/** Fixed diagnostic invoked only after the parent runner's live Job attestation. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { ROOT, json, hash } from './packet.mjs';
import { benchmarkRigid } from './state-space.mjs';
import { assertBaseline } from './profile-data.mjs';
import { decodeSolverCoverage } from './solver-profile-data.mjs';
export async function countOffsetCache(api, packet, config, baseline, attempt, bundleDirectory) {
  let session, coverage, row, failure;
  let started = false;
  try {
    const { Session, url } = await import('node:inspector');
    assert.equal(url(), undefined, 'Inspector listeners are outside this scope');
    session = new Session();
    session.connect();
    const post = (method, params = {}) =>
      new Promise((resolve, reject) =>
        session.post(method, params, (e, v) => (e ? reject(e) : resolve(v))),
      );
    await post('Profiler.enable');
    try {
      await post('Profiler.startPreciseCoverage', {
        callCount: true,
        detailed: true,
        allowTriggeredUpdates: false,
      });
      started = true;
      row = benchmarkRigid(
        api,
        packet.fixtures.find((s) => s.id === 'resting-stack'),
        config.coverageDt,
      );
    } finally {
      if (started) {
        coverage = await post('Profiler.takePreciseCoverage');
        await post('Profiler.stopPreciseCoverage');
      }
      await post('Profiler.disable');
    }
  } catch (e) {
    failure = e;
  } finally {
    session?.disconnect();
  }
  if (coverage) {
    assert(Buffer.byteLength(JSON.stringify(coverage)) <= config.maxCoverageBytes);
    json(join(attempt, 'coverage.json'), coverage);
  }
  if (failure)
    return {
      status: 'failed',
      error: String(failure),
      stack: failure.stack,
      partial: failure.partial ?? null,
    };
  try {
    assertBaseline(
      row,
      baseline.rows.find(
        (r) =>
          r.backend === 'state-space-rigid' &&
          r.scene === 'resting-stack' &&
          r.dt === config.coverageDt,
      ),
    );
    const currentText = readFileSync(join(bundleDirectory, 'engine.mjs'), 'utf8');
    const current = decodeSolverCoverage(
      coverage,
      currentText,
      pathToFileURL(join(bundleDirectory, 'engine.mjs')).href,
    );
    const old = JSON.parse(readFileSync(join(ROOT, config.coverageBaseline), 'utf8'));
    const oldScripts = old.result.filter((s) => s.url.endsWith('/engine.mjs'));
    assert.equal(oldScripts.length, 1);
    const oldText = readFileSync(fileURLToPath(oldScripts[0].url), 'utf8');
    assert.equal(hash(Buffer.from(oldText)), config.baselineBundleSha256);
    const previous = decodeSolverCoverage(old, oldText, oldScripts[0].url);
    const count = (functions, name) => {
      const matching = functions.filter(
        (f) => f.source === 'engine/experimental/multiphysics/rigid.ts' && f.function === name,
      );
      assert.equal(matching.length, 1, name);
      return matching[0].callCount;
    };
    const scalarSubtractCount = (functions) => {
      const matches = functions.filter(
        (f) =>
          f.source === 'engine/experimental/multiphysics/math.ts' && f.function === 'subtractVec3',
      );
      assert.equal(matches.length, 1, 'vector subtraction function');
      return matches[0].callCount;
    };
    const totalSubtractBefore = scalarSubtractCount(previous),
      totalSubtractAfter = scalarSubtractCount(current);
    const before = 491280,
      after = 17088;
    assert.equal(totalSubtractBefore - totalSubtractAfter, before - after);
    assert.equal(count(previous, 'pointVelocity'), 315772);
    assert.equal(count(current, 'pointVelocity'), 25276);
    assert.equal(count(current, 'effective'), 8544);
    for (const name of [
      'createRigidStep3D',
      'relative',
      'impulse',
      'apply',
      'record',
      'omega',
      'contactGeometry',
      'manifold',
      'solve3',
      'project',
      'nextImpact',
      'diskSolution',
      'effective',
    ])
      assert.equal(count(current, name), count(previous, name), name + ' execution count changed');
    json(join(attempt, 'row.json'), row);
    return {
      status: 'completed',
      before,
      after,
      totalSubtractBefore,
      totalSubtractAfter,
      removed: before - after,
      reduction: 1 - after / before,
      exactSha256: row.exact.sha256,
      phaseWork: row.phaseWork,
      coverageSha256: hash(readFileSync(join(attempt, 'coverage.json'))),
      rowSha256: hash(readFileSync(join(attempt, 'row.json'))),
      functions: current,
      interpretation:
        'Precise coverage disables optimization; these timings are not performance evidence. Total vector subtraction calls confirm the targeted offset reduction; other selected helper counts and complete replay match the denominator-cache baseline.',
    };
  } catch (e) {
    return { status: 'failed', error: String(e), stack: e.stack };
  }
}
