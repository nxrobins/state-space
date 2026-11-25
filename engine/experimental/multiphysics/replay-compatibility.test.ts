import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import {
  createMultiphysicsProfiles3D,
  createMultiphysicsSnapshot3D,
  createMultiphysicsWorld3D,
  importUnversionedLiquidHeatSnapshot3D,
  readMultiphysicsSnapshot3D,
  type MultiphysicsProfiles3D,
  type MultiphysicsPreview3D,
  type MultiphysicsSnapshot3D,
} from '../multiphysics.js';
import {
  digestFrozen3D,
  type FrozenRecord3D,
} from '../../test-support/multiphysics-frozen-cases.js';

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const directory = '../../test-support/fixtures/';
const saved = read(directory + 'combined-v1-tick24.json') as MultiphysicsSnapshot3D;
const id = 'combined-failure-builder-journey';
let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});

function finish(preview: MultiphysicsPreview3D, budget: number) {
  while (preview.progress().status === 'running') preview.advance(budget);
}

// The source engine saved at tick 24, five ticks before the histories first diverge.
// Compare whole committed predictions (state, edit receipt, tick reports), including work.
test.each([
  ['original', directory + 'liquid-contact-world-1.json'],
  ['unversioned heat release', './liquid-contact-freeze.json'],
])('restores the %s history through its recorded edge', (producer, path) => {
  const original = producer === 'original';
  const initial = original
    ? readMultiphysicsSnapshot3D(profiles, saved)
    : importUnversionedLiquidHeatSnapshot3D(profiles, saved);
  const rules = original ? 'multiphysics-world-1' : 'multiphysics-world-2';
  expect(initial.rules).toBe(rules);
  expect({ ...initial, rules: saved.rules }).toEqual(saved);
  const freeze = read(path);
  const expected: FrozenRecord3D = freeze.cases[id];
  const exact = process.versions.v8 === freeze.runtime.v8;
  const world = createMultiphysicsWorld3D(profiles, initial);
  for (let pair = 12; pair <= 24; pair++) {
    const edits =
      pair === 24 ? [{ kind: 'heat' as const, id: saved.parcels[0].id, energyQ: 2048 }] : [];
    const preview = world.prepare(edits, 2);
    finish(preview, pair % 2 ? 256 : 1);
    const work = preview.progress().work;
    const { result } = world.commit(preview);
    expect(result.snapshot.rules).toBe(rules);
    if (exact) expect(`${digestFrozen3D(result).slice(0, 16)} ${work}`).toBe(expected.steps[pair]);
    if (pair === 18) world.restore(JSON.parse(JSON.stringify(world.snapshot())));
  }
  const before = digestFrozen3D(world.snapshot());
  if (exact) expect(before).toBe(expected.final);
  const next = world.prepare([], 2);
  if (original) {
    expect(() => finish(next, 256)).toThrow(/World numerical energy limit exceeded/);
    if (exact) {
      expect(next.progress().work).toBe(expected.rejection!.work);
      const retry = world.prepare([], 2);
      expect(() => finish(retry, 1)).toThrow(expected.rejection!.message);
    }
    expect(digestFrozen3D(world.snapshot())).toBe(before);
  } else {
    finish(next, 256);
    expect(world.commit(next).result.snapshot.tick).toBe(52);
  }
  expect(saved.rules).toBe('multiphysics-world-1');
});

test('new saves select v2 and an explicit heat-release import still validates its input', () => {
  const current = createMultiphysicsSnapshot3D(profiles, { parcels: [] });
  expect(current.rules).toBe('multiphysics-world-2');
  expect(() => importUnversionedLiquidHeatSnapshot3D(profiles, current)).toThrow(/unversioned/);
  for (const read of [readMultiphysicsSnapshot3D, importUnversionedLiquidHeatSnapshot3D]) {
    expect(() => read(profiles, { ...saved, rules: 'unknown' })).toThrow(/Incompatible/);
    expect(() => read(profiles, { ...saved, catalogHash: 'unknown' })).toThrow(/Incompatible/);
  }
});
