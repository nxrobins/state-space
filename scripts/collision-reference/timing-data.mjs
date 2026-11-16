/** Transparent per-step clocks and data-only attribution; no engine import. */
import { performance } from 'node:perf_hooks';
import { PROTOCOL, ticksFor } from './protocol.mjs';
import { same } from './replay.mjs';

const nativeClocks = {
  now: () => performance.now(),
  thread: () => process.threadCpuUsage(),
  process: () => process.cpuUsage(),
};
function cpuDelta(after, before) {
  const result = { user: after.user - before.user, system: after.system - before.system };
  if (Object.values(result).some((v) => !Number.isSafeInteger(v) || v < 0))
    throw Error('Invalid CPU clock delta');
  return result;
}

export function timeRigidSteps(api, maxRecords, clocks = nativeClocks) {
  const records = [];
  const wrapped = {
    ...api,
    createRigidStep3D(...args) {
      if (records.length >= maxRecords) throw Error('Step timing record budget exceeded');
      let job,
        closed = false,
        completedWork = null,
        yielded = 0;
      const startMs = clocks.now(),
        threadStart = clocks.thread(),
        processStart = clocks.process();
      const finish = () => {
        if (closed) return;
        closed = true;
        const threadEnd = clocks.thread(),
          processEnd = clocks.process(),
          endMs = clocks.now();
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs)
          throw Error('Invalid wall clock interval');
        const thread = cpuDelta(threadEnd, threadStart),
          process = cpuDelta(processEnd, processStart);
        records.push({
          startMs,
          endMs,
          wallMs: endMs - startMs,
          threadStart,
          threadEnd,
          processStart,
          processEnd,
          threadCpuMs: (thread.user + thread.system) / 1000,
          processCpuMs: (process.user + process.system) / 1000,
          yielded,
          completedWork,
        });
      };
      try {
        job = Reflect.apply(api.createRigidStep3D, api, args);
      } catch (error) {
        finish();
        throw error;
      }
      return {
        next(...values) {
          const result = Reflect.apply(job.next, job, values);
          if (result.done) completedWork = result.value?.report?.work ?? null;
          else yielded++;
          return result;
        },
        return(...values) {
          try {
            return Reflect.apply(job.return, job, values);
          } finally {
            finish();
          }
        },
        throw(...values) {
          return Reflect.apply(job.throw, job, values);
        },
        [Symbol.iterator]() {
          return this;
        },
      };
    },
  };
  return { api: wrapped, records };
}

/** Mirrors only the frozen benchmark's invocation order, checked against every work receipt. */
export function benchmarkLayout(dt) {
  const count = ticksFor(dt),
    layout = [];
  const add = (phase, sample, start = 0, end = count) => {
    for (let tick = start; tick < end; tick++) layout.push({ phase, sample, tick });
  };
  add('reference', 0);
  for (const budget of PROTOCOL.budgets) add('budget', budget);
  add('restart-lossless', 0, 2);
  add('restart-json', 0, 2);
  add('cancellation', 0, 0, 1);
  for (let i = 0; i < PROTOCOL.warmups; i++) add('warmup', i);
  for (let i = 0; i < PROTOCOL.samples; i++) add('measured', i);
  return layout;
}

export function overlapMs(start, end, intervals) {
  const clipped = intervals
    .map((v) => [Math.max(start, v.startMs), Math.min(end, v.endMs)])
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    previousEnd = start;
  for (const [a, b] of clipped) {
    total += Math.max(0, b - Math.max(a, previousEnd));
    previousEnd = Math.max(b, previousEnd);
  }
  return total;
}

export function annotateTiming(records, row, gc) {
  const layout = benchmarkLayout(row.dt);
  same(records.length, layout.length, 'timed benchmark invocation count');
  const steps = records.map((record, i) => {
    const label = layout[i];
    if (label.phase === 'cancellation') {
      same(record.completedWork, null, 'timed cancellation completion');
      same(record.yielded, 1, 'timed cancellation progress');
    } else {
      const expected = row.exact.value.frames[label.tick].result.report.work;
      same(record.completedWork, expected, 'timed per-step work receipt');
      same(record.yielded, expected, 'timed per-step yields');
    }
    const gcIndices = gc.flatMap((entry, index) =>
      entry.startMs < record.endMs && entry.endMs > record.startMs ? [index] : [],
    );
    return {
      ...record,
      ...label,
      wallMinusThreadCpuMs: record.wallMs - record.threadCpuMs,
      wallMinusProcessCpuMs: record.wallMs - record.processCpuMs,
      gcOverlapMs: overlapMs(
        record.startMs,
        record.endMs,
        gcIndices.map((i) => gc[i]),
      ),
      gcIndices,
    };
  });
  const samples = row.timing.samplesMs.map((wallMs, sample) => {
    const selected = steps.filter((s) => s.phase === 'measured' && s.sample === sample);
    const sum = (key) => selected.reduce((n, step) => n + step[key], 0);
    if (sum('wallMs') > wallMs + 1e-6) throw Error('Instrumented clocks exceed benchmark boundary');
    return {
      sample,
      wallMs,
      wrappedWallMs: sum('wallMs'),
      threadCpuMs: sum('threadCpuMs'),
      processCpuMs: sum('processCpuMs'),
      gcOverlapMs: sum('gcOverlapMs'),
      maximumStepWallMs: Math.max(...selected.map((s) => s.wallMs)),
      work: sum('completedWork'),
    };
  });
  return { steps, samples };
}
