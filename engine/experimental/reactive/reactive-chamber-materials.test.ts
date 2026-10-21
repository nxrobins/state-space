import { expect, test } from 'vitest';
import { MAT, THERMAL_MAT_3D as M } from 'state-space-engine/experimental/3d/reactive-materials';
import {
  createChamber,
  prepareCommand,
  finishBranch,
  SCENARIOS,
  index,
  coordinate,
  type ChamberCommand,
} from '../../../examples/reactive-chamber/scenario.js';
import { parseSave, SAVE_FORMAT } from '../../../examples/reactive-chamber/recording.js';

test('copper carries heat to distant wax; replacing the middle with ceramic protects it and traps heat at the inlet', async () => {
  for (const scenario of ['conduction', 'insulation'] as const) {
    const { registry, session } = await createChamber(scenario),
      initial = session.snapshot();
    const control = prepareCommand(registry, session, { kind: 'wait' });
    expect(finishBranch(control).state.game.phaseChanges).toBe(0);
    control.discard();
    expect(session.snapshot()).toEqual(initial);
    for (let step = 0; step < 5; step++) {
      const branch = prepareCommand(
        registry,
        session,
        step === 0 ? { kind: 'heat', cell: [...SCENARIOS[scenario].primary] } : { kind: 'wait' },
      );
      finishBranch(branch, step % 2 ? 64 : 256);
      session.commit(branch);
    }
    const state = session.snapshot(),
      block = state.domains.world.block;
    expect(state.game.actor.minQ).toEqual(initial.game.actor.minQ);
    expect(session.energyBalance().driftQ).toBe(0n);
    if (scenario === 'conduction') {
      expect(block.packedCells.some((word) => (word & 255) === M.MOLTEN_WAX)).toBe(true);
      expect(block.packedCells[index(SCENARIOS[scenario].secondary, 16)] & 255).toBe(MAT.AIR);
    } else {
      const wax = block.packedCells[index(SCENARIOS[scenario].secondary, 16)];
      expect(wax & 255).toBe(M.WAX);
      expect((wax >>> 8) & 255).toBeLessThanOrEqual(21);
      expect(block.packedCells[index([6, 8, 6], 16)] & 255).toBe(M.CERAMIC);
      expect(state.game.phaseChanges).toBeGreaterThanOrEqual(2); // Inlet melts, moves, refreezes.
    }
  }
});

test('wax valve keeps water trapped until heated, then releases water and refreezes at its new location', async () => {
  const { registry, session } = await createChamber('wax'),
    initial = session.snapshot();
  const control = prepareCommand(registry, session, { kind: 'wait' });
  const untouched = finishBranch(control).state.domains.world.block;
  expect(untouched.packedCells[index(SCENARIOS.wax.secondary, 16)] & 255).toBe(MAT.WATER);
  control.discard();
  const apply = (command: ChamberCommand) => {
    const branch = prepareCommand(registry, session, command);
    finishBranch(branch);
    return session.commit(branch).snapshot;
  };
  apply({ kind: 'heat', cell: [...SCENARIOS.wax.primary] });
  const flowed = apply({ kind: 'wait' }),
    block = flowed.domains.world.block;
  const wax = block.packedCells.findIndex((word) => (word & 255) === M.MOLTEN_WAX);
  const water = block.packedCells.findIndex((word) => (word & 255) === MAT.WATER);
  expect(wax).toBeGreaterThanOrEqual(0);
  expect(coordinate(water, 16)[1]).toBeGreaterThan(SCENARIOS.wax.primary[1]);
  const frozen = apply({ kind: 'cool', cell: coordinate(wax, 16) });
  expect(frozen.domains.world.block.packedCells.some((word) => (word & 255) === M.WAX)).toBe(true);
  expect(frozen.game.phaseChanges).toBeGreaterThanOrEqual(2);
  expect(frozen.game.actor.minQ).toEqual(initial.game.actor.minQ);
  expect(session.energyBalance().driftQ).toBe(0n);
});

test('pack saves reject changed definitions or a builtin catalog even when material IDs match', async () => {
  const { registry, session } = await createChamber('wax'),
    initial = session.snapshot();
  const save = {
    format: SAVE_FORMAT,
    catalog: registry.toCatalog(),
    initial,
    snapshot: initial,
    steps: [],
  };
  expect(parseSave(registry, JSON.stringify(save), initial).snapshot).toEqual(initial);
  save.catalog.propertiesCatalog.materials.find((m) => m.id === M.WAX)!.properties.flash_point++;
  expect(() => parseSave(registry, JSON.stringify(save), initial)).toThrow(/catalog/);
  const old = await createChamber();
  expect(() => parseSave(old.registry, JSON.stringify(save), old.session.snapshot())).toThrow(
    /catalog/,
  );
});
