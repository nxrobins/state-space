/** Private fixed-face experiment, deliberately disconnected from world solving.
 * Every residual uses the unfloored mass-metric operator. A successful linear
 * replay does not qualify unilateral contact, a world trajectory or a release.
 */
import type { FluidProjectionFaceCapture3D } from './fluids.js';

export type ProjectionStudyMethod3D = 'dense' | 'dense-reuse' | 'matrix-free';
export type ProjectionStudyResult3D = {
  candidate: number[];
  accepted: boolean;
  reason: string;
  residualInfinity: number;
  tolerance: number;
  iterations: number;
  factorizations: number;
  factorHits: number;
  matrixEntries: number;
  matvecs: number;
  scalarProducts: number;
};
type SparseRow = [number, number][];
const infinity = (values: readonly number[]) => Math.max(0, ...values.map(Math.abs));

/** At most one exact operator and four active-face factors survive a replay.
 * The full finite coefficient serialization is compared, without hash collisions.
 * RHS changes permit reuse; an operator or ordered-face change cannot hit a factor.
 * Identity construction and sparse conversion are part of the caller's timing.
 */
export function createProjectionStudy3D(method: ProjectionStudyMethod3D): {
  solve(face: FluidProjectionFaceCapture3D): ProjectionStudyResult3D;
} {
  let identity = '',
    gradients: SparseRow[] = [],
    responses: SparseRow[] = [],
    width = 0,
    gram: number[][] | null = null;
  const factors = new Map<string, number[][]>();
  return {
    solve(face) {
      const size = face.gradients.length;
      if (
        size > 384 ||
        face.responses.length !== size ||
        face.indices.length > size ||
        face.rhs.length !== face.indices.length ||
        new Set(face.indices).size !== face.indices.length ||
        face.indices.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= size) ||
        face.rhs.some((v) => !Number.isFinite(v))
      )
        throw Error('Invalid projection study face.');
      const nextWidth = face.gradients[0]?.length ?? 0;
      if (
        nextWidth > 1152 ||
        [...face.gradients, ...face.responses].some(
          (row) => row.length !== nextWidth || row.some((v) => !Number.isFinite(v)),
        )
      )
        throw Error('Invalid projection study operator.');
      const nextIdentity = JSON.stringify([face.gradients, face.responses]);
      if (identity !== nextIdentity) {
        identity = nextIdentity;
        width = nextWidth;
        const sparse = (rows: number[][]): SparseRow[] =>
          rows.map((row) =>
            row.flatMap((value, i): SparseRow => (value === 0 ? [] : [[i, value]])),
          );
        gradients = sparse(face.gradients);
        responses = sparse(face.responses);
        gram = null;
        factors.clear();
      }
      const indices = face.indices,
        n = indices.length,
        tolerance = 1e-11 * Math.max(1, infinity(face.rhs));
      const result: ProjectionStudyResult3D = {
        candidate: Array(n).fill(0),
        accepted: false,
        reason: 'iteration limit',
        residualInfinity: Infinity,
        tolerance,
        iterations: 0,
        factorizations: 0,
        factorHits: 0,
        matrixEntries: 0,
        matvecs: 0,
        scalarProducts: 0,
      };
      function entry(i: number, j: number): number {
        let value = 0;
        // Match the reference matrix assembly's arithmetic order.
        for (let k = 0; k < width; k++) value += face.gradients[i][k] * face.responses[j][k];
        result.scalarProducts += width;
        result.matrixEntries++;
        return value;
      }
      function apply(values: number[]): number[] {
        const response = new Float64Array(width);
        for (let j = 0; j < n; j++)
          for (const [k, value] of responses[indices[j]]) {
            response[k] += value * values[j];
            result.scalarProducts++;
          }
        result.matvecs++;
        return indices.map((i) => {
          let value = 0;
          for (const [k, gradient] of gradients[i]) {
            value += gradient * response[k];
            result.scalarProducts++;
          }
          return value;
        });
      }
      function residual(candidate: number[]): number[] {
        return apply(candidate).map((v, i) => face.rhs[i] - v);
      }
      if (method !== 'matrix-free') {
        if (gram === null) {
          gram = Array.from({ length: size }, () => Array(size).fill(0));
          for (let i = 0; i < size; i++)
            for (let j = 0; j <= i; j++) gram[i][j] = gram[j][i] = entry(i, j);
        }
        const faceKey = JSON.stringify(indices);
        let factor = method === 'dense-reuse' ? factors.get(faceKey) : undefined;
        if (factor) result.factorHits++;
        else {
          factor = [];
          for (let a = 0; a < n; a++) {
            const values: number[] = [],
              i = indices[a];
            for (let b = 0; b <= a; b++) {
              let value = gram[i][indices[b]];
              for (let c = 0; c < b; c++) value -= values[c] * (a === b ? values[c] : factor[b][c]);
              values.push(
                a === b ? Math.sqrt(Math.max(value, gram[i][i] * 1e-12)) : value / factor[b][b],
              );
            }
            if (!(values[a] > 0) || !Number.isFinite(values[a]))
              throw Error('Invalid study factor.');
            factor.push(values);
          }
          result.factorizations++;
          if (method === 'dense-reuse') {
            if (factors.size === 4) factors.delete(factors.keys().next().value!);
            factors.set(faceKey, factor);
          }
        }
        const forward: number[] = [];
        for (let a = 0; a < n; a++) {
          let value = face.rhs[a];
          for (let b = 0; b < a; b++) value -= factor[a][b] * forward[b];
          forward.push(value / factor[a][a]);
        }
        for (let a = n - 1; a >= 0; a--) {
          let value = forward[a];
          for (let b = a + 1; b < n; b++) value -= factor[b][a] * result.candidate[b];
          result.candidate[a] = value / factor[a][a];
        }
        result.iterations = 1;
      } else {
        const diagonal = indices.map((i) => entry(i, i));
        if (diagonal.some((d) => !(d > 0))) throw Error('Invalid study diagonal.');
        let r = face.rhs.slice(),
          z = r.map((v, i) => v / diagonal[i]),
          direction = z.slice();
        const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0);
        let rz = dot(r, z);
        for (
          let iteration = 0;
          infinity(r) > tolerance && iteration < Math.min(512, 2 * n + 8);
          iteration++
        ) {
          const ad = apply(direction),
            curvature = dot(direction, ad);
          if (!(curvature > 0) || !Number.isFinite(curvature) || !Number.isFinite(rz)) {
            result.reason = 'nonpositive or nonfinite curvature';
            break;
          }
          const alpha = rz / curvature;
          result.candidate = result.candidate.map((v, i) => v + alpha * direction[i]);
          r = r.map((v, i) => v - alpha * ad[i]);
          result.iterations = iteration + 1;
          // A recurrence residual alone must never establish acceptance.
          if (infinity(residual(result.candidate)) <= tolerance) break;
          z = r.map((v, i) => v / diagonal[i]);
          const next = dot(r, z),
            beta = next / rz;
          direction = z.map((v, i) => v + beta * direction[i]);
          rz = next;
        }
      }
      result.residualInfinity = infinity(residual(result.candidate));
      result.accepted =
        result.candidate.every(Number.isFinite) && result.residualInfinity <= tolerance;
      if (result.accepted) result.reason = 'original operator residual';
      return result;
    },
  };
}
