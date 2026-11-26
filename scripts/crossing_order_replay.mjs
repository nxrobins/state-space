import assert from 'node:assert/strict';
import { at } from './crossing_reference.mjs';

const jsonCopy = (x) => JSON.parse(JSON.stringify(x));
function near(a, b, tol = 1e-8) {
  assert(Math.abs(a - b) < tol, `expected ${b}, got ${a}`);
}
export function complete(plan, budget, visit) {
  while (plan.status() === 'running') {
    const frame = plan.advance(budget);
    if (frame) visit(frame);
  }
  return plan.result();
}
export function impulsesMatch(before, frame) {
  const { edits, result } = frame,
    receipt = result.edits;
  if (!edits.length) {
    assert.equal(receipt.mechanicalEnergy, 0);
    assert(receipt.linearMomentum.every((v) => v === 0));
    return;
  }
  const u = at(before, 'unit'),
    [x, y, z] = u.center,
    [a, b, c] = edits[0].impulse;
  assert.equal(edits.length, 1);
  assert.equal(edits[0].id, u.id);
  const torque = [y * c - z * b, z * a - x * c, x * b - y * a];
  [a, b, c].forEach((j, k) => {
    near(receipt.linearMomentum[k], j);
    near(receipt.angularMomentum[k], torque[k]);
  });
  near(
    receipt.mechanicalEnergy,
    a * u.velocity[0] +
      b * u.velocity[1] +
      c * u.velocity[2] +
      (a * a + b * b + c * c) / (2 * u.mass),
  );
  assert.equal(receipt.storedSubQ, '0');
  assert.equal(receipt.mass, 0);
  assert.equal(receipt.conversionRemainderSubQ, 0);
}
export function logReplay(api, profiles, initial, frames, boundaries) {
  let world = api.createMultiphysicsWorld3D(profiles, jsonCopy(initial));
  for (const [i, expected] of frames.entries()) {
    if (boundaries.includes(i))
      world = api.createMultiphysicsWorld3D(profiles, jsonCopy(world.snapshot()));
    const plan = world.prepare(jsonCopy(expected.edits), 1);
    while (plan.progress().status === 'running') plan.advance(64);
    assert.deepEqual(plan.result(), expected.result, 'log preview tick ' + (i + 1));
    assert.deepEqual(world.commit(plan).result, expected.result, 'log commit tick ' + (i + 1));
    assert.deepEqual(world.snapshot(), expected.result.snapshot);
  }
}
