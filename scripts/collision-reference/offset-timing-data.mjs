/** Data-only cohort summaries. Wall, CPU and GC overlap are overlapping measures. */
import assert from 'node:assert/strict';
export function summarizeTimingRows(rows) {
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const describe = (row) => {
    const wall = row.timing.samplesMs;
    assert.equal(wall.length, 7);
    assert(wall.every((value) => Number.isFinite(value) && value >= 0));
    const sorted = [...wall].sort((a, b) => a - b);
    assert.equal(row.timing.medianMs, sorted[3]);
    if (row.instrumented) {
      assert.equal(row.samples.length, 7);
      row.samples.forEach((sample, index) => {
        assert.equal(sample.sample, index);
        assert.equal(sample.wallMs, wall[index]);
        for (const key of ['wrappedWallMs', 'threadCpuMs', 'processCpuMs', 'gcOverlapMs', 'work'])
          assert(Number.isFinite(sample[key]) && sample[key] >= 0);
      });
    }
    return {
      wallSamplesMs: wall,
      wallMedianMs: sorted[3],
      wallMeanMs: mean(wall),
      wallMaximumMs: sorted.at(-1),
      ...(row.instrumented
        ? {
            meanWrappedWallMs: mean(row.samples.map((s) => s.wrappedWallMs)),
            meanThreadCpuMs: mean(row.samples.map((s) => s.threadCpuMs)),
            meanProcessCpuMs: mean(row.samples.map((s) => s.processCpuMs)),
            meanGcOverlapMs: mean(row.samples.map((s) => s.gcOverlapMs)),
            maximumGcOverlapMs: Math.max(...row.samples.map((s) => s.gcOverlapMs)),
            distinctWorkCounts: [...new Set(row.samples.map((s) => s.work))],
          }
        : {}),
    };
  };
  const keys = new Set(rows.map((row) => row.case + '/' + row.dt));
  return [...keys].map((key) => {
    const selected = rows.filter((row) => row.case + '/' + row.dt === key);
    assert.equal(selected.length, 2, 'Each cohort must retain both controls');
    const baseline = selected.find((row) => row.version === 'baseline');
    const optimized = selected.find((row) => row.version === 'optimized');
    assert(baseline && optimized);
    assert.equal(baseline.instrumented, optimized.instrumented);
    assert.deepEqual(baseline.order, optimized.order);
    const control = describe(baseline),
      offsetCache = describe(optimized);
    return {
      case: baseline.case,
      dt: baseline.dt,
      order: baseline.order,
      instrumented: baseline.instrumented,
      control,
      offsetCache,
      medianChangeFraction: offsetCache.wallMedianMs / control.wallMedianMs - 1,
      meanChangeFraction: offsetCache.wallMeanMs / control.wallMeanMs - 1,
    };
  });
}
