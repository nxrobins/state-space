/** Hoisted thermal tables and the block check that uses them, against the engine/thermal.ts oracle. */
import { beforeAll, describe, expect, test } from 'vitest';
import { PHASE_SHIFT, COLD_STRIDE, COLD_COHESION } from '../../generated/materials.js';
import { temperatureQ, thermalView, validateEnergyState } from '../../thermal.js';
import {
  INTEGRITY_3D,
  BONDS_3D,
  COMPLETE_STRUCTURE_3D,
  structuralNeighbor,
} from '../structural-mechanics.js';
import {
  createReactiveMaterialRegistry3D,
  createThermalMaterialRegistry3D,
  createReactiveMaterialBlock3D,
  editReactiveMaterialBlock3D,
  MAT,
  PHASE,
  ENERGY_SCALE,
  MAX_ENERGY_Q,
  type ReactiveMaterialBlock3D,
  type ReactiveMaterialEdit3D,
  type ReactiveMaterialRegistry3D,
} from '../reactive-materials.js';
import { reactiveRegistrySource3D } from './reactive-registry.js';
import { checkReactiveMaterialBlock3D } from './reactive-block.js';
import {
  reactiveThermalTables3D,
  reactiveTemperatureQ3D,
  reactiveThermalView3D,
} from './reactive-thermal-tables.js';

let registries: [string, ReactiveMaterialRegistry3D][];
beforeAll(async () => {
  const base = await createReactiveMaterialRegistry3D();
  const custom = await base.extend([
    { ...structuredClone(base.material(MAT.WOOD)), id: 200, name: 'resin' },
    {
      ...structuredClone(base.material(MAT.ASH)),
      id: 201,
      name: 'soft_solid',
      properties: { ...base.material(MAT.ASH).properties, default_phase: PHASE.SOLID, cohesion: 0 },
    },
  ]);
  registries = [
    ['default', base],
    ['thermal', await createThermalMaterialRegistry3D()],
    ['custom', custom],
  ];
});
function random(seed: number) {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
}
/** The block check as it stood before the tables: validateEnergyState, then the structural loop. */
function oracleCheck(
  registry: ReactiveMaterialRegistry3D,
  block: ReactiveMaterialBlock3D,
): ReactiveMaterialBlock3D {
  const source = reactiveRegistrySource3D(registry),
    { packedCells, energyQ, structure } = block,
    dimensions = { width: block.width, height: block.height, depth: block.depth },
    count = block.width * block.height * block.depth;
  if (packedCells.length !== count || energyQ.length !== count || structure.length !== count)
    throw Error('Reactive coordinate length mismatch.');
  validateEnergyState(packedCells, energyQ, count, source.cold, source.registry);
  const known = new Uint8Array(256),
    phase = new Uint8Array(256);
  for (const id of registry.materialIds) {
    known[id] = 1;
    phase[id] = registry.material(id).properties.default_phase;
  }
  const eligible = (packed: number) => {
    const p = (packed >>> PHASE_SHIFT) & 15;
    return (
      (p === PHASE.SOLID || p === PHASE.FROZEN) &&
      source.cold[(packed & 255) * COLD_STRIDE + COLD_COHESION] > 0
    );
  };
  const bondMask = BONDS_3D.reduce((mask, bit) => mask | bit, 0);
  for (let i = 0; i < count; i++) {
    const v = packedCells[i],
      word = structure[i];
    if (!known[v & 255] || (v & 0xf0ff0000) !== 0 || ((v >>> PHASE_SHIFT) & 15) !== phase[v & 255])
      throw Error('Invalid reactive packed material.');
    if ((word & ~COMPLETE_STRUCTURE_3D) !== 0 || (!eligible(v) && word !== 0))
      throw Error('Invalid reactive structural state.');
    if ((word & bondMask) === 0) continue;
    for (let dir = 0; dir < 6; dir++)
      if (word & BONDS_3D[dir]) {
        const j = structuralNeighbor(i, dir, dimensions);
        if (
          j < 0 ||
          !(word & INTEGRITY_3D) ||
          !(structure[j] & INTEGRITY_3D) ||
          !(structure[j] & BONDS_3D[dir ^ 1]) ||
          !eligible(packedCells[j])
        )
          throw Error('Invalid reactive reciprocal bond or boundary.');
      }
  }
  return {
    schemaVersion: 1,
    rulesVersion: block.rulesVersion,
    materialCatalogHash: registry.hash,
    ...dimensions,
    packedCells,
    energyQ,
    structure,
  };
}
const outcome = (f: () => unknown) => {
  try {
    return 'ok ' + JSON.stringify(f());
  } catch (error) {
    return 'throw ' + (error as Error).message;
  }
};
/** Random active materials at assorted temperatures and energies over a bonded, anchored floor. */
function mixedBlock(registry: ReactiveMaterialRegistry3D, seed: number) {
  const rnd = random(seed),
    shape = { width: 6, height: 5, depth: 4 },
    ids = registry.materialIds;
  let block = createReactiveMaterialBlock3D(registry, shape);
  const edits: ReactiveMaterialEdit3D[] = [];
  for (let z = 0; z < shape.depth; z++)
    for (let y = 0; y < shape.height - 1; y++)
      for (let x = 0; x < shape.width; x++)
        edits.push({
          kind: 'place',
          x,
          y,
          z,
          material: ids[Math.floor(rnd() * ids.length)],
          thermal: Math.floor(rnd() * 256),
        });
  const y = shape.height - 1;
  for (let z = 0; z < shape.depth; z++)
    for (let x = 0; x < shape.width; x++) {
      edits.push({ kind: 'place', x, y, z, material: MAT.STONE, thermal: 20 });
      if (x) edits.push({ kind: 'bond', x, y, z, direction: 0, bonded: true });
      if (z) edits.push({ kind: 'bond', x, y, z, direction: 4, bonded: true });
      if (x === 0) edits.push({ kind: 'anchor', x, y, z, anchored: true });
    }
  block = editReactiveMaterialBlock3D(registry, block, edits).block;
  const energy: ReactiveMaterialEdit3D[] = [];
  for (let i = 0; i < block.packedCells.length; i += 3) {
    const x = i % shape.width,
      yy = Math.floor(i / shape.width) % shape.height,
      z = Math.floor(i / (shape.width * shape.height)),
      floor = registry.material(block.packedCells[i] & 255).properties.fuel_energy * ENERGY_SCALE;
    energy.push({
      kind: 'energy',
      x,
      y: yy,
      z,
      energyQ: floor + Math.floor(rnd() * 400 * ENERGY_SCALE),
    });
  }
  return editReactiveMaterialBlock3D(registry, block, energy).block;
}

describe('reactive thermal tables', () => {
  test('tables are cached per registry and mirror registry membership and properties', () => {
    for (const [, registry] of registries) {
      const T = reactiveThermalTables3D(registry),
        source = reactiveRegistrySource3D(registry);
      expect(reactiveThermalTables3D(registry)).toBe(T);
      for (let id = 0; id < 256; id++) {
        const at = id * COLD_STRIDE;
        expect(T.known[id]).toBe(registry.has(id) ? 1 : 0);
        expect(T.sourceKnown[id]).toBe(source.registry.has(id) ? 1 : 0);
        const p = registry.has(id) ? registry.material(id).properties : null;
        // The folded block table read default_phase from the material; inactive ids are zero in both.
        expect(T.defaultPhase[id]).toBe(p ? p.default_phase : 0);
        expect(T.eligibleById[id]).toBe(
          p && (p.default_phase === PHASE.SOLID || p.default_phase === PHASE.FROZEN) && p.cohesion
            ? 1
            : 0,
        );
        expect(T.cohesion[id]).toBe(source.cold[at + COLD_COHESION]);
        expect(T.transitions[id]).toBe(T.up[id] || T.down[id] ? 1 : 0);
        expect(T.upBoundary[id]).toBe(T.fuelQ[id] + T.upPhaseQ[id] + T.upQ[id]);
      }
      expect(T.sourceKnown[MAT.PLAYER]).toBe(1);
      expect(T.known[MAT.PLAYER]).toBe(0);
    }
  });
  test('temperature and thermal view match engine/thermal.ts at every breakpoint', () => {
    const mismatches: number[][] = [];
    let checked = 0;
    for (const [, registry] of registries) {
      const T = reactiveThermalTables3D(registry),
        cold = reactiveRegistrySource3D(registry).cold,
        rnd = random(17);
      for (let id = 0; id < 256; id++) {
        const f = T.fuelQ[id],
          p = f + T.phaseQ[id],
          points = [0, f, p, p + T.upQ[id], p + T.downQ[id], T.upBoundary[id], T.downBoundary[id]],
          energies: number[] = [];
        for (const point of points)
          for (const d of [0, 1, -1, 255, -255, 256, -256]) energies.push(point + d);
        // Random energies near the boundaries and across the whole range: about 2000 per registry each.
        const near = Math.max(...points) + 512;
        for (let k = 0; k < 8; k++)
          energies.push(Math.floor(rnd() * near), Math.floor(rnd() * (MAX_ENERGY_Q + 1)));
        // Temperature depends on the id alone; the view also keeps every other bit of the word.
        const words = [id, (id | 0xf0ff0000) >>> 0, id | 0xff00];
        for (let nibble = 0; nibble < 16; nibble++)
          words.push((id | (Math.floor(rnd() * 256) << 8) | (nibble << PHASE_SHIFT)) >>> 0);
        for (const word of words)
          for (const e of energies) {
            checked++;
            if (
              !Object.is(reactiveTemperatureQ3D(T, word, e), temperatureQ(word, e, cold)) ||
              reactiveThermalView3D(T, word, e) !== thermalView(word, e, cold)
            )
              mismatches.push([id, word, e]);
          }
      }
    }
    expect(mismatches).toEqual([]);
    expect(checked).toBe(3 * 256 * 19 * 65);
  });
  test('block check throws the oracle message or accepts identically under random corruption', () => {
    const odd = [NaN, -1, 0.5, 2 ** 32, -0, 2 ** 53, Infinity, 'x', undefined, null];
    for (const [name, registry] of registries) {
      const rnd = random(name.length * 7919),
        base = mixedBlock(registry, name.length),
        T = reactiveThermalTables3D(registry),
        n = base.packedCells.length,
        inactive = [...Array(256).keys()].filter((id) => !registry.has(id));
      expect(outcome(() => checkReactiveMaterialBlock3D(registry, base))).toBe(
        outcome(() => oracleCheck(registry, base)),
      );
      const counts = new Map<string, number>();
      for (let k = 0; k < 3000; k++) {
        const block = structuredClone(base),
          cells = block.packedCells as unknown[],
          energies = block.energyQ as unknown[],
          hits = rnd() < 0.35 ? 2 : 1;
        for (let h = 0; h < hits; h++) {
          const i = Math.floor(rnd() * n),
            v = block.packedCells[i],
            e = block.energyQ[i],
            r = rnd(),
            pick = <V>(values: V[]) => values[Math.floor(rnd() * values.length)];
          if (r < 0.08) cells[i] = ((v & ~255) | pick(inactive)) >>> 0;
          else if (r < 0.14) cells[i] = ((v & ~255) | MAT.PLAYER) >>> 0;
          else if (r < 0.22) cells[i] = ((v & ~255) | Math.floor(rnd() * 256)) >>> 0;
          else if (r < 0.3) cells[i] = (v ^ ((1 + Math.floor(rnd() * 15)) << PHASE_SHIFT)) >>> 0;
          else if (r < 0.38) {
            const bit = pick([16, 17, 18, 19, 20, 21, 22, 23, 28, 29, 30, 31]);
            cells[i] = rnd() < 0.5 ? v | (1 << bit) : (v | (1 << bit)) >>> 0;
          } else if (r < 0.46) cells[i] = v + pick([256, -256]);
          else if (r < 0.52) cells[i] = pick(odd);
          else if (r < 0.58) energies[i] = T.fuelQ[v & 255] - pick([1, 256, 0]);
          else if (r < 0.62) energies[i] = MAX_ENERGY_Q + pick([0, 1]);
          else if (r < 0.7) energies[i] = pick(odd);
          else if (r < 0.8) energies[i] = e + pick([1, -1, 255, -255, 256, -256]);
          else if (r < 0.86) energies[i] = Math.floor(rnd() * (MAX_ENERGY_Q + 1));
          else if (r < 0.92) block.structure[i] = Math.floor(rnd() * 65536);
          else block.structure[i] ^= 1 << Math.floor(rnd() * 16);
        }
        const actual = outcome(() => checkReactiveMaterialBlock3D(registry, block));
        expect(actual).toBe(outcome(() => oracleCheck(registry, block)));
        const key = actual.startsWith('ok') ? 'ok' : actual.replace(/\[[^\]]*\]/g, '[]');
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      // Every check of the oracle is reached, and some corruptions are still valid states.
      for (const message of [
        'ok',
        'throw packedCells[] must be an integer in [].',
        'throw Undefined material in simulation state.',
        'throw energyQ[] must be an integer in [].',
        'throw Packed thermal view disagrees with conserved energy.',
        'throw Invalid reactive packed material.',
        'throw Invalid reactive structural state.',
        'throw Invalid reactive reciprocal bond or boundary.',
      ])
        expect(counts.get(message), `${name}: ${message}`).toBeGreaterThan(0);
    }
  });
  test('an earlier non-reactive material does not mask a later energy fault', () => {
    for (const [, registry] of registries) {
      const block = mixedBlock(registry, 3),
        cold = reactiveRegistrySource3D(registry).cold;
      // A player word with a consistent thermal view passes the energy loop and fails only later.
      block.packedCells[1] = thermalView(
        ((block.packedCells[1] & ~255) | MAT.PLAYER) >>> 0,
        block.energyQ[1],
        cold,
      );
      expect(outcome(() => checkReactiveMaterialBlock3D(registry, block))).toBe(
        'throw Invalid reactive packed material.',
      );
      block.energyQ[9] = MAX_ENERGY_Q + 1;
      const message = outcome(() => checkReactiveMaterialBlock3D(registry, block));
      expect(message).toBe(outcome(() => oracleCheck(registry, block)));
      expect(message).toMatch(/^throw energyQ\[9\]/);
    }
  });
});
