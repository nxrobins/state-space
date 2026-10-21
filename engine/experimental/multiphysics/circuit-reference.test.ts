import { describe, expect, test } from 'vitest';
import { solveReferenceCircuit3D, type CircuitReferenceInput3D } from './circuit-reference.js';
const source = { positive: 0, negative: 2, emf: 12, internalResistance: 6 };
describe('independent bounded DC reference', () => {
  test('series divider includes battery internal loss and Kirchhoff balance', () => {
    const input = {
      nodeCount: 3,
      connections: [
        { a: 0, b: 1, resistance: 2 },
        { a: 1, b: 2, resistance: 4 },
      ],
      source,
    };
    const before = structuredClone(input),
      result = solveReferenceCircuit3D(input);
    expect(result.sourceCurrent).toBeCloseTo(1, 12);
    expect(result.potentials).toEqual([6, 4, 0]);
    expect(result.dissipations).toEqual([2, 4]);
    expect(result.internalDissipation).toBe(6);
    expect(result.sourcePower).toBe(12);
    expect(result.residual.maxJunctionCurrent).toBeLessThan(1e-12);
    expect(Math.abs(result.residual.power)).toBeLessThan(1e-12);
    expect(input).toEqual(before);
  });
  test('parallel paths divide current; a short remains bounded by internal resistance', () => {
    const input = {
      nodeCount: 2,
      connections: [
        { a: 0, b: 1, resistance: 4 },
        { a: 1, b: 0, resistance: 4 },
      ],
      source: { ...source, negative: 1, emf: 8, internalResistance: 2 },
    };
    const parallel = solveReferenceCircuit3D(input);
    expect(parallel.sourceCurrent).toBe(2);
    expect(parallel.currents).toEqual([1, -1]);
    expect(parallel.sourcePower).toBe(16);
    const short = solveReferenceCircuit3D({
      ...input,
      connections: [{ a: 0, b: 1, resistance: 1e-6 }],
    });
    expect(short.sourceCurrent).toBeLessThan(4);
    expect(short.sourceCurrent).toBeGreaterThan(3.99);
    expect(short.internalDissipation).toBeGreaterThan(31.99);
  });
  test('open and floating components have zero current and consume no energy', () => {
    const result = solveReferenceCircuit3D({
      nodeCount: 5,
      connections: [
        { a: 0, b: 1, resistance: 1 },
        { a: 3, b: 4, resistance: 1 },
      ],
      source,
    });
    expect(result.potentials).toEqual([12, 12, 0, null, null]);
    expect(result.currents).toEqual([0, 0]);
    expect(result.sourcePower).toBe(0);
  });
  test('a balanced bridge carries no cross current and is independent of edge ordering', () => {
    const input: CircuitReferenceInput3D = {
      nodeCount: 4,
      source: { ...source, negative: 3, internalResistance: 2 },
      connections: [
        { a: 0, b: 1, resistance: 2 },
        { a: 1, b: 3, resistance: 2 },
        { a: 0, b: 2, resistance: 2 },
        { a: 2, b: 3, resistance: 2 },
        { a: 1, b: 2, resistance: 7 },
      ],
    };
    const result = solveReferenceCircuit3D(input),
      reversed = solveReferenceCircuit3D({
        ...input,
        connections: input.connections.slice().reverse(),
      });
    expect(result.potentials).toEqual(reversed.potentials);
    expect(result.currents[4]).toBeCloseTo(0, 12);
    expect(result.sourceCurrent).toBeCloseTo(3, 12);
    expect(result.currents).toEqual(reversed.currents.reverse());
  });
  test('rejects zero resistance, identical terminals, non-finite data and oversized inputs', () => {
    const input = { nodeCount: 3, connections: [{ a: 0, b: 2, resistance: 0 }], source };
    expect(() => solveReferenceCircuit3D(input)).toThrow();
    expect(() =>
      solveReferenceCircuit3D({ ...input, connections: [], source: { ...source, negative: 0 } }),
    ).toThrow();
    expect(() =>
      solveReferenceCircuit3D({ ...input, connections: [], source: { ...source, emf: NaN } }),
    ).toThrow();
    expect(() => solveReferenceCircuit3D({ ...input, nodeCount: 33 })).toThrow();
    let read = false;
    const bad = {
      ...input,
      get source() {
        read = true;
        return source;
      },
    };
    expect(() => solveReferenceCircuit3D(bad)).toThrow();
    expect(read).toBe(false);
  });
});

test('asymmetric bridge has independently derived rational nodal solution and a floating island', () => {
  const result = solveReferenceCircuit3D({
    nodeCount: 6,
    connections: [
      { a: 0, b: 1, resistance: 1 },
      { a: 1, b: 3, resistance: 2 },
      { a: 0, b: 2, resistance: 2 },
      { a: 2, b: 3, resistance: 1 },
      { a: 1, b: 2, resistance: 2 },
      { a: 4, b: 5, resistance: 3 },
    ],
    source: { positive: 0, negative: 3, emf: 24, internalResistance: 2 },
  });
  // Unit-source nodal equations: 4u1-u2=2, -u1+4u2=1.
  // u1=3/5, u2=2/5, conductance=7/10; battery terminal voltage=10.
  for (const [i, expected] of [10, 6, 4, 0].entries())
    expect(result.potentials[i]).toBeCloseTo(expected, 12);
  expect(result.potentials.slice(4)).toEqual([null, null]);
  for (const [i, expected] of [4, 3, 3, 4, 1, 0].entries())
    expect(result.currents[i]).toBeCloseTo(expected, 12);
  expect(result.sourceCurrent).toBeCloseTo(7, 12);
  expect(result.sourcePower).toBeCloseTo(168, 12);
  expect(result.internalDissipation).toBeCloseTo(98, 12);
});
