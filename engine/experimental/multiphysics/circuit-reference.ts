/** Small independent DC reference. This is an oracle, not the world runtime solver. */
import { assertRecordFields, copyPortableValue, type PortableValue } from '../../portable-data.js';

export const CIRCUIT_REFERENCE_LIMITS_3D = Object.freeze({
  nodes: 32,
  connections: 256,
  resistanceMin: 1e-6,
  resistanceMax: 1e6,
  emfMax: 1000,
});
export type ResistiveConnection3D = { a: number; b: number; resistance: number };
export type CircuitReferenceInput3D = {
  nodeCount: number;
  connections: ResistiveConnection3D[];
  source: { positive: number; negative: number; emf: number; internalResistance: number };
};
export type CircuitReferenceResult3D = {
  /** Floating components have no assigned reference potential. */
  potentials: (number | null)[];
  /** Signed in the supplied a -> b direction; input order is preserved. */
  currents: number[];
  dissipations: number[];
  sourceCurrent: number;
  terminalVoltage: number;
  internalDissipation: number;
  sourcePower: number;
  residual: { maxJunctionCurrent: number; power: number };
};
const fields = (value: unknown, keys: string[]) =>
  assertRecordFields(value, keys, [], 'Invalid DC reference fields.');
function scalar(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error('Invalid DC reference scalar.');
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  const n = scalar(value, min, max);
  if (!Number.isSafeInteger(n)) throw Error('Invalid DC reference index.');
  return n;
}
function read(raw: unknown): CircuitReferenceInput3D {
  const value = copyPortableValue(raw as PortableValue);
  fields(value, ['nodeCount', 'connections', 'source']);
  const r = value as Record<string, unknown>,
    nodeCount = integer(r.nodeCount, 2, CIRCUIT_REFERENCE_LIMITS_3D.nodes);
  if (
    !Array.isArray(r.connections) ||
    r.connections.length > CIRCUIT_REFERENCE_LIMITS_3D.connections
  )
    throw Error('DC connection budget exceeded.');
  const resistance = (v: unknown) =>
    scalar(v, CIRCUIT_REFERENCE_LIMITS_3D.resistanceMin, CIRCUIT_REFERENCE_LIMITS_3D.resistanceMax);
  const connections = r.connections.map((row) => {
    fields(row, ['a', 'b', 'resistance']);
    const a = integer(row.a, 0, nodeCount - 1),
      b = integer(row.b, 0, nodeCount - 1);
    if (a === b) throw Error('A resistive connection requires distinct nodes.');
    return { a, b, resistance: resistance(row.resistance) };
  });
  fields(r.source, ['positive', 'negative', 'emf', 'internalResistance']);
  const s = r.source as Record<string, unknown>,
    positive = integer(s.positive, 0, nodeCount - 1),
    negative = integer(s.negative, 0, nodeCount - 1);
  if (positive === negative) throw Error('A source requires distinct terminals.');
  return {
    nodeCount,
    connections,
    source: {
      positive,
      negative,
      emf: scalar(s.emf, 0, CIRCUIT_REFERENCE_LIMITS_3D.emfMax),
      internalResistance: resistance(s.internalResistance),
    },
  };
}
/** Dense elimination with deterministic partial pivoting, independent of a sparse production solver. */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (a[pivot][col] === 0 || !Number.isFinite(a[pivot][col]))
      throw Error('Singular DC reference system.');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];
    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      a[row][col] = 0;
      for (let k = col + 1; k < n; k++) a[row][k] -= factor * a[col][k];
      b[row] -= factor * b[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
    if (!Number.isFinite(x[row])) throw Error('Non-finite DC reference solution.');
  }
  return x;
}
export function solveReferenceCircuit3D(raw: CircuitReferenceInput3D): CircuitReferenceResult3D {
  const { nodeCount: n, connections, source: s } = read(raw),
    adjacency = Array.from({ length: n }, () => [] as number[]);
  for (const edge of connections) {
    adjacency[edge.a].push(edge.b);
    adjacency[edge.b].push(edge.a);
  }
  const component = (start: number) => {
    const found = new Set([start]),
      queue = [start];
    for (let k = 0; k < queue.length; k++)
      for (const j of adjacency[queue[k]])
        if (!found.has(j)) {
          found.add(j);
          queue.push(j);
        }
    return found;
  };
  const positive = component(s.positive),
    potentials: (number | null)[] = new Array(n).fill(null),
    unit = new Array<number>(n).fill(0);
  unit[s.positive] = 1;
  let terminalVoltage = s.emf,
    sourceCurrent = 0;
  if (!positive.has(s.negative)) {
    for (const i of positive) potentials[i] = s.emf;
    for (const i of component(s.negative)) potentials[i] = 0;
  } else {
    const unknown = [...positive]
      .filter((i) => i !== s.positive && i !== s.negative)
      .sort((a, b) => a - b);
    const index = new Map(unknown.map((node, i) => [node, i]));
    const a = unknown.map(() => new Array<number>(unknown.length).fill(0)),
      b = new Array<number>(unknown.length).fill(0);
    // Canonical edge traversal makes equivalent input permutations use the same arithmetic order.
    const canonical = connections
      .slice()
      .sort(
        (x, y) =>
          Math.min(x.a, x.b) - Math.min(y.a, y.b) ||
          Math.max(x.a, x.b) - Math.max(y.a, y.b) ||
          x.resistance - y.resistance,
      );
    for (const edge of canonical)
      for (const [at, other] of [
        [edge.a, edge.b],
        [edge.b, edge.a],
      ]) {
        const row = index.get(at);
        if (row === undefined) continue;
        const g = 1 / edge.resistance;
        a[row][row] += g;
        const column = index.get(other);
        if (column !== undefined) a[row][column] -= g;
        else if (other === s.positive) b[row] += g;
      }
    const solution = solve(a, b);
    for (let i = 0; i < unknown.length; i++) unit[unknown[i]] = solution[i];
    let conductance = 0;
    for (const edge of canonical)
      if (edge.a === s.positive || edge.b === s.positive)
        conductance += (1 - unit[edge.a === s.positive ? edge.b : edge.a]) / edge.resistance;
    if (!(conductance > 0) || !Number.isFinite(conductance))
      throw Error('Invalid DC equivalent conductance.');
    terminalVoltage = s.emf / (1 + s.internalResistance * conductance);
    sourceCurrent = terminalVoltage * conductance;
    for (const i of positive) potentials[i] = unit[i] * terminalVoltage;
  }
  const currents = connections.map((e) =>
    potentials[e.a] === null || potentials[e.b] === null
      ? 0
      : (potentials[e.a]! - potentials[e.b]!) / e.resistance,
  );
  const dissipations = connections.map((e, i) => currents[i] * currents[i] * e.resistance),
    junction = new Array<number>(n).fill(0);
  for (let i = 0; i < connections.length; i++) {
    junction[connections[i].a] += currents[i];
    junction[connections[i].b] -= currents[i];
  }
  junction[s.positive] -= sourceCurrent;
  junction[s.negative] += sourceCurrent;
  const internalDissipation = sourceCurrent * sourceCurrent * s.internalResistance,
    sourcePower = s.emf * sourceCurrent;
  const residual = {
    maxJunctionCurrent: Math.max(...junction.map(Math.abs)),
    power: sourcePower - internalDissipation - dissipations.reduce((a, b) => a + b, 0),
  };
  if (
    residual.maxJunctionCurrent > 1e-8 * Math.max(1, sourceCurrent) ||
    Math.abs(residual.power) > 1e-8 * Math.max(1, sourcePower)
  )
    throw Error('DC reference residual exceeds tolerance.');
  return {
    potentials,
    currents,
    dissipations,
    sourceCurrent,
    terminalVoltage,
    internalDissipation,
    sourcePower,
    residual,
  };
}
