// Static source identity and synthetic data only. No engine execution.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyClockRecords } from '../scripts/collision-reference/cache-timing-data.mjs';

test('cached engine, exact replay, differential checks and timing wrapper remain pinned', () => {
  const packet = JSON.parse(
    readFileSync(
      new URL(
        '../dist/verification/collision-normal-cache-20261109-v3/packet.json',
        import.meta.url,
      ),
    ),
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
      'timing-data.mjs',
    ].map((p) => 'scripts/collision-reference/' + p),
  ];
  for (const file of packet.files.filter((f) =>
    fixed.some((prefix) => f.path.startsWith(prefix)),
  )) {
    const bytes = readFileSync(
      new URL(
        '../' +
          (file.path === 'engine/experimental/multiphysics/rigid.ts'
            ? 'dist/verification/collision-offset-cache-review-20261109/rigid.ts.before'
            : file.path),
        import.meta.url,
      ),
    );
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
  }
});

test('clock validation preserves off-CPU gaps, coarse negative gaps and overlapping GC elapsed time', () => {
  const step = {
    startMs: 10,
    endMs: 260,
    wallMs: 250,
    threadCpuMs: 0,
    processCpuMs: 16,
    threadStart: { user: 1000, system: 0 },
    threadEnd: { user: 1000, system: 0 },
    processStart: { user: 2000, system: 0 },
    processEnd: { user: 18000, system: 0 },
  };
  const gc = [{ startMs: 20, endMs: 250, durationMs: 230, kind: 1, flags: 0 }];
  verifyClockRecords([step], gc);
  verifyClockRecords([{ ...step, endMs: 11, wallMs: 1 }], []);
  for (const patch of [
    { threadCpuMs: 1 },
    { wallMs: 251 },
    { endMs: 9 },
    { startMs: NaN },
    { processEnd: { user: 1, system: 0 } },
  ])
    assert.throws(() => verifyClockRecords([{ ...step, ...patch }], gc));
  assert.throws(() => verifyClockRecords([step, step], gc));
  assert.throws(() => verifyClockRecords([step], [{ ...gc[0], durationMs: 229 }]));
});
