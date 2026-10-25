import { expect, test } from 'vitest';
import { createProjectionStudy3D } from './projection-study.js';
import type { FluidProjectionFaceCapture3D } from './fluids.js';

const face = (): FluidProjectionFaceCapture3D => ({
  gradients: [
    [1, 1, 0],
    [0, 1, 1],
  ],
  responses: [
    [1, 0.5, 0],
    [0, 0.5, 2],
  ],
  indices: [0, 1],
  rhs: [2, 3],
  candidate: [1, 1],
  kind: 'divergence',
  iteration: 32,
});

test.each(['dense', 'dense-reuse', 'matrix-free'] as const)(
  '%s matches an independent mass-metric two-row solution',
  (method) => {
    // A = [[1.5, .5], [.5, 2.5]], A [1,1] = [2,3].
    const result = createProjectionStudy3D(method).solve(face());
    expect(result.accepted).toBe(true);
    for (const value of result.candidate) expect(value).toBeCloseTo(1, 10);
    expect(result.residualInfinity).toBeLessThanOrEqual(result.tolerance);
    if (method === 'matrix-free') expect(result.matrixEntries).toBe(2);
  },
);

test('factor reuse permits a new RHS and invalidates ordered faces and changed coefficients', () => {
  const study = createProjectionStudy3D('dense-reuse'),
    original = face();
  expect(study.solve(original).factorizations).toBe(1);
  const changedRhs = study.solve({ ...original, rhs: [4, 6] });
  expect(changedRhs.factorHits).toBe(1);
  for (const value of changedRhs.candidate) expect(value).toBeCloseTo(2, 10);
  const reversed = study.solve({ ...original, indices: [1, 0], rhs: [3, 2] });
  expect(reversed.factorizations).toBe(1);
  expect(reversed.factorHits).toBe(0);
  const changedMetric = study.solve({
    ...original,
    responses: [
      [2, 1, 0],
      [0, 1, 4],
    ],
  });
  expect(changedMetric.factorHits).toBe(0);
  expect(changedMetric.factorizations).toBe(1);
  for (const value of changedMetric.candidate) expect(value).toBeCloseTo(0.5, 10);
  expect(study.solve(original).factorHits).toBe(0);
});

test('compatible redundant rows accept physical response equivalence rather than unique impulses', () => {
  const redundant: FluidProjectionFaceCapture3D = {
    ...face(),
    gradients: [
      [1, 0],
      [1, 0],
    ],
    responses: [
      [1, 0],
      [1, 0],
    ],
    rhs: [2, 2],
  };
  for (const method of ['dense', 'matrix-free'] as const) {
    const result = createProjectionStudy3D(method).solve(redundant);
    expect(result.accepted).toBe(true);
    expect(result.candidate[0] + result.candidate[1]).toBeCloseTo(2, 10);
  }
});

test('inconsistent redundant rows fail the original residual rather than accepting a pivot floor', () => {
  for (const method of ['dense', 'matrix-free'] as const) {
    const result = createProjectionStudy3D(method).solve({
      ...face(),
      gradients: [
        [1, 0],
        [1, 0],
      ],
      responses: [
        [1, 0],
        [1, 0],
      ],
      rhs: [2, 3],
    });
    expect(result.accepted).toBe(false);
  }
});

test('invalid study shapes and nonfinite coefficients cannot enter the cache', () => {
  const study = createProjectionStudy3D('dense-reuse');
  expect(() => study.solve({ ...face(), indices: [0, 0] })).toThrow();
  expect(() =>
    study.solve({
      ...face(),
      responses: [
        [Infinity, 0, 0],
        [0, 1, 1],
      ],
    }),
  ).toThrow();
  expect(study.solve(face()).factorHits).toBe(0);
});
