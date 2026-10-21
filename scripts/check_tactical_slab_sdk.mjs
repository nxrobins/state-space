// Built-package application integration. No physics, support solve or worker starts.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildTacticalSlab } from './build_tactical_slab.mjs';

export async function checkTacticalSlabSdk() {
  const directory = resolve('dist/verification');
  await mkdir(directory, { recursive: true });
  const output = resolve(directory, 'tactical-slab-sdk-check.mjs');
  await build({
    entryPoints: ['examples/tactical-slab/index.ts'],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
  });
  const {
    createSlabController,
    createSlabSession,
    prepareSlabScene,
    createSlabUIModel,
    prepareSlabCommand,
    readSlabRequest,
    SLAB_RULES,
    mountSlabUI,
  } = await import(pathToFileURL(output).href);
  const renderer = await import('state-space-engine/experimental/3d/tactical-renderer');
  assert.equal(typeof renderer.createTacticalRenderer3D, 'function');
  assert.equal(typeof renderer.TACTICAL_CAMERA_WGSL_3D, 'string');
  assert.equal(typeof mountSlabUI, 'function');
  const controller = createSlabController();
  try {
    const before = controller.snapshot();
    assert.equal(controller.inspect().firingLine, 'open');
    const scene = prepareSlabScene(before, controller.inspect());
    assert.equal(scene.actors, 2);
    assert.equal(scene.overlays, 4);
    assert.equal(scene.stamp.kind, 'committed');
    assert.deepEqual(scene.shape, [8, 8, 8]);
    assert.equal(
      renderer.projectTacticalPoint3D(
        {
          eye: [4, 4, -4],
          right: [1, 0, 0],
          up: [0, -1, 0],
          forward: [0, 0, 1],
          fovY: Math.PI / 3,
          near: 0.1,
          far: 100,
        },
        [4096, 4096, 0],
        1280,
        720,
      ).x,
      640,
    );
    const ticket = controller.request({ kind: 'lift' }, 0),
      outcome = await ticket.result;
    assert.equal(outcome.status, 'ready');
    assert.deepEqual(controller.snapshot(), before);
    assert.equal((await controller.inspectPreview(ticket)).firingLine, 'blocked');
    const previewScene = prepareSlabScene(outcome.preview, await controller.inspectPreview(ticket));
    assert.equal(previewScene.stamp.kind, 'preview');
    assert.equal(
      outcome.preview.game.units[0].body.minQ[1],
      before.game.units[0].body.minQ[1] - 2048,
    );
    assert.equal(outcome.preview.game.ap, 2);
    assert.equal(outcome.preview.holds[0].expiresAtTick, 4);
    before.game.slab.forEach((from, k) => {
      const to = outcome.preview.game.slab[k];
      assert.equal(outcome.preview.terrain.energyQ[to], before.terrain.energyQ[from]);
      assert.equal(outcome.preview.terrain.packedCells[to], before.terrain.packedCells[from]);
      assert.equal(outcome.preview.terrain.structure[to] & 255, 96);
    });
    const committed = controller.commit(ticket);
    assert.equal(committed.receipt.externalEnergyQ, '0');
    assert.deepEqual(createSlabSession(committed.snapshot).snapshot(), committed.snapshot);
    const heat = controller.request({ kind: 'heat', deltaQ: 3 }, 0);
    assert.equal((await heat.result).status, 'ready');
    const heated = controller.commit(heat);
    assert.equal(heated.receipt.externalEnergyQ, '12');
    assert.equal(heated.snapshot.game.heatBudgetQ, 500);
    assert.equal(heated.snapshot.terrain.tick, 0);
    assert.throws(() => controller.request({ kind: 'lift', cost: 0 }, 0));
    const sdk = await import('state-space-engine/experimental/3d/tactical-session');
    let toClient = () => {},
      toHost = () => {};
    const host = sdk.createTacticalWorkerHost3D(
      {
        send: (value) => queueMicrotask(() => toClient(structuredClone(value))),
        subscribe(fn) {
          toHost = fn;
          return () => {};
        },
        close() {},
      },
      createSlabSession(),
      prepareSlabCommand,
      'slab-public-ui',
    );
    const client = sdk.createTacticalWorkerClient3D(
      {
        send: (value) => queueMicrotask(() => toHost(structuredClone(value))),
        subscribe(fn) {
          toClient = fn;
          return () => {};
        },
        close() {},
      },
      { channel: 'slab-public-ui', worldId: 'hot-slab-chamber', gameRulesVersion: SLAB_RULES },
    );
    const ui = await createSlabUIModel(client, async () => {});
    try {
      const saved = ui.save();
      assert.equal(await ui.preview({ kind: 'lift' }, 0), 'ready');
      assert.equal(ui.save(), saved);
      assert.throws(
        () => ui.preview({ kind: 'air', unit: 'scout', direction: 'up' }, 0),
        /at least one/,
      );
      assert.equal(ui.view().canCommit, true);
      assert.equal(ui.view().observation.firingLine, 'blocked');
      await ui.commit();
      assert.equal(ui.view().committedAP, 2);
      await ui.restore(saved);
      assert.equal(ui.view().committedAP, 3);
      assert.equal(ui.view().displayedTick, 0);
    } finally {
      await ui.close();
      await host.close();
    }
    // Stage the actual public application command without advancing material.
    const airSession = createSlabSession(),
      airBefore = airSession.snapshot(),
      air = airSession.branch({ horizonTicks: 1 });
    assert.equal(SLAB_RULES, 'hot-slab-game-4');
    assert.deepEqual(readSlabRequest({ kind: 'air', unit: 'scout', direction: 'up' }, 1), {
      command: { kind: 'air', unit: 'scout', direction: 'up' },
      horizonTicks: 1,
    });
    prepareSlabCommand(air, { kind: 'air', unit: 'scout', direction: 'up' });
    assert.equal(air.inspect().game.ap, 2);
    assert.deepEqual(air.inspect().game.pendingAir, {
      kind: 'air',
      unit: 'scout',
      direction: 'up',
    });
    assert.deepEqual(air.inspect().game.units, airBefore.game.units);
    assert.deepEqual(airSession.snapshot(), airBefore);
    air.discard();
    const windSession = createSlabSession(),
      windBefore = windSession.snapshot(),
      wind = windSession.branch({ horizonTicks: 0 });
    prepareSlabCommand(wind, { kind: 'wind', parcel: 'steam', direction: 'east' });
    assert.deepEqual(windSession.snapshot(), windBefore);
    const pulsed = windSession.commit(wind).snapshot,
      restarted = createSlabSession(JSON.parse(JSON.stringify(pulsed)));
    const drift = windSession.branch({ horizonTicks: 0 }),
      resumed = restarted.branch({ horizonTicks: 0 });
    prepareSlabCommand(drift, { kind: 'drift' });
    prepareSlabCommand(resumed, { kind: 'drift' });
    const drifted = windSession.commit(drift).snapshot;
    assert.deepEqual(drifted, restarted.commit(resumed).snapshot);
    assert.equal(drifted.game.wind.cycle, 2);
    assert.equal(drifted.game.ap, 1);
    assert.equal(drifted.game.wind.parcels[1].cell, windBefore.game.wind.parcels[1].cell + 1);
    assert.deepEqual(drifted.accounting, windBefore.accounting);
    assert.equal(drifted.terrain.tick, 0);
    const browser = await buildTacticalSlab();
    assert.equal(browser.outputs.length, 2);
    assert(browser.inputs.some((p) => p.startsWith('dist/sdk/')));
    assert(!browser.inputs.some((p) => p.startsWith('engine/')));
    return {
      passed: true,
      worldCells: 512,
      physicsTicks: 0,
      nativeWorker: false,
      gpu: false,
      presentation: true,
      uiCoordinator: true,
      browserBundles: true,
      airPreparation: true,
      windContinuation: true,
    };
  } finally {
    await controller.close();
  }
}
