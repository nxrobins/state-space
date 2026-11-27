/** The frozen liquid/contact behaviour: the light cases and the rejection vocabulary. The heavy
 * cases, and the same comparison against a bundled engine, run under the supervisor with
 * `node scripts/freeze_liquid_contact.mjs check`.
 *
 * A failure here means behaviour changed. An exact-behaviour change must not fail it. A change
 * to the physical model re-records the freeze in the same commit, so the diff of the freeze
 * file states which cases changed. A recorded rejection is evidence, never a passing result. */
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import * as engine from '../multiphysics.js';
import {
  FROZEN_CASES_3D,
  FROZEN_REJECTION_SOURCES_3D,
  recordFrozenCase3D,
  rejectionVocabulary3D,
  type FrozenRecord3D,
} from '../../test-support/multiphysics-frozen-cases.js';

type Freeze = {
  schema: string;
  engine: { sourceSha256: string; commit: string | null };
  runtime: { node: string; v8: string };
  rejections: Record<string, string[]>;
  cases: Record<string, FrozenRecord3D & { why: string; heavy: boolean }>;
};
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const freeze = JSON.parse(read('./liquid-contact-freeze.json')) as Freeze;
let profiles: engine.MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await engine.createMultiphysicsProfiles3D();
});

test('the freeze file covers exactly the catalogue', () => {
  expect(freeze.schema).toBe('liquid-contact-freeze-1');
  expect(Object.keys(freeze.cases)).toEqual(FROZEN_CASES_3D.map((frozen) => frozen.id));
  for (const frozen of FROZEN_CASES_3D)
    expect(freeze.cases[frozen.id]).toMatchObject({
      id: frozen.id,
      group: frozen.group,
      why: frozen.why,
      heavy: frozen.heavy,
    });
});

test('every recorded rejection left its input untouched and repeated exactly', () => {
  const rejected = Object.values(freeze.cases).filter((row) => row.outcome === 'rejected');
  expect(rejected.length).toBeGreaterThan(0);
  for (const row of rejected) expect(row.rejection, row.id).toMatchObject({ atomic: true });
  // The catalogue's rejection boundaries must stay rejections; none may quietly start passing.
  for (const row of Object.values(freeze.cases))
    if (row.group === 'rejection') expect(row.outcome, row.id).toBe('rejected');
});

test.each(FROZEN_REJECTION_SOURCES_3D)('the rejections in %s are the frozen ones', (file) => {
  expect(rejectionVocabulary3D(read(`./${file}`))).toEqual(freeze.rejections[file]);
});

test.each(FROZEN_CASES_3D.filter((frozen) => !frozen.heavy))('$id behaves as frozen', (frozen) => {
  const { why: _why, heavy: _heavy, ...expected } = freeze.cases[frozen.id];
  const record = recordFrozenCase3D(engine, profiles, frozen);
  expect(record).toEqual(expected);
});
