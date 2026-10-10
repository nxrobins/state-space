// Complete public WebGPU calls; hashing and rendering are outside the tick clock.
import { createGpuField, createMaterialRegistry } from '../dist/sdk/state-space.js';

function distribution(values) {
  const sorted = values.toSorted((a, b) => a - b), n = values.length;
  return { samples: values, count: n, min: sorted[0], max: sorted[n - 1],
    median: (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2,
    p95: sorted[Math.ceil(n * .95) - 1] };
}
async function digest(snapshot) {
  const count = snapshot.packedCells.length;
  const bytes = new Uint8Array(count * 12), view = new DataView(bytes.buffer);
  [snapshot.packedCells, snapshot.energyQ, snapshot.structure].forEach((values, coordinate) => {
    values.forEach((value, i) => view.setUint32((coordinate * count + i) * 4, value, true));
  });
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function benchmarkBrowserGpu(scenesUrl, nativeUrl, progress = () => {}) {
  const scenes = await (await fetch(scenesUrl)).json(), native = await (await fetch(nativeUrl)).json();
  const rows = [];
  for (const scene of scenes) {
    const expected = native.publicSteps.find(row => row.scene === scene.name);
    if (!expected) throw new Error(`Missing native public-step evidence: ${scene.name}`);
    const registry = await createMaterialRegistry(scene.catalog);
    const field = await createGpuField(scene.width, scene.height, { registry });
    try {
      if (field.backendInfo.isFallbackAdapter) throw new Error('Hardware WebGPU required for performance evidence.');
      field.restore({ ...field.packedSnapshot(), tick: scene.tick, packedCells: scene.cells, energyQ: scene.energyQ, structure: scene.structure });
      const samples = [], warmup = expected.warmup, ticks = expected.ticks;
      let firstTickMs, firstTickHash;
      for (let i = 0; i < warmup + ticks; i += 1) {
        const options = { inspect: false }, started = performance.now();
        const operation = field.step(1, options);
        // The asynchronous call must capture options before its first await.
        options.inspect = true;
        const reports = await operation;
        const elapsed = performance.now() - started;
        if (reports.length) throw new Error('Caller changed an in-flight step option.');
        if (i === 0) {
          firstTickMs = elapsed;
          firstTickHash = await digest(field.packedSnapshot());
          if (firstTickHash !== expected.firstTickHash) throw new Error(`Native/browser first-tick mismatch: ${scene.name}`);
        }
        if (i >= warmup) samples.push(elapsed);
      }
      const finalHash = await digest(field.packedSnapshot());
      if (finalHash !== expected.finalHash || field.tick !== expected.endTick) throw new Error(`Native/browser complete-state mismatch: ${scene.name}`);
      if (field.energyBalance().driftQ !== 0n) throw new Error(`Energy drift: ${scene.name}`);
      rows.push({ scene: scene.name, width: scene.width, height: scene.height, warmup, ticks, endTick: field.tick,
        publicStepMs: distribution(samples), firstTickMs, firstTickHash, finalHash, nativeParity: true, backendInfo: field.backendInfo });
      progress({ completed: rows.length, total: scenes.length, scene: scene.name });
    } finally { field.close(); }
  }
  return { userAgent: navigator.userAgent, rows };
}
