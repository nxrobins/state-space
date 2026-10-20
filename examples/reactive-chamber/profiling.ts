/** Bounded CPU diagnostics. Timings observe public jobs and never select physical outcomes. */
import {
  createReactiveWorldTickJob3D,
  editReactiveMaterialBlock3D,
} from 'state-space-engine/experimental/3d/reactive-materials';
import {
  CHAMBER,
  SCENARIOS,
  createChamber,
  compileCommand,
  prepareCommand,
  type ScenarioId,
} from './scenario.js';
import { prepareScene } from './presentation.js';
export type Timing = { calls: number; totalMs: number; worstMs: number };
export function recordTiming(rows: Record<string, Timing>, key: string, ms: number) {
  const row = (rows[key] ??= { calls: 0, totalMs: 0, worstMs: 0 });
  row.calls++;
  row.totalMs += ms;
  row.worstMs = Math.max(row.worstMs, ms);
}
export async function profileChamber(scenario: ScenarioId) {
  const { registry, session } = await createChamber(scenario);
  const command = {
    kind: 'heat',
    cell: [...(scenario === 'flow' ? SCENARIOS[scenario].ice : SCENARIOS[scenario].support)],
  };
  const timings: Record<string, Timing> = {};
  const measure = <T>(key: string, action: () => T): T => {
    const start = performance.now();
    try {
      return action();
    } finally {
      recordTiming(timings, key, performance.now() - start);
    }
  };
  const snapshot = session.snapshot();
  let world = snapshot.domains.world;
  const edits = compileCommand(registry, snapshot, command)[0];
  if (edits.kind !== 'edit') throw Error('Expected thermal edit.');
  world.block = editReactiveMaterialBlock3D(registry, world.block, edits.edits).block;
  for (let tick = 0; tick < 2; tick++) {
    const job = measure('world.create (copy/validate)', () =>
      createReactiveWorldTickJob3D(registry, world, { motion: { maxEntries: 65536 } }),
    );
    for (let slice = 0; job.progress().status !== 'complete'; slice++) {
      if (slice >= CHAMBER.maxSlices) throw Error('Profile work limit exceeded.');
      measure(`world.${job.progress().phase}`, () => job.advance(256));
    }
    world = measure('world.result (copy)', () => job.result()).state;
  }
  const branch = measure('session.prepare (copy/validate)', () =>
    prepareCommand(registry, session, command),
  );
  for (let slice = 0; branch.progress().status !== 'ready'; slice++) {
    if (slice >= CHAMBER.maxSlices) throw Error('Profile work limit exceeded.');
    measure(`session.${branch.progress().phase}`, () => branch.advance(256));
  }
  const preview = measure('session.inspect (copy)', () => branch.inspect());
  // Includes application validation, geometry and render-instance preparation, not GPU work.
  measure('presentation.prepare', () => prepareScene(registry, preview));
  measure('session.commit', () => session.commit(branch));
  return {
    scenario,
    size: SCENARIOS[scenario].size,
    timings,
    game: session.snapshot().game,
    energyDriftQ: session.energyBalance().driftQ.toString(),
  };
}
