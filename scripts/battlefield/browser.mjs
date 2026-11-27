import { createStateSpaceStructuralWorld3DGPU } from 'state-space-engine/experimental/3d/structural-world/gpu';
import { createTerrain, geometry, cameraAt, changedCells, crossingCells } from './scene.mjs';
import { firstDifference, unpack, startTick, sliceCount, sliceTicks, viewOf } from './slice.mjs';
import { measurePass } from './passes.mjs';

const stage = 'battlefield-crossing-visible';
// One callback per nominal 60 Hz slot even on a faster display.
function displayClock() {
  let origin,
    last = -1;
  return () =>
    new Promise((resolve) => {
      function frame(t) {
        origin ??= t;
        const slot = Math.floor((t - origin + 0.5) / (1000 / 60));
        if (slot <= last) {
          requestAnimationFrame(frame);
          return;
        }
        last = slot;
        resolve(t);
      }
      requestAnimationFrame(frame);
    });
}
const clock = () => performance.now();
const publish = (r) => {
  document.getElementById('report').textContent = JSON.stringify(r);
};
async function measure() {
  let field, renderer, worker, pending, workerFault;
  const report = {
    done: false,
    passed: false,
    qualified: false,
    progress: 'loading',
    passes: {},
    userAgent: navigator.userAgent,
    scope:
      '64x16x64 cinematic display grid, 12 unit markers, two physical actors and four moving water parcels. Application GPU completion; OS scanout excluded.',
  };
  const boundary = displayClock();
  publish(report);
  try {
    const manifest = await (await fetch('./manifest.json')).json();
    const bytes = await (await fetch('./packet.json')).arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    if (
      Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('') !==
      manifest.files['packet.json']
    )
      throw Error('Packet digest changed');
    const packet = unpack(new TextDecoder().decode(bytes));
    if (
      packet.schema !== 'battlefield-crossing-1' ||
      packet.slices.length !== sliceCount ||
      packet.initial.tick !== startTick
    )
      throw Error('Unexpected crossing packet');
    report.revision = manifest.revision;
    report.packetSHA256 = manifest.files['packet.json'];
    const canvas = document.querySelector('canvas'),
      terrain = createTerrain();
    report.resolution = [canvas.width, canvas.height];
    report.viewport = [innerWidth, innerHeight];
    report.devicePixelRatio = devicePixelRatio;
    field = await createStateSpaceStructuralWorld3DGPU({ ...geometry, mode: 'active' });
    report.adapter = field.backendInfo;
    if (
      report.adapter.isFallbackAdapter !== false ||
      /swiftshader|llvmpipe|software/i.test(JSON.stringify(report.adapter))
    )
      throw Error('Hardware adapter required');
    await field.restore(terrain);
    renderer = await field.createRenderer(canvas);
    await renderer.setStyle({ profile: 'cinematic' });
    await renderer.setAppearance('naturalistic');
    report.style = await renderer.inspectStyle();
    let cells = new Map();
    async function draw(view, prediction, camera) {
      if (document.hidden) throw Error('Benchmark window hidden');
      const start = clock(),
        next = crossingCells(view, prediction),
        edits = changedCells(cells, next, terrain);
      const projected = clock();
      if (edits.length) await field.edit(edits);
      const uploaded = clock();
      await renderer.render(camera); // public renderer waits for GPU completion
      cells = next;
      return {
        projectionMs: projected - start,
        editMs: uploaded - projected,
        renderMs: clock() - uploaded,
        edits: edits.length,
      };
    }
    // Record a real nonblank GPU image outside the measurement windows.
    async function imageSignature(i) {
      await draw(viewOf(packet.initial), null, cameraAt(i));
      // WebGPU can discard the canvas texture when presenting it. The supervisor
      // captures the composited viewport while this camera and its GPU resources stay live.
      report.captureKey = i;
      publish(report);
      const until = clock() + 10000;
      while (window.battlefieldCapture?.key !== i) {
        if (clock() > until) throw Error('Composited terrain capture timed out');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const screenshot = new Image();
      screenshot.src = window.battlefieldCapture.url;
      await screenshot.decode();
      delete report.captureKey;
      const thumb = document.createElement('canvas');
      thumb.width = 96;
      thumb.height = 54;
      const ctx = thumb.getContext('2d');
      ctx.drawImage(screenshot, 0, 0, 96, 54);
      const pixels = ctx.getImageData(0, 0, 96, 54).data;
      if (new Set(new Uint32Array(pixels.buffer)).size < 16) throw Error('Empty terrain capture');
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', pixels)), (v) =>
        v.toString(16).padStart(2, '0'),
      ).join('');
    }
    report.images = [await imageSignature(0), await imageSignature(64)];
    if (report.images[0] === report.images[1]) throw Error('Camera views are identical');
    function live(message) {
      return new Promise((resolve, reject) => {
        if (workerFault) throw workerFault;
        if (pending) throw Error('Concurrent worker request');
        pending = { resolve, reject };
        worker.postMessage(message);
      });
    }
    const byTick = new Map(packet.slices.map((s) => [s.tick, s]));
    async function recorded({ kind, tick }) {
      const { views } = byTick.get(tick);
      return kind === 'preview' ? { views, workerMs: 0 } : views.at(-1);
    }
    function check(observed) {
      const differences = [],
        commitDifferences = [];
      for (const [i, r] of observed.entries()) {
        const views = packet.slices[i].views;
        const difference =
          firstDifference(views, r.views) ?? firstDifference(views.at(-1), r.committed);
        if (difference) differences.push({ startTick: packet.slices[i].tick, ...difference });
        const commitDifference = firstDifference(r.views.at(-1), r.committed);
        if (commitDifference)
          commitDifferences.push({ startTick: packet.slices[i].tick, ...commitDifference });
      }
      return {
        exactHostedSlices: observed.length - differences.length,
        exactPreviewCommits: observed.length - commitDifferences.length,
        firstHostedDifference: differences[0] ?? null,
        firstCommitDifference: commitDifferences[0] ?? null,
      };
    }
    const counts = { frames: 2 }; // includes the two image checks
    for (const mode of ['recorded', 'live']) {
      report.progress = mode;
      publish(report);
      if (mode === 'live') {
        worker = new Worker('./worker.js', { type: 'module' });
        worker.onmessage = ({ data }) => {
          if (data.error) pending.reject(Error(data.error));
          else pending.resolve(data.value);
          pending = null;
        };
        worker.onerror = (e) => {
          workerFault = Error(e.message);
          pending?.reject(workerFault);
          pending = null;
        };
        await live({ kind: 'init', snapshot: packet.initial });
        await live({ kind: 'preview', tick: startTick, edits: packet.slices[0].edits });
        await live({ kind: 'commit', tick: startTick });
        await live({ kind: 'init', snapshot: packet.initial });
        const initial = await live({ kind: 'audit', tick: startTick });
        report.initialDifference = firstDifference(packet.initial, initial.live);
      }
      for (let i = 0; i < 32; i++) {
        await boundary();
        await draw(viewOf(packet.initial), null, cameraAt(i));
        counts.frames++;
      }
      report.passes[mode] = await measurePass({
        packet,
        request: mode === 'live' ? live : recorded,
        draw,
        boundary,
        clock,
        check,
        counts,
      });
    }
    const audit = await live({ kind: 'audit', tick: startTick + sliceTicks * sliceCount });
    const expected = packet.slices.flatMap((s) => s.results);
    if (audit.history.length !== expected.length) throw Error('Incomplete native history');
    report.exactTicks = 0;
    for (const [i, row] of expected.entries()) {
      const difference = firstDifference(row, audit.history[i]);
      if (!difference) report.exactTicks++;
      else report.firstTickDifference ??= { tick: row.snapshot.tick, ...difference };
    }
    report.finalDifference = firstDifference(expected.at(-1).snapshot, audit.live);
    report.fractureTicks = audit.history
      .filter((row) => row.ticks.some((t) => t.brokenBonds.length))
      .map((row) => row.snapshot.tick);
    if (
      report.initialDifference ||
      report.finalDifference ||
      report.exactTicks !== expected.length ||
      Object.values(report.passes).some(
        (p) =>
          p.comparison.exactHostedSlices !== sliceCount ||
          p.comparison.exactPreviewCommits !== sliceCount,
      )
    )
      throw Error(
        'Native replay differs from the hosted reference; timings retained as diagnostics',
      );
    report.passed = true;
    report.progress = 'measured';
  } catch (e) {
    report.error = String(e);
    report.progress = 'failed';
  } finally {
    worker?.terminate();
    try {
      renderer?.close();
      field?.close();
    } catch (e) {
      report.error = String(e);
      report.passed = false;
    }
    report.done = true;
    publish(report);
  }
}
let started = false;
window.macQualification = {
  ready: true,
  run(name) {
    if (name !== stage || started) throw Error('Unexpected benchmark stage');
    started = true;
    void measure();
  },
};
