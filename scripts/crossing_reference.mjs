import assert from 'node:assert/strict';
export const at = (state, id) => {
  const p = state.parcels.find((p) => p.id === id);
  assert(p, 'missing parcel ' + id);
  return p;
};
export function crossingSolid(
  api,
  profiles,
  id,
  center,
  halfExtents,
  bodyMass,
  velocity = [0, 0, 0],
) {
  const p = api.seedThermalParcel3D(profiles, {
    id,
    center,
    halfExtents,
    material: 'ceramic',
    owner: 'authored',
    temperature: 20,
    velocity,
  });
  const volume = 8 * halfExtents[0] * halfExtents[1] * halfExtents[2];
  const props = api.cuboidMassProperties(halfExtents, bodyMass / volume);
  return { ...p, mass: bodyMass, principalInertia: props.inertia };
}
export function crossingWater(api, profiles) {
  return [-0.5, 0.5].flatMap((x, i) =>
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
}
export function direct(api, profiles, state) {
  const job = api.createMultiphysicsTickJob3D(profiles, state);
  while (job.progress().status === 'running') job.advance(256);
  return job.result();
}
export function replay(api, profiles, initial, results, checkpoints) {
  const world = api.createMultiphysicsWorld3D(profiles, initial);
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
