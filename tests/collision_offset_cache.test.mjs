// Source proof and extracted pure helpers on synthetic data only. Engines run in attested Jobs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from '@typescript/typescript6';
import {
  readHistorical,
  historicalSource,
  verifyHistoricalSources,
} from './helpers/collision-history.mjs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const before = historicalSource('normal', 'engine/experimental/multiphysics/rigid.ts')
  .toString('utf8')
  .replaceAll('\r\n', '\n');
const after = read('../engine/experimental/multiphysics/rigid.ts');
const historicalAfter = historicalSource('offset', 'engine/experimental/multiphysics/rigid.ts')
  .toString('utf8')
  .replaceAll('\r\n', '\n');
const parse = (s) => ts.createSourceFile('rigid.ts', s, ts.ScriptTarget.Latest, true);
function find(source, name, kind) {
  const found = [];
  function walk(n) {
    if (kind(n) && n.name?.getText(source) === name) found.push(n);
    ts.forEachChild(n, walk);
  }
  walk(source);
  assert.equal(found.length, 1, name);
  return found[0];
}
const relative = (s) => find(parse(s), 'relative', ts.isVariableDeclaration).initializer.getText();
const apply = (s) => find(parse(s), 'apply', ts.isFunctionDeclaration).getText();
const normalized = (s) => ts.createPrinter({ removeComments: false }).printFile(parse(s));

test('historical whole-file proof confines the measured edit to private offsets and their three solver uses', () => {
  verifyHistoricalSources('offset', ['engine/experimental/multiphysics/rigid.ts']);
  assert.equal(
    createHash('sha256')
      .update(
        readHistorical('dist/verification/collision-offset-cache-review-20261109/rigid.ts.before'),
      )
      .digest('hex'),
    '645697f27090db717dd065873f674dce896560f5b4f9123472fa0ebc042f470b',
  );
  let restored = historicalAfter.replace(relative(historicalAfter), relative(before));
  restored = restored
    .replace(/  offset[AB]: Vec3 \| undefined;\n/g, '')
    .replace(/                  offset[AB]: undefined,\n/g, '');
  restored = restored
    .replace(
      '(contact.offsetA ??= subtractVec3(contact.point, contact.a.center))',
      'subtractVec3(contact.point, contact.a.center)',
    )
    .replace(
      '(contact.offsetB ??= subtractVec3(contact.point, contact.b.center))',
      'subtractVec3(contact.point, contact.b.center)',
    );
  restored = restored
    .replace(', offset?: Vec3', '')
    .replace('offset ?? subtractVec3(point, body.center)', 'subtractVec3(point, body.center)')
    .replace('c.point, c.offsetA', 'c.point')
    .replace('c.point, c.offsetB', 'c.point');
  assert.deepEqual(parse(historicalAfter).parseDiagnostics, []);
  assert.equal(normalized(restored), normalized(before));
  assert(
    historicalAfter.includes(
      "yield progress('contact');\n          // Geometry and inertia stay fixed within this solve; each solve builds fresh contacts.\n          const velocity = relative(c)",
    ),
  );
});

function verifyCurrentCacheWiring(current) {
  assert.deepEqual(parse(current).parseDiagnostics, []);
  // These scopes contain contact allocation, lazy cache reads, every impulse use,
  // yield order, and per-solve lifetime. Admission/contact rejection may evolve outside them.
  for (const [name, kind] of [
    ['Contact', ts.isTypeAliasDeclaration],
    ['solve', ts.isFunctionDeclaration],
    ['effective', ts.isFunctionDeclaration],
    ['apply', ts.isFunctionDeclaration],
  ])
    assert.equal(
      normalized(find(parse(current), name, kind).getText()),
      normalized(find(parse(historicalAfter), name, kind).getText()),
      name,
    );
}

test('current solver preserves cache allocation, lifetime, arithmetic, impulse wiring and yields', () => {
  verifyCurrentCacheWiring(after);
  for (const changed of [
    after.replace('normalDenominator: undefined,', 'normalDenominator: 0,'),
    after.replace('c.point, c.offsetA', 'c.point, c.offsetB'),
    after.replace('offset ?? subtractVec3(point, body.center)', 'subtractVec3(point, body.center)'),
  ]) {
    assert.notEqual(changed, after);
    assert.throws(() => verifyCurrentCacheWiring(changed));
  }
});

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, s) => a.map((x) => x * s);
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const js = (s) =>
  ts.transpileModule(s, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
function relativeHelper(text, trace) {
  const omega = (b) => (trace.push('omega-' + b.id), b.angularMomentum);
  const subtract = (a, b) => (trace.push('subtract'), sub(a, b));
  const point = (b, p) => add(b.velocity, cross(omega(b), subtract(p, b.center)));
  return new Function(
    'addVec3',
    'crossVec3',
    'omega',
    'subtractVec3',
    'pointVelocity',
    js('const relative = ' + relative(text) + ';') + 'return relative;',
  )(add, cross, omega, subtract, point);
}
function contact() {
  return {
    a: { id: 'a', center: [0, 0, 0], velocity: [1, 2, -0], angularMomentum: [0, 0, 1] },
    b: { id: 'b', center: [1, 0, 0], velocity: [-1, 0, 0], angularMomentum: [0, 2, 0] },
    point: [-0, 0, 2],
    offsetA: undefined,
    offsetB: undefined,
  };
}

test('first offsets follow omega in original B/A order; live momentum and fresh contacts remain exact', () => {
  const oldTrace = [],
    newTrace = [],
    old = relativeHelper(before, oldTrace),
    cached = relativeHelper(after, newTrace);
  const a = contact(),
    b = contact();
  assert.deepEqual(cached(b), old(a));
  assert.deepEqual(newTrace, oldTrace);
  assert.deepEqual(newTrace, ['omega-b', 'subtract', 'omega-a', 'subtract', 'subtract']);
  assert(Object.is(b.offsetA[0], -0));
  const offsetA = b.offsetA,
    offsetB = b.offsetB;
  for (const c of [a, b]) {
    c.a.velocity = [-0, 7, 1];
    c.a.angularMomentum = [2, 3, 4];
    c.b.angularMomentum = [-3, 0, 2];
  }
  newTrace.length = 0;
  assert.deepEqual(cached(b), old(a));
  assert.deepEqual(newTrace, ['omega-b', 'omega-a', 'subtract']);
  assert.equal(b.offsetA, offsetA);
  assert.equal(b.offsetB, offsetB);
  const fresh = contact();
  fresh.a.center = [2, 0, 0];
  assert.deepEqual(cached(fresh), old({ ...fresh, offsetA: undefined, offsetB: undefined }));
  assert.notEqual(fresh.offsetA, offsetA);
});

function impulseHelper(text) {
  return new Function(
    'addVec3',
    'crossVec3',
    'subtractVec3',
    'scaleVec3',
    'let boundaryLinearImpulse=[0,0,0],boundaryAngularImpulse=[0,0,0];const receipt={linear:[0,0,0],angular:[0,0,0]};function record(parcel,impulse,point){receipt.linear=addVec3(receipt.linear,impulse);receipt.angular=addVec3(receipt.angular,crossVec3(point,impulse));}' +
      js(apply(text)) +
      'return {apply,get:()=>({receipt,boundaryLinearImpulse,boundaryAngularImpulse})};',
  )(add, cross, sub, scale);
}
test('cached dynamic torque and anchored receipts retain original world-space arithmetic and signed zeros', () => {
  for (const anchored of [false, true])
    for (const impulse of [
      [1, 2, -3],
      [-0, 0, -0],
    ]) {
      const old = impulseHelper(before),
        cached = impulseHelper(after),
        point = [7, 1, -3];
      const a = {
          center: [3, -4, 5],
          mass: 2,
          velocity: [-0, 2, 3],
          angularMomentum: [-0, 1, 2],
          anchored,
        },
        b = structuredClone(a);
      old.apply(a, {}, impulse, point);
      cached.apply(b, {}, impulse, point, sub(point, b.center));
      assert.deepEqual(b, a);
      assert.deepEqual(cached.get(), old.get());
      assert.deepEqual(cached.get().receipt.angular, add([0, 0, 0], cross(point, impulse)));
    }
});
