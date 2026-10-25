/** Explicit frozen-reference comparison; use the supervised comparison launcher. */
import { beforeAll, test } from 'vitest';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { createFluidReferenceJob3D, FluidReferenceInput3D } from './fluids.js';
import { createFluidStudyBlock3D } from '../../test-support/multiphysics-fluid-fixtures.js';

type Engine = { createFluidReferenceJob3D: typeof createFluidReferenceJob3D };
const output = process.env.STATE_SPACE_FLUID_COMPARISON_OUTPUT;
const bundles = JSON.parse(process.env.STATE_SPACE_FLUID_COMPARISON_BUNDLES ?? 'null') as Record<
  string,
  string
> | null;
if (!output || !bundles || !process.env.STATE_SPACE_VERIFICATION_JOB)
  throw Error('Use the supervised compare_fluid_optimizations.mjs launcher.');
const engines: Record<string, Engine> = {};
const names = ['baseline', 'coordinate', 'zero-viscosity', 'combined'];
beforeAll(async () => {
  for (const name of names)
    engines[name] = (await import(/* @vite-ignore */ pathToFileURL(bundles[name]).href)) as Engine;
});

function step(engine: Engine, input: FluidReferenceInput3D, budget = 256) {
  const start = performance.now(),
    job = engine.createFluidReferenceJob3D(input);
  while (job.progress().status === 'running') job.advance(budget);
  const result = job.result();
  return { ms: performance.now() - start, result, progress: job.progress() };
}
function stages(engine: Engine, input: FluidReferenceInput3D) {
  const job = engine.createFluidReferenceJob3D(input);
  const rows: Record<string, { work: number; instrumentedMs: number }> = {};
  while (job.progress().status === 'running') {
    const start = performance.now(),
      p = job.advance(1);
    const row = (rows[p.stage] ??= { work: 0, instrumentedMs: 0 });
    if (p.status === 'running') row.work++;
    row.instrumentedMs += performance.now() - start;
  }
  return rows;
}
function percentile(values: number[], fraction: number) {
  const sorted = values.slice().sort((a, b) => a - b),
    p = (sorted.length - 1) * fraction;
  const low = Math.floor(p),
    high = Math.ceil(p);
  return sorted[low] + (sorted[high] - sorted[low]) * (p - low);
}

test.each([3, 4])('exact comparison and paired timing of %s-cubed liquid block', (side) => {
  const input = createFluidStudyBlock3D(side),
    unchanged = structuredClone(input);
  const report: Record<string, unknown> = {
    particles: side ** 3,
    status: 'started',
    warmupsPerVariant: 5,
    pairedRounds: 15,
  };
  const save = () =>
    writeFileSync(
      resolve(output!, `comparison-${side ** 3}.json`),
      JSON.stringify(report, null, 2) + '\n',
    );
  save();
  try {
    const reference = step(engines.baseline, input);
    for (const name of names.slice(1)) {
      const old = engines.baseline.createFluidReferenceJob3D(input),
        next = engines[name].createFluidReferenceJob3D(input);
      while (old.progress().status === 'running')
        assert.deepStrictEqual(next.advance(1), old.advance(1));
      assert.deepStrictEqual(next.result(), reference.result);
      assert.deepStrictEqual(step(engines[name], input, 256).result, reference.result);
      const reversed = {
        ...input,
        particles: input.particles.slice().reverse(),
        boundaries: input.boundaries.slice().reverse(),
        contacts: input.contacts?.slice().reverse(),
      };
      assert.deepStrictEqual(step(engines[name], reversed).result, reference.result);
      const cancelled = engines[name].createFluidReferenceJob3D(input);
      while (cancelled.progress().stage !== 'divergence-projection') cancelled.advance(1);
      assert.equal(cancelled.cancel(), true);
      assert.throws(() => cancelled.result(), /not complete/);
    }
    for (let warmup = 0; warmup < 5; warmup++)
      for (let i = 0; i < names.length; i++) {
        const name = names[(i + warmup) % names.length];
        assert.deepStrictEqual(step(engines[name], input).result, reference.result);
      }
    const rounds: Record<string, number>[] = [];
    report.rounds = rounds;
    for (let round = 0; round < 15; round++) {
      const measured: Record<string, number> = {};
      for (let i = 0; i < names.length; i++) {
        const name = names[(i + round) % names.length];
        const next = step(engines[name], input);
        measured[name] = next.ms;
        assert.deepStrictEqual(next.result, reference.result);
        assert.deepStrictEqual(next.progress, reference.progress);
      }
      rounds.push(measured);
    }
    const summary = Object.fromEntries(
      names.map((name) => {
        const times = rounds.map((r) => r[name]),
          ratios = rounds.map((r) => r.baseline / r[name]);
        return [
          name,
          {
            medianMs: percentile(times, 0.5),
            p25Ms: percentile(times, 0.25),
            p75Ms: percentile(times, 0.75),
            minMs: Math.min(...times),
            maxMs: Math.max(...times),
            medianPairedSpeedup: percentile(ratios, 0.5),
            wins: ratios.filter((r) => r > 1).length,
          },
        ];
      }),
    );
    assert.deepStrictEqual(input, unchanged);
    Object.assign(report, {
      status: 'complete',
      exactResults: true,
      exactProgressStages: true,
      exactCanonicalReversal: true,
      cancellationNoPublication: true,
      inputUnchanged: true,
      summary,
      completedWork: reference.progress.completedWork,
      maxTotalWork: reference.progress.maxTotalWork,
      convergence: reference.result.convergence,
      energy: reference.result.energy,
      instrumentedStages: Object.fromEntries(
        names.map((name) => [name, stages(engines[name], input)]),
      ),
      scope:
        'Whole frozen CPU step, including input and output copies; no world trajectory, native runtime or GPU qualification. Paired speedup is the median of per-round baseline/variant ratios.',
    });
    save();
    console.log(JSON.stringify({ particles: side ** 3, summary, exactResults: true, output }));
  } catch (error) {
    Object.assign(report, {
      status: 'failed',
      error: String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 16000) : undefined,
    });
    save();
    throw error;
  }
});
