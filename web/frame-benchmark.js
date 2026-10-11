import { createGpuField, createStateSpaceField, MAT } from '../dist/sdk/state-space.js';
import { seedScene, FRAME_SCENES } from './demo.js';
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

export async function benchmarkFrames(canvas, progress = () => {}, { samples = 120, warmup = 12 } = {}) {
    if (!Number.isInteger(samples) || samples < 60 || !Number.isInteger(warmup) || warmup < 4) throw new Error('Insufficient frame samples');
    canvas.width = 1920; canvas.height = 1080;
    const rows = [], references = {};
    for (const scene of FRAME_SCENES) {
        const cpu = createStateSpaceField(256, 256);
        try {
            seedScene(cpu, scene);
            const initial = cpu.packedSnapshot();
            cpu.step(1); const firstTickHash = await stateHash(cpu);
            cpu.step(samples + warmup - 1);
            references[scene] = { firstTickHash, finalHash: await stateHash(cpu), endTick: cpu.tick, initial };
        } finally { cpu.close(); }
        const modes = ['plain', 'styled', 'alternating'];
        if (scene === 'water') modes.push('water-off');
        if (scene === 'haze') modes.push('haze-off');
        if (scene === 'heat') modes.push('distortion-off');
        for (const mode of modes) {
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
                renderer.render(world, true, { water: false }); await renderer.completed();
                renderer.render(world, true, { haze: false }); await renderer.completed();
                renderer.render(world, true, { distortion: false }); await renderer.completed();
                if (await stateHash(world) !== initialHash) throw new Error('A/B render mutated the complete state');
                const frames = [], physics = [], rendering = [];
                for (let i = 0; i < warmup + samples; i++) {
                    const started = performance.now();
                    await world.step(1);
                    const physicsDone = performance.now();
                    renderer.render(world, ['styled', 'water-off', 'haze-off', 'distortion-off'].includes(mode) || (mode === 'alternating' && i % 2 === 0), { water: mode !== 'water-off', haze: mode !== 'haze-off', distortion: mode !== 'distortion-off' });
                    await renderer.completed();
                    const finished = performance.now();
                    if (i === 0 && await stateHash(world) !== references[scene].firstTickHash) throw new Error('Rendered first tick differs from CPU reference');
                    if (i >= warmup) { frames.push(finished - started); physics.push(physicsDone - started); rendering.push(finished - physicsDone); }
                }
                const finalHash = await stateHash(world);
                if (finalHash !== references[scene].finalHash || world.tick !== references[scene].endTick) throw new Error('Rendered continuation differs from CPU reference');
                if (world.energyBalance().driftQ !== 0n) throw new Error('Energy drift');
                const finalLavaCells = world.snapshot().grid.reduce((count, cell) => count + ((cell & 255) === MAT.LAVA ? 1 : 0), 0);
                const finalWaterCells = world.snapshot().grid.reduce((count, cell) => count + ((cell & 255) === MAT.WATER ? 1 : 0), 0);
                const finalSmokeCells = world.snapshot().grid.reduce((count, cell) => count + ((cell & 255) === MAT.SMOKE ? 1 : 0), 0);
                const finalSteamCells = world.snapshot().grid.reduce((count, cell) => count + ((cell & 255) === MAT.STEAM ? 1 : 0), 0);
                if (['lighting', 'water', 'haze', 'heat'].includes(scene) && finalLavaCells < 64) throw new Error('Stress sources expired before measurement ended');
                if (scene === 'water' && finalWaterCells < 1024) throw new Error('Water stress pool expired before measurement ended');
                if (['haze', 'heat'].includes(scene) && (finalSmokeCells < 1024 || finalSteamCells < 1024)) throw new Error('Haze expired before measurement ended');
                rows.push({ scene, mode, width: 256, height: 256, output: [canvas.width, canvas.height], warmup, ticks: samples,
                    frameMs: distribution(frames), physicsMs: distribution(physics), renderingMs: distribution(rendering),
                    overBudget: frames.filter(value => value > 1000 / 60).length, finalHash, endTick: world.tick, finalLavaCells, finalWaterCells, finalSmokeCells, finalSteamCells,
                    cpuParity: true, renderIsolation: true, energyDriftQ: '0', physicsAdapter: world.backendInfo, renderingAdapter: renderer.backendInfo });
            } finally { renderer?.close(); world.close(); }
        }
    }
    // A separate display-paced run records actual callback cadence as well as work.
    const pacedScenes = [];
    for (const scene of ['bridge', 'lighting', 'water', 'haze', 'heat']) {
        progress(`${scene} · 60 Hz display pacing`);
        const world = await createGpuField(256, 256);
        let renderer;
        try {
            seedScene(world, scene);
            renderer = await createMaterialRenderer(canvas, 256, 256, world.registry);
            if (world.backendInfo.isFallbackAdapter || renderer.backendInfo.isFallbackAdapter) throw new Error('Hardware WebGPU required');
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
            if (finalHash !== references[scene].finalHash || world.tick !== references[scene].endTick || world.energyBalance().driftQ !== 0n) throw new Error('Paced replay differs');
            pacedScenes.push({ scene, ticks: samples, frameMs: distribution(work), displayIntervalMs: distribution(intervals),
                overBudget: work.filter(value => value > 1000 / 60).length, endTick: world.tick, energyDriftQ: '0',
                achievedHz: (samples - 1) * 1000 / (last - first), finalHash, cpuParity: true });
        } finally { renderer?.close(); world.close(); }
    }
    return { rows, paced: pacedScenes[0], pacedScenes, userAgent: navigator.userAgent,
        scope: 'Physics + public state copies/uploads + material, gas density reconstruction, area-light extraction, terrain visibility, volumetric extinction/scattering, water geometry/reflections/refraction, bloom, heat plume reconstruction/distortion and composition + GPU completion at 1920x1080. Startup, reference hashing and OS scanout excluded.' };
}
