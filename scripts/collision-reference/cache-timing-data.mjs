/** Data-only checks of the retained native clock counters. Never imports an engine. */
import assert from 'node:assert/strict';

export function verifyClockRecords(steps, gc) {
  for (const entry of gc) {
    for (const key of ['startMs', 'endMs', 'durationMs', 'kind', 'flags'])
      assert(Number.isFinite(entry[key]) && entry[key] >= 0, 'Invalid GC clock');
    assert(entry.endMs >= entry.startMs, 'Reversed GC interval');
    assert(Math.abs(entry.endMs - entry.startMs - entry.durationMs) < 1e-8, 'GC duration mismatch');
  }
  let previousEnd = -Infinity;
  for (const step of steps) {
    for (const key of ['startMs', 'endMs', 'wallMs', 'threadCpuMs', 'processCpuMs'])
      assert(Number.isFinite(step[key]) && step[key] >= 0, 'Invalid step clock');
    assert(step.startMs >= previousEnd && step.endMs >= step.startMs, 'Step clock order');
    assert.equal(step.wallMs, step.endMs - step.startMs, 'Step wall clock mismatch');
    for (const name of ['thread', 'process']) {
      let delta = 0;
      for (const part of ['user', 'system']) {
        const before = step[name + 'Start'][part],
          after = step[name + 'End'][part];
        assert(Number.isSafeInteger(before) && before >= 0, 'Invalid CPU counter');
        assert(Number.isSafeInteger(after) && after >= before, 'Reversed CPU counter');
        delta += after - before;
      }
      assert.equal(step[name + 'CpuMs'], delta / 1000, 'CPU delta mismatch');
    }
    previousEnd = step.endMs;
  }
}
