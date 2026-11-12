// Executed after installing the tarball in an independent temporary project.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createStateSpaceStructuralWorld3D,
  MAT,
} from 'state-space-engine/experimental/3d/structural-world';
const exports = Object.keys(
  JSON.parse(
    readFileSync(new URL('./node_modules/state-space-engine/package.json', import.meta.url)),
  ).exports,
);
for (const path of exports)
  await import('state-space-engine' + (path === '.' ? '' : path.slice(1)));
const world = createStateSpaceStructuralWorld3D({ width: 8, height: 8, depth: 8, chunkSize: 4 });
world.setCell(3, 1, 3, MAT.STONE, 20);
for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) world.setCell(x, 7, z, MAT.STONE, 20);
world.step(3);
const saved = world.snapshot();
world.step(3);
const final = world.snapshot();
world.restore(saved);
world.step(3);
assert.deepEqual(world.snapshot(), final);
assert.equal(world.energyBalance().driftQ, 0n);
assert.equal(final.packedCells[3 + 8 * (6 + 8 * 3)] & 255, MAT.STONE);
assert.throws(() => world.restore({ ...final, rulesVersion: 'bad' }));
assert.deepEqual(world.snapshot(), final);
const {
  solveReferenceCircuit3D,
  cuboidMassProperties,
  partitionMaterialParcel3D,
  parcelConservation3D,
  createMultiphysicsProfiles3D,
  createMultiphysicsDemonstration3D,
  createMultiphysicsWorld3D,
  readMultiphysicsSnapshot3D,
  startMultiphysicsWorker3D,
  serveMultiphysicsWorker3D,
} = await import('state-space-engine/experimental/3d/multiphysics');
const circuit = solveReferenceCircuit3D({
  nodeCount: 3,
  connections: [
    { a: 0, b: 1, resistance: 2 },
    { a: 1, b: 2, resistance: 4 },
  ],
  source: { positive: 0, negative: 2, emf: 12, internalResistance: 6 },
});
assert.deepEqual(circuit.potentials, [6, 4, 0]);
assert.equal(circuit.sourceCurrent, 1);
const cube = cuboidMassProperties([0.5, 0.5, 0.5], 2);
const parcel = {
  id: 'source',
  owner: 'solid',
  material: 'copper',
  mass: cube.mass,
  referenceAmount: 1,
  heatCapacity: 1,
  thermalQ: 11,
  latentQ: 0,
  chemicalQ: 3,
  center: [0, 0, 0],
  velocity: [1, 0, 0],
  orientation: [0, 0, 0, 1],
  principalInertia: cube.inertia,
  intrinsicAngularMomentum: [0, 0, 0],
};
const children = partitionMaterialParcel3D(parcel, [
  { id: 'a', weight: 1 },
  { id: 'b', weight: 1 },
]);
assert.deepEqual(parcelConservation3D(children), parcelConservation3D([parcel]));
// The exported runtime: a bounded two-tick preview commits exactly what it previewed.
const profiles = await createMultiphysicsProfiles3D();
const multiphysics = createMultiphysicsWorld3D(
  profiles,
  createMultiphysicsDemonstration3D(profiles, 'falling-battery'),
);
const preview = multiphysics.prepare([], 2);
while (preview.progress().status === 'running') preview.advance(256);
const expected = preview.result();
assert.deepEqual(multiphysics.commit(preview).result, expected);
assert.deepEqual(multiphysics.snapshot(), readMultiphysicsSnapshot3D(profiles, expected.snapshot));
assert.equal(multiphysics.snapshot().tick, 2);
assert.equal(typeof startMultiphysicsWorker3D, 'function');
assert.equal(typeof serveMultiphysicsWorker3D, 'function');
console.log(
  JSON.stringify({
    exportCount: exports.length,
    multiphysicsReferences: true,
    multiphysicsRuntime: true,
    structuralRestartExact: true,
    positiveFall: true,
    invalidRestoreAtomic: true,
    energyDriftQ: '0',
  }),
);
