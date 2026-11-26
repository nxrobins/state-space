/** Hosted CPU fixture for a free unit travelling between two fixed banks. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { serialize } from 'node:v8';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { at, crossingSolid, crossingWater, direct, replay } from './crossing_reference.mjs';
import { BUNDLE, ENTRY, hash, loadCatalogue } from './liquid_contact_engine.mjs';
import { guardNode } from './verification_guard.mjs';

const dt = 1 / 480,
  gravity = 9.8,
  ticks = 250,
  deckY = 1.0251;
const deckTop = deckY + 0.125,
  halfFoot = 0.075,
  startX = -1.4,
  speed = 5;
const cases = [
  { id: 'unloaded', mass: 0, strength: 135 },
  { id: 'light', mass: 1, strength: 135 },
  { id: 'heavy', mass: 10, strength: 135 },
  { id: 'reinforced', mass: 10, strength: 500 },
];
function scene(api, profiles, { mass, strength }) {
  const solid = (...args) => crossingSolid(api, profiles, ...args);
  return api.createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      solid('abutment', [-1.53, deckY, 0], [0.5, 0.125, 0.4], 1),
      solid('deck', [0, deckY, 0], [1, 0.125, 0.4], 1),
      solid('far-bank', [2.03, deckTop - 0.01, 0], [1, 0.01, 0.4], 1),
      solid('floor', [0, -0.5, 0], [2.5, 0.5, 2.5], 1),
      ...crossingWater(api, profiles),
      ...(mass
        ? [
            solid('unit', [startX, deckTop + halfFoot, 0], [halfFoot, halfFoot, 0.12], mass, [
              speed,
              0,
              0,
            ]),
          ]
        : []),
    ],
    anchors: ['abutment', 'far-bank', 'floor'],
    bonds: [{ a: 'abutment', b: 'deck', strength, restLength: 1.53 }],
    settings: { dt, gravity: [0, -gravity, 0], restitution: 0, friction: 0 },
  });
}

// The public boundary impulse combines BOTH banks, the deck and floor. Observe the
// existing deck-side impulse at the graph cut in a separate, compile-only diagnostic
// copy. The ordinary public world must reproduce every complete diagnostic result.
async function diagnosticBundle(path) {
  const marker =
    'const fracture = fractureRigidBonds3D(state.parcels, rigid.bonds, [...demands.values()], dt);';
  await build({
    ...BUNDLE,
    entryPoints: [ENTRY],
    outfile: path,
    banner: { js: 'let movingDeckCut;' },
    footer: {
      js: 'export function takeDeckCut() { const r=movingDeckCut; movingDeckCut=undefined; return r; }',
    },
    plugins: [
      {
        name: 'read-deck-cut',
        setup(builder) {
          let found = 0;
          builder.onLoad({ filter: /[/\\]multiphysics[/\\]world-tick\.ts$/ }, ({ path }) => {
            const src = readFileSync(path, 'utf8');
            assert.equal(src.split(marker).length, 2, 'world fracture observer location changed');
            found++;
            const tap =
              "movingDeckCut = rigid.bonds.some(b => b.a === 'abutment' && b.b === 'deck') ? structuredClone(demands.get('deck')) : null;";
            return { contents: src.replace(marker, tap + '\n' + marker), loader: 'ts' };
          });
          builder.onEnd(() => assert.equal(found, 1, 'missing deck observer'));
        },
      },
    ],
  });
}
const attached = (s) => s.bonds.some((b) => b.a === 'abutment' && b.b === 'deck');
function observe(prev, r, cut, initial, digest) {
  assert.equal(cut !== undefined, true, 'missing graph cut measurement');
  assert.equal(cut !== null, attached(prev), 'reaction must be defined through the fracture tick');
  const s = r.snapshot,
    u = s.parcels.find((p) => p.id === 'unit'),
    d = at(s, 'deck');
  const water = initial.parcels
    .filter((p) => p.material === 'water')
    .map((p) => {
      const q = at(s, p.id);
      assert.equal(q.mass, p.mass);
      assert.equal(q.material, p.material);
      return { id: p.id, center: q.center, delta: q.center.map((v, k) => v - p.center[k]) };
    });
  return {
    tick: s.tick,
    digest: digest(r),
    deck: d.center,
    unit: u?.center ?? null,
    unitVelocity: u?.velocity ?? null,
    unitOrientation: u?.orientation ?? null,
    unitSupportY: u
      ? u.mass * (gravity + (u.velocity[1] - at(prev, 'unit').velocity[1]) / dt)
      : null,
    reactionY: cut ? cut.linear[1] / dt : null,
    cutImpulse: cut,
    allBoundaryImpulse: r.report.boundaryLinearImpulse,
    intact: attached(s),
    broken: r.report.brokenBonds.map((b) => [b.a, b.b]),
    water,
  };
}
function qualify(cs) {
  const { unloaded, light, heavy, reinforced } = cs;
  for (const c of [unloaded, light, reinforced]) {
    assert(
      c.rows.every((r) => r.intact && !r.broken.length && Math.abs(r.deck[1] - deckY) < 1e-8),
      c.id + ' deck must hold',
    );
    c.maxWaterTravel = Math.max(
      ...c.rows.flatMap((r) => r.water.map((q) => Math.hypot(...q.delta))),
    );
    c.maxLateralTravel = Math.max(
      ...c.rows.flatMap((r) => r.water.map((q) => Math.abs(q.delta[2]))),
    );
    assert(c.maxLateralTravel < 1e-5, c.id + ' intact deck must not drive outward water movement');
    if (c === unloaded)
      assert.equal(c.maxWaterTravel, 0, 'empty crossing water must remain at rest');
  }
  for (const c of [light, heavy, reinforced]) {
    const first = c.rows[0];
    assert(
      first.unit[0] + halfFoot < -1.03 && Math.abs(first.reactionY - gravity) < 1e-5,
      'near bank must initially carry unit',
    );
  }
  for (const c of [light, reinforced]) {
    const onDeck = c.rows.filter((r) => r.unit[0] - halfFoot > -1 && r.unit[0] + halfFoot < 1);
    const far = c.rows.filter(
      (r) =>
        r.unit[0] - halfFoot > 1.03 &&
        r.unit[0] + halfFoot < 3.03 &&
        Math.abs(r.unit[2]) + 0.12 < 0.4,
    );
    assert(
      onDeck.length > 10 && far.length >= 5 && far.at(-1) === c.rows.at(-1),
      c.id + ' must reach and stay on far bank',
    );
    assert(
      c.rows.every(
        (r, i) =>
          r.unit[0] > (i ? c.rows[i - 1].unit[0] : startX) &&
          Math.abs(r.unit[1] - deckTop - halfFoot) < 1e-6,
      ),
      c.id + ' continuous supported transit',
    );
    for (const r of [...onDeck.slice(1), ...far.slice(1)]) {
      const deckLoaded = r.unit[0] < 1;
      assert(
        Math.abs(r.reactionY - gravity - (deckLoaded ? c.mass * gravity : 0)) < 1e-4,
        'load must transfer onto and off deck',
      );
      assert(Math.abs(r.unitSupportY - c.mass * gravity) < 1e-4, 'unit must remain supported');
    }
    c.firstFullyOnDeck = onDeck[0].tick;
    c.firstFullyOnFarBank = far[0].tick;
  }
  const breaks = heavy.rows.filter((r) => r.broken.length);
  assert.equal(breaks.length, 1);
  const br = breaks[0],
    i = br.tick - 1;
  assert.deepEqual(br.broken, [['abutment', 'deck']]);
  assert(i > 0);
  assert(
    heavy.rows.every((r) => (r.tick < br.tick ? r.intact : !r.intact)),
    'fracture must persist',
  );
  assert(
    br.unit[0] - halfFoot > -1 &&
      br.unit[0] + halfFoot < 1 &&
      Math.abs(br.unit[2]) + 0.12 < 0.4 &&
      Math.abs(br.unit[1] - halfFoot - deckTop) < 1e-6,
    'fracture underfoot',
  );
  assert(
    br.reactionY - unloaded.rows[i].reactionY > 1 && br.unitSupportY > 1,
    'fracture requires a measured unit load on deck',
  );
  for (let j = 0; j <= i; j++) {
    const a = heavy.rows[j],
      b = reinforced.rows[j];
    assert.deepEqual(a.water, b.water, 'heavy controls diverged before the deck fell');
    assert.deepEqual(a.unit, b.unit, 'heavy approach paths diverged');
    assert.equal(a.reactionY, b.reactionY, 'reinforcement changed the applied load');
  }
  const missed = heavy.rows.at(-1);
  // A bounding sphere encloses the entire rotated unit. Even its top lies below
  // the landing surface, so a horizontal crossing of x=1 alone cannot pass.
  assert(
    missed.unit[1] + Math.hypot(halfFoot, halfFoot, 0.12) < deckTop &&
      !heavy.rows.some(
        (r) => r.unit[0] - halfFoot > 1 && Math.abs(r.unit[1] - halfFoot - deckTop) < 1e-6,
      ),
    'heavy unit must miss the far landing',
  );
  const paired = heavy.rows.map((r, i) =>
    Math.min(
      ...r.water.map((q, k) => {
        const ref = reinforced.rows[i].water[k];
        assert.equal(q.id, ref.id);
        return Math.sign(ref.center[2]) * (q.center[2] - ref.center[2]);
      }),
    ),
  );
  const onset = paired.findIndex((x) => x > 0.001) + 1;
  assert(onset > br.tick && paired.at(-1) > 0.01, 'water must move outward after fracture');
  assert(
    paired.at(-1) > 100 * Math.max(light.maxWaterTravel, reinforced.maxWaterTravel),
    'fracture displacement must dominate travel-induced water drift',
  );
  assert(heavy.rows.at(-1).deck[1] < deckY - 0.05, 'fractured deck must fall');
  return {
    fractureTick: br.tick,
    unitXAtFracture: br.unit[0],
    reactionYAtFracture: br.reactionY,
    incrementalDeckLoadAtFracture: br.reactionY - unloaded.rows[i].reactionY,
    totalUnitSupportAtFracture: br.unitSupportY,
    waterOnsetTick: onset,
    finalMinOutward: paired.at(-1),
  };
}
await guardNode('cpu', 600);
const folder = resolve('dist/verification/moving-load-crossing', randomUUID());
mkdirSync(folder, { recursive: true });
const summary = {
  schema: 'moving-load-crossing-1',
  status: 'started',
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version,
  v8: process.versions.v8,
  dt,
  ticks,
  cases: {},
};
const save = () =>
  writeFileSync(resolve(folder, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
try {
  assert.equal(
    summary.v8,
    JSON.parse(readFileSync('engine/experimental/multiphysics/liquid-contact-freeze.json')).runtime
      .v8,
  );
  const reference = resolve(folder, 'public.mjs'),
    diag = resolve(folder, 'diagnostic.mjs');
  await build({ ...BUNDLE, entryPoints: [ENTRY], outfile: reference });
  await diagnosticBundle(diag);
  summary.publicBundleSHA256 = hash(readFileSync(reference));
  summary.diagnosticBundleSHA256 = hash(readFileSync(diag));
  const api = await import(pathToFileURL(reference).href),
    probe = await import(pathToFileURL(diag).href);
  const profiles = await api.createMultiphysicsProfiles3D(),
    pp = await probe.createMultiphysicsProfiles3D();
  const { digestFrozen3D: digest } = await loadCatalogue(folder);
  for (const spec of cases) {
    const initial = scene(api, profiles, spec);
    assert.equal(initial.rules, 'multiphysics-world-2');
    const c = (summary.cases[spec.id] = { ...spec, initialSHA256: digest(initial), rows: [] }),
      results = [];
    let prev = initial;
    for (let t = 1; t <= ticks; t++) {
      try {
        const r = direct(probe, pp, prev);
        const row = observe(prev, r, probe.takeDeckCut(), initial, digest);
        results.push(r);
        c.rows.push(row);
        prev = r.snapshot;
      } catch (e) {
        throw Error(spec.id + ' tick ' + t + ': ' + e.message, { cause: e });
      }
    }
    assert.equal(digest(initial), c.initialSHA256);
    const event = c.rows.find((r) => r.broken.length)?.tick;
    const checkpoints = [...new Set([0, ...(event ? [event - 1, event] : []), ticks / 2])].sort(
      (a, b) => a - b,
    );
    c.restoredAt = replay(api, profiles, initial, results, checkpoints);
    c.trajectorySHA256 = digest(c.rows.map((r) => r.digest));
    c.observationsSHA256 = digest(c.rows);
    const packet = gzipSync(serialize({ initial, results }));
    writeFileSync(resolve(folder, spec.id + '.ticks.v8.gz'), packet);
    c.packetSHA256 = hash(packet);
    console.log('Replayed', spec.id, ticks, c.trajectorySHA256);
    save();
  }
  summary.comparison = qualify(summary.cases);
  summary.status = 'complete';
} catch (e) {
  summary.status = 'failed';
  summary.error = String(e);
  throw e;
} finally {
  save();
}
