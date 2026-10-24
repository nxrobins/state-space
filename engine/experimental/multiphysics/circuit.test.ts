import { expect, test } from 'vitest';
import { createCircuitSolveJob3D } from './circuit.js';
import { solveReferenceCircuit3D, type CircuitReferenceInput3D } from './circuit-reference.js';
const bridge: CircuitReferenceInput3D = {
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
};
function run(input: CircuitReferenceInput3D, budget = 64) {
  const job = createCircuitSolveJob3D(input);
  while (job.progress().status === 'running')
    expect(job.advance(budget).lastAdvanceWork).toBeLessThanOrEqual(budget);
  return job.result();
}
test('sparse solver agrees with independent dense oracle across asymmetric networks and disconnected islands', () => {
  for (let size = 4; size <= 16; size++) {
    const input: CircuitReferenceInput3D = {
      nodeCount: size + 2,
      connections: Array.from({ length: size - 1 }, (_, i) => ({
        a: i,
        b: i + 1,
        resistance: 0.3 + (i % 5),
      })),
      source: { positive: 0, negative: size - 1, emf: 17, internalResistance: 0.7 },
    };
    for (let i = 0; i < size - 3; i++)
      input.connections.push({ a: i, b: i + 3, resistance: 2.4 + i });
    input.connections.push({ a: size, b: size + 1, resistance: 3 });
    const expected = solveReferenceCircuit3D(input),
      actual = run(input, 7);
    expect(actual.sourceCurrent).toBeCloseTo(expected.sourceCurrent, 9);
    for (let i = 0; i < size; i++)
      expect(actual.potentials[i]).toBeCloseTo(expected.potentials[i]!, 9);
    expect(actual.potentials.slice(size)).toEqual([null, null]);
    expect(actual.residual.maxJunctionCurrent).toBeLessThan(1e-8);
  }
  expect(run(bridge, 1)).toEqual(run(bridge, 1024));
});
test('long chain has analytical resistance beyond the dense oracle limit', () => {
  const size = 80,
    result = run({
      nodeCount: size,
      connections: Array.from({ length: size - 1 }, (_, a) => ({ a, b: a + 1, resistance: 1 })),
      source: { positive: 0, negative: size - 1, emf: 80, internalResistance: 1 },
    });
  expect(result.sourceCurrent).toBeCloseTo(1, 8);
  expect(result.potentials[40]).toBeCloseTo(39, 8);
});
test('cancellation, input ownership, failed data and returned result ownership are atomic', () => {
  const input = structuredClone(bridge),
    job = createCircuitSolveJob3D(input);
  input.connections[0].resistance = 100;
  job.advance(1);
  expect(() => job.result()).toThrow();
  expect(job.cancel()).toBe(true);
  expect(job.advance().status).toBe('cancelled');
  expect(() => job.result()).toThrow();
  const done = createCircuitSolveJob3D(bridge);
  while (done.progress().status === 'running') done.advance();
  const first = done.result();
  first.potentials[0] = 999;
  expect(done.result().potentials[0]).toBeCloseTo(10, 10);
  expect(() =>
    createCircuitSolveJob3D({ ...bridge, connections: [{ a: 0, b: 1, resistance: 0 }] }),
  ).toThrow();
  let reads = 0;
  expect(() =>
    createCircuitSolveJob3D({
      ...bridge,
      get nodeCount() {
        reads++;
        return 6;
      },
    }),
  ).toThrow();
  expect(reads).toBe(0);
});
test('open circuit carries no current and input edge order does not change nodal solution', () => {
  const open = run({
    ...bridge,
    connections: [
      { a: 0, b: 1, resistance: 1 },
      { a: 4, b: 5, resistance: 1 },
    ],
  });
  expect(open.sourceCurrent).toBe(0);
  expect(open.sourcePower).toBe(0);
  expect(open.potentials).toEqual([24, 24, null, 0, null, null]);
  const reversed = run({ ...bridge, connections: [...bridge.connections].reverse() });
  expect(reversed.potentials).toEqual(run(bridge).potentials);
  expect(reversed.currents).toEqual([...run(bridge).currents].reverse());
});
