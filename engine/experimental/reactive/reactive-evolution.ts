/** Complete conservative movement + thermal reaction ticks, without global mechanics. */
import {
  readReactiveMaterialBlock3D,
  reactiveEnergyTotalQ3D,
  type ReactiveMaterialBlock3D,
} from './reactive-block.js';
import {
  reactiveFields3D,
  reactiveInteger3D,
  reactiveRegistrySource3D,
  cloneReactiveData3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';
import {
  reactiveMovementSchedule3D,
  executeReactiveMovementPass3D,
  REACTIVE_MOVEMENT_RULES_3D,
  type ReactiveMovementClasses3D,
} from './reactive-movement.js';
import {
  REACTIVE_REACTION_RULES_3D,
  startReactiveReactionJob3D,
  type ReactiveReactionJob3D,
  type ReactiveReactionResult3D,
  type ReactiveReactionReport3D,
} from './reactive-reactions.js';

export const REACTIVE_EVOLUTION_RULES_3D = 'reactive-evolution-1';
export const REACTIVE_EVOLUTION_SCHEMA_3D = 1;
export type ReactiveEvolutionState3D = {
  schemaVersion: 1;
  rulesVersion: typeof REACTIVE_EVOLUTION_RULES_3D;
  tick: number;
  block: ReactiveMaterialBlock3D;
};
export type ReactiveEvolutionReport3D = {
  rulesVersion: typeof REACTIVE_EVOLUTION_RULES_3D;
  materialCatalogHash: string;
  fromTick: number;
  toTick: number;
  changedCells: number[];
  touchedCells: number[];
  movement: {
    rulesVersion: typeof REACTIVE_MOVEMENT_RULES_3D;
    swapCount: number;
    moves: { from: number; to: number }[];
    touchedOrigins: number[];
  };
  reactions: ReactiveReactionReport3D;
};
export type ReactiveEvolutionResult3D = {
  state: ReactiveEvolutionState3D;
  report: ReactiveEvolutionReport3D;
};
export type ReactiveEvolutionProgress3D = {
  status: 'running' | 'complete' | 'cancelled';
  completedPasses: number;
  totalPasses: 28;
};
export interface ReactiveEvolutionJob3D {
  progress(): ReactiveEvolutionProgress3D;
  advance(): ReactiveEvolutionProgress3D;
  cancel(): boolean;
  result(): ReactiveEvolutionResult3D;
}
export function createReactiveEvolutionState3D(
  registry: ReactiveMaterialRegistry3D,
  block: ReactiveMaterialBlock3D,
  tick: number = 0,
): ReactiveEvolutionState3D {
  tick = reactiveInteger3D(tick, 0, Number.MAX_SAFE_INTEGER);
  return {
    schemaVersion: 1,
    rulesVersion: REACTIVE_EVOLUTION_RULES_3D,
    tick,
    block: readReactiveMaterialBlock3D(registry, block),
  };
}
export function readReactiveEvolutionState3D(
  registry: ReactiveMaterialRegistry3D,
  raw: unknown,
): ReactiveEvolutionState3D {
  reactiveFields3D(raw, ['schemaVersion', 'rulesVersion', 'tick', 'block']);
  if (
    raw.schemaVersion !== REACTIVE_EVOLUTION_SCHEMA_3D ||
    raw.rulesVersion !== REACTIVE_EVOLUTION_RULES_3D
  )
    throw Error('Incompatible reactive evolution state.');
  return createReactiveEvolutionState3D(
    registry,
    raw.block as ReactiveMaterialBlock3D,
    reactiveInteger3D(raw.tick, 0, Number.MAX_SAFE_INTEGER),
  );
}
type EvolutionObserver = {
  swap(index: number, a: number, b: number): void;
  pass(index: number, block: ReactiveMaterialBlock3D): void;
};
type ReactionStage = { job: ReactiveReactionJob3D; output(): ReactiveReactionResult3D };
/** Owned validated state only. Public entries validate first and never hand over uncopied results. */
function evolutionJob(
  registry: ReactiveMaterialRegistry3D,
  owned: ReactiveEvolutionState3D,
  observer?: EvolutionObserver,
) {
  const tick = owned.tick;
  if (tick === Number.MAX_SAFE_INTEGER) throw Error('Reactive evolution tick would overflow.');
  const schedule = reactiveMovementSchedule3D(tick),
    cold = reactiveRegistrySource3D(registry).cold,
    initialQ = reactiveEnergyTotalQ3D(owned.block.energyQ);
  let before: ReactiveMaterialBlock3D | null = owned.block,
    current: ReactiveMaterialBlock3D | null = owned.block,
    classes: ReactiveMovementClasses3D | undefined,
    // The first moving pass copies the block once; later passes swap that private copy in place.
    working = false;
  let origins: Int32Array | null = new Int32Array(owned.block.packedCells.length);
  for (let i = 0; i < origins.length; i++) origins[i] = i;
  let touched: Uint8Array | null = new Uint8Array(origins.length),
    touchedOrigins: Uint8Array | null = new Uint8Array(origins.length);
  let reaction: ReactionStage | null = null,
    result: ReactiveEvolutionResult3D | null = null;
  let completedPasses = 0,
    swapCount = 0,
    status: ReactiveEvolutionProgress3D['status'] = 'running';
  const progress = (): ReactiveEvolutionProgress3D => ({
    status,
    completedPasses,
    totalPasses: 28,
  });
  const release = () => {
    before = current = null;
    classes = undefined;
    origins = null;
    touched = touchedOrigins = null;
    reaction = null;
  };
  const swapped = (a: number, b: number) => {
    const first = origins![a],
      second = origins![b];
    origins![a] = second;
    origins![b] = first;
    touched![a] = touched![b] = 1;
    touchedOrigins![first] = touchedOrigins![second] = 1;
    swapCount++;
    observer?.swap(completedPasses, a, b);
  };
  const job: ReactiveEvolutionJob3D = Object.freeze({
    progress,
    advance() {
      if (status !== 'running' || !current || !before || !origins || !touched || !touchedOrigins)
        throw Error('Reactive evolution job is no longer running.');
      try {
        if (completedPasses < 20) {
          const moved = executeReactiveMovementPass3D(
            current,
            cold,
            tick,
            schedule[completedPasses],
            swapped,
            classes,
            working,
          );
          if (moved.block.packedCells !== current.packedCells) working = true;
          current = moved.block;
          classes = moved.classes;
          observer?.pass(completedPasses, current);
        } else {
          reaction ??= startReactiveReactionJob3D(
            registry,
            {
              schemaVersion: 1,
              rulesVersion: REACTIVE_REACTION_RULES_3D,
              cycle: tick,
              block: current,
            },
            observer ? (index, block) => observer.pass(index + 20, block) : undefined,
          );
          reaction.job.advance();
        }
        completedPasses++;
        if (completedPasses === 28) {
          const output = reaction!.output(),
            block = output.state.block;
          if (
            BigInt(output.report.energy.beforeQ) !== initialQ ||
            reactiveEnergyTotalQ3D(block.energyQ) !== initialQ
          )
            throw Error('Reactive movement/evolution lost conserved energy.');
          const report: ReactiveEvolutionReport3D = {
            rulesVersion: REACTIVE_EVOLUTION_RULES_3D,
            materialCatalogHash: registry.hash,
            fromTick: tick,
            toTick: tick + 1,
            changedCells: [],
            touchedCells: [],
            movement: {
              rulesVersion: REACTIVE_MOVEMENT_RULES_3D,
              swapCount,
              moves: [],
              touchedOrigins: [],
            },
            reactions: output.report,
          };
          for (const i of output.report.changedCells) touched[i] = 1;
          const destinations = new Int32Array(origins.length);
          for (let i = 0; i < origins.length; i++) destinations[origins[i]] = i;
          for (let i = 0; i < origins.length; i++) {
            if (
              block.packedCells[i] !== before.packedCells[i] ||
              block.energyQ[i] !== before.energyQ[i] ||
              block.structure[i] !== before.structure[i]
            )
              report.changedCells.push(i);
            if (touched[i]) report.touchedCells.push(i);
            if (touchedOrigins[i]) report.movement.touchedOrigins.push(i);
            if (destinations[i] !== i) report.movement.moves.push({ from: i, to: destinations[i] });
          }
          result = {
            state: {
              schemaVersion: 1,
              rulesVersion: REACTIVE_EVOLUTION_RULES_3D,
              tick: tick + 1,
              block,
            },
            report,
          };
          release();
          status = 'complete';
        }
      } catch (error) {
        reaction?.job.cancel();
        release();
        status = 'cancelled';
        throw error;
      }
      return progress();
    },
    cancel() {
      if (status !== 'running') return false;
      reaction?.job.cancel();
      release();
      status = 'cancelled';
      return true;
    },
    result() {
      if (!result || status !== 'complete')
        throw Error('Reactive evolution result is not complete.');
      return cloneReactiveData3D(result);
    },
  });
  return {
    job,
    output() {
      if (!result || status !== 'complete')
        throw Error('Reactive evolution result is not complete.');
      return result;
    },
  };
}
export function createReactiveEvolutionJob3D(
  registry: ReactiveMaterialRegistry3D,
  raw: ReactiveEvolutionState3D,
): ReactiveEvolutionJob3D {
  return evolutionJob(registry, readReactiveEvolutionState3D(registry, raw)).job;
}
/** Internal only: owned validated state, an optional observer and an uncopied result hand-off.
 * Observations follow executed passes and never choose physical operations.
 */
export function startReactiveEvolutionJob3D(
  registry: ReactiveMaterialRegistry3D,
  owned: ReactiveEvolutionState3D,
  observer?: EvolutionObserver,
) {
  return evolutionJob(registry, owned, observer);
}
export function advanceReactiveEvolution3D(
  registry: ReactiveMaterialRegistry3D,
  state: ReactiveEvolutionState3D,
): ReactiveEvolutionResult3D {
  const job = createReactiveEvolutionJob3D(registry, state);
  for (let i = 0; i < 28; i++) job.advance();
  return job.result();
}
