/** Fixed-face comparison. No study candidate is ever applied to a world. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deserialize } from 'node:v8';
import { gunzipSync } from 'node:zlib';
import { guardNode } from './verification_guard.mjs';
import { hash } from './liquid_contact_engine.mjs';

const maxAbs = (a) => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const relative = (a, b) => maxAbs(a.map((v, i) => v - b[i])) / Math.max(1, maxAbs(b));
function applyRows(rows, face, values) {
  const result = Array(rows[0].length).fill(0);
  face.indices.forEach((index, j) => {
    for (let k = 0; k < result.length; k++) result[k] -= values[j] * rows[index][k];
  });
  return result;
}

function compare(face, op, result) {
  const reference = applyRows(op.responses, face, face.candidate);
  const actual = applyRows(op.responses, face, result.candidate);
  const expectedLoad = applyRows(op.gradients, face, face.candidate);
  const load = applyRows(op.gradients, face, result.candidate);
  // Trial force and torque at each solid's centre, including fixed supports. A trial
  // active face can be discarded by the outer solve; these are not committed forces.
  const bodies = op.columns.bodies.map((id, i) => {
    const start = op.columns.particles.length * 3 + 6 * i;
    const wrench = (v) => v.slice(start, start + 6).map((x) => x / face.dt);
    const expected = wrench(expectedLoad),
      solved = wrench(load);
    return {
      id,
      expected,
      solved,
      forceError: relative(solved.slice(0, 3), expected.slice(0, 3)),
      torqueError: relative(solved.slice(3), expected.slice(3)),
    };
  });
  const responseError = relative(actual, reference);
  const accepted =
    result.accepted &&
    responseError <= 1e-8 &&
    bodies.every((b) => b.forceError <= 1e-8 && b.torqueError <= 1e-8);
  return {
    residual: result.residualInfinity,
    tolerance: result.tolerance,
    responseError,
    bodies,
    iterations: result.iterations,
    matvecs: result.matvecs,
    reason: result.reason,
    accepted,
  };
}

function replay(api, packet, method, inspect) {
  const rows = [],
    answers = [];
  let wallMs = 0,
    cpuMs = 0,
    study,
    previous;
  for (const face of packet.faces) {
    const op = packet.operators.get(face.operator);
    const input = { ...face, gradients: op.gradients, responses: op.responses };
    const pass = face.tick + '/' + face.pass;
    const cpu = process.cpuUsage(),
      start = performance.now();
    // Includes study allocation, sparse conversion, identity checks, Gram/diagonal setup
    // and factorization/iteration. Share setup only within the original world pass.
    if (pass !== previous) study = api.createProjectionStudy3D(method);
    const result = study.solve(input);
    wallMs += performance.now() - start;
    const used = process.cpuUsage(cpu);
    cpuMs += (used.user + used.system) / 1000;
    previous = pass;
    answers.push([result.accepted, result.candidate]);
    if (inspect)
      rows.push({
        tick: face.tick,
        pass: face.pass,
        kind: face.kind,
        faceIteration: face.iteration,
        activeRows: face.indices.length,
        ...compare(face, op, result),
      });
  }
  return { wallMs, cpuMs, rows, answers };
}

await guardNode('cpu', 600);
const [out, file, digest, method, resultFile] = process.argv.slice(2);
assert(['dense', 'matrix-free'].includes(method));
const api = await import(pathToFileURL(resolve(out, 'study.mjs')).href);
const bytes = readFileSync(resolve(out, file));
assert.equal(hash(bytes), digest);
const packet = deserialize(gunzipSync(bytes));
const decodedRSS = process.memoryUsage().rss;
const warm = replay(api, packet, method, true);
const samples = Array.from({ length: 3 }, () => {
  const { cpuMs, wallMs, answers } = replay(api, packet, method, false);
  assert.deepEqual(answers, warm.answers, 'timed solve changed the answer');
  return { cpuMs, wallMs };
});
writeFileSync(
  resultFile,
  JSON.stringify(
    {
      method,
      packetSHA256: digest,
      samples,
      decodedRSSBytes: decodedRSS,
      processPeakRSSKiB: process.resourceUsage().maxRSS,
      rows: warm.rows,
    },
    (_key, v) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v),
  ),
);
