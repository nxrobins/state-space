import { holdPhysics, STRUCTURAL_CALLS } from '../test-support/hold-physics.js';
/** Tiny local CPU kernels only: no world stepping or structural solves. */
import { beforeAll, describe, expect, test } from 'vitest';

import { createReactiveMaterialRegistry3D, defaultReactiveMaterialCatalog3D, createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit, readReactiveMaterialBlock3D, MAT, PHASE, MAX_ENERGY_Q, BONDS_3D, ANCHOR_3D,
  type ReactiveMaterialRegistry3D, type ReactiveMaterialEdit3D } from './reactive-materials.js';
import { createReactiveReactionState3D as state, advanceReactiveReactions3D as advance } from './reactive-reactions.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D, conductive: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  const c = defaultReactiveMaterialCatalog3D(); for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0;
  r = await createReactiveMaterialRegistry3D(c); conductive = await createReactiveMaterialRegistry3D();
});
const at = {x: 0, y: 0, z: 0};
function room(edits: ReactiveMaterialEdit3D[], size = {width: 2, height: 1, depth: 1}, registry = r, fill: number = MAT.AIR) {
  return state(registry, edit(registry, block(registry, size, fill), edits).block);
}
function hot(thermal = 181): ReactiveMaterialEdit3D {return {...at, kind: 'place', material: MAT.WOOD, thermal};}
function balanced(result: ReturnType<typeof advance>) {
  expect(result.report.energy.beforeQ).toBe(result.report.energy.afterQ); expect(result.report.energy.externalQ).toBe('0'); expect(result.report.energy.driftQ).toBe('0');
  expect(readReactiveMaterialBlock3D(r, result.state.block)).toEqual(result.state.block);
}
describe('exact local reactive evolution', () => {
  test('wood and air form ash and fire with exact chemical conversion', () => {
    const s = room([hot()]), out = advance(r, s); balanced(out);
    expect(out.state.block.packedCells.map(v => v & 255)).toEqual([MAT.ASH, MAT.FIRE]);
    expect(out.state.block.energyQ).toEqual([s.block.energyQ[0] - 40 * 256, s.block.energyQ[1] + 40 * 256]);
    expect(out.report.reactedPairs).toEqual([{fuel: 0, oxidizer: 1, transferredEnergyQ: 40 * 256}]);
    expect(BigInt(out.report.energy.chemicalBeforeQ) - BigInt(out.report.energy.chemicalAfterQ)).toBe(80n * 256n);
    expect(s.block.packedCells[0] & 255).toBe(MAT.WOOD);
  });
  test('flash threshold is strict and uses exact sub-thermal energy', () => {
    const equal = room([hot(180)]); expect(advance(r, equal).report.reactedPairs).toEqual([]);
    const justAbove = state(r, edit(r, equal.block, [{...at, kind: 'energy', energyQ: equal.block.energyQ[0] + 1}]).block);
    expect(advance(r, justAbove).report.reactedPairs).toHaveLength(1);
  });
  test('fuel without an oxidizer retains all its energy and damage', () => {
    const s = room([hot(), {...at, kind: 'integrity', integrity: 13}], {width: 2, height: 1, depth: 1}, r, MAT.STONE);
    const out = advance(r, s); expect(out.state.block).toEqual(s.block); balanced(out);
  });
  test('sealed singleton fuel cannot burn across a boundary', () => {
    const s = room([hot()], {width: 1, height: 1, depth: 1}), out = advance(r, s);
    expect(out.state.block).toEqual(s.block); expect(out.report.reactedPairs).toEqual([]);
  });
  test('competition consumes one oxidizer once and leaves the rejected fuel intact', () => {
    const s = room([hot(), {...hot(), x: 2}], {width: 3, height: 1, depth: 1}), out = advance(r, s);
    expect(out.report.reactedPairs).toEqual([{fuel: 2, oxidizer: 1, transferredEnergyQ: 10240}]);
    expect(out.state.block.packedCells.map(v => v & 255)).toEqual([MAT.WOOD, MAT.FIRE, MAT.ASH]); balanced(out);
  });
  test('one fuel cannot consume two oxidizers in one cycle', () => {
    const out = advance(r, room([{...hot(), x: 1}], {width: 3, height: 1, depth: 1}));
    expect(out.report.reactedPairs).toHaveLength(1); expect(out.state.block.packedCells.filter(v => (v & 255) === MAT.AIR)).toHaveLength(1); balanced(out);
  });
  test('direction rotation exercises all six signed neighbor directions', () => {
    const s = room([{...hot(), x: 1, y: 1, z: 1}], {width: 3, height: 3, depth: 3});
    for (let cycle = 0; cycle < 6; cycle++) {
      const out = advance(r, {...s, cycle}); expect(out.report.reactedPairs).toEqual([{fuel: 13, oxidizer: [12, 14, 10, 16, 4, 22][cycle], transferredEnergyQ: 10240}]); balanced(out);
    }
  });
  test('rectangular boundary adjacency never wraps rows or depth layers', () => {
    const s = room([{...hot(), x: 2}, {...at, y: 1, kind: 'place', material: MAT.AIR}], {width: 3, height: 3, depth: 1}, r, MAT.STONE);
    const out = advance(r, s); expect(out.report.reactedPairs).toEqual([]); expect(out.state.block).toEqual(s.block);
  });
  test('disjoint reacting pairs conserve energy and report ascending fuel indices', () => {
    const s = room([hot(), {...hot(), x: 3}], {width: 5, height: 1, depth: 1}), out = advance(r, s);
    expect(out.report.reactedPairs.map(p => p.fuel)).toEqual([0, 3]); expect(new Set(out.report.reactedPairs.map(p => p.oxidizer)).size).toBe(2); balanced(out);
  });
  test('saturated oxidizer storage clips transfer without dropping energy', () => {
    const s = room([hot(), {...at, x: 1, kind: 'energy', energyQ: MAX_ENERGY_Q - 3}]), out = advance(r, s);
    expect(out.report.reactedPairs[0].transferredEnergyQ).toBe(3); expect(out.state.block.energyQ[1]).toBe(MAX_ENERGY_Q); balanced(out);
  });
  test('a full oxidizer still reacts with zero transfer and exact total energy', () => {
    const s = room([hot(), {...at, x: 1, kind: 'energy', energyQ: MAX_ENERGY_Q}]), out = advance(r, s);
    expect(out.report.reactedPairs[0].transferredEnergyQ).toBe(0); expect(out.state.block.energyQ).toEqual(s.block.energyQ); balanced(out);
  });
  test('newly produced cold fire survives this pass and extinguishes next cycle', () => {
    const s = room([hot()]), first = advance(r, s), second = advance(r, first.state);
    expect(first.report.extinguishedCells).toEqual([]); expect(second.report.extinguishedCells).toEqual([1]);
    expect(second.state.block.packedCells[1] & 255).toBe(MAT.SMOKE); balanced(second);
  });
  test('orphaned hot fire becomes smoke without losing conserved heat', () => {
    const s = room([{...at, kind: 'place', material: MAT.FIRE, thermal: 200}]), out = advance(r, s);
    expect(out.report.extinguishedCells).toEqual([0]); expect(out.state.block.energyQ).toEqual(s.block.energyQ); balanced(out);
  });
  test('fire temperature cutoff is strict even with adjacent unburned fuel', () => {
    for (const thermal of [79, 80]) {
      const s = room([{...at, kind: 'place', material: MAT.FIRE, thermal}, {...at, x: 1, kind: 'place', material: MAT.WOOD, thermal: 20}]);
      const out = advance(r, s); expect(out.state.block.packedCells[0] & 255).toBe(thermal === 79 ? MAT.SMOKE : MAT.FIRE); balanced(out);
    }
  });
  test('adjacent water extinguishes hot fire despite adjacent fuel', () => {
    const s = room([{...at, kind: 'place', material: MAT.FIRE, thermal: 200}, {...at, x: 1, kind: 'place', material: MAT.WOOD, thermal: 20},
      {...at, y: 1, kind: 'place', material: MAT.WATER, thermal: 20}], {width: 2, height: 2, depth: 1});
    const out = advance(r, s); expect(out.report.extinguishedCells).toEqual([0]); balanced(out);
  });
  test('thermal reaction does not spontaneously ignite cold adjacent fuel', () => {
    const s = room([{...at, kind: 'place', material: MAT.FIRE, thermal: 200}, {...at, x: 1, kind: 'place', material: MAT.WOOD, thermal: 20}]);
    expect(advance(r, s).state.block).toEqual(s.block);
  });
  test('burning a bonded cell cuts its surviving neighbor and reports distant endpoint change', () => {
    const s = room([hot(), {...at, x: 1, kind: 'place', material: MAT.WOOD, thermal: 20}, {...at, kind: 'bond', direction: 1, bonded: true},
      {...at, kind: 'integrity', integrity: 73}, {...at, kind: 'anchor', anchored: true}], {width: 2, height: 2, depth: 1});
    const out = advance(r, s); expect(out.state.block.structure[0]).toBe(0); expect(out.state.block.structure[1]).toBe(255);
    expect(out.report.changedCells).toEqual([0, 1, 2]); expect(s.block.structure[1] & BONDS_3D[0]).not.toBe(0); balanced(out);
  });
  test('unchanged damaged and anchored solids retain exact history', () => {
    const s = room([{...at, kind: 'place', material: MAT.STONE}, {...at, kind: 'integrity', integrity: 31}, {...at, kind: 'anchor', anchored: true}]);
    expect(advance(r, s).state.block.structure[0]).toBe(31 | ANCHOR_3D); expect(advance(r, s).state.block).toEqual(s.block);
  });
  test('custom fuels use catalog energy, threshold and both products', async () => {
    const row = r.material(MAT.WOOD), custom = await r.extend([{...row, id: 200, name: 'resin', properties: {...row.properties, fuel_energy: 81, flash_point: 10, smoke_product: MAT.SMOKE}}]);
    const s = room([{...at, kind: 'place', material: 200, thermal: 11}], undefined, custom), out = advance(custom, s);
    expect(out.state.block.packedCells.map(v => v & 255)).toEqual([MAT.ASH, MAT.SMOKE]); expect(out.report.reactedPairs[0].transferredEnergyQ).toBe(81 * 128);
    expect(out.report.energy.afterQ).toBe(out.report.energy.beforeQ); expect(out.report.energy.chemicalAfterQ).toBe('0');
  });
  test('heat exchanges along X Y and Z with a hand-calculated exact flux', () => {
    for (const size of [{width: 2, height: 1, depth: 1}, {width: 1, height: 2, depth: 1}, {width: 1, height: 1, depth: 2}]) {
      const s = room([{...at, kind: 'place', material: MAT.STONE, thermal: 100}], size, conductive, MAT.STONE);
      const cold = conductive.material(MAT.STONE).default_thermal, difference = (100 - cold) * 256;
      const flux = Math.floor(difference / 512) * 30 + Math.floor(((difference % 512) * 30 + 511) / 512);
      const out = advance(conductive, s); expect(out.state.block.energyQ).toEqual([100 * 256 - flux, cold * 256 + flux]);
      expect(out.report.energy.beforeQ).toBe(out.report.energy.afterQ); expect(out.state.block.structure).toEqual(s.block.structure);
    }
  });
  test('phase threshold includes latent energy rather than the packed heat byte', () => {
    const p = r.material(MAT.WATER).properties, target = r.material(p.boils_into).properties;
    const threshold = (target.phase_energy + p.boil_point) * 256;
    for (const energyQ of [threshold - 1, threshold]) {
      const s = room([{...at, kind: 'place', material: MAT.WATER}, {...at, kind: 'energy', energyQ}], {width: 1, height: 1, depth: 1});
      const out = advance(r, s); expect(out.state.block.packedCells[0] & 255).toBe(energyQ === threshold ? MAT.STEAM : MAT.WATER); expect(out.state.block.energyQ[0]).toBe(energyQ); balanced(out);
    }
  });
  test('freezing creates intact unjoined ice; melting removes both bond endpoints', () => {
    const s = room([{...at, kind: 'place', material: MAT.WATER}, {...at, kind: 'energy', energyQ: 0}], {width: 2, height: 1, depth: 1}, r, MAT.ICE);
    const frozen = advance(r, s); expect(frozen.state.block.packedCells[0] & 255).toBe(MAT.ICE); expect(frozen.state.block.structure).toEqual([255, 255]); balanced(frozen);
    const ice = r.material(MAT.ICE).properties, meltQ = (r.material(ice.melts_into).properties.phase_energy + ice.melt_point) * 256;
    const bonded = state(r, edit(r, frozen.state.block, [{...at, kind: 'bond', direction: 1, bonded: true}, {...at, kind: 'energy', energyQ: meltQ}]).block);
    const melted = advance(r, bonded); expect(melted.state.block.packedCells[0] & 255).toBe(MAT.WATER); expect(melted.state.block.structure).toEqual([0, 255]); balanced(melted);
  });
  test('steam condenses and stone and sand melt at their catalog boundaries', () => {
    for (const id of [MAT.STEAM, MAT.STONE, MAT.SAND]) {
      const p = r.material(id).properties, to = p.condenses_into || p.melts_into;
      const energyQ = (r.material(to).properties.phase_energy + (p.condenses_into ? p.condense_point : p.melt_point)) * 256;
      const s = room([{...at, kind: 'place', material: id}, {...at, kind: 'energy', energyQ}], {width: 1, height: 1, depth: 1});
      const out = advance(r, s); expect(out.state.block.packedCells[0] & 255).toBe(to); balanced(out);
    }
  });
  test('solid-to-solid phase changes retain damage anchors and existing bonds', async () => {
    const c = r.toCatalog(), base = r.material(MAT.STONE), clear = {...base.properties, melts_into: 201, melt_point: 50, latent_heat_melt: 10, phase_energy: 0};
    c.propertiesCatalog.materials.push({...base, id: 200, name: 'solid_a', properties: clear},
      {...base, id: 201, name: 'solid_b', properties: {...base.properties, melts_into: 0, freezes_into: 200, freeze_point: 40, phase_energy: 10}});
    c.materialIds.push(200, 201); const custom = await createReactiveMaterialRegistry3D(c);
    const s = room([{...at, kind: 'place', material: 200, thermal: 60}, {...at, kind: 'integrity', integrity: 17},
      {...at, kind: 'anchor', anchored: true}, {...at, kind: 'bond', direction: 1, bonded: true}], undefined, custom, MAT.STONE);
    const out = advance(custom, s); expect(out.state.block.packedCells[0] & 255).toBe(201); expect(out.state.block.structure).toEqual(s.block.structure);
  });
  test('solid combustion products start fresh without auto-welding or inherited anchors', async () => {
    const c = r.toCatalog(), fuel = c.propertiesCatalog.materials.find(m => m.id === MAT.WOOD)!;
    const ash = r.material(MAT.ASH); c.propertiesCatalog.materials.push({...ash, id: 200, name: 'char', properties: {...ash.properties, default_phase: PHASE.SOLID, cohesion: 20}});
    c.materialIds.push(200); fuel.properties.burns_into = 200; const custom = await createReactiveMaterialRegistry3D(c);
    const s = room([hot(), {...at, kind: 'integrity', integrity: 2}, {...at, kind: 'anchor', anchored: true}], undefined, custom);
    const out = advance(custom, s); expect(out.state.block.packedCells[0] & 255).toBe(200); expect(out.state.block.structure[0]).toBe(255);
    expect(out.report.energy.beforeQ).toBe(out.report.energy.afterQ);
  });
});
