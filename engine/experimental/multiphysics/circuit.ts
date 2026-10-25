/** Cold-start sparse DC solve. Bounded work, no persistent or time-dependent electrical state. */
import { assertRecordFields, copyPortableValue, type PortableValue } from '../../portable-data.js';
import type {
  CircuitReferenceInput3D,
  CircuitReferenceResult3D,
  ResistiveConnection3D,
} from './circuit-reference.js';

export const CIRCUIT_LIMITS_3D = Object.freeze({
  nodes: 4096,
  connections: 8192,
  iterations: 4096,
  work: 2000000,
});
export type CircuitProgress3D = {
  status: 'running' | 'ready' | 'cancelled' | 'failed';
  work: number;
  lastAdvanceWork: number;
  iteration: number;
};
export type CircuitSolveJob3D = {
  advance(budget?: number): CircuitProgress3D;
  progress(): CircuitProgress3D;
  cancel(): boolean;
  result(): CircuitReferenceResult3D;
};
type Row = ResistiveConnection3D & { g: number; index: number };
function finite(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`Invalid ${label}.`);
  return value;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  const n = finite(value, min, max, label);
  if (!Number.isSafeInteger(n)) throw Error(`Invalid integer ${label}.`);
  return n;
}
function read(raw: CircuitReferenceInput3D): CircuitReferenceInput3D {
  const value = copyPortableValue(
    raw as unknown as PortableValue,
  ) as unknown as CircuitReferenceInput3D;
  assertRecordFields(value, ['nodeCount', 'connections', 'source'], [], 'Invalid circuit fields.');
  const n = integer(value.nodeCount, 2, CIRCUIT_LIMITS_3D.nodes, 'node count');
  if (!Array.isArray(value.connections) || value.connections.length > CIRCUIT_LIMITS_3D.connections)
    throw Error('Invalid bounded connections.');
  assertRecordFields(
    value.source,
    ['positive', 'negative', 'emf', 'internalResistance'],
    [],
    'Invalid circuit source fields.',
  );
  for (const key of ['positive', 'negative'] as const)
    integer(value.source[key], 0, n - 1, 'source node');
  if (value.source.positive === value.source.negative) throw Error('Source terminals must differ.');
  finite(value.source.emf, 0, 1000, 'source emf');
  finite(value.source.internalResistance, 1e-6, 1e6, 'source resistance');
  for (const edge of value.connections) {
    assertRecordFields(edge, ['a', 'b', 'resistance'], [], 'Invalid circuit connection fields.');
    integer(edge.a, 0, n - 1, 'node');
    integer(edge.b, 0, n - 1, 'node');
    if (edge.a === edge.b) throw Error('Connection endpoints must differ.');
    finite(edge.resistance, 1e-6, 1e6, 'connection resistance');
  }
  return value;
}

/** Each generator yield is one graph edge, node, or sparse linear algebra row. */
function* solve(input: CircuitReferenceInput3D): Generator<number, CircuitReferenceResult3D, void> {
  const { nodeCount: n, connections, source } = input;
  const edges: Row[] = connections.map((edge, index) => ({
    ...edge,
    g: 1 / edge.resistance,
    index,
  }));
  edges.sort(
    (a, b) =>
      Math.min(a.a, a.b) - Math.min(b.a, b.b) ||
      Math.max(a.a, a.b) - Math.max(b.a, b.b) ||
      a.resistance - b.resistance,
  );
  const adjacency: number[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    adjacency[e.a].push(e.b);
    adjacency[e.b].push(e.a);
    yield 0;
  }
  function* component(start: number): Generator<number, Set<number>, void> {
    const visited = new Set([start]),
      queue = [start];
    for (let head = 0; head < queue.length; head++)
      for (const next of adjacency[queue[head]]) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
        yield 0;
      }
    return visited;
  }
  const positive = yield* component(source.positive),
    negative = positive.has(source.negative) ? positive : yield* component(source.negative);
  const unit: (number | null)[] = Array(n).fill(null);
  for (const i of positive) {
    unit[i] = 1;
    yield 0;
  }
  for (const i of negative) {
    unit[i] = 0;
    yield 0;
  }
  unit[source.positive] = 1;
  const closed = positive === negative;
  let terminalVoltage = source.emf,
    sourceCurrent = 0;
  if (closed) {
    const unknown = [...positive]
      .filter((i) => i !== source.positive && i !== source.negative)
      .sort((a, b) => a - b);
    const index = new Map(unknown.map((id, i) => [id, i])),
      count = unknown.length;
    const diagonal = new Float64Array(count),
      rhs = new Float64Array(count);
    const links: { i: number; j: number; g: number }[] = [];
    for (const e of edges) {
      const i = index.get(e.a),
        j = index.get(e.b);
      if (i !== undefined) {
        diagonal[i] += e.g;
        if (e.b === source.positive) rhs[i] += e.g;
      }
      if (j !== undefined) {
        diagonal[j] += e.g;
        if (e.a === source.positive) rhs[j] += e.g;
      }
      if (i !== undefined && j !== undefined) links.push({ i, j, g: e.g });
      yield 0;
    }
    function* multiply(v: Float64Array, iteration: number): Generator<number, Float64Array, void> {
      const out = new Float64Array(count);
      for (let i = 0; i < count; i++) {
        out[i] = diagonal[i] * v[i];
        yield iteration;
      }
      for (const e of links) {
        out[e.i] -= e.g * v[e.j];
        out[e.j] -= e.g * v[e.i];
        yield iteration;
      }
      return out;
    }
    const x = new Float64Array(count),
      r = rhs.slice(),
      z = new Float64Array(count),
      direction = new Float64Array(count);
    let rz = 0,
      rhsScale = 0;
    for (let i = 0; i < count; i++) {
      z[i] = r[i] / diagonal[i];
      direction[i] = z[i];
      rz += r[i] * z[i];
      rhsScale = Math.max(rhsScale, Math.abs(rhs[i]));
      yield 0;
    }
    let converged = rz === 0;
    for (let iteration = 1; !converged && iteration <= CIRCUIT_LIMITS_3D.iterations; iteration++) {
      const product = yield* multiply(direction, iteration);
      let denominator = 0;
      for (let i = 0; i < count; i++) {
        denominator += direction[i] * product[i];
        yield iteration;
      }
      if (!(denominator > 0) || !Number.isFinite(denominator))
        throw Error('Circuit conjugate gradient breakdown.');
      const alpha = rz / denominator;
      for (let i = 0; i < count; i++) {
        x[i] += alpha * direction[i];
        yield iteration;
      }
      // Recompute true residual periodically and at proposed convergence; never trust recurrence alone.
      for (let i = 0; i < count; i++) {
        r[i] -= alpha * product[i];
        yield iteration;
      }
      let maxResidual = 0;
      for (let i = 0; i < count; i++) {
        maxResidual = Math.max(maxResidual, Math.abs(r[i]));
        yield iteration;
      }
      if (maxResidual <= 1e-12 * Math.max(1, rhsScale) || iteration % 32 === 0) {
        const trueProduct = yield* multiply(x, iteration);
        maxResidual = 0;
        for (let i = 0; i < count; i++) {
          r[i] = rhs[i] - trueProduct[i];
          maxResidual = Math.max(maxResidual, Math.abs(r[i]));
          yield iteration;
        }
      }
      if (maxResidual <= 1e-12 * Math.max(1, rhsScale)) {
        converged = true;
        break;
      }
      let nextRz = 0;
      for (let i = 0; i < count; i++) {
        z[i] = r[i] / diagonal[i];
        nextRz += r[i] * z[i];
        yield iteration;
      }
      const beta = nextRz / rz;
      for (let i = 0; i < count; i++) {
        direction[i] = z[i] + beta * direction[i];
        yield iteration;
      }
      rz = nextRz;
    }
    if (!converged) throw Error('Circuit solve did not converge.');
    for (let i = 0; i < count; i++) {
      unit[unknown[i]] = x[i];
      yield 0;
    }
    let conductance = 0;
    for (const e of edges) {
      if (e.a === source.positive) conductance += e.g * (1 - (unit[e.b] ?? 0));
      else if (e.b === source.positive) conductance += e.g * (1 - (unit[e.a] ?? 0));
      yield 0;
    }
    if (!Number.isFinite(conductance) || conductance <= 0)
      throw Error('Invalid circuit conductance.');
    terminalVoltage = source.emf / (1 + source.internalResistance * conductance);
    sourceCurrent = terminalVoltage * conductance;
  }
  const potentials = unit.map((v) => (v === null ? null : v * terminalVoltage)),
    currents = Array(connections.length).fill(0),
    dissipations = [...currents];
  const junctions = new Float64Array(n);
  let totalDissipation = 0;
  for (const e of edges) {
    const a = potentials[e.a],
      b = potentials[e.b];
    const current = a === null || b === null ? 0 : (a - b) * e.g;
    currents[e.index] = current;
    dissipations[e.index] = current * current * e.resistance;
    totalDissipation += dissipations[e.index];
    junctions[e.a] += current;
    junctions[e.b] -= current;
    yield 0;
  }
  junctions[source.positive] -= sourceCurrent;
  junctions[source.negative] += sourceCurrent;
  let maxJunctionCurrent = 0;
  for (const current of junctions) {
    maxJunctionCurrent = Math.max(maxJunctionCurrent, Math.abs(current));
    yield 0;
  }
  const internalDissipation = sourceCurrent * sourceCurrent * source.internalResistance,
    sourcePower = source.emf * sourceCurrent;
  const power = sourcePower - internalDissipation - totalDissipation;
  if (
    !Number.isFinite(power) ||
    maxJunctionCurrent > 1e-8 * Math.max(1, sourceCurrent) ||
    Math.abs(power) > 1e-8 * Math.max(1, sourcePower)
  )
    throw Error('Circuit residual exceeds tolerance.');
  return {
    potentials,
    currents,
    dissipations,
    sourceCurrent,
    terminalVoltage,
    internalDissipation,
    sourcePower,
    residual: { maxJunctionCurrent, power },
  };
}
export function createCircuitSolveJob3D(raw: CircuitReferenceInput3D): CircuitSolveJob3D {
  const iterator = solve(read(raw));
  let status: CircuitProgress3D['status'] = 'running',
    work = 0,
    lastAdvanceWork = 0,
    iteration = 0,
    result: CircuitReferenceResult3D | undefined;
  const progress = (): CircuitProgress3D => ({ status, work, lastAdvanceWork, iteration });
  return Object.freeze({
    progress,
    advance(budget = 64) {
      integer(budget, 1, 1024, 'circuit work budget');
      lastAdvanceWork = 0;
      if (status !== 'running') return progress();
      try {
        while (lastAdvanceWork < budget) {
          if (work >= CIRCUIT_LIMITS_3D.work) throw Error('Circuit work limit exceeded.');
          const next = iterator.next();
          work++;
          lastAdvanceWork++;
          if (next.done) {
            result = next.value;
            status = 'ready';
            break;
          }
          iteration = Math.max(iteration, next.value);
        }
      } catch (error) {
        status = 'failed';
        iterator.return(undefined as never);
        throw error;
      }
      return progress();
    },
    cancel() {
      if (status !== 'running' && status !== 'ready') return false;
      status = 'cancelled';
      result = undefined;
      iterator.return(undefined as never);
      return true;
    },
    result() {
      if (status !== 'ready' || !result) throw Error('Circuit result is not ready.');
      return structuredClone(result);
    },
  });
}
