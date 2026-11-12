// Static source invariants only; real differential tests run through the fixed CPU scope.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from '@typescript/typescript6';
import {
  newProgressTrace,
  appendProgress,
  progressPrefix,
} from '../scripts/collision-reference/normal-cache-regression.mjs';
import { captureExact } from '../scripts/collision-reference/exact-state.mjs';
const read = (path) =>
  readFileSync(new URL(path, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const beforePath = '../dist/verification/collision-normal-cache-review-20261109/rigid.ts.before';
const before = read(beforePath),
  after = read('../dist/verification/collision-offset-cache-review-20261109/rigid.ts.before');
test('the entire engine edit is exactly one private lazy denominator cache', () => {
  assert.equal(
    createHash('sha256')
      .update(readFileSync(new URL(beforePath, import.meta.url)))
      .digest('hex'),
    '2a9f951f01bb4b61d22dc5ccf416f7ef734f3072c6e1a936db52e5edb626dd7a',
  );
  const reverted = after
    .replace('  normalDenominator: number | undefined;\n', '')
    .replace('                  normalDenominator: undefined,\n', '')
    .replace(
      '          // Geometry and inertia stay fixed within this solve; each solve builds fresh contacts.\n',
      '',
    )
    .replace(
      '(c.normalDenominator ??= dotVec3(c.normal, effective(c, c.normal)))',
      'dotVec3(c.normal, effective(c, c.normal))',
    );
  assert.equal(reverted, before);
  assert.equal((after.match(/normalDenominator/g) ?? []).length, 3);
});
test('lazy cache evaluation follows the same yield and relative velocity and parses without error', () => {
  assert(
    after.includes(
      "yield progress('contact');\n          // Geometry and inertia stay fixed within this solve; each solve builds fresh contacts.\n          const velocity = relative(c),\n            denominator = (c.normalDenominator ??= dotVec3(c.normal, effective(c, c.normal)));",
    ),
  );
  const source = ts.createSourceFile('rigid.ts', after, ts.ScriptTarget.Latest, true);
  assert.deepEqual(source.parseDiagnostics, []);
});
test('diagnostic progress encoding is lossless across phases and prefixes', () => {
  const values = [
    'assembly',
    'assembly',
    'sweep',
    'contact',
    'contact',
    'contact',
    'sweep',
    'fracture',
  ].map((phase, i) => ({ phase, work: i + 1 }));
  const trace = newProgressTrace();
  for (const value of values) appendProgress(trace, value);
  const decode = (t) =>
    t.runs.flatMap((r) =>
      Array.from({ length: r.count }, (_, i) => ({ phase: r.phase, work: r.firstWork + i })),
    );
  assert.deepEqual(decode(trace), values);
  for (let n = 0; n <= values.length; n++)
    assert.deepEqual(decode(progressPrefix(trace, n)), values.slice(0, n));
});
test('large contact traces preserve every yield within the unchanged exact-state bounds', () => {
  const trace = newProgressTrace();
  for (let work = 1; work <= 100000; work++) appendProgress(trace, { phase: 'contact', work });
  assert.deepEqual(trace, {
    count: 100000,
    runs: [{ phase: 'contact', firstWork: 1, count: 100000 }],
  });
  assert(captureExact({ frames: [trace, trace] }).nodes < 100);
  assert.equal(progressPrefix(trace, 31096).runs[0].count, 31096);
});
test('progress encoding rejects skipped work, extra fields, wrong order and unknown phases', () => {
  for (const value of [
    { phase: 'contact', work: 2 },
    { phase: 'contact', work: 1, extra: 1 },
    { work: 1, phase: 'contact' },
    { phase: 'unknown', work: 1 },
  ])
    assert.throws(() => appendProgress(newProgressTrace(), value));
  assert.throws(() => progressPrefix(newProgressTrace(), 1));
});
