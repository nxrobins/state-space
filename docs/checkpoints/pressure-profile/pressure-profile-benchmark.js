import { createGpuField, createStateSpaceField, MAT } from '/dist/sdk/state-space.js';
import { seedScene, FRAME_SCENES } from '/web/demo.js';
import { createMaterialRenderer } from '/web/renderer.js';
import { FrameClock } from '/web/frame-clock.js';
import { createFramePump } from '/web/frame-pump.js';

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

export async function benchmarkFrames(canvas, progress = () => {}, { samples = 120, warmup = 12, pacedSamples = 600, pacedWarmup = 60 } = {}) {
    if (!Number.isInteger(samples) || samples < 60 || !Number.isInteger(warmup) || warmup < 4) throw new Error('Insufficient frame samples');
    if (!Number.isInteger(pacedSamples) || pacedSamples < 600 || !Number.isInteger(pacedWarmup) || pacedWarmup < 60) throw new Error('Pacing requires at least ten seconds after one second of warmup');
    canvas.width = 1920; canvas.height = 1080;
    const rows = [], references = {};
    for (const scene of FRAME_SCENES) {
        progress(`${scene} · CPU reference`);
        const cpu = createStateSpaceField(256, 256);
        try {
            seedScene(cpu, scene);
            const initial = cpu.packedSnapshot();
            cpu.step(1); const firstTickHash = await stateHash(cpu);
            await referenceSteps(cpu, samples + warmup - 1);
            references[scene] = { firstTickHash, finalHash: await stateHash(cpu), endTick: cpu.tick, initial };
            if (scene !== 'emissive') {
                await referenceSteps(cpu, pacedSamples + pacedWarmup - cpu.tick);
                references[scene].pacedFinalHash = await stateHash(cpu);
            }
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
                performance.mark('render-' + frames);
                renderer.render(world, true); await renderer.completed();
                performance.mark('completed-' + frames);
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
                    // Include the pressure gallery's initial rupture, which can
                    // occur during the usual warmup. Pipelines are already built.
                    if (i >= warmup || scene === 'pressure') { frames.push(finished - started); physics.push(physicsDone - started); rendering.push(finished - physicsDone); }
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
                rows.push({ scene, mode, width: 256, height: 256, output: [canvas.width, canvas.height],
                    warmup: scene === 'pressure' ? 0 : warmup, ticks: scene === 'pressure' ? warmup + samples : samples,
                    frameMs: distribution(frames), physicsMs: distribution(physics), renderingMs: distribution(rendering),
                    overBudget: frames.filter(value => value > 1000 / 60).length, finalHash, endTick: world.tick, finalLavaCells, finalWaterCells, finalSmokeCells, finalSteamCells,
                    cpuParity: true, renderIsolation: true, energyDriftQ: '0', physicsAdapter: world.backendInfo, renderingAdapter: renderer.backendInfo });
            } finally { renderer?.close(); world.close(); }
        }
    }
    // A separate display-paced run records actual callback cadence as well as work.
    const pacedScenes = [];
    for (const scene of FRAME_SCENES.filter(scene => scene !== 'emissive')) {
        progress(`${scene} · 60 Hz display pacing`);
        const world = await createGpuField(256, 256);
        let renderer;
        try {
            world.restore(references[scene].initial);
            renderer = await createMaterialRenderer(canvas, 256, 256, world.registry);
            if (world.backendInfo.isFallbackAdapter || renderer.backendInfo.isFallbackAdapter) throw new Error('Hardware WebGPU required');
            const measured = await measurePacing(world, renderer, pacedSamples, pacedWarmup);
            const finalHash = await stateHash(world);
            let expected = references[scene].pacedFinalHash;
            if (world.tick !== pacedSamples + pacedWarmup) {
                const cpu = createStateSpaceField(256, 256);
                try { cpu.restore(references[scene].initial); await referenceSteps(cpu, world.tick); expected = await stateHash(cpu); }
                finally { cpu.close(); }
            }
            if (finalHash !== expected || world.energyBalance().driftQ !== 0n) throw new Error('Paced replay differs');
            const counts = world.grid.reduce((counts, cell) => { counts[cell & 255]++; return counts; }, new Uint32Array(256));
            if (scene !== 'bridge' && counts[MAT.LAVA] < 64) throw new Error('Paced lava sources expired');
            if (scene === 'water' && counts[MAT.WATER] < 1024) throw new Error('Paced water expired');
            if (['haze', 'heat'].includes(scene) && (counts[MAT.SMOKE] < 1024 || counts[MAT.STEAM] < 1024)) throw new Error('Paced haze expired');
            pacedScenes.push({ scene, width: 256, height: 256, output: [canvas.width, canvas.height], allEffects: true,
                ...measured, endTick: world.tick, energyDriftQ: '0', finalHash, cpuParity: true,
                finalLavaCells: counts[MAT.LAVA], finalWaterCells: counts[MAT.WATER], finalSmokeCells: counts[MAT.SMOKE], finalSteamCells: counts[MAT.STEAM] });
        } finally { renderer?.close(); world.close(); }
    }
    return { rows, paced: pacedScenes[0], pacedScenes, locked60: pacedScenes.every(row => row.locked60), userAgent: navigator.userAgent,
        scope: 'Physics + public state copies/uploads + material, gas density reconstruction, area-light extraction, terrain visibility, volumetric extinction/scattering, water geometry/reflections/refraction, bloom, heat plume reconstruction/distortion and composition + GPU completion at 1920x1080. Startup, reference hashing and OS scanout excluded.' };
}

// Use the production clock and bounded callback pump. Record completion relative
// to each actual display callback, not just average throughput or submit time.
export async function measurePacing(world, renderer, samples, warmup) {
    const clock = new FrameClock(), rows = [];
    let frames = 0, previous, pump, startStatistics;
    try {
        await new Promise((resolve, reject) => {
            pump = createFramePump(async (now, displayInterval) => {
                if (frames === 0) clock.advance(now - 1000 / 60);
                const ticks = clock.advance(now, false, displayInterval);
                if (!ticks) return;
                const started = performance.now();
                performance.mark('physics-' + frames);
                await world.step(ticks);
                const physicsDone = performance.now();
                performance.mark('render-' + frames);
                renderer.render(world, true); await renderer.completed();
                performance.mark('completed-' + frames);
                const finished = performance.now();
                if (frames >= warmup) {
                    startStatistics ??= pump.statistics();
                    rows.push({ callback: now, started, completed: finished, ticks, workMs: finished - started,
                        physicsMs: physicsDone - started, renderingMs: finished - physicsDone,
                        startDelayMs: started - now, completionDelayMs: finished - now, intervalMs: previous === undefined ? null : now - previous });
                    previous = now;
                }
                if (++frames === warmup + samples) { pump.stop(); resolve(); }
            }, { onError: reject });
        });
        const coalescedCallbacks = pump.statistics().coalesced - startStatistics.coalesced;
        return { ticks: rows.reduce((sum, row) => sum + row.ticks, 0), frames: samples, warmupFrames: warmup, rawFrames: rows,
            frameMs: distribution(rows.map(row => row.workMs)), physicsMs: distribution(rows.map(row => row.physicsMs)), renderingMs: distribution(rows.map(row => row.renderingMs)),
            displayIntervalMs: distribution(rows.slice(1).map(row => row.intervalMs)), completionDelayMs: distribution(rows.map(row => row.completionDelayMs)),
            overBudget: rows.filter(row => row.workMs > 1000 / 60).length, ...pacingMetrics(rows, coalescedCallbacks),
            definition: 'At least 600 all-effects frames after 60 warmup frames; 59.9-60.1 Hz callback/completion/physics cadence, every GPU-completed frame within 16.67 ms of its callback, no missed display slots or coalesced callbacks. OS scanout is not measured.' };
    } finally { pump?.stop(); }
}

async function referenceSteps(field, ticks) {
    // Reference work is outside all frame clocks. Yield between exact batches so
    // the UI and browser-control connection remain responsive during long replay.
    for (let remaining = ticks; remaining > 0; remaining -= Math.min(remaining, 16)) {
        field.step(Math.min(remaining, 16));
        await new Promise(resolve => setTimeout(resolve, 0));
    }
}

export function pacingMetrics(rows, coalescedCallbacks) {
    const first = rows[0], last = rows.at(-1), intervals = rows.length - 1;
    const achievedHz = intervals * 1000 / (last.callback - first.callback);
    const completedHz = intervals * 1000 / (last.completed - first.completed);
    const physicsHz = rows.slice(1).reduce((sum, row) => sum + row.ticks, 0) * 1000 / (last.callback - first.callback);
    const deadlineMisses = rows.filter(row => row.completionDelayMs > 1000 / 60).length;
    const missedDisplaySlots = rows.reduce((sum, row) => sum + (row.intervalMs === null ? 0 : Math.max(0, Math.round(row.intervalMs / (1000 / 60)) - 1)), 0);
    return { achievedHz, completedHz, physicsHz, deadlineMisses, missedDisplaySlots, coalescedCallbacks,
        locked60: rows.length >= 600 && [achievedHz, completedHz, physicsHz].every(hz => hz >= 59.9 && hz <= 60.1) &&
            deadlineMisses === 0 && missedDisplaySlots === 0 && coalescedCallbacks === 0 };
}
