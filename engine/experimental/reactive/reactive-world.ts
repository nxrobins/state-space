/** Owned reactive CPU world: revision-bound complete ticks and accounted atomic edits. */
import {
  editReactiveMaterialBlock3D,
  stageReactiveMaterialEdits3D,
  reactiveMaterialEnergyLedger3D,
  reactiveEnergyTotalQ3D,
  type ReactiveMaterialBlock3D,
  type ReactiveMaterialEdit3D,
} from './reactive-block.js';
import {
  assertReactiveRealm3D,
  reactiveInteger3D,
  cloneReactiveData3D,
  cloneReactiveDataQuietly3D,
  reactivePlainObjectPrototype3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';
import type { ReactiveTickOptions3D } from './reactive-motion-capture.js';
import {
  REACTIVE_HOLD_RULES_3D,
  copyReactiveHolds3D,
  addReactiveHold3D,
  removeReactiveHold3D,
  reactiveHoldsAfterReplacement3D,
  type ReactiveHold3D,
  type ReactiveHoldRequest3D,
} from './reactive-holds.js';
import {
  createReactiveTranslationJob3D,
  type ReactiveTranslationJob3D,
  type ReactiveTranslationRequest3D,
  type ReactiveTranslationReceipt3D,
} from './reactive-translation.js';
import {
  createReactiveWorldSnapshot3D,
  createConstrainedReactiveWorldSnapshot3D,
  reactiveSnapshotHolds3D,
  readReactiveWorldSnapshot3D,
  startReactiveWorldTickJob3D,
  type ReactiveWorldSnapshot3D,
  type ReactiveWorldTickJob3D,
  type ReactiveWorldTickReport3D,
  type ReactiveWorldTickResult3D,
} from './reactive-world-tick.js';

export type ReactiveWorldTickCommit3D = {
  fromRevision: number;
  toRevision: number;
  report: ReactiveWorldTickReport3D;
};
export type ReactiveWorldEditCommit3D = {
  fromRevision: number;
  toRevision: number;
  tick: number;
  receipt: ReturnType<typeof editReactiveMaterialBlock3D>['receipt'];
};
export type ReactiveWorldTranslationCommit3D = {
  fromRevision: number;
  toRevision: number;
  receipt: ReactiveTranslationReceipt3D;
};
export type ReactiveWorldHoldCommit3D = {
  fromRevision: number;
  toRevision: number;
  tick: number;
  rulesVersion: typeof REACTIVE_HOLD_RULES_3D;
  holds: ReactiveHold3D[];
};
export interface ReactiveWorld3D {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly tick: number;
  /** Monotonic within this instance; not a portable or globally unique identity. */
  readonly revision: number;
  snapshot(): ReactiveWorldSnapshot3D;
  edit(edits: readonly ReactiveMaterialEdit3D[]): ReactiveWorldEditCommit3D;
  prepareTick(options?: ReactiveTickOptions3D): ReactiveWorldTickJob3D;
  commitTick(job: ReactiveWorldTickJob3D): ReactiveWorldTickCommit3D;
  prepareTranslation(request: ReactiveTranslationRequest3D): ReactiveTranslationJob3D;
  commitTranslation(job: ReactiveTranslationJob3D): ReactiveWorldTranslationCommit3D;
  holds(): ReactiveHold3D[];
  hold(request: ReactiveHoldRequest3D): ReactiveWorldHoldCommit3D;
  releaseHold(id: string): ReactiveWorldHoldCommit3D;
  restore(snapshot: unknown): void;
  energyLedger(): ReturnType<typeof reactiveMaterialEnergyLedger3D>;
  energyBalance(): { initialQ: bigint; externalQ: bigint; currentQ: bigint; driftQ: bigint };
}
const total = (block: ReactiveMaterialBlock3D) => reactiveEnergyTotalQ3D(block.energyQ);
export function createReactiveWorld3D(
  registry: ReactiveMaterialRegistry3D,
  block: ReactiveMaterialBlock3D,
  tick: number = 0,
): ReactiveWorld3D {
  let live = createReactiveWorldSnapshot3D(registry, block, tick),
    revision = 0,
    initialQ = total(live.block),
    externalQ = 0n;
  const { width, height, depth } = live.block,
    // Each prepared job's base revision, and the taker of its uncopied result.
    prepared = new WeakMap<
      ReactiveWorldTickJob3D,
      { base: number; take: () => { result: ReactiveWorldTickResult3D; handed: boolean } }
    >();
  const translations = new WeakMap<ReactiveTranslationJob3D, number>();
  const nextRevision = () => reactiveInteger3D(revision + 1, 0, Number.MAX_SAFE_INTEGER);
  let mutating = false,
    poisoned = false;
  const mutation = <T>(operation: (ensureValid: () => void) => T): T => {
    if (mutating) {
      poisoned = true;
      throw Error('Reactive world mutations cannot reenter.');
    }
    mutating = true;
    poisoned = false;
    try {
      return operation(() => {
        if (poisoned) throw Error('Reactive world mutation was invalidated by reentry.');
      });
    } finally {
      mutating = false;
      poisoned = false;
    }
  };
  return Object.freeze({
    width,
    height,
    depth,
    get tick() {
      return live.tick;
    },
    get revision() {
      return revision;
    },
    snapshot() {
      return cloneReactiveData3D(live);
    },
    edit(edits: readonly ReactiveMaterialEdit3D[]) {
      return mutation((ensureValid) => {
        const next = nextRevision(),
          {
            block: edited,
            receipt,
            replacedCells,
          } = stageReactiveMaterialEdits3D(registry, live.block, edits);
        const charge = BigInt(receipt.externalEnergyQ),
          before = revision;
        if (total(edited) !== initialQ + externalQ + charge)
          throw Error('Reactive world edit accounting mismatch.');
        ensureValid();
        live =
          live.schemaVersion === 2
            ? {
                ...live,
                block: edited,
                holds: reactiveHoldsAfterReplacement3D(live.holds, replacedCells),
              }
            : { ...live, block: edited };
        externalQ += charge;
        revision = next;
        return { fromRevision: before, toRevision: next, tick: live.tick, receipt };
      });
    },
    prepareTick(options: ReactiveTickOptions3D = {}) {
      // The live snapshot is always owned and validated, so the tick reads it without a second copy.
      return mutation((ensureValid) => {
        nextRevision();
        const { job, take } = startReactiveWorldTickJob3D(registry, live, options);
        ensureValid();
        prepared.set(job, { base: revision, take });
        return job;
      });
    },
    commitTick(job: ReactiveWorldTickJob3D) {
      return mutation((ensureValid) => {
        const entry = prepared.get(job);
        if (entry === undefined) throw Error('Reactive tick job is foreign or already consumed.');
        const base = entry.base;
        if (base !== revision)
          throw Error('Reactive tick job is stale; recompute from the committed revision.');
        assertReactiveRealm3D();
        // live adopts the job's immutable result state; only the handed-out report is copied. A job
        // whose result() was read is copied, as before: in a realm whose slice was replaced before the
        // SDK loaded, that read may have handed out the job's own arrays. While Object.prototype is not
        // as the realm starts it, its hooks may have seen the job's objects, so the state is cloned
        // without running caller code.
        const next = nextRevision(),
          { result: taken, handed } = entry.take(),
          output = {
            state: !reactivePlainObjectPrototype3D()
              ? cloneReactiveDataQuietly3D(taken.state)
              : handed
                ? cloneReactiveData3D(taken.state)
                : taken.state,
            report: cloneReactiveData3D(taken.report),
          },
          report = output.report;
        if (
          output.state.tick !== live.tick + 1 ||
          total(output.state.block) !== initialQ + externalQ
        )
          throw Error('Reactive tick commit identity or accounting mismatch.');
        ensureValid();
        live = output.state;
        revision = next;
        prepared.delete(job);
        return { fromRevision: base, toRevision: next, report };
      });
    },
    prepareTranslation(request: ReactiveTranslationRequest3D) {
      return mutation((ensureValid) => {
        nextRevision();
        const job = createReactiveTranslationJob3D(registry, live, request);
        ensureValid();
        translations.set(job, revision);
        return job;
      });
    },
    commitTranslation(job: ReactiveTranslationJob3D) {
      return mutation((ensureValid) => {
        const base = translations.get(job);
        if (base === undefined)
          throw Error('Reactive translation job is foreign or already consumed.');
        if (base !== revision)
          throw Error('Reactive translation job is stale; recompute from the committed revision.');
        const next = nextRevision(),
          output = job.result();
        if (output.state.tick !== live.tick || total(output.state.block) !== initialQ + externalQ)
          throw Error('Reactive translation commit identity or accounting mismatch.');
        ensureValid();
        live = output.state;
        revision = next;
        translations.delete(job);
        return { fromRevision: base, toRevision: next, receipt: output.receipt };
      });
    },
    holds() {
      return copyReactiveHolds3D(reactiveSnapshotHolds3D(live));
    },
    hold(request: ReactiveHoldRequest3D): ReactiveWorldHoldCommit3D {
      return mutation((ensureValid) => {
        const next = nextRevision(),
          base = revision,
          holds = addReactiveHold3D(
            registry,
            live.block,
            live.tick,
            reactiveSnapshotHolds3D(live),
            request,
          );
        const changed = createConstrainedReactiveWorldSnapshot3D(
          registry,
          live.block,
          live.tick,
          holds,
        );
        ensureValid();
        live = changed;
        revision = next;
        return {
          fromRevision: base,
          toRevision: next,
          tick: live.tick,
          rulesVersion: REACTIVE_HOLD_RULES_3D,
          holds: copyReactiveHolds3D(holds),
        };
      });
    },
    releaseHold(id: string): ReactiveWorldHoldCommit3D {
      return mutation((ensureValid) => {
        const next = nextRevision(),
          base = revision,
          holds = removeReactiveHold3D(reactiveSnapshotHolds3D(live), id);
        const changed = createConstrainedReactiveWorldSnapshot3D(
          registry,
          live.block,
          live.tick,
          holds,
        );
        ensureValid();
        live = changed;
        revision = next;
        return {
          fromRevision: base,
          toRevision: next,
          tick: live.tick,
          rulesVersion: REACTIVE_HOLD_RULES_3D,
          holds: copyReactiveHolds3D(holds),
        };
      });
    },
    restore(snapshot: unknown) {
      return mutation((ensureValid) => {
        const next = nextRevision(),
          restored = readReactiveWorldSnapshot3D(registry, snapshot);
        if (
          restored.block.width !== width ||
          restored.block.height !== height ||
          restored.block.depth !== depth
        )
          throw Error('Reactive restore dimensions differ.');
        const baseline = total(restored.block);
        ensureValid();
        live = restored;
        revision = next;
        initialQ = baseline;
        externalQ = 0n;
      });
    },
    energyLedger() {
      return reactiveMaterialEnergyLedger3D(registry, live.block);
    },
    energyBalance() {
      const currentQ = total(live.block);
      return { initialQ, externalQ, currentQ, driftQ: currentQ - initialQ - externalQ };
    },
  });
}
