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
import { at, crossingSolid, crossingWater, direct, replay } from './crossing_reference.mjs';
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
function initialState(api, profiles, { mass, strength }) {
  const solid = (...args) => crossingSolid(api, profiles, ...args);
  const water = crossingWater(api, profiles);
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
    const initialHeight = c.initialBallastY;
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
  assert.equal(Object.keys(heavy.initialWaterCenters).length, 4);
  assert.deepEqual(heavy.initialWaterCenters, reinforced.initialWaterCenters);
  assert.deepEqual(
    heavy.rows[0].water.map((q) => q.id),
    reinforced.rows[0].water.map((q) => q.id),
  );
  assert(
    heavy.rows.filter((r) => r.tick <= fractureTick).every((r) => r.maxWaterTravel < 1e-5),
    'water moved before the deck fell',
  );
  const paired = heavy.rows.map((r, i) => ({
    tick: r.tick,
    // Both wings must move outward relative to the same heavy ballast on the reinforced deck.
    minOutward: Math.min(
      ...r.water.map(
        (q, k) =>
          Math.sign(heavy.initialWaterCenters[q.id][2]) *
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
    const c = {
      ...spec,
      initialSHA256,
      initialBallastY: initial.parcels.find((p) => p.id === 'ballast')?.center[1] ?? null,
      initialWaterCenters: Object.fromEntries(
        initial.parcels.filter((p) => p.material === 'water').map((p) => [p.id, p.center]),
      ),
      rows: [],
    };
    summary.cases.push(c);
    outcomes[spec.id] = c;
    // On supported ticks the floor carries the resting water; the two fixed
    // solids also deliver their own weight directly to the boundaries.
    const otherWeight =
      gravity *
      initial.parcels
        .filter((p) => p.id !== 'deck' && p.id !== 'ballast')
        .reduce((mass, p) => mass + p.mass, 0);
    const supportedWeight = gravity * (at(initial, 'deck').mass + spec.mass);
    const results = [];
    let state = initial;
    for (let i = 0; i < ticks; i++) {
      try {
        const r = direct(api, profiles, state);
        results.push(r);
        const row = observe(initial, r, catalogue.digestFrozen3D);
        const beganSupported = i === 0 || c.rows[i - 1].bondIntact;
        row.abutmentReactionY = beganSupported ? -row.boundaryImpulse[1] / dt - otherWeight : null;
        if (beganSupported) {
          assert(
            row.maxWaterTravel === 0 && Math.abs(row.abutmentReactionY - supportedWeight) < 1e-5,
            'supported deck and ballast weight must reach the abutment',
          );
        }
        c.rows.push(row);
        state = r.snapshot;
      } catch (e) {
        throw Error(spec.id + ' at tick ' + (i + 1) + ': ' + e.message, { cause: e });
      }
    }
    assert.equal(catalogue.digestFrozen3D(initial), initialSHA256);
    c.trajectorySHA256 = catalogue.digestFrozen3D(c.rows.map((r) => r.resultSHA256));
    c.restoredAt = replay(api, profiles, initial, results, [0, 1, Math.floor(ticks / 2)]);
    c.fullRecord = spec.id + '.ticks.v8.gz';
    const packet = gzipSync(serialize({ initial, results }));
    writeFileSync(resolve(output, c.fullRecord), packet);
    c.packetSHA256 = hash(packet);
    console.log('Replayed', spec.id, ticks, 'ticks', c.trajectorySHA256);
    write('summary.json', summary);
  }
  summary.comparison = compare(outcomes);

  const frozen = JSON.parse(
    readFileSync('engine/test-support/fixtures/load-bearing-crossing-v2.json', 'utf8'),
  );
  assert.equal(frozen.rules, 'multiphysics-world-2');
  assert.equal(frozen.v8, process.versions.v8);
  const measured = Object.fromEntries(
    summary.cases.map((c) => [
      c.id,
      { initialSHA256: c.initialSHA256, trajectorySHA256: c.trajectorySHA256 },
    ]),
  );
  assert.deepEqual(
    measured,
    frozen.cases,
    'crossing initial state or full-result trajectory changed',
  );
  summary.status = 'complete';
} catch (e) {
  summary.status = 'failed';
  summary.error = String(e);
  throw e;
} finally {
  write('summary.json', summary);
}
