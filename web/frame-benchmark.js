import { createGpuField, createStateSpaceField, MAT } from '../dist/sdk/state-space.js';
import { seedBridge } from './demo.js';
import { createMaterialRenderer } from './renderer.js';

export function distribution(values) {
    const sorted = [...values].sort((a, b) => a - b), n = values.length;
    return { count: n, samples: values, min: sorted[0], max: sorted[n - 1],
        median: (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2,
        p95: sorted[Math.ceil(n * .95) - 1] };
}
export async function stateHash(field) {
    const state = field.snapshot(), count = field.width * field.height;
    const bytes = new Uint8Array(count * 12), view = new DataView(bytes.buffer);
    [state.grid, state.energyQ, state.structure].forEach((values, coordinate) => {
        values.forEach((value, i) => view.setUint32((coordinate * count + i) * 4, value, true));
    });
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
const seed = (field, scene) => {
    if (scene === 'bridge') seedBridge(field);
    else { field.clear(MAT.LAVA); }
};

export async function benchmarkFrames(canvas, progress = () => {}, { samples = 120, warmup = 12 } = {}) {
    if (!Number.isInteger(samples) || samples < 60 || !Number.isInteger(warmup) || warmup < 4) throw new Error('Insufficient frame samples');
    canvas.width = 1920; canvas.height = 1080;
    const rows = [], references = {};
    for (const scene of ['bridge', 'emissive']) {
        const cpu = createStateSpaceField(256, 256);
        try {
            seed(cpu, scene);
            const initial = cpu.packedSnapshot();
            cpu.step(1); const firstTickHash = await stateHash(cpu);
            cpu.step(samples + warmup - 1);
            references[scene] = { firstTickHash, finalHash: await stateHash(cpu), endTick: cpu.tick, initial };
        } finally { cpu.close(); }
        for (const mode of ['plain', 'styled', 'alternating']) {
            progress(`${scene} · ${mode}`);
            const world = await createGpuField(256, 256);
            let renderer;
            try {
                if (world.backendInfo.isFallbackAdapter) throw new Error('Hardware WebGPU required');
                world.restore(references[scene].initial);
                renderer = await createMaterialRenderer(canvas, 256, 256, world.registry);
                if (renderer.backendInfo.isFallbackAdapter) throw new Error('Hardware renderer required');
                const initialHash = await stateHash(world);
                renderer.render(world, false); await renderer.completed();
                renderer.render(world, true); await renderer.completed();
                if (await stateHash(world) !== initialHash) throw new Error('A/B render mutated the complete state');
                const frames = [], physics = [], rendering = [];
                for (let i = 0; i < warmup + samples; i++) {
                    const started = performance.now();
                    await world.step(1);
                    const physicsDone = performance.now();
                    renderer.render(world, mode === 'styled' || (mode === 'alternating' && i % 2 === 0));
                    await renderer.completed();
                    const finished = performance.now();
                    if (i === 0 && await stateHash(world) !== references[scene].firstTickHash) throw new Error('Rendered first tick differs from CPU reference');
                    if (i >= warmup) { frames.push(finished - started); physics.push(physicsDone - started); rendering.push(finished - physicsDone); }
                }
                const finalHash = await stateHash(world);
                if (finalHash !== references[scene].finalHash || world.tick !== references[scene].endTick) throw new Error('Rendered continuation differs from CPU reference');
                if (world.energyBalance().driftQ !== 0n) throw new Error('Energy drift');
                rows.push({ scene, mode, width: 256, height: 256, output: [canvas.width, canvas.height], warmup, ticks: samples,
                    frameMs: distribution(frames), physicsMs: distribution(physics), renderingMs: distribution(rendering),
                    overBudget: frames.filter(value => value > 1000 / 60).length, finalHash, endTick: world.tick,
                    cpuParity: true, renderIsolation: true, energyDriftQ: '0', physicsAdapter: world.backendInfo, renderingAdapter: renderer.backendInfo });
            } finally { renderer?.close(); world.close(); }
        }
    }
    // A separate display-paced run records actual callback cadence as well as work.
    progress('bridge · 60 Hz display pacing');
    const world = await createGpuField(256, 256);
    let renderer;
    try {
        seedBridge(world);
        renderer = await createMaterialRenderer(canvas, 256, 256, world.registry);
        const intervals = [], work = [];
        let previous, first, last, nextAt;
        for (let i = 0; i < warmup + samples; i++) {
            let now = await new Promise(requestAnimationFrame);
            nextAt ??= now;
            // Cap the requested rate at 60 Hz even on a 120/144 Hz display.
            while (now + 0.1 < nextAt) now = await new Promise(requestAnimationFrame);
            nextAt += 1000 / 60;
            const started = performance.now();
            await world.step(1); renderer.render(world, true); await renderer.completed();
            const finished = performance.now();
            if (i >= warmup) {
                if (previous !== undefined) intervals.push(now - previous);
                first ??= now; last = now; previous = now; work.push(finished - started);
            }
        }
        const finalHash = await stateHash(world);
        if (finalHash !== references.bridge.finalHash || world.energyBalance().driftQ !== 0n) throw new Error('Paced replay differs');
        return { rows, paced: { scene: 'bridge', ticks: samples, frameMs: distribution(work), displayIntervalMs: distribution(intervals),
            achievedHz: (samples - 1) * 1000 / (last - first), finalHash, cpuParity: true }, userAgent: navigator.userAgent,
            scope: 'Physics + public state copies/uploads + all rendering passes + GPU completion at 1920x1080. Startup, reference hashing and OS scanout excluded.' };
    } finally { renderer?.close(); world.close(); }
}
