/** Explicit CPU investigation, never part of native or ordinary CPU selection. */
import { expect, test } from 'vitest';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createFluidReferenceJob3D,
  type FluidReferenceInput3D,
  type FluidProjectionFaceCapture3D,
} from './fluids.js';
import { createProjectionStudy3D, type ProjectionStudyMethod3D } from './projection-study.js';
import {
  createFluidStudyBlock3D as block,
  createFluidStudyWedge3D as wedge,
} from '../../test-support/multiphysics-fluid-fixtures.js';

const output = process.env.STATE_SPACE_SOLVER_STUDY_OUTPUT;
const mode = process.env.STATE_SPACE_SOLVER_STUDY_MODE;
if (
  !output ||
  !['pilot', 'profile'].includes(mode ?? '') ||
  !process.env.STATE_SPACE_VERIFICATION_JOB
)
  throw Error('Use the supervised profile_coupled_solver.mjs entry point after incident review.');

function run(
  scene: FluidReferenceInput3D,
  budget: number,
  capture?: (face: FluidProjectionFaceCapture3D) => void,
) {
  const started = performance.now(),
    job = createFluidReferenceJob3D(scene, capture);
  const stages: Record<string, { work: number; instrumentedMs: number }> = {};
  while (job.progress().status === 'running') {
    const before = performance.now(),
      p = job.advance(budget);
    if (budget === 1) {
      const row = (stages[p.stage] ??= { work: 0, instrumentedMs: 0 });
      if (p.status === 'running') row.work++;
      row.instrumentedMs += performance.now() - before;
    }
  }
  const result = job.result();
  return { result, ms: performance.now() - started, stages, progress: job.progress() };
}
const norm = (v: number[]) => Math.max(0, ...v.map(Math.abs));
function response(face: FluidProjectionFaceCapture3D, candidate: number[]): number[] {
  const out = Array(face.responses[0]?.length ?? 0).fill(0) as number[];
  for (let i = 0; i < candidate.length; i++)
    for (let k = 0; k < out.length; k++)
      out[k] += face.responses[face.indices[i]][k] * candidate[i];
  return out;
}

for (const [name, scene] of (mode === 'pilot'
  ? [['pilot-8', block(2)]]
  : [
      ['coupled-27', block(3)],
      ['coupled-64', block(4)],
      ['redundant-narrow-wedge', wedge()],
    ]) as [string, FluidReferenceInput3D][]) {
  test(name, () => {
    const report: Record<string, unknown> = { name, mode, status: 'started' };
    const save = () =>
      writeFileSync(
        resolve(output!, `${name}.json`),
        JSON.stringify(
          report,
          (_key, value) =>
            typeof value === 'number' && !Number.isFinite(value) ? String(value) : value,
          2,
        ) + '\n',
      );
    save();
    try {
      const original = structuredClone(scene),
        reference = run(scene, 256);
      const times: number[] = [];
      for (let i = 0; i < (mode === 'pilot' ? 1 : 3); i++) {
        const next = run(scene, 256);
        times.push(next.ms);
        expect(next.result).toEqual(reference.result);
      }
      const faces: FluidProjectionFaceCapture3D[] = [];
      const observed = run(scene, 1);
      const captured = run(scene, 256, (face) => {
        if (faces.length === 64) throw Error('Study capture limit reached.');
        faces.push(face);
      });
      // Timing/capture cannot silently change the reference output or work semantics.
      expect(observed.result).toEqual(reference.result);
      expect(captured.result).toEqual(reference.result);
      expect(observed.progress.completedWork).toBe(reference.progress.completedWork);
      expect(scene).toEqual(original);
      const cancelled = createFluidReferenceJob3D(scene);
      cancelled.advance(1);
      expect(cancelled.cancel()).toBe(true);
      expect(() => cancelled.result()).toThrow();
      const replays = [];
      for (const method of ['dense', 'dense-reuse', 'matrix-free'] as ProjectionStudyMethod3D[]) {
        const study = createProjectionStudy3D(method);
        for (const temperature of ['cold', 'frozen-repeat']) {
          const started = performance.now(),
            rows = [];
          let solverMs = 0;
          for (const face of faces) {
            const solveStarted = performance.now();
            const linear = study.solve(face);
            solverMs += performance.now() - solveStarted;
            const expected = response(face, face.candidate),
              actual = response(face, linear.candidate);
            const responseRelativeError =
              norm(actual.map((v, i) => v - expected[i])) / Math.max(1, norm(expected));
            rows.push({
              ...linear,
              candidate: undefined,
              activeRows: face.indices.length,
              kind: face.kind,
              responseRelativeError,
              fixedFaceAccepted: linear.accepted && responseRelativeError <= 1e-8,
            });
          }
          replays.push({
            method,
            temperature,
            solverMs,
            verificationWindowMs: performance.now() - started,
            rows,
          });
        }
      }
      Object.assign(report, {
        status: 'complete',
        particles: scene.particles.length,
        boundaries: scene.boundaries.length,
        contacts: scene.contacts?.length ?? 0,
        referenceMs: times,
        referenceSetupRunMs: reference.ms,
        completedWork: reference.progress.completedWork,
        maxTotalWork: reference.progress.maxTotalWork,
        convergence: reference.result.convergence,
        energy: reference.result.energy,
        instrumentedStages: observed.stages,
        capturedFaces: faces.length,
        replays,
        scope:
          'Alternative timings cover fixed active faces only; they do not include full nonlinear solving or establish a world speedup. Frozen repeats are a reuse upper bound.',
        matrixFreeIntegrationAccepted: false,
      });
      save();
      console.log(
        JSON.stringify({ name, capturedFaces: faces.length, referenceMs: times, output }),
      );
    } catch (error) {
      Object.assign(report, { status: 'failed', error: String(error) });
      save();
      throw error;
    }
  });
}
