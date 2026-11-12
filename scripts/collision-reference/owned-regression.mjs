/** Fixed differential checks. Import-safe; engines are supplied only inside an attested Job. */
import assert from 'node:assert/strict';
import { captureExact } from './exact-state.mjs';
import { same } from './replay.mjs';
import { PROTOCOL } from './protocol.mjs';

function parcel(api, id = 'a', center = [0, 0, 0], mass = 1) {
  const halfExtents = [0.5, 0.5, 0.5];
  return {
    id,
    owner: id,
    material: 'solid',
    mass,
    referenceAmount: 1,
    heatCapacity: 1,
    thermalQ: 100,
    latentQ: 0,
    chemicalQ: 0,
    center,
    velocity: [0, 0, 0],
    halfExtents,
    orientation: [0, 0, 0, 1],
    intrinsicAngularMomentum: [0, 0, 0],
    principalInertia: api.cuboidMassProperties(halfExtents, mass).inertia,
    extension: { z: [-0, { nested: 'kept' }], a: ['owned'] },
  };
}
function drive(job, progress) {
  try {
    for (let i = 0; i <= PROTOCOL.maxYieldsPerTick; i++) {
      const next = job.next();
      if (next.done) return next.value;
      progress.push(next.value);
    }
    throw Error('Regression exceeded the unchanged rigid work bound');
  } finally {
    job.return();
  }
}
function execute(api, operation, build) {
  let reads = 0;
  const input = build(api, () => {
    reads++;
    throw Error('Accessor executed');
  });
  const progress = [];
  try {
    const value =
      operation === 'mass'
        ? api.rigidAssemblyMassProperties3D(input.parcels)
        : operation === 'motion'
          ? api.validateRigidAssemblyMotion3D(input.parcels, input.anchored ?? false)
          : drive(
              api.createRigidStep3D(input.parcels, input.bonds ?? [], input.anchors ?? [], {
                dt: 0.016,
                ...(input.options ?? {}),
              }),
              progress,
            );
    return { status: 'completed', value, progress, getterReads: reads };
  } catch (error) {
    return {
      status: 'rejected',
      error: { name: error.name, message: error.message },
      progress,
      getterReads: reads,
    };
  }
}

export function checkOwnedRegression(before, after) {
  const checks = [];
  const compare = (name, operation, build, expected = 'completed') => {
    const old = execute(before, operation, build),
      current = execute(after, operation, build);
    assert.equal(old.status, expected, name + ' baseline expectation');
    assert.equal(old.getterReads, 0, name + ' baseline getter');
    assert.equal(current.getterReads, 0, name + ' optimized getter');
    same(current, old, 'owned differential ' + name + '/' + operation);
    checks.push({
      name,
      operation,
      status: 'passed',
      outcome: expected,
      exactSha256: captureExact(current).sha256,
    });
  };
  const valid = [
    ['single-extension-signed-zero', (api) => ({ parcels: [parcel(api)] })],
    [
      'unsorted-asymmetric',
      (api) => ({
        parcels: [parcel(api, 'b', [2, 2, 0], 3), parcel(api)],
        bonds: [{ a: 'b', b: 'a', strength: 1000, restLength: Math.sqrt(8) }],
      }),
    ],
    ['anchored-stationary', (api) => ({ parcels: [parcel(api)], anchored: true, anchors: ['a'] })],
    [
      'rigid-spinning-pair',
      (api) => {
        const a = parcel(api, 'a', [-1, 0, 0]),
          b = parcel(api, 'b', [1, 0, 0]);
        a.velocity = [0, -2, 0];
        b.velocity = [0, 2, 0];
        a.intrinsicAngularMomentum = [0, 0, 2 * a.principalInertia[2]];
        b.intrinsicAngularMomentum = [0, 0, 2 * b.principalInertia[2]];
        return { parcels: [b, a], bonds: [{ a: 'a', b: 'b', strength: 1000, restLength: 2 }] };
      },
    ],
  ];
  for (const [name, build] of valid)
    for (const operation of ['mass', 'motion', 'step']) compare(name, operation, build);
  const malformed = [
    ['negative-energy', (p) => (p.thermalQ = -1)],
    ['nonfinite-mass', (p) => (p.mass = Infinity)],
    ['invalid-quaternion', (p) => (p.orientation = [0, 0, 0, 2])],
    ['zero-inertia', (p) => (p.principalInertia = [0, 1, 1])],
    ['zero-half-extent', (p) => (p.halfExtents = [0, 1, 1])],
    ['empty-owner', (p) => (p.owner = '')],
    ['nonfinite-extension', (p) => (p.extension.z = [NaN])],
    ['hidden-extension', (p) => Object.defineProperty(p.extension, 'hidden', { value: 1 })],
    ['symbol-extension', (p) => (p.extension[Symbol('field')] = 1)],
    ['sparse-extension', (p) => (p.extension.z = new Array(2))],
    ['cyclic-extension', (p) => (p.extension.loop = p.extension)],
    ['custom-prototype', (p) => Object.setPrototypeOf(p.extension, { inherited: 1 })],
    [
      'field-accessor',
      (p, getter) => Object.defineProperty(p, 'mass', { get: getter, enumerable: true }),
    ],
    [
      'nested-accessor',
      (p, getter) =>
        Object.defineProperty(p.extension, 'getter', { get: getter, enumerable: true }),
    ],
  ];
  for (const [name, mutate] of malformed)
    for (const operation of ['mass', 'motion', 'step'])
      compare(
        name,
        operation,
        (api, getter) => {
          const p = parcel(api);
          mutate(p, getter);
          return { parcels: [p] };
        },
        'rejected',
      );
  for (const operation of ['mass', 'motion', 'step']) {
    compare(
      'duplicate-id',
      operation,
      (api) => ({ parcels: [parcel(api), parcel(api)] }),
      'rejected',
    );
    compare(
      'array-accessor',
      operation,
      (api, getter) => {
        const parcels = new Array(1);
        Object.defineProperty(parcels, '0', { get: getter, enumerable: true });
        return { parcels };
      },
      'rejected',
    );
    compare(
      'array-bound',
      operation,
      (api) => ({ parcels: Array.from({ length: 257 }, (_, i) => parcel(api, 'p' + i)) }),
      'rejected',
    );
  }
  for (const operation of ['motion', 'step']) {
    compare(
      'moving-anchor',
      operation,
      (api) => {
        const p = parcel(api);
        p.velocity = [1, 0, 0];
        return { parcels: [p], anchored: true, anchors: ['a'] };
      },
      'rejected',
    );
    compare(
      'nonrigid-bonded-motion',
      operation,
      (api) => {
        const a = parcel(api),
          b = parcel(api, 'b', [2, 0, 0]);
        b.velocity = [1, 0, 0];
        return { parcels: [a, b], bonds: [{ a: 'a', b: 'b', strength: 1000, restLength: 2 }] };
      },
      'rejected',
    );
  }
  function isolation(api, mutateAfterYield, cancel) {
    const source = [parcel(api), parcel(api, 'b', [2, 0, 0])];
    const bonds = [{ a: 'a', b: 'b', strength: 1000, restLength: 2 }];
    const anchors = ['a'],
      options = { dt: 0.016, gravity: [0, -9.8, 0] };
    const job = api.createRigidStep3D(source, bonds, anchors, options),
      progress = [];
    if (mutateAfterYield) progress.push(job.next().value);
    source[0].center[0] = 99;
    source[1].thermalQ = -1;
    source[0].extension.z[1].nested = 'caller mutation';
    bonds[0].strength = -1;
    anchors[0] = 'missing';
    options.gravity[1] = 99;
    const callerState = captureExact({ source, bonds, anchors, options });
    if (cancel) {
      job.return();
      same(captureExact({ source, bonds, anchors, options }), callerState, 'cancel mutated caller');
      return { cancelled: true, progress };
    }
    const result = drive(job, progress);
    assert.equal(result.parcels[0].extension.z[1].nested, 'kept');
    assert.equal(result.parcels[1].thermalQ, 100);
    result.parcels[0].extension.z[1].nested = 'returned mutation';
    same(captureExact({ source, bonds, anchors, options }), callerState, 'result aliases caller');
    return { result, progress };
  }
  for (const afterYield of [false, true])
    for (const cancel of [false, true]) {
      const old = isolation(before, afterYield, cancel),
        current = isolation(after, afterYield, cancel);
      same(current, old, 'mutation/cancellation isolation');
      checks.push({
        name: `isolation-afterYield-${afterYield}-cancel-${cancel}`,
        status: 'passed',
        exactSha256: captureExact(current).sha256,
      });
    }
  return { status: 'completed', checks, count: checks.length, acceptance: PROTOCOL.acceptance };
}
