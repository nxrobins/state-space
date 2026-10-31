/** Snapshot-backed speculative abilities. Only complete same-revision commits publish. */
import { copyPortableValue } from '../../portable-data.js';
import {
  reactiveFields3D,
  reactiveInteger3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';
import {
  compatibleReactiveDomains3D,
  reactiveDomainsEnergyQ3D,
  reactiveDomain3D,
  reactiveDomainId3D,
  replaceReactiveDomain3D,
  type ReactiveDomainId3D,
  type ReactiveDomainsSnapshot3D,
} from './reactive-domain-state.js';
import {
  createReactiveGeometry3D,
  type ReactiveGeometryIdentity3D,
  type ReactiveGameplayGeometry3D,
} from './reactive-geometry.js';
import {
  readReactiveTickOptions3D,
  type ReactiveTickOptions3D,
} from './reactive-motion-capture.js';
import { bindReactiveTickMovement3D, type ReactiveTickMovement3D } from './reactive-motion.js';
import {
  readReactiveTranslationCapture3D,
  createReactiveTranslationMovementAccess3D,
  type ReactiveTranslationCaptureOptions3D,
  type ReactiveTranslationMovement3D,
} from './reactive-translation-motion.js';
import {
  createReactiveDomainSet3D,
  type ReactiveDomainSet3D,
  type ReactiveDomainsTickJob3D,
  type ReactiveDomainsTickReport3D,
} from './reactive-domains.js';
import type { ReactiveMaterialEdit3D } from './reactive-block.js';
import type { ReactiveHoldRequest3D } from './reactive-holds.js';
import type {
  ReactiveTranslationJob3D,
  ReactiveTranslationRequest3D,
  ReactiveTranslationReceipt3D,
} from './reactive-translation.js';
import type { ReactiveTransferJob3D, ReactiveTransferRequest3D } from './reactive-transfer.js';
import {
  REACTIVE_SESSION_LIMITS_3D,
  createReactiveSessionSnapshot3D,
  readReactiveSessionSnapshot3D,
  reactiveSessionRevision3D,
  type ReactiveGameValue3D,
  type ReactiveSessionInitial3D,
  type ReactiveSessionSnapshot3D,
  type ReactiveSessionRevision3D,
} from './reactive-session-state.js';
import {
  createReactiveMaterialTransportJob3D,
  captureReactiveMaterialTransportMemory3D,
  restoreReactiveMaterialTransportMemory3D,
  type ReactiveMaterialTransportJob3D,
  type ReactiveMaterialTransportMemory3D,
  type ReactiveMaterialTransportReceipt3D,
  type ReactiveMaterialImpulse3D,
} from './reactive-transport.js';
import {
  readReactiveTransportCapture3D,
  createReactiveTransportMovementAccess3D,
  type ReactiveTransportCaptureOptions3D,
  type ReactiveTransportMovement3D,
} from './reactive-transport-motion.js';
export type ReactiveTransportCommand3D = {
  kind: 'transport';
  domain: ReactiveDomainId3D;
  control: string;
  impulses?: readonly ReactiveMaterialImpulse3D[];
};
export type ReactiveTransportCommandResult3D = {
  domain: ReactiveDomainId3D;
  control: string;
  receipt: ReactiveMaterialTransportReceipt3D;
  memory: ReactiveMaterialTransportMemory3D;
  movement: ReactiveTransportMovement3D;
};
export type ReactiveSessionTransportAccess3D = () => ReactiveTransportCommandResult3D | null;
export type ReactiveSessionCommand3D<T extends ReactiveGameValue3D> =
  | ReactiveTransportCommand3D
  | { kind: 'edit'; domain: ReactiveDomainId3D; edits: readonly ReactiveMaterialEdit3D[] }
  | { kind: 'translate'; domain: ReactiveDomainId3D; request: ReactiveTranslationRequest3D }
  | { kind: 'transfer'; request: ReactiveTransferRequest3D }
  | { kind: 'hold'; domain: ReactiveDomainId3D; request: ReactiveHoldRequest3D }
  | { kind: 'releaseHold'; domain: ReactiveDomainId3D; id: string }
  | { kind: 'game'; game: T };
export type ReactiveSessionQueryAccess3D = (
  domain?: ReactiveDomainId3D,
) => ReactiveGameplayGeometry3D;
export type ReactiveSessionMovementAccess3D = (
  domain?: ReactiveDomainId3D,
) => ReactiveTickMovement3D;
export type ReactiveSessionTranslationAccess3D = () => ReactiveTranslationMovement3D | null;
export type ReactiveSessionPolicy3D<T extends ReactiveGameValue3D> = {
  /** Pure selection from the current staged game. Required with reduceCommand for transport. */
  readTransport?: (context: {
    game: T;
    command: ReactiveTransportCommand3D;
    queries: ReactiveSessionQueryAccess3D;
  }) => ReactiveMaterialTransportMemory3D;
  /** Pure synchronous application policy. Keep RNG and actor state inside game. */
  reduceTick?: (context: {
    game: T;
    domains: ReactiveDomainsSnapshot3D;
    report: ReactiveDomainsTickReport3D;
    beforeQueries: ReactiveSessionQueryAccess3D;
    queries: ReactiveSessionQueryAccess3D;
    movement: ReactiveSessionMovementAccess3D;
  }) => T;
  reduceCommand?: (context: {
    game: T;
    command: ReactiveSessionCommand3D<T>;
    receipt: CommandReceipt;
    beforeQueries: ReactiveSessionQueryAccess3D;
    queries: ReactiveSessionQueryAccess3D;
    translation: ReactiveSessionTranslationAccess3D;
    transport: ReactiveSessionTransportAccess3D;
  }) => T;
  validateGame?: (snapshot: ReactiveSessionSnapshot3D<T>) => boolean;
};
export type ReactiveBranchStatus3D =
  'preparing' | 'running' | 'ready' | 'failed' | 'discarded' | 'stale' | 'committed';
export type ReactiveBranchProgress3D = {
  status: ReactiveBranchStatus3D;
  phase: 'preparing' | 'commands' | 'ticks' | 'finalize' | 'terminal';
  completedCommands: number;
  totalCommands: number;
  completedTicks: number;
  horizonTicks: number;
};
type CommandReceipt =
  | ReturnType<ReactiveDomainSet3D['edit']>['receipt']
  | ReturnType<ReactiveDomainSet3D['hold']>['receipt']
  | ReturnType<ReactiveDomainSet3D['commitTranslation']>['receipt']
  | ReturnType<ReactiveDomainSet3D['commitTransfer']>['receipt']
  | {
      kind: 'transport';
      domain: ReactiveDomainId3D;
      control: string;
      value: ReactiveMaterialTransportReceipt3D;
      memory: ReactiveMaterialTransportMemory3D;
    }
  | { gameChanged: true };
export type ReactiveSessionBoundary3D = { sequence: number; tick: number } & (
  | {
      kind: 'command';
      commandKind: ReactiveSessionCommand3D<ReactiveGameValue3D>['kind'];
      receipt: CommandReceipt;
    }
  | { kind: 'tick'; report: ReactiveDomainsTickReport3D }
);
export type ReactiveSessionPreview3D<T extends ReactiveGameValue3D> = {
  base: Readonly<ReactiveSessionRevision3D>;
  branchId: number;
  progress: ReactiveBranchProgress3D;
  state: ReactiveSessionSnapshot3D<T>;
};
export interface ReactiveBranch3D<T extends ReactiveGameValue3D> {
  readonly base: Readonly<ReactiveSessionRevision3D>;
  readonly branchId: number;
  progress(): ReactiveBranchProgress3D;
  enqueue(command: ReactiveSessionCommand3D<T>): void;
  advance(work?: number): ReactiveBranchProgress3D;
  inspect(): ReactiveSessionPreview3D<T>;
  queries(domain?: ReactiveDomainId3D): ReactiveGameplayGeometry3D;
  /** Only the most recent completed command/tick. The caller owns any history. */
  lastBoundary(): ReactiveSessionBoundary3D | null;
  lastMovement(domain?: ReactiveDomainId3D): ReactiveTickMovement3D | null;
  lastTranslation(): ReactiveTranslationMovement3D | null;
  lastTransport(): ReactiveTransportCommandResult3D | null;
  discard(): boolean;
}
export type ReactiveSessionCommit3D<T extends ReactiveGameValue3D> = {
  snapshot: ReactiveSessionSnapshot3D<T>;
  receipt: {
    base: Readonly<ReactiveSessionRevision3D>;
    revision: number;
    completedCommands: number;
    horizonTicks: number;
    endTick: number;
    externalEnergyQ: string;
  };
};
type CommandStage = { field: ReactiveDomainSet3D; before: ReactiveDomainsSnapshot3D };
type ActiveCommand = CommandStage &
  (
    | { kind: 'transfer'; job: ReactiveTransferJob3D }
    | { kind: 'translate'; job: ReactiveTranslationJob3D }
    | { kind: 'transport'; job: ReactiveMaterialTransportJob3D }
  );
type BranchRecord<T extends ReactiveGameValue3D> = {
  base: Readonly<ReactiveSessionRevision3D>;
  id: number;
  horizon: number;
  status: ReactiveBranchStatus3D;
  field: ReactiveDomainSet3D | null;
  game: T | null;
  accounting: { initialQ: string; externalQ: string };
  commands: ReactiveSessionCommand3D<T>[];
  totalCommands: number;
  completedCommands: number;
  completedTicks: number;
  nodes: number;
  characters: number;
  active: ActiveCommand | null;
  tickJob: ReactiveDomainsTickJob3D | null;
  last: ReactiveSessionBoundary3D | null;
  motionOptions: ReactiveTickOptions3D;
  lastMotion: ReactiveSessionMovementAccess3D | null;
  translationOptions: { maxEntries: number } | null;
  lastTranslation: ReactiveSessionTranslationAccess3D | null;
  transportOptions: { maxEntries: number } | null;
  lastTransport: ReactiveSessionTransportAccess3D | null;
};
function synchronous<T>(value: T): T {
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  ) {
    void Promise.resolve(value).catch(() => {});
    throw Error('Reactive application policies must be synchronous.');
  }
  return value;
}
function commandData<T extends ReactiveGameValue3D>(raw: ReactiveSessionCommand3D<T>) {
  const copied = copyPortableValue(raw as unknown as ReactiveGameValue3D);
  if (
    !copied ||
    typeof copied !== 'object' ||
    Array.isArray(copied) ||
    typeof copied.kind !== 'string'
  )
    throw Error('Invalid reactive session command.');
  const fields = {
    transport: ['domain', 'control'],
    edit: ['domain', 'edits'],
    translate: ['domain', 'request'],
    transfer: ['request'],
    hold: ['domain', 'request'],
    releaseHold: ['domain', 'id'],
    game: ['game'],
  } as const;
  if (!Object.hasOwn(fields, copied.kind)) throw Error('Unknown reactive session command.');
  reactiveFields3D(
    copied,
    ['kind', ...fields[copied.kind as keyof typeof fields]],
    copied.kind === 'transport' ? ['impulses'] : [],
  );
  if (copied.kind === 'transport') {
    reactiveDomainId3D(copied.domain);
    if (typeof copied.control !== 'string') throw Error('Invalid transport control identity.');
    reactiveDomainId3D(copied.control);
  }
  let nodes = 0,
    characters = 0;
  const measure = (v: ReactiveGameValue3D) => {
    nodes++;
    if (typeof v === 'string') characters += v.length;
    else if (Array.isArray(v)) for (const item of v) measure(item);
    else if (v && typeof v === 'object')
      for (const [key, value] of Object.entries(v)) {
        characters += key.length;
        measure(value);
      }
  };
  measure(copied);
  return { command: copied as unknown as ReactiveSessionCommand3D<T>, nodes, characters };
}
export function createReactiveSession3D<T extends ReactiveGameValue3D>(
  registry: ReactiveMaterialRegistry3D,
  initial: ReactiveSessionInitial3D<T>,
  policy: ReactiveSessionPolicy3D<T> = {},
) {
  reactiveFields3D(policy, [], ['reduceTick', 'reduceCommand', 'validateGame', 'readTransport']);
  for (const key of ['reduceTick', 'reduceCommand', 'validateGame', 'readTransport'] as const)
    if (Object.hasOwn(policy, key) && typeof policy[key] !== 'function')
      throw Error('Invalid reactive application policy.');
  const { reduceTick, reduceCommand, validateGame, readTransport } = policy;
  let live = createReactiveSessionSnapshot3D(registry, initial),
    nextId = 0,
    mutating = false,
    poisoned = false;
  const records = new WeakMap<ReactiveBranch3D<T>, BranchRecord<T>>(),
    active = new Set<BranchRecord<T>>();
  const mutation = <R>(operation: (ensure: () => void) => R): R => {
    if (mutating) {
      poisoned = true;
      throw Error('Reactive session mutations cannot reenter.');
    }
    mutating = true;
    poisoned = false;
    try {
      return operation(() => {
        if (poisoned) throw Error('Reactive session mutation invalidated by reentry.');
      });
    } finally {
      mutating = false;
      poisoned = false;
    }
  };
  const validate = (snapshot: ReactiveSessionSnapshot3D<T>) => {
    if (validateGame && synchronous(validateGame(structuredClone(snapshot))) !== true)
      throw Error('Reactive game policy rejected the transaction.');
  };
  validate(live);
  const release = (r: BranchRecord<T>, status: ReactiveBranchStatus3D) => {
    r.active?.job.cancel();
    r.tickJob?.cancel();
    r.active = null;
    r.tickJob = null;
    r.field = null;
    r.game = null;
    r.commands = [];
    r.last = null;
    r.lastMotion = null;
    r.lastTranslation = null;
    r.lastTransport = null;
    r.status = status;
    active.delete(r);
  };
  const current = (r: BranchRecord<T>) => {
    if (r.status === 'stale') throw Error('Reactive branch is stale; recompute.');
    if (!active.has(r)) throw Error('Reactive branch is no longer active.');
    if (r.base.revision !== live.revision) {
      release(r, 'stale');
      throw Error('Reactive branch is stale; recompute.');
    }
  };
  const progress = (r: BranchRecord<T>): ReactiveBranchProgress3D => ({
    status: r.status,
    phase:
      r.status === 'preparing'
        ? 'preparing'
        : r.status !== 'running'
          ? 'terminal'
          : r.completedCommands < r.totalCommands
            ? 'commands'
            : r.completedTicks < r.horizon
              ? 'ticks'
              : 'finalize',
    completedCommands: r.completedCommands,
    totalCommands: r.totalCommands,
    completedTicks: r.completedTicks,
    horizonTicks: r.horizon,
  });
  const draft = (r: BranchRecord<T>): ReactiveSessionSnapshot3D<T> => ({
    ...live,
    revision: r.base.revision,
    domains: r.field!.snapshot(),
    game: copyPortableValue(r.game as T),
    accounting: {
      initialQ: r.accounting.initialQ,
      externalQ: (BigInt(r.accounting.externalQ) + r.field!.energyBalance().externalQ).toString(),
    },
  });
  const previewIdentity = (
    r: BranchRecord<T>,
    completedTicks = r.completedTicks,
    completedCommands = r.completedCommands,
  ): Omit<Extract<ReactiveGeometryIdentity3D, { kind: 'preview' }>, 'domain'> => ({
    kind: 'preview',
    base: r.base,
    branchId: r.id,
    completedCommands,
    completedTicks,
    horizonTicks: r.horizon,
  });
  const queryAccess = (
    domains: ReactiveDomainsSnapshot3D,
    identity: ReturnType<typeof previewIdentity>,
  ): ReactiveSessionQueryAccess3D => {
    const views = new Map<ReactiveDomainId3D, ReactiveGameplayGeometry3D>();
    return (domain = null) => {
      let view = views.get(domain);
      if (!view) {
        view = createReactiveGeometry3D(registry, reactiveDomain3D(domains, domain), {
          ...identity,
          domain,
        });
        views.set(domain, view);
      }
      return view;
    };
  };
  const commandDone = (
    r: BranchRecord<T>,
    command: ReactiveSessionCommand3D<T>,
    receipt: CommandReceipt,
    stage: CommandStage,
    ensure: () => void,
    translated?: ReactiveTranslationReceipt3D,
    transported?: {
      receipt: ReactiveMaterialTransportReceipt3D;
      memory: ReactiveMaterialTransportMemory3D;
    },
  ) => {
    const beforeQueries = queryAccess(stage.before, previewIdentity(r)),
      queries = queryAccess(
        stage.field.snapshot(),
        previewIdentity(r, r.completedTicks, r.completedCommands + 1),
      );
    const translation: ReactiveSessionTranslationAccess3D =
      command.kind === 'translate' && translated
        ? createReactiveTranslationMovementAccess3D(
            beforeQueries(command.domain),
            queries(command.domain),
            translated,
            r.translationOptions,
          )
        : () => null;
    const transportMovement =
      command.kind === 'transport' && transported
        ? createReactiveTransportMovementAccess3D(
            beforeQueries(command.domain),
            queries(command.domain),
            transported.receipt,
            r.transportOptions,
          )
        : null;
    const transport: ReactiveSessionTransportAccess3D = () =>
      command.kind === 'transport' && transported && transportMovement
        ? {
            domain: command.domain,
            control: command.control,
            receipt: structuredClone(transported.receipt),
            memory: structuredClone(transported.memory),
            movement: transportMovement(),
          }
        : null;
    let game = command.kind === 'game' ? copyPortableValue(command.game) : (r.game as T);
    if (reduceCommand)
      game = copyPortableValue(
        synchronous(
          reduceCommand({
            game: copyPortableValue(game),
            command: structuredClone(command),
            receipt: structuredClone(receipt),
            beforeQueries,
            queries,
            translation,
            transport,
          }),
        ),
      );
    // The staged field has a fresh local accounting baseline. Fold previous charges
    // into the session ledger before replacing it; this is not an external reset.
    const externalQ = (
      BigInt(r.accounting.externalQ) + r.field!.energyBalance().externalQ
    ).toString();
    ensure();
    r.accounting.externalQ = externalQ;
    r.field = stage.field;
    r.game = game;
    r.completedCommands++;
    r.last = {
      sequence: r.completedCommands + r.completedTicks,
      tick: r.field.tick,
      kind: 'command',
      commandKind: command.kind,
      receipt,
    };
    r.active = null;
    r.lastTranslation = command.kind === 'translate' ? translation : null;
    r.lastTransport = command.kind === 'transport' ? transport : null;
  };
  return Object.freeze({
    get revision() {
      return reactiveSessionRevision3D(live);
    },
    snapshot() {
      return structuredClone(live);
    },
    queries(domain: ReactiveDomainId3D = null): ReactiveGameplayGeometry3D {
      return createReactiveGeometry3D(registry, reactiveDomain3D(live.domains, domain), {
        kind: 'committed',
        revision: reactiveSessionRevision3D(live),
        domain,
      });
    },
    energyBalance() {
      const initialQ = BigInt(live.accounting.initialQ),
        externalQ = BigInt(live.accounting.externalQ),
        currentQ = reactiveDomainsEnergyQ3D(live.domains);
      return { initialQ, externalQ, currentQ, driftQ: currentQ - initialQ - externalQ };
    },
    branch(
      options: {
        horizonTicks: number;
        translation?: ReactiveTranslationCaptureOptions3D;
        transport?: ReactiveTransportCaptureOptions3D;
      } & ReactiveTickOptions3D,
    ): ReactiveBranch3D<T> {
      return mutation((ensure) => {
        reactiveFields3D(options, ['horizonTicks'], ['motion', 'translation', 'transport']);
        const horizon = reactiveInteger3D(
          options.horizonTicks,
          0,
          REACTIVE_SESSION_LIMITS_3D.horizonTicks,
        );
        const capture = readReactiveTickOptions3D(
          Object.hasOwn(options, 'motion') ? { motion: options.motion } : {},
        );
        const transportOptions = Object.hasOwn(options, 'transport')
          ? readReactiveTransportCapture3D(options.transport!)
          : null;
        const translationOptions = Object.hasOwn(options, 'translation')
          ? readReactiveTranslationCapture3D(options.translation!)
          : null;
        reactiveInteger3D(live.domains.tick + horizon, 0, Number.MAX_SAFE_INTEGER);
        reactiveInteger3D(live.revision + 1, 0, Number.MAX_SAFE_INTEGER);
        if (active.size >= REACTIVE_SESSION_LIMITS_3D.branches)
          throw Error('Reactive branch capacity exhausted.');
        const id = reactiveInteger3D(nextId + 1, 1, Number.MAX_SAFE_INTEGER),
          field = createReactiveDomainSet3D(registry, live.domains.world, live.domains.reservoirs);
        const r: BranchRecord<T> = {
          base: reactiveSessionRevision3D(live),
          id,
          horizon,
          field,
          game: copyPortableValue(live.game),
          accounting: { ...live.accounting },
          status: 'preparing',
          commands: [],
          totalCommands: 0,
          completedCommands: 0,
          completedTicks: 0,
          nodes: 0,
          characters: 0,
          active: null,
          tickJob: null,
          last: null,
          motionOptions: capture.enabled ? { motion: { maxEntries: capture.maxEntries } } : {},
          lastMotion: null,
          translationOptions,
          lastTranslation: null,
          transportOptions,
          lastTransport: null,
        };
        const branch: ReactiveBranch3D<T> = Object.freeze({
          base: r.base,
          branchId: id,
          progress: () => progress(r),
          enqueue(command: ReactiveSessionCommand3D<T>) {
            return mutation((check) => {
              current(r);
              if (r.status !== 'preparing') throw Error('Reactive branch commands are sealed.');
              try {
                const data = commandData(command);
                if (
                  r.totalCommands >= REACTIVE_SESSION_LIMITS_3D.operations ||
                  r.nodes + data.nodes > REACTIVE_SESSION_LIMITS_3D.commandNodes ||
                  r.characters + data.characters > REACTIVE_SESSION_LIMITS_3D.commandCharacters
                )
                  throw Error('Reactive command data budget exceeded.');
                check();
                r.commands.push(data.command);
                r.totalCommands++;
                r.nodes += data.nodes;
                r.characters += data.characters;
              } catch (error) {
                release(r, 'failed');
                throw error;
              }
            });
          },
          advance(work: number = 64) {
            return mutation((check) => {
              current(r);
              if (!['preparing', 'running'].includes(r.status))
                throw Error('Reactive branch cannot advance.');
              reactiveInteger3D(work, 1, 256);
              try {
                r.status = 'running';
                const field = r.field!;
                if (r.completedCommands < r.totalCommands) {
                  const c = r.commands[r.completedCommands];
                  if (r.active) {
                    const a = r.active;
                    if (a.job.advance(work).status === 'complete') {
                      if (a.kind === 'transport') {
                        if (c.kind !== 'transport')
                          throw Error('Reactive active transport command differs.');
                        const out = a.job.result(),
                          memory = captureReactiveMaterialTransportMemory3D(registry, out.state);
                        const candidate = replaceReactiveDomain3D(
                          a.before,
                          c.domain,
                          out.state.world,
                        );
                        a.field = createReactiveDomainSet3D(
                          registry,
                          candidate.world,
                          candidate.reservoirs,
                        );
                        commandDone(
                          r,
                          c,
                          {
                            kind: 'transport',
                            domain: c.domain,
                            control: c.control,
                            value: out.receipt,
                            memory,
                          },
                          a,
                          check,
                          undefined,
                          { receipt: out.receipt, memory },
                        );
                      } else if (a.kind === 'transfer')
                        commandDone(r, c, a.field.commitTransfer(a.job).receipt, a, check);
                      else {
                        const moved = a.field.commitTranslation(a.job).receipt;
                        commandDone(r, c, moved, a, check, moved.value);
                      }
                    }
                  } else {
                    const before = field.snapshot(),
                      staged = createReactiveDomainSet3D(registry, before.world, before.reservoirs),
                      stage = { field: staged, before };
                    if (c.kind === 'transport') {
                      if (!readTransport || !reduceCommand)
                        throw Error(
                          'Reactive transport requires a memory selector and command reducer.',
                        );
                      const queries = queryAccess(before, previewIdentity(r));
                      const memory = copyPortableValue(
                        synchronous(
                          readTransport({
                            game: copyPortableValue(r.game as T),
                            command: structuredClone(c),
                            queries,
                          }),
                        ),
                      );
                      const state = restoreReactiveMaterialTransportMemory3D(
                        registry,
                        queries(c.domain),
                        memory,
                      );
                      const job = createReactiveMaterialTransportJob3D(registry, state, c.impulses);
                      check();
                      r.active = { ...stage, kind: 'transport', job };
                    } else if (c.kind === 'transfer')
                      r.active = {
                        ...stage,
                        kind: 'transfer',
                        job: staged.prepareTransfer(c.request),
                      };
                    else if (c.kind === 'translate')
                      r.active = {
                        ...stage,
                        kind: 'translate',
                        job: staged.prepareTranslation(c.domain, c.request),
                      };
                    else if (c.kind === 'edit')
                      commandDone(r, c, staged.edit(c.domain, c.edits).receipt, stage, check);
                    else if (c.kind === 'hold')
                      commandDone(r, c, staged.hold(c.domain, c.request).receipt, stage, check);
                    else if (c.kind === 'releaseHold')
                      commandDone(r, c, staged.releaseHold(c.domain, c.id).receipt, stage, check);
                    else commandDone(r, c, { gameChanged: true }, stage, check);
                  }
                } else if (r.completedTicks < r.horizon) {
                  if (!r.tickJob) r.tickJob = field.prepareTick(r.motionOptions);
                  else if (r.tickJob.advance(work).status === 'complete') {
                    const out = r.tickJob.result();
                    const beforeQueries = queryAccess(field.snapshot(), previewIdentity(r)),
                      queries = queryAccess(out.state, previewIdentity(r, r.completedTicks + 1));
                    const observed = r.tickJob.motion();
                    const movement: ReactiveSessionMovementAccess3D = (domain = null) =>
                      bindReactiveTickMovement3D(
                        beforeQueries(domain),
                        queries(domain),
                        observed.status,
                        observed.domains.find((d) => d.id === domain)?.motion ?? null,
                      );
                    const game = reduceTick
                      ? copyPortableValue(
                          synchronous(
                            reduceTick({
                              game: copyPortableValue(r.game as T),
                              domains: structuredClone(out.state),
                              report: structuredClone(out.report),
                              beforeQueries,
                              queries,
                              movement,
                            }),
                          ),
                        )
                      : (r.game as T);
                    check();
                    const { receipt } = field.commitTick(r.tickJob);
                    r.game = game;
                    r.tickJob = null;
                    r.completedTicks++;
                    r.lastMotion = movement;
                    r.lastTranslation = null;
                    r.lastTransport = null;
                    r.last = {
                      sequence: r.completedCommands + r.completedTicks,
                      tick: field.tick,
                      kind: 'tick',
                      report: receipt,
                    };
                  }
                } else {
                  const candidate = readReactiveSessionSnapshot3D<T>(registry, draft(r));
                  validate(candidate);
                  check();
                  r.status = 'ready';
                }
                check();
                return progress(r);
              } catch (error) {
                release(r, 'failed');
                throw error;
              }
            });
          },
          inspect() {
            current(r);
            return { base: { ...r.base }, branchId: r.id, progress: progress(r), state: draft(r) };
          },
          queries(domain: ReactiveDomainId3D = null) {
            current(r);
            return createReactiveGeometry3D(registry, r.field!.domain(domain), {
              ...previewIdentity(r),
              domain,
            });
          },
          lastBoundary() {
            current(r);
            return structuredClone(r.last);
          },
          lastMovement(domain: ReactiveDomainId3D = null) {
            current(r);
            return r.lastMotion ? r.lastMotion(domain) : null;
          },
          lastTranslation() {
            current(r);
            return r.lastTranslation ? r.lastTranslation() : null;
          },
          lastTransport() {
            current(r);
            return r.lastTransport ? r.lastTransport() : null;
          },
          discard() {
            return mutation(() => {
              if (!active.has(r)) return false;
              release(r, 'discarded');
              return true;
            });
          },
        });
        ensure();
        nextId = id;
        active.add(r);
        records.set(branch, r);
        return branch;
      });
    },
    commit(branch: ReactiveBranch3D<T>): ReactiveSessionCommit3D<T> {
      return mutation((ensure) => {
        const r = records.get(branch);
        if (!r) throw Error('Reactive branch is foreign.');
        current(r);
        if (r.status !== 'ready') throw Error('Reactive branch is not ready.');
        try {
          const revision = reactiveInteger3D(live.revision + 1, 0, Number.MAX_SAFE_INTEGER),
            // Finalization validated this private state before marking it ready.
            // Ready branches cannot enqueue or advance; public reads own their
            // data, and a live mutation stales the branch. draft still copies
            // the field/game, so commit needs no second domain read/validation.
            candidate = { ...draft(r), revision };
          if (candidate.domains.tick !== r.base.tick + r.horizon)
            throw Error('Reactive preview duration differs.');
          compatibleReactiveDomains3D(live.domains, candidate.domains);
          validate(candidate);
          const out = {
            snapshot: structuredClone(candidate),
            receipt: {
              base: { ...r.base },
              revision,
              completedCommands: r.completedCommands,
              horizonTicks: r.horizon,
              endTick: candidate.domains.tick,
              externalEnergyQ: (
                BigInt(candidate.accounting.externalQ) - BigInt(live.accounting.externalQ)
              ).toString(),
            },
          };
          ensure();
          live = candidate;
          for (const sibling of active) release(sibling, sibling === r ? 'committed' : 'stale');
          return out;
        } catch (error) {
          release(r, 'failed');
          throw error;
        }
      });
    },
    restore(raw: unknown): ReactiveSessionSnapshot3D<T> {
      return mutation((ensure) => {
        const saved = readReactiveSessionSnapshot3D<T>(registry, raw);
        if (saved.worldId !== live.worldId || saved.gameRulesVersion !== live.gameRulesVersion)
          throw Error('Reactive session identities differ.');
        compatibleReactiveDomains3D(live.domains, saved.domains);
        const candidate = {
          ...saved,
          revision: reactiveInteger3D(live.revision + 1, 0, Number.MAX_SAFE_INTEGER),
        };
        validate(candidate);
        const out = structuredClone(candidate);
        ensure();
        live = candidate;
        for (const sibling of active) release(sibling, 'stale');
        return out;
      });
    },
  });
}
export type ReactiveSession3D<T extends ReactiveGameValue3D> = ReturnType<
  typeof createReactiveSession3D<T>
>;
