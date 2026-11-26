/** Retain complete supervised crossing histories and compare their freeze on the pinned V8. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { guardNode } from './verification_guard.mjs';
import { bundleEngine, loadCatalogue } from './liquid_contact_engine.mjs';
import { ticks } from './moving_crossing_scene.mjs';

export async function runCrossingCheckpoint(name, createScene, exercise) {
  await guardNode('cpu', 600);
  const folder = resolve('dist/verification', name, randomUUID());
  mkdirSync(folder, { recursive: true });
  const summary = {
    schema: name + '-1',
    status: 'started',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    ticks,
    cases: {},
  };
  try {
    const freeze = JSON.parse(
      readFileSync('engine/experimental/multiphysics/liquid-contact-freeze.json', 'utf8'),
    );
    assert.equal(summary.v8, freeze.runtime.v8);
    const catalogue = await loadCatalogue(folder);
    const bundle = await bundleEngine(process.cwd(), folder, 'public', catalogue);
    const api = await import(pathToFileURL(bundle.path).href);
    const profiles = await api.createMultiphysicsProfiles3D();
    const initial = createScene(api, profiles);
    assert.equal(initial.rules, 'multiphysics-world-2');
    summary.rules = initial.rules;
    summary.initialSHA256 = catalogue.digestFrozen3D(initial);
    summary.engineSHA256 = bundle.sourceSha256;
    exercise(api, profiles, initial, catalogue.digestFrozen3D, folder, summary);
    if (name === 'two-unit-crossing') {
      const baseline = JSON.parse(
        readFileSync('engine/test-support/fixtures/' + name + '-v2.json', 'utf8'),
      );
      const cases = Object.fromEntries(
        Object.entries(summary.cases).map(([action, c]) => [
          action,
          { historySHA256: c.historySHA256, finalSHA256: c.finalSHA256 },
        ]),
      );
      assert.deepEqual(
        { rules: summary.rules, v8: summary.v8, initialSHA256: summary.initialSHA256, cases },
        baseline.expected,
        name + ' starting state, trajectory or outcome changed',
      );
    }
    summary.status = 'complete';
    console.log('Replayed', name, Object.keys(summary.cases));
  } catch (e) {
    summary.status = 'failed';
    summary.error = String(e);
    throw e;
  } finally {
    writeFileSync(resolve(folder, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  }
}
