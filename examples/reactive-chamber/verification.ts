/// <reference types="@webgpu/types" />
/** Fixed 8-cubed native browser acceptance. Invoked only by the bounded Mac stage. */
import {
  MAT,
  THERMAL_MAT_3D as M,
  GEOMETRY_SCALE_3D as Q,
} from 'state-space-engine/experimental/3d/reactive-materials';
import type { chamberApp } from './browser-entry.js';
import { openChamber, type ChamberClient } from './client.js';
import {
  createChamber,
  SCENARIOS,
  coordinate,
  snapshotScenario,
  prepareCommand,
  finishBranch,
  SUPPORT,
  type ChamberCommand,
  type ChamberSnapshot,
} from './scenario.js';
import { isMaterialScenario } from './material-scenes.js';
import { profileChamber } from './profiling.js';
import { canonical, stateHash } from './recording.js';
import { prepareScene, orbitCamera, projectPoint } from './presentation.js';
import { createChamberRenderer } from './renderer.js';
const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
function assert(value: unknown, message: string): asserts value {
  if (!value) throw Error(message);
}
const equal = (a: unknown, b: unknown, message: string) =>
  assert(canonical(a) === canonical(b), message);
async function until(check: () => boolean, ms = 10000) {
  const end = performance.now() + ms;
  while (!check()) {
    if (performance.now() > end) throw Error('Browser condition timed out.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
const click = (id: string) => {
  const button = document.getElementById(id) as HTMLButtonElement;
  assert(!button.disabled, `${id} is disabled.`);
  button.click();
};
const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * p) - 1)];
export async function verifyChamber(app: typeof chamberApp) {
  const output = document.getElementById('report')!,
    report: Record<string, unknown> = { passed: false, done: false, size: 8, progress: 'starting' };
  const publish = (progress: string) => {
    report.progress = progress;
    output.textContent = JSON.stringify(report);
  };
  let fault: ChamberClient | null = null,
    closing: ChamberClient | null = null;
  try {
    click('start');
    await until(() => app.running && Boolean(app.scene));
    const direct = await createChamber(),
      initial = app.client!.snapshot();
    equal(initial, direct.session.snapshot(), 'Worker initial state differs.');
    // Exercise a capped Retina backing store and real pointer coordinate conversion.
    const nativeRatio = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 2 });
    app.orbit(-0.65);
    await app.painted();
    const canvas = document.getElementById('world') as HTMLCanvasElement,
      rect = canvas.getBoundingClientRect();
    assert(
      Math.abs(canvas.width / canvas.height - rect.width / rect.height) < 0.005,
      'Retina canvas changed the viewport aspect ratio.',
    );
    const retinaTarget = [canvas.width, canvas.height];
    click('select-ice');
    await app.painted();
    const point = projectPoint(
      app.camera,
      [3 * Q + Q / 2, 4 * Q + Q / 2, 3 * Q + Q / 2],
      canvas.width,
      canvas.height,
    )!;
    const event = {
      pointerId: 1,
      clientX: rect.left + (point.x * rect.width) / canvas.width,
      clientY: rect.top + (point.y * rect.height) / canvas.height,
    };
    // The pending camera must not replace the camera of the pixels being picked.
    app.orbit(0.65);
    // Pointer capture requires a trusted active pointer; the click's picking path does not.
    const capture = canvas.setPointerCapture;
    canvas.setPointerCapture = () => {};
    canvas.dispatchEvent(new PointerEvent('pointerdown', event));
    canvas.dispatchEvent(new PointerEvent('pointerup', event));
    canvas.setPointerCapture = capture;
    await app.painted();
    equal(app.scene!.selected, [...SUPPORT], 'Retina pointer did not use the completed frame.');
    if (nativeRatio) Object.defineProperty(window, 'devicePixelRatio', nativeRatio);
    else delete (window as unknown as { devicePixelRatio?: number }).devicePixelRatio;
    app.orbit(-0.65);
    await app.painted();
    report.retinaPicking = { passed: true, target: retinaTarget };

    const reference = (command: ChamberCommand) => {
      const branch = prepareCommand(direct.registry, direct.session, command);
      const preview = finishBranch(branch);
      return { branch, preview };
    };
    publish('real browser preview / discard / compare');
    click('heat');
    await until(() => app.client!.state.hasPreview);
    await app.painted();
    const expectedHeat = reference({ kind: 'heat', cell: [...SUPPORT] });
    equal(
      app.client!.previewSnapshot()!.state,
      expectedHeat.preview.state,
      'Worker heat preview differs from direct reference.',
    );
    expectedHeat.branch.discard();
    assert(
      app.client!.previewSnapshot()!.state.game.lostFooting > 0,
      'Heat did not remove footing.',
    );
    equal(app.scene!.kind, 'preview', 'UI did not display the preview.');
    click('compare');
    await app.painted();
    equal(
      [app.scene!.kind, app.scene!.tick],
      ['committed', 0],
      'A/B comparison did not return to live state.',
    );
    click('compare');
    await app.painted();
    equal([app.scene!.kind, app.scene!.tick], ['preview', 2], 'A/B comparison lost the preview.');
    assert(
      document.getElementById('view-label')!.dataset.identity === app.scene!.identity,
      'Inspection and pixels have different identities.',
    );
    click('discard');
    await until(() => app.client!.state.activeId === null);
    equal(app.client!.snapshot(), initial, 'Discard published state or spent resources.');
    click('cool');
    await until(() => app.client!.state.hasPreview);
    const cool = reference({ kind: 'cool', cell: [...SUPPORT] });
    equal(app.client!.previewSnapshot()!.state, cool.preview.state, 'Cooled preview differs.');
    cool.branch.discard();
    click('discard');
    await until(() => app.client!.state.activeId === null);
    publish('coalescing and cancellation acknowledgements');
    const rapid = [
      { kind: 'heat', cell: [...SUPPORT] },
      { kind: 'cool', cell: [...SUPPORT] },
      { kind: 'wait' },
    ];
    const outcomes = await Promise.all(rapid.map((command) => app.client!.preview(command)));
    equal(
      outcomes.map((o) => o.status),
      ['superseded', 'superseded', 'ready'],
      'Rapid input did not keep only the latest intent.',
    );
    await app.client!.cancel();
    const cancelled = app.client!.preview({ kind: 'heat', cell: [...SUPPORT] });
    await app.client!.cancel();
    assert((await cancelled).status === 'cancelled', 'In-flight preview was not cancelled.');
    equal(app.client!.snapshot(), initial, 'Cancellation changed live state.');
    const previewMetrics: number[] = [],
      cancelMetrics: number[] = [],
      rafGaps: number[] = [];
    publish('8-cubed two-tick latency and camera responsiveness');
    for (let i = 0; i < 12; i++) {
      const started = performance.now(),
        pending = app.client!.preview({ kind: 'heat', cell: [...SUPPORT] });
      let complete = false;
      void pending.then(() => {
        complete = true;
      });
      let previous = await frame();
      while (!complete) {
        app.orbit(-0.65 + 0.1 * Math.sin(i));
        const now = await frame();
        rafGaps.push(now - previous);
        previous = now;
      }
      assert((await pending).status === 'ready', 'Measured preview failed.');
      previewMetrics.push(app.client!.metrics.previewsMs.at(-1)!);
      assert(performance.now() - started < 5000, 'Preview wall deadline exceeded.');
      const cancelStart = performance.now();
      await app.client!.cancel();
      cancelMetrics.push(performance.now() - cancelStart);
    }
    report.latency = {
      samples: previewMetrics,
      p95Ms: percentile(previewMetrics, 0.95),
      cancellations: cancelMetrics,
      cancellationP95Ms: percentile(cancelMetrics, 0.95),
      rafWorstGapMs: Math.max(...rafGaps),
    };
    publish('commit, exact restart, recording replay, and malformed save rollback');
    click('heat');
    await until(() => app.client!.state.hasPreview);
    click('commit');
    await until(() => app.client!.snapshot().revision === 1 && !app.client!.state.busy);
    const first = reference({ kind: 'heat', cell: [...SUPPORT] });
    const expected = direct.session.commit(first.branch).snapshot;
    equal(app.client!.snapshot(), expected, 'Worker commit differs from direct reference.');
    const saved = app.client!.exportSave(),
      oldClient = app.client;
    const fileInput = document.getElementById('load') as HTMLInputElement,
      transfer = new DataTransfer();
    transfer.items.add(new File([saved], 'chamber.json', { type: 'application/json' }));
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change'));
    await until(() => app.client !== oldClient && app.client?.state.status === 'ready');
    equal(app.client!.snapshot(), expected, 'Restored complete state differs.');
    const next = reference({ kind: 'wait' });
    const continuation = await app.client!.preview({ kind: 'wait' });
    assert(continuation.status === 'ready', 'Continuation failed.');
    equal(continuation.preview.state, next.preview.state, 'Restarted next preview differs.');
    equal(
      await app.client!.commit(),
      direct.session.commit(next.branch).snapshot,
      'Restarted next commit differs.',
    );
    const secondSave = app.client!.exportSave(),
      beforeBad = app.client!.snapshot(),
      tampered = JSON.parse(secondSave);
    tampered.steps[0].command.kind = 'cool';
    let rejected = false;
    try {
      await app.importSave(JSON.stringify(tampered));
    } catch {
      rejected = true;
    }
    assert(rejected, 'Tampered command history was accepted.');
    equal(app.client!.snapshot(), beforeBad, 'Failed import changed the running chamber.');
    await app.importSave(secondSave);
    equal(app.client!.snapshot(), beforeBad, 'Second save did not replay exactly.');
    report.energyDriftQ = direct.session.energyBalance().driftQ.toString();
    publish('lost commit acknowledgement / no retry / last acknowledged save');
    let commitsSent = 0;
    fault = await openChamber({
      timeoutMs: 250,
      wrapTransport: (transport) => ({
        ...transport,
        send(value) {
          if ((value as { kind?: string }).kind === 'commit') commitsSent++;
          transport.send(value);
        },
        subscribe(receive, failed) {
          return transport.subscribe((value) => {
            if ((value as { kind?: string }).kind !== 'commit') receive(value);
          }, failed);
        },
      }),
    });
    const acknowledged = fault.exportSave();
    assert(
      (await fault.preview({ kind: 'wait' })).status === 'ready',
      'Fault fixture did not prepare.',
    );
    let uncertain = false;
    try {
      await fault.commit();
    } catch {
      uncertain = fault.state.uncertain;
    }
    assert(
      uncertain && commitsSent === 1,
      'Lost acknowledgement did not fail closed without retry.',
    );
    equal(fault.exportSave(), acknowledged, 'Uncertain commit changed the acknowledged save.');
    await fault.close().catch(() => {});
    fault = null;
    publish('discard timeout, close during cancellation, and preview ownership');
    fault = await openChamber({
      timeoutMs: 250,
      wrapTransport: (transport) => ({
        ...transport,
        subscribe(receive, failed) {
          return transport.subscribe((value) => {
            if ((value as { kind?: string }).kind !== 'discard') receive(value);
          }, failed);
        },
      }),
    });
    const beforeCancel = fault.exportSave(),
      observed: string[] = [];
    fault.onChange(() => observed.push(fault!.state.status));
    assert(
      (await fault.preview({ kind: 'wait' })).status === 'ready',
      'Discard fault fixture did not prepare.',
    );
    let cancellation = '';
    void fault.cancel().then(
      () => {
        cancellation = 'resolved';
      },
      (error) => {
        cancellation = String(error);
      },
    );
    await until(() => cancellation !== '', 1000);
    assert(
      /timed out/.test(cancellation) && observed.at(-1) === 'failed' && !fault.state.uncertain,
      'Discard timeout did not reject and publish terminal state.',
    );
    equal(fault.exportSave(), beforeCancel, 'Discard timeout changed the acknowledged save.');
    await fault.close().catch(() => {});
    fault = null;
    closing = await openChamber();
    const ownedPreview = await closing.preview({ kind: 'wait' });
    assert(ownedPreview.status === 'ready', 'Ownership fixture did not prepare.');
    const privatePreview = closing.previewSnapshot();
    ownedPreview.preview.state.game.remainingQ--;
    Object.assign(ownedPreview.preview.base, { revision: 99 });
    equal(
      closing.previewSnapshot(),
      privatePreview,
      'Returned preview mutated the private candidate.',
    );
    const ownedCommit = await closing.commit();
    equal(
      JSON.parse(closing.exportSave()).steps[0].sha256,
      await stateHash(ownedCommit),
      'Caller mutation corrupted the recording digest.',
    );
    assert(
      (await closing.preview({ kind: 'wait' })).status === 'ready',
      'Close fixture did not prepare.',
    );
    let closeCancellation = '';
    void closing.cancel().then(
      () => {
        closeCancellation = 'resolved';
      },
      (error) => {
        closeCancellation = String(error);
      },
    );
    await closing.close();
    await until(() => closeCancellation !== '', 1000);
    assert(/closed/i.test(closeCancellation), 'Closing left cancellation pending.');
    closing = null;
    closing = await openChamber();
    const running = closing.preview({ kind: 'heat', cell: [...SUPPORT] });
    await closing.close();
    assert((await running).status === 'closed', 'Shutdown did not cancel active preview.');
    closing = null;
    publish('native pixels, depth, bounded camera frames, and disposal');
    report.render = await verifyRendering(initial);
    const previousFrames = app.renderer!.frameCount,
      previousTimings = app.renderer!.timings,
      previousWorstMs = app.renderer!.worstFrameMs;
    await app.stop();
    const startup = app.start();
    const interrupted = app.stop();
    await Promise.all([startup, interrupted]);
    assert(!app.running, 'Stop during startup resurrected the chamber.');
    await app.start();
    await app.painted();
    const exposed = app.client!.initial;
    exposed.game.remainingQ = 0;
    equal(app.client!.initial, initial, 'Initial save was externally mutable.');
    click('heat');
    await until(() => app.client!.state.hasPreview);
    await app.painted();
    const worstMs = Math.max(previousWorstMs, app.renderer!.worstFrameMs);
    report.applicationFrames = {
      worstMs,
      count: previousFrames + app.renderer!.frameCount,
      completedMs: [...previousTimings, ...app.renderer!.timings],
    };
    assert(
      previousFrames + app.renderer!.frameCount + 132 <= 256,
      'Browser frame budget exceeded.',
    );
    assert(worstMs <= 16.667, 'Completed application frame exceeds 16.667ms.');
    const latency = report.latency as {
      p95Ms: number;
      cancellationP95Ms: number;
      rafWorstGapMs: number;
    };
    assert(latency.p95Ms <= 250, `Preview p95 ${latency.p95Ms.toFixed(1)}ms exceeds 250ms.`);
    assert(latency.cancellationP95Ms <= 100, 'Cancellation p95 exceeds 100ms.');
    assert(latency.rafWorstGapMs < 100, 'Main-thread camera stalled during preview.');
    await app.painted();
    report.journeys = [
      'causal-controls',
      'direct-worker-equality',
      'preview-compare-discard',
      'latest-intent',
      'cancel-ack',
      'save-replay-continuation',
      'failed-import-rollback',
      'uncertain-commit-no-retry',
      'discard-timeout',
      'close-during-cancel',
      'preview-ownership',
      'close-during-preview',
      'stop-during-startup',
    ];
    publish('capture-ready');
    report.captureReady = true;
    output.textContent = JSON.stringify(report);
    await until(
      () => (window as unknown as { chamberCaptureAck?: boolean }).chamberCaptureAck === true,
    );
    report.passed = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : 'Chamber verification failed.';
  } finally {
    await fault?.close().catch(() => {});
    await closing?.close().catch(() => {});
    await app.stop();
    report.done = true;
    publish(report.passed ? 'complete' : 'failed');
  }
}
async function verifyRendering(snapshot: ChamberSnapshot) {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'low-power' });
  assert(adapter && !adapter.info.isFallbackAdapter, 'Native adapter required.');
  const device = await adapter.requestDevice(),
    renderer = await createChamberRenderer(device, 'rgba8unorm');
  const width = 640,
    height = 400,
    bytesPerRow = width * 4;
  const color = device.createTexture({
    size: [width, height],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const depth = device.createTexture({
    size: [width, height],
    format: 'depth32float',
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const pixels = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const depths = device.createBuffer({
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  try {
    const { registry } = await createChamber(snapshotScenario(snapshot)),
      scene = prepareScene(registry, snapshot),
      camera = orbitCamera(-0.65, 0.42, snapshot.domains.world.block.width);
    const promise = renderer.render(scene, camera, color, depth);
    let overlapRejected = false;
    try {
      await renderer.render(scene, camera, color, depth);
    } catch {
      overlapRejected = true;
    }
    await promise;
    assert(overlapRejected, 'Renderer accepted overlapping frames.');
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture: color }, { buffer: pixels, bytesPerRow }, [
      width,
      height,
    ]);
    encoder.copyTextureToBuffer(
      { texture: depth, aspect: 'depth-only' },
      { buffer: depths, bytesPerRow },
      [width, height],
    );
    device.queue.submit([encoder.finish()]);
    await Promise.all([pixels.mapAsync(GPUMapMode.READ), depths.mapAsync(GPUMapMode.READ)]);
    const rgba = new Uint8Array(pixels.getMappedRange()),
      z = new Float32Array(depths.getMappedRange());
    let terrainPixels = 0,
      actorPixels = 0;
    for (let i = 0; i < z.length; i++) {
      if (z[i] < 1) terrainPixels++;
      if (rgba[i * 4 + 1] > 120 && rgba[i * 4 + 2] > 140 && rgba[i * 4] < 100) actorPixels++;
    }
    assert(
      terrainPixels > 5000 && actorPixels > (snapshot.domains.world.block.width === 8 ? 20 : 5),
      'Expected terrain and actor pixels were not rendered.',
    );
    const actor = snapshot.game.actor,
      point = actor.minQ.map((v, i) => v + actor.sizeQ[i] / 2) as [number, number, number],
      projected = projectPoint(camera, point, width, height)!;
    const at = Math.floor(projected.y) * width + Math.floor(projected.x);
    assert(
      projected.visible && z[at] > 0 && z[at] < projected.depth && z[0] === 1,
      'Actor depth or clear depth is incorrect.',
    );
    pixels.unmap();
    depths.unmap();
    for (let i = 0; i < 130; i++) {
      await frame();
      await renderer.render(
        scene,
        orbitCamera(-0.65 + i * 0.006, 0.42, snapshot.domains.world.block.width),
        color,
        depth,
      );
    }
    const frames = renderer.timings.slice(11),
      worstMs = Math.max(...frames);
    assert(
      frames.length === 120 && worstMs <= 16.667,
      `Completed camera frame ${worstMs.toFixed(2)}ms exceeds 16.667ms.`,
    );
    const last = renderer.render(scene, camera, color, depth);
    await renderer.close();
    await last;
    assert(renderer.state === 'closed', 'Renderer did not drain on close.');
    return {
      backendInfo: {
        vendor: adapter.info.vendor,
        architecture: adapter.info.architecture,
        device: adapter.info.device,
        isFallbackAdapter: adapter.info.isFallbackAdapter,
      },
      terrainPixels,
      actorPixels,
      frames,
      p95Ms: percentile(frames, 0.95),
      worstMs,
      overlapRejected,
      drainedOnClose: true,
    };
  } finally {
    await renderer.close();
    pixels.destroy();
    depths.destroy();
    color.destroy();
    depth.destroy();
    device.destroy();
  }
}

/** One explicitly selected 16³ profile per supervised stage; no unbounded loop. */
export async function verifySandbox(app: typeof chamberApp) {
  const output = document.getElementById('report')!;
  const report: Record<string, unknown> = { passed: false, done: false, size: 16 };
  const publish = (progress: string) => {
    report.progress = progress;
    output.textContent = JSON.stringify(report);
  };
  try {
    publish('start 16³ worker and native view');
    click('start');
    await until(() => app.running && Boolean(app.scene));
    const initial = app.client!.snapshot(),
      scenario = snapshotScenario(initial);
    assert(scenario !== 'chamber', '16³ stage requires a sandbox profile.');
    report.scenario = scenario;
    report.materialCatalogHash = app.client!.registry.hash;
    report.materialPack = SCENARIOS[scenario].pack;
    // Replace across dimensions while a camera frame is pending, through the actual selector.
    for (const next of ['chamber', scenario] as const) {
      app.orbit(-0.5);
      const select = document.getElementById('scenario') as HTMLSelectElement;
      select.value = next;
      select.dispatchEvent(new Event('change'));
      await until(() => app.client?.scenario === next);
      await app.painted();
      equal(
        app.scene!.selected,
        [...(next === 'flow' ? SCENARIOS[next].secondary : SCENARIOS[next].primary)],
        'Scenario switch lost the selection.',
      );
      assert(app.running, 'Scenario replacement stopped the renderer.');
    }
    const direct = await createChamber(scenario);
    equal(initial, direct.session.snapshot(), 'Initial Worker state differs.');
    const cell = [
      ...(scenario === 'flow' ? SCENARIOS[scenario].secondary : SCENARIOS[scenario].primary),
    ] as [number, number, number];
    const heat: ChamberCommand = { kind: 'heat', cell };
    publish('preview latency, active cancellation, and camera responsiveness');
    const previews: number[] = [],
      cancellations: number[] = [],
      rafGaps: number[] = [];
    for (let i = 0; i < 12; i++) {
      const pending = app.client!.preview(heat);
      let complete = false;
      void pending.then(() => {
        complete = true;
      });
      let previous = await frame();
      while (!complete) {
        assert(app.renderer!.frameCount < 300, 'Preview exceeded the finite camera frame budget.');
        app.orbit(-0.65 + 0.1 * Math.sin(i));
        const now = await frame();
        rafGaps.push(now - previous);
        previous = now;
      }
      assert((await pending).status === 'ready', 'Measured preview failed.');
      previews.push(app.client!.metrics.previewsMs.at(-1)!);
      await app.client!.cancel();
      const active = app.client!.preview(heat);
      await until(() => app.client!.state.progress?.phase === 'ticks');
      const started = performance.now();
      await app.client!.cancel();
      cancellations.push(performance.now() - started);
      assert((await active).status === 'cancelled', 'Active cancellation failed.');
      equal(app.client!.snapshot(), initial, 'Cancellation published state or charged resource.');
    }
    report.latency = {
      samples: previews,
      p95Ms: percentile(previews, 0.95),
      cancellations,
      cancellationP95Ms: percentile(cancellations, 0.95),
      rafWorstGapMs: Math.max(...rafGaps),
    };
    assert(
      percentile(previews, 0.95) <= 250,
      `16³ preview p95 ${percentile(previews, 0.95).toFixed(1)}ms exceeds 250ms.`,
    );
    assert(percentile(cancellations, 0.95) <= 100, '16³ cancellation p95 exceeds 100ms.');
    assert(Math.max(...rafGaps) < 100, 'Camera stalled during worker preview.');
    report.worker = app.client!.metrics.runtime;
    publish('controls, preview comparison, commit, save, reload, and exact continuation');
    const apply = async (command: ChamberCommand) => {
      // Keep synchronous CPU-oracle work outside real application frame measurements.
      await app.painted();
      const branch = prepareCommand(direct.registry, direct.session, command);
      const expected = finishBranch(branch, 64);
      if (command.kind === 'cool') {
        click('select-water');
        await app.painted();
        equal(
          app.scene!.selected,
          command.cell,
          'Liquid selector did not follow the flowed material.',
        );
      }
      click(command.kind);
      await until(() => app.client!.state.hasPreview);
      equal(
        app.client!.previewSnapshot()!.state,
        expected.state,
        'Direct and Worker preview differ.',
      );
      await app.painted();
      click('compare');
      await app.painted();
      equal(app.scene!.kind, 'committed', 'Comparison lost committed scene.');
      click('compare');
      await app.painted();
      equal(app.scene!.kind, 'preview', 'Comparison lost candidate scene.');
      const revision = app.client!.snapshot().revision;
      click('commit');
      await until(
        () => app.client!.snapshot().revision === revision + 1 && !app.client!.state.busy,
      );
      await app.painted();
      const committed = app.client!.snapshot();
      equal(committed, direct.session.commit(branch).snapshot, 'Direct and Worker commit differ.');
      return committed;
    };
    // A control preview must leave the supported actor at the original position.
    const control = await app.client!.preview({ kind: 'wait' });
    assert(control.status === 'ready', 'Control failed.');
    equal(
      control.preview.state.game.actor.minQ,
      initial.game.actor.minQ,
      'Untouched support fell.',
    );
    await app.client!.cancel();
    const changed = await apply(heat);
    if (scenario === 'flow') {
      assert(
        changed.domains.world.block.packedCells.some((v) => (v & 255) === MAT.WATER),
        'Ice did not melt.',
      );
    } else if (scenario === 'wax') {
      assert(
        changed.domains.world.block.packedCells.some((v) => (v & 255) === M.MOLTEN_WAX),
        'Wax plug did not melt.',
      );
    } else if (!isMaterialScenario(scenario)) {
      assert(
        changed.game.burned > 0 &&
          changed.game.fallen > 0 &&
          changed.game.actor.minQ[1] > initial.game.actor.minQ[1],
        'Burning support did not displace the actor.',
      );
    }
    const saved = app.client!.exportSave();
    await app.importSave(saved);
    equal(app.client!.snapshot(), changed, 'Reload changed complete state.');
    const continued = await apply({ kind: 'wait' });
    if (scenario === 'flow') {
      const water = continued.domains.world.block.packedCells.findIndex(
        (v) => (v & 255) === MAT.WATER,
      );
      assert(
        water >= 0 && coordinate(water, 16)[1] > SCENARIOS.flow.secondary[1],
        'Melted water did not flow off the shelf.',
      );
      const frozen = await apply({ kind: 'cool', cell: coordinate(water, 16) });
      assert(
        frozen.domains.world.block.packedCells.some((v) => (v & 255) === MAT.ICE),
        'Flowed water did not freeze.',
      );
    }
    if (scenario === 'wax') {
      const block = continued.domains.world.block;
      const water = block.packedCells.findIndex((v) => (v & 255) === MAT.WATER);
      const wax = block.packedCells.findIndex((v) => (v & 255) === M.MOLTEN_WAX);
      assert(
        water >= 0 && coordinate(water, 16)[1] > SCENARIOS.wax.primary[1],
        'Water stayed trapped behind the melted plug.',
      );
      assert(wax >= 0, 'Melted wax missing.');
      const frozen = await apply({ kind: 'cool', cell: coordinate(wax, 16) });
      assert(
        frozen.domains.world.block.packedCells.some((v) => (v & 255) === M.WAX),
        'Moved wax did not refreeze.',
      );
    } else if (scenario === 'conduction' || scenario === 'insulation') {
      for (let i = 0; i < 3; i++) await apply({ kind: 'wait' });
      const block = app.client!.snapshot().domains.world.block;
      if (scenario === 'conduction') {
        assert(
          block.packedCells.some((v) => (v & 255) === M.MOLTEN_WAX),
          'Copper failed to melt the distant wax.',
        );
      } else {
        const target = SCENARIOS.insulation.secondary;
        const word = block.packedCells[target[0] + 16 * (target[1] + 16 * target[2])];
        assert(
          (word & 255) === M.WAX && ((word >>> 8) & 255) <= 21,
          'Ceramic failed to protect the wax.',
        );
      }
    }
    const beforeBad = app.client!.snapshot(),
      bad = JSON.parse(app.client!.exportSave());
    bad.initial.worldId = SCENARIOS.chamber.worldId;
    let rejected = false;
    try {
      await app.importSave(JSON.stringify(bad));
    } catch {
      rejected = true;
    }
    assert(rejected, 'Cross-profile save was accepted.');
    equal(app.client!.snapshot(), beforeBad, 'Failed import replaced the working sandbox.');
    report.energyDriftQ = direct.session.energyBalance().driftQ.toString();
    assert(report.energyDriftQ === '0', 'Energy drift.');
    publish('public-job phase timings and native completed camera frames');
    await app.painted();
    report.cpu = await profileChamber(scenario);
    report.render = await verifyRendering(initial);
    await app.painted();
    const completedMs = app.renderer!.timings,
      worstMs = app.renderer!.worstFrameMs;
    report.applicationFrames = { count: app.renderer!.frameCount, completedMs, worstMs };
    assert(app.renderer!.frameCount + 132 <= 512, 'Sandbox frame budget exceeded.');
    assert(worstMs <= 16.667, 'Completed application frame exceeds 16.667ms.');
    report.journeys = [
      'scenario-switch-during-frame',
      'stable-control',
      'causal-outcome',
      'direct-worker-budget-equality',
      'preview-compare',
      'active-cancel',
      'commit',
      'save-replay-continuation',
      'cross-profile-import-rollback',
    ];
    publish('capture-ready');
    report.captureReady = true;
    output.textContent = JSON.stringify(report);
    await until(
      () => (window as unknown as { chamberCaptureAck?: boolean }).chamberCaptureAck === true,
    );
    report.passed = true;
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    await app.stop();
    report.done = true;
    publish(report.passed ? 'complete' : 'failed');
  }
}
