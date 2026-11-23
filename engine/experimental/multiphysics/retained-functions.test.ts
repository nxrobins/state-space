import { beforeAll, expect, test } from 'vitest';
import { heldJobFunctions, retainJobFunctions } from './retained-functions.js';
import { createMultiphysicsProfiles3D, type MultiphysicsProfiles3D } from './profiles.js';
import { createMultiphysicsDemonstration3D } from './demonstrations.js';
import { createMultiphysicsTickJob3D } from './world-tick.js';

let profiles: MultiphysicsProfiles3D;
beforeAll(async () => {
  profiles = await createMultiphysicsProfiles3D();
});

test('a site holds the functions of its most recent jobs and no older ones', () => {
  const sets = [[() => 1], [() => 2], [() => 3], [() => 4]];
  expect(heldJobFunctions('test-site')).toEqual([]);
  retainJobFunctions('test-site', sets[0]);
  expect(heldJobFunctions('test-site')).toEqual([sets[0]]);
  retainJobFunctions('test-site', sets[1]);
  retainJobFunctions('test-site', sets[2]);
  // Two sets unless the site asks for more: the latest, then the one before.
  expect(heldJobFunctions('test-site')).toHaveLength(2);
  expect(heldJobFunctions('test-site')[0]).toBe(sets[2]);
  expect(heldJobFunctions('test-site')[1]).toBe(sets[1]);
  for (const set of sets) retainJobFunctions('alternating-site', set, 3);
  expect(heldJobFunctions('alternating-site')).toHaveLength(3);
  expect(heldJobFunctions('alternating-site')[0]).toBe(sets[3]);
  expect(heldJobFunctions('alternating-site')[2]).toBe(sets[1]);
  // Sites are independent.
  expect(heldJobFunctions('test-site')[0]).toBe(sets[2]);
});

test('a tick registers the functions it creates, and later ticks release the oldest', () => {
  // One liquid sample over solids: the tick, the rigid step and the fluid solve all run.
  let snapshot = createMultiphysicsDemonstration3D(profiles, 'fluid-switch');
  const sites = ['world-tick', 'world-tick-stages', 'rigid-step', 'rigid-run', 'fluid-job'];
  const latest: (readonly unknown[])[][] = [];
  for (let tick = 0; tick < 3; tick++) {
    const job = createMultiphysicsTickJob3D(profiles, snapshot);
    while (job.progress().status === 'running') job.advance(256);
    snapshot = job.result().snapshot;
    // The job is among what its site holds, with the pipeline it runs.
    expect(heldJobFunctions('world-tick')[0]).toContain(job);
    expect(heldJobFunctions('world-tick')[0].some((held) => typeof held === 'function')).toBe(true);
    latest.push(sites.map((site) => heldJobFunctions(site)[0]));
  }
  for (const [at, site] of sites.entries()) {
    // Each tick created its own functions, and the first tick's are no longer held.
    expect(latest[2][at]).not.toBe(latest[1][at]);
    expect(heldJobFunctions(site)).toHaveLength(2);
    expect(heldJobFunctions(site)[0]).toBe(latest[2][at]);
    expect(heldJobFunctions(site)).not.toContain(latest[0][at]);
  }
  // A tick solves its liquid twice. Three sets cover the last full solve and projection.
  const solves = heldJobFunctions('fluid-solve');
  expect(solves).toHaveLength(3);
  expect(new Set(solves).size).toBe(3);
  for (const set of solves) {
    expect(set).toHaveLength(solves[0].length);
    expect(set.every((held) => typeof held === 'function')).toBe(true);
  }
});
