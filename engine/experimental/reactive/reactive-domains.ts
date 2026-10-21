/** One publication boundary for a primary world and finite reactive reservoirs. */
import { reactiveInteger3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';
import { createReactiveWorld3D, type ReactiveWorld3D } from './reactive-world.js';
import {
  createReactiveWorldTickJob3D,
  type ReactiveWorldSnapshot3D,
  type ReactiveWorldTickJob3D,
  type ReactiveWorldTickReport3D,
} from './reactive-world-tick.js';
import {
  createReactiveTranslationJob3D,
  type ReactiveTranslationRequest3D,
  type ReactiveTranslationJob3D,
} from './reactive-translation.js';
import {
  createReactiveTransferJob3D,
  type ReactiveTransferRequest3D,
  type ReactiveTransferJob3D,
} from './reactive-transfer.js';
import { REACTIVE_STRUCTURE_MAX_WORK_3D } from './reactive-structure.js';
import {
  readReactiveTickOptions3D,
  REACTIVE_MOTION_RULES_3D,
  type ReactiveTickOptions3D,
  type ReactiveMotionReport3D,
} from './reactive-motion-capture.js';
import type { ReactiveMaterialEdit3D } from './reactive-block.js';
import type { ReactiveHoldRequest3D } from './reactive-holds.js';
import {
  REACTIVE_DOMAINS_RULES_3D,
  createReactiveDomainsSnapshot3D,
  readReactiveDomainsSnapshot3D,
  reactiveDomain3D,
  reactiveDomainList3D,
  replaceReactiveDomain3D,
  reactiveDomainsEnergyQ3D,
  compatibleReactiveDomains3D,
  type ReactiveDomainId3D,
  type ReactiveReservoir3D,
  type ReactiveDomainsSnapshot3D,
} from './reactive-domain-state.js';
export type ReactiveDomainsTickReport3D = {
  rulesVersion: typeof REACTIVE_DOMAINS_RULES_3D;
  materialCatalogHash: string;
  fromTick: number;
  toTick: number;
  domains: { id: ReactiveDomainId3D; report: ReactiveWorldTickReport3D }[];
  energy: { beforeQ: string; afterQ: string; externalQ: '0'; driftQ: '0' };
};
export type ReactiveDomainsTickResult3D = {
  state: ReactiveDomainsSnapshot3D;
  report: ReactiveDomainsTickReport3D;
};
export type ReactiveDomainsTickProgress3D = {
  status: 'running' | 'complete' | 'cancelled';
  phase: 'domain-prepare' | 'domain' | 'publish' | 'complete';
  completedDomains: number;
  totalDomains: number;
  activeDomain: ReactiveDomainId3D | undefined;
};
export type ReactiveDomainsMotion3D = {
  rulesVersion: typeof REACTIVE_MOTION_RULES_3D;
  fromTick: number;
  toTick: number;
  status: 'disabled' | 'complete' | 'overflow';
  requiresReexecution: boolean;
  maxEntries: number;
  entries: number;
  overflowDomain: ReactiveDomainId3D;
  domains: { id: ReactiveDomainId3D; motion: ReactiveMotionReport3D }[];
};
export interface ReactiveDomainsTickJob3D {
  progress(): ReactiveDomainsTickProgress3D;
  advance(work?: number): ReactiveDomainsTickProgress3D;
  cancel(): boolean;
  result(): ReactiveDomainsTickResult3D;
  motion(): ReactiveDomainsMotion3D;
}
export function createReactiveDomainsTickJob3D(
  registry: ReactiveMaterialRegistry3D,
  raw: ReactiveDomainsSnapshot3D,
  options: ReactiveTickOptions3D = {},
): ReactiveDomainsTickJob3D {
  const capture = readReactiveTickOptions3D(options);
  let state: ReactiveDomainsSnapshot3D | null = readReactiveDomainsSnapshot3D(registry, raw);
  if (state.tick === Number.MAX_SAFE_INTEGER) throw Error('Reactive domain tick would overflow.');
  const fromTick = state.tick,
    ids = reactiveDomainList3D(state).map((d) => d.id),
    beforeQ = reactiveDomainsEnergyQ3D(state);
  const motion: ReactiveDomainsMotion3D = {
    rulesVersion: REACTIVE_MOTION_RULES_3D,
    fromTick,
    toTick: fromTick + 1,
    status: capture.enabled ? 'complete' : 'disabled',
    requiresReexecution: !capture.enabled,
    maxEntries: capture.maxEntries,
    entries: 0,
    overflowDomain: null,
    domains: [],
  };
  let active: ReactiveWorldTickJob3D | null = null,
    reports: ReactiveDomainsTickReport3D['domains'] = [],
    result: ReactiveDomainsTickResult3D | null = null;
  let completedDomains = 0,
    status: ReactiveDomainsTickProgress3D['status'] = 'running',
    phase: ReactiveDomainsTickProgress3D['phase'] = 'domain-prepare';
  const progress = (): ReactiveDomainsTickProgress3D => ({
    status,
    phase,
    completedDomains,
    totalDomains: ids.length,
    activeDomain:
      phase === 'domain' || phase === 'domain-prepare' ? ids[completedDomains] : undefined,
  });
  const cancel = () => {
    if (status !== 'running') return false;
    active?.cancel();
    active = null;
    state = null;
    reports = [];
    motion.domains = [];
    motion.entries = 0;
    status = 'cancelled';
    return true;
  };
  return Object.freeze({
    progress,
    cancel,
    advance(work: number = 64) {
      reactiveInteger3D(work, 1, REACTIVE_STRUCTURE_MAX_WORK_3D);
      if (status !== 'running' || !state) throw Error('Reactive domain tick is no longer running.');
      try {
        if (phase === 'domain-prepare') {
          active = createReactiveWorldTickJob3D(
            registry,
            reactiveDomain3D(state, ids[completedDomains]),
            motion.status === 'complete'
              ? { motion: { maxEntries: capture.maxEntries - motion.entries } }
              : {},
          );
          phase = 'domain';
        } else if (phase === 'domain') {
          if (active!.advance(work).status === 'complete') {
            const output = active!.result(),
              id = ids[completedDomains];
            state = replaceReactiveDomain3D(state, id, output.state);
            if (motion.status === 'complete') {
              const observed = active!.motion();
              if (observed.status !== 'complete') {
                motion.status = 'overflow';
                motion.requiresReexecution = true;
                motion.overflowDomain = id;
                motion.domains = [];
                motion.entries = 0;
              } else {
                motion.domains.push({ id, motion: observed });
                motion.entries += observed.entries;
              }
            }
            reports.push({ id, report: output.report });
            active = null;
            completedDomains++;
            phase = completedDomains === ids.length ? 'publish' : 'domain-prepare';
          }
        } else if (phase === 'publish') {
          const validated = readReactiveDomainsSnapshot3D(registry, {
              ...state,
              tick: fromTick + 1,
            }),
            afterQ = reactiveDomainsEnergyQ3D(validated);
          if (afterQ !== beforeQ) throw Error('Reactive domain tick lost conserved energy.');
          result = {
            state: validated,
            report: {
              rulesVersion: REACTIVE_DOMAINS_RULES_3D,
              materialCatalogHash: registry.hash,
              fromTick,
              toTick: fromTick + 1,
              domains: reports,
              energy: {
                beforeQ: beforeQ.toString(),
                afterQ: afterQ.toString(),
                externalQ: '0',
                driftQ: '0',
              },
            },
          };
          state = null;
          reports = [];
          status = 'complete';
          phase = 'complete';
        }
      } catch (error) {
        cancel();
        throw error;
      }
      return progress();
    },
    result() {
      if (!result || status !== 'complete') throw Error('Reactive domain tick is not complete.');
      return structuredClone(result);
    },
    motion() {
      if (status !== 'complete') throw Error('Reactive domain motion is not complete.');
      return structuredClone(motion);
    },
  });
}
export type ReactiveDomainCommit3D<T> = {
  fromRevision: number;
  toRevision: number;
  tick: number;
  receipt: T;
};
export type ReactiveDomainSet3D = ReturnType<typeof createReactiveDomainSet3D>;
export function createReactiveDomainSet3D(
  registry: ReactiveMaterialRegistry3D,
  world: ReactiveWorldSnapshot3D,
  reservoirs: readonly ReactiveReservoir3D[] = [],
) {
  let live = createReactiveDomainsSnapshot3D(registry, world, reservoirs),
    revision = 0,
    initialQ = reactiveDomainsEnergyQ3D(live),
    externalQ = 0n;
  const ticks = new WeakMap<ReactiveDomainsTickJob3D, number>(),
    transfers = new WeakMap<ReactiveTransferJob3D, number>();
  const translations = new WeakMap<
    ReactiveTranslationJob3D,
    { revision: number; domain: ReactiveDomainId3D }
  >();
  let mutating = false,
    poisoned = false;
  const nextRevision = () => reactiveInteger3D(revision + 1, 0, Number.MAX_SAFE_INTEGER);
  const mutation = <T>(operation: (ensure: () => void) => T): T => {
    if (mutating) {
      poisoned = true;
      throw Error('Reactive domain mutations cannot reenter.');
    }
    mutating = true;
    poisoned = false;
    try {
      return operation(() => {
        if (poisoned) throw Error('Reactive domain mutation invalidated by reentry.');
      });
    } finally {
      mutating = false;
      poisoned = false;
    }
  };
  const publish = <T>(
    state: ReactiveDomainsSnapshot3D,
    charge: bigint,
    receipt: T,
    ensure: () => void,
  ): ReactiveDomainCommit3D<T> => {
    const next = nextRevision(),
      before = revision;
    if (reactiveDomainsEnergyQ3D(state) !== initialQ + externalQ + charge)
      throw Error('Reactive domain accounting mismatch.');
    ensure();
    live = state;
    externalQ += charge;
    revision = next;
    return { fromRevision: before, toRevision: next, tick: live.tick, receipt };
  };
  const alter = <T>(
    id: ReactiveDomainId3D,
    operation: (field: ReactiveWorld3D) => { receipt: T; charge: bigint },
  ) =>
    mutation((ensure) => {
      nextRevision();
      const old = reactiveDomain3D(live, id),
        field = createReactiveWorld3D(registry, old.block, old.tick);
      field.restore(old);
      const { receipt, charge } = operation(field),
        state = replaceReactiveDomain3D(live, id, field.snapshot());
      return publish(state, charge, { domain: id, value: receipt }, ensure);
    });
  const current = <J extends object>(map: WeakMap<J, number>, job: J) => {
    const base = map.get(job);
    if (base === undefined) throw Error('Reactive domain job is foreign or consumed.');
    if (base !== revision) throw Error('Reactive domain job is stale; recompute.');
  };
  return Object.freeze({
    get revision() {
      return revision;
    },
    get tick() {
      return live.tick;
    },
    snapshot() {
      return structuredClone(live);
    },
    domain(id: ReactiveDomainId3D) {
      return structuredClone(reactiveDomain3D(live, id));
    },
    edit(id: ReactiveDomainId3D, edits: readonly ReactiveMaterialEdit3D[]) {
      return alter(id, (field) => {
        const { receipt } = field.edit(edits);
        return { receipt, charge: BigInt(receipt.externalEnergyQ) };
      });
    },
    hold(id: ReactiveDomainId3D, request: ReactiveHoldRequest3D) {
      return alter(id, (field) => {
        const { holds, rulesVersion } = field.hold(request);
        return { receipt: { holds, rulesVersion }, charge: 0n };
      });
    },
    releaseHold(id: ReactiveDomainId3D, holdId: string) {
      return alter(id, (field) => {
        const { holds, rulesVersion } = field.releaseHold(holdId);
        return { receipt: { holds, rulesVersion }, charge: 0n };
      });
    },
    prepareTransfer(request: ReactiveTransferRequest3D) {
      return mutation((ensure) => {
        nextRevision();
        const job = createReactiveTransferJob3D(registry, live, request);
        ensure();
        transfers.set(job, revision);
        return job;
      });
    },
    commitTransfer(job: ReactiveTransferJob3D) {
      return mutation((ensure) => {
        current(transfers, job);
        const out = job.result();
        if (out.state.tick !== live.tick) throw Error('Reactive transfer tick differs.');
        const receipt = publish(out.state, 0n, out.receipt, ensure);
        transfers.delete(job);
        return receipt;
      });
    },
    prepareTick(options: ReactiveTickOptions3D = {}) {
      return mutation((ensure) => {
        nextRevision();
        const job = createReactiveDomainsTickJob3D(registry, live, options);
        ensure();
        ticks.set(job, revision);
        return job;
      });
    },
    commitTick(job: ReactiveDomainsTickJob3D) {
      return mutation((ensure) => {
        current(ticks, job);
        const out = job.result();
        if (out.state.tick !== live.tick + 1) throw Error('Reactive domain tick differs.');
        const receipt = publish(out.state, 0n, out.report, ensure);
        ticks.delete(job);
        return receipt;
      });
    },
    prepareTranslation(id: ReactiveDomainId3D, request: ReactiveTranslationRequest3D) {
      return mutation((ensure) => {
        nextRevision();
        const job = createReactiveTranslationJob3D(registry, reactiveDomain3D(live, id), request);
        ensure();
        translations.set(job, { revision, domain: id });
        return job;
      });
    },
    commitTranslation(job: ReactiveTranslationJob3D) {
      return mutation((ensure) => {
        const base = translations.get(job);
        if (!base) throw Error('Reactive translation is foreign or consumed.');
        if (base.revision !== revision) throw Error('Reactive translation is stale; recompute.');
        const out = job.result();
        if (out.state.tick !== live.tick) throw Error('Reactive translation tick differs.');
        const result = publish(
          replaceReactiveDomain3D(live, base.domain, out.state),
          0n,
          { domain: base.domain, value: out.receipt },
          ensure,
        );
        translations.delete(job);
        return result;
      });
    },
    restore(raw: unknown) {
      return mutation((ensure) => {
        const next = nextRevision(),
          restored = readReactiveDomainsSnapshot3D(registry, raw);
        compatibleReactiveDomains3D(live, restored);
        const baseline = reactiveDomainsEnergyQ3D(restored);
        ensure();
        live = restored;
        initialQ = baseline;
        externalQ = 0n;
        revision = next;
      });
    },
    energyBalance() {
      const currentQ = reactiveDomainsEnergyQ3D(live);
      return { initialQ, externalQ, currentQ, driftQ: currentQ - initialQ - externalQ };
    },
  });
}
