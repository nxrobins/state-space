/** Supervised, bounded reference fixture for the v2 world. Length, mass and force are model units. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serialize } from 'node:v8';
import { gzipSync } from 'node:zlib';
import { bundleEngine, hash, loadCatalogue } from './liquid_contact_engine.mjs';
import { guardNode } from './verification_guard.mjs';

const dt = 1 / 480,
  gravity = 9.8,
  ticks = 160;
// A 3:4:5 edge-to-sample triangle gives tangency at y=1.025. Leave a small
// vertical clearance so a supported deck cannot push the resting water.
const deckY = 0.5 + 0.4 + 0.125 + 0.0001;
const cases = [
  { id: 'unloaded', mass: 0, strength: 50 },
  { id: 'light', mass: 1, strength: 50 },
  { id: 'heavy', mass: 10, strength: 50 },
  { id: 'reinforced', mass: 10, strength: 500 },
];
const at = (state, id) => {
  const p = state.parcels.find((p) => p.id === id);
  assert(p, 'missing parcel ' + id);
  return p;
};
function initialState(api, profiles, { mass, strength }) {
  const solid = (id, center, halfExtents, bodyMass) => {
    const p = api.seedThermalParcel3D(profiles, {
      id,
      center,
      halfExtents,
      material: 'ceramic',
      owner: 'authored',
      temperature: 20,
    });
    const volume = 8 * halfExtents[0] * halfExtents[1] * halfExtents[2];
    const props = api.cuboidMassProperties(halfExtents, bodyMass / volume);
    return { ...p, mass: bodyMass, principalInertia: props.inertia };
  };
  const water = [-0.5, 0.5].flatMap((x, i) =>
    [-0.7, 0.7].map((z, j) =>
      api.seedThermalParcel3D(profiles, {
        id: 'water-' + i + j,
        center: [x, 0.5, z],
        material: 'water',
        owner: 'authored',
        temperature: 20,
      }),
    ),
  );
  return api.createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      solid('abutment', [-1.375, deckY, 0], [0.375, 0.125, 0.4], 1),
      solid('deck', [0, deckY, 0], [1, 0.125, 0.4], 1),
      solid('floor', [0, -0.5, 0], [2.5, 0.5, 2.5], 1),
      ...water,
      ...(mass ? [solid('ballast', [0, deckY + 0.125 + 0.25, 0], [0.25, 0.25, 0.25], mass)] : []),
    ],
    anchors: ['abutment', 'floor'],
    bonds: [{ a: 'abutment', b: 'deck', strength, restLength: 1.375 }],
    settings: { dt, gravity: [0, -gravity, 0], restitution: 0, friction: 0 },
  });
}

function observe(initial, { snapshot, report }, digest) {
  const ballast = snapshot.parcels.find((p) => p.id === 'ballast');
  const water = initial.parcels
    .filter((p) => p.material === 'water')
    .map((p) => {
      const q = at(snapshot, p.id);
      assert.equal(q.material, 'water');
      assert.equal(q.mass, p.mass);
      return { id: p.id, center: q.center, delta: q.center.map((v, k) => v - p.center[k]) };
    });
  return {
    tick: snapshot.tick,
    work: report.work,
    numericalEnergy: report.numericalEnergy,
    resultSHA256: digest({ snapshot, report }),
    bondIntact: snapshot.bonds.some((b) => b.a === 'abutment' && b.b === 'deck'),
    broken: report.brokenBonds.map((b) => [b.a, b.b]),
    deckY: at(snapshot, 'deck').center[1],
    ballastY: ballast?.center[1] ?? null,
    ballastVy: ballast?.velocity[1] ?? null,
    // The public receipt is the impulse received by ALL fixed boundaries.
    boundaryImpulse: report.boundaryLinearImpulse,
    boundaryAngularImpulse: report.boundaryAngularImpulse,
    water,
    maxWaterTravel: Math.max(...water.map((q) => Math.hypot(...q.delta))),
  };
}
function direct(api, profiles, state) {
  const job = api.createMultiphysicsTickJob3D(profiles, state);
  while (job.progress().status === 'running') job.advance(256);
  return job.result();
}
function replay(api, profiles, initial, results) {
  const world = api.createMultiphysicsWorld3D(profiles, initial);
  const checkpoints = [0, 1, Math.floor(ticks / 2)];
  for (const [i, expected] of results.entries()) {
    if (checkpoints.includes(i)) {
      const save = JSON.parse(JSON.stringify(world.snapshot()));
      world.restore(save);
    }
    const preview = world.prepare([], 1);
    while (preview.progress().status === 'running') preview.advance(1);
    const { result } = world.commit(preview);
    assert.deepEqual(
      { snapshot: result.snapshot, report: result.ticks[0] },
      expected,
      'restored replay at tick ' + (i + 1),
    );
    assert.deepEqual(world.snapshot(), expected.snapshot, 'published state at tick ' + (i + 1));
  }
  return checkpoints;
}
function compare(outcomes) {
  const { unloaded, light, heavy, reinforced } = outcomes;
  const crossingBreak = heavy.rows.filter((r) => r.broken.length);
  assert.equal(crossingBreak.length, 1, 'one heavy fracture');
  assert.deepEqual(crossingBreak[0].broken, [['abutment', 'deck']]);
  const fractureTick = crossingBreak[0].tick;
  assert(
    heavy.rows.every((r) => (r.tick < fractureTick ? r.bondIntact : !r.bondIntact)),
    'fracture receipt and bond topology',
  );
  for (const c of [light, reinforced]) {
    const initialHeight = at(c.initial, 'ballast').center[1];
    assert(
      c.rows.every((r) => Math.abs(r.ballastY - initialHeight) < 1e-8),
      c.id + ' ballast left its supported height',
    );
  }
  for (const c of [unloaded, light, reinforced]) {
    assert(
      c.rows.every((r) => r.bondIntact && !r.broken.length),
      'control fractured: ' + c.id,
    );
    assert(
      c.rows.every((r) => Math.abs(r.deckY - deckY) < 1e-8),
      'control deck moved: ' + c.id,
    );
  }
  // Before the deck moves, subtract identical abutment, deck, floor and resting water weight.
  // Check independently against static weight and the free ballast's change of vertical momentum.
  for (const c of [light, heavy, reinforced]) {
    const r = c.rows[0],
      tare = unloaded.rows[0];
    const support = -(r.boundaryImpulse[1] - tare.boundaryImpulse[1]) / dt;
    const fromBallast = c.mass * (r.ballastVy / dt + gravity);
    assert(
      Math.abs(support - c.mass * gravity) < 1e-5 && Math.abs(support - fromBallast) < 1e-5,
      c.id + ' incremental upward force ' + support + ' vs ' + fromBallast,
    );
    c.initialUpwardBallastReaction = support;
  }
  const paired = heavy.rows.map((r, i) => ({
    tick: r.tick,
    // Both wings must move outward relative to the same heavy ballast on the reinforced deck.
    minOutward: Math.min(
      ...r.water.map(
        (q, k) =>
          Math.sign(at(heavy.initial, q.id).center[2]) *
          (q.center[2] - reinforced.rows[i].water[k].center[2]),
      ),
    ),
    maxSeparation: Math.max(
      ...r.water.map((q, k) =>
        Math.hypot(...q.center.map((v, j) => v - reinforced.rows[i].water[k].center[j])),
      ),
    ),
  }));
  const onset = paired.find((r) => r.minOutward > 0.001);
  assert(onset && onset.tick > fractureTick, 'measurable outward water motion after break');
  assert(paired.at(-1).minOutward > 0.01, 'all four water centers displaced outwards');
  assert(heavy.rows.at(-1).deckY < deckY - 0.1, 'broken deck must fall');
  for (const c of [unloaded, light, reinforced])
    assert(
      c.rows.every((r) => r.maxWaterTravel < 1e-5),
      'resting control water moved: ' + c.id,
    );
  return {
    fractureTick,
    waterOnsetTick: onset.tick,
    finalMinOutward: paired.at(-1).minOutward,
    paired,
  };
}

await guardNode('cpu', 600);
const output = resolve('dist/verification/load-bearing-crossing', randomUUID());
mkdirSync(output, { recursive: true });
const write = (f, v) => writeFileSync(resolve(output, f), JSON.stringify(v, null, 2) + '\n');
const source = 'engine/experimental/multiphysics/liquid-contact-freeze.json';
const summary = {
  schema: 'load-bearing-crossing-1',
  status: 'started',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runtime: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  },
  supervisor: process.env.STATE_SPACE_VERIFICATION_JOB,
  driverSHA256: hash(readFileSync(fileURLToPath(import.meta.url))),
  ticks,
  dt,
  gravity,
  cases: [],
};
write('summary.json', summary);
try {
  assert.equal(process.versions.v8, JSON.parse(readFileSync(source)).runtime.v8);
  const catalogue = await loadCatalogue(output),
    bundle = await bundleEngine(process.cwd(), output, 'engine', catalogue);
  const api = await import(pathToFileURL(bundle.path).href),
    profiles = await api.createMultiphysicsProfiles3D();
  summary.engineSHA256 = bundle.sourceSha256;
  const outcomes = {};
  for (const spec of cases) {
    const initial = initialState(api, profiles, spec),
      initialSHA256 = catalogue.digestFrozen3D(initial);
    assert.equal(initial.rules, 'multiphysics-world-2');
    const c = { ...spec, initialSHA256, rows: [] };
    summary.cases.push(c);
    outcomes[spec.id] = { initial, ...c };
    const results = [];
    let state = initial;
    for (let i = 0; i < ticks; i++) {
      try {
        const r = direct(api, profiles, state);
        results.push(r);
        c.rows.push(observe(initial, r, catalogue.digestFrozen3D));
        state = r.snapshot;
      } catch (e) {
        throw Error(spec.id + ' at tick ' + (i + 1) + ': ' + e.message, { cause: e });
      }
    }
    assert.equal(catalogue.digestFrozen3D(initial), initialSHA256);
    c.trajectorySHA256 = catalogue.digestFrozen3D(c.rows.map((r) => r.resultSHA256));
    c.restoredAt = replay(api, profiles, initial, results);
    c.fullRecord = spec.id + '.ticks.v8.gz';
    const packet = gzipSync(serialize({ initial, results }));
    writeFileSync(resolve(output, c.fullRecord), packet);
    c.packetSHA256 = hash(packet);
    console.log('Replayed', spec.id, ticks, 'ticks', c.trajectorySHA256);
    write('summary.json', summary);
  }
  summary.comparison = compare(outcomes);
  for (const c of summary.cases)
    c.initialUpwardBallastReaction = outcomes[c.id].initialUpwardBallastReaction;
  summary.status = 'complete';
} catch (e) {
  summary.status = 'failed';
  summary.error = String(e);
  throw e;
} finally {
  write('summary.json', summary);
}
