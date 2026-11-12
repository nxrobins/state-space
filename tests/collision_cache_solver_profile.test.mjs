// Static source checks and retained coverage decoding only; no engine or inspector execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { decodeSolverCoverage } from '../scripts/collision-reference/solver-profile-data.mjs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url));
const hash = (b) => createHash('sha256').update(b).digest('hex');

test('cached engine, replay, regression suites and attribution stay pinned to the completed cache comparison', () => {
  const packet = JSON.parse(
    read('dist/verification/collision-normal-cache-20261109-v3/packet.json'),
  );
  const fixed = [
    'engine/',
    ...[
      'engine-entry.ts',
      'state-space.mjs',
      'protocol.mjs',
      'replay.mjs',
      'exact-state.mjs',
      'profile-data.mjs',
      'owned-regression.mjs',
      'normal-cache-regression.mjs',
      'solver-profile-data.mjs',
    ].map((p) => 'scripts/collision-reference/' + p),
  ];
  for (const file of packet.files.filter((f) => fixed.some((prefix) => f.path.startsWith(prefix))))
    assert.equal(
      hash(
        read(
          file.path === 'engine/experimental/multiphysics/rigid.ts'
            ? 'dist/verification/collision-offset-cache-review-20261109/rigid.ts.before'
            : file.path,
        ),
      ),
      file.sha256,
      file.path,
    );
});

test('cached coverage baseline decodes the unchanged workload and zero-friction branch', () => {
  const bytes = read(
    'dist/verification/collision-cpu/e3e46c48e46847a19a50477dee6c5f61/ss-normal-cache-counts/coverage.json',
  );
  assert.equal(hash(bytes), 'f7092ab43849255c199a0e9d405a7c70648993840f438c9830707feafe073b21');
  const text = read('dist/verification/collision-normal-cache-20261109-v3/engine.mjs');
  assert.equal(hash(text), '44a000628cfe99134fbf3cb39cd6a431f826bc3212560524d396bf54445e7de7');
  const raw = JSON.parse(bytes),
    script = raw.result.filter((s) => s.url.endsWith('/engine.mjs'));
  assert.equal(script.length, 1);
  const functions = decodeSolverCoverage(raw, text.toString(), script[0].url);
  for (const [name, expected] of Object.entries({
    createRigidStep3D: 357,
    effective: 8544,
    relative: 145248,
    pointVelocity: 315772,
    apply: 244928,
    record: 247064,
    diskSolution: 0,
  })) {
    const match = functions.filter(
      (f) => f.source === 'engine/experimental/multiphysics/rigid.ts' && f.function === name,
    );
    assert.equal(match.length, 1, name);
    assert.equal(match[0].callCount, expected, name);
  }
});
