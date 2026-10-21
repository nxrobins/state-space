import {expect, test} from 'vitest';
import {
  createThermalMaterialRegistry3D, createReactiveMaterialRegistry3D,
  THERMAL_MAT_3D as M, MAT, ENERGY_SCALE as E,
  createReactiveMaterialBlock3D, editReactiveMaterialBlock3D,
  createReactiveReactionState3D, advanceReactiveReactions3D, reactiveMaterialEnergyLedger3D,
} from '../reactive-materials.js';

test('thermal v1 is opt-in, immutable, portable and leaves builtin identities unchanged', async () => {
  const base = await createReactiveMaterialRegistry3D(), registry = await createThermalMaterialRegistry3D();
  expect(registry.materialIds.length).toBe(base.materialIds.length + 5);
  for (const id of base.materialIds) expect(registry.material(id)).toEqual(base.material(id));
  expect(base.has(M.WAX)).toBe(false);
  // Persisted catalog identity: changing v1 definitions requires a new pack version.
  expect(registry.hash).toBe('21e840506f7ccaddb1fe256d2d99299aaec6ee569493ac9bd13291c01d9433ab');
  const catalog = JSON.parse(JSON.stringify(registry.toCatalog()));
  const restored = await createReactiveMaterialRegistry3D(catalog);
  expect(restored.hash).toBe(registry.hash);
  catalog.materialIds.pop();
  expect(registry.materialIds).toEqual(restored.materialIds);
  expect(Object.isFrozen(registry.material(M.WAX).properties)).toBe(true);
});

test.each([[M.COPPER, M.MOLTEN_COPPER], [M.WAX, M.MOLTEN_WAX]])(
  '%i melts and refreezes conservatively without restoring anchors or bonds', async (solid, liquid) => {
    const registry = await createThermalMaterialRegistry3D();
    const p = registry.material(solid).properties;
    let block = editReactiveMaterialBlock3D(registry, createReactiveMaterialBlock3D(registry, {width: 1, height: 1, depth: 1}), [
      {kind: 'place', x: 0, y: 0, z: 0, material: solid, thermal: p.melt_point + p.latent_heat_melt + 1},
      {kind: 'anchor', x: 0, y: 0, z: 0, anchored: true},
    ]).block;
    const total = reactiveMaterialEnergyLedger3D(registry, block).totalQ;
    const melted = advanceReactiveReactions3D(registry, createReactiveReactionState3D(registry, block));
    expect(melted.state.block.packedCells[0] & 255).toBe(liquid);
    expect(reactiveMaterialEnergyLedger3D(registry, melted.state.block).totalQ).toBe(total);
    const cooled = editReactiveMaterialBlock3D(registry, melted.state.block, [
      {kind: 'energy', x: 0, y: 0, z: 0, energyQ: (p.fuel_energy + 20) * E},
    ]);
    block = advanceReactiveReactions3D(registry, createReactiveReactionState3D(registry, cooled.block)).state.block;
    expect(block.packedCells[0] & 255).toBe(solid);
    expect(block.structure[0]).toBe(255);
    expect(reactiveMaterialEnergyLedger3D(registry, block).totalQ).toBe(total + BigInt(cooled.receipt.externalEnergyQ));
  },
);

test('wax melts below ignition; both fuel phases burn only with oxidizer and conserve chemical energy', async () => {
  const registry = await createThermalMaterialRegistry3D();
  for (const material of [M.WAX, M.MOLTEN_WAX]) for (const thermal of [65, 220]) for (const neighbor of [MAT.AIR, M.CERAMIC]) {
    const block = editReactiveMaterialBlock3D(registry, createReactiveMaterialBlock3D(registry, {width: 2, height: 1, depth: 1}), [
      {kind: 'place', x: 0, y: 0, z: 0, material, thermal},
      {kind: 'place', x: 1, y: 0, z: 0, material: neighbor, thermal: 20},
    ]).block;
    const result = advanceReactiveReactions3D(registry, createReactiveReactionState3D(registry, block));
    const burns = thermal === 220 && neighbor === MAT.AIR;
    expect(result.report.reactedPairs.length).toBe(Number(burns));
    expect(result.state.block.packedCells[0] & 255).toBe(burns ? MAT.ASH : M.MOLTEN_WAX);
    expect(result.report.energy.beforeQ).toBe(result.report.energy.afterQ);
    expect(reactiveMaterialEnergyLedger3D(registry, result.state.block).chemicalQ).toBe(burns ? 0n : 100n * BigInt(E));
  }
});
