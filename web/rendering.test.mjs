import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateSpaceField, MAT } from '../dist/sdk/state-space.js';
import { seedBridge, seedLighting, seedWater, seedHaze, seedHeat, seedPressure } from './demo.js';
import { FrameClock } from './frame-clock.js';
import { createFramePump } from './frame-pump.js';
import { pacingMetrics } from './frame-benchmark.js';
import { canvasCell } from './renderer.js';

test('display scheduling keeps 60 ticks per second without an unbounded backlog', async () => {
    for (const hz of [30, 60, 144]) {
        const clock = new FrameClock();
        let ticks = 0;
        for (let i = 0; i <= hz; i++) ticks += clock.advance(i * 1000 / hz);
        assert.equal(ticks, 60);
    }
    // Ordinary frame jitter loses no simulated time.
    const jitter = new FrameClock();
    let now = 0, jittered = jitter.advance(now);
    for (let i = 0; i < 60; i++) { now += i % 2 ? 1000 / 30 - 10 : 10; jittered += jitter.advance(now); }
    assert.equal(jittered, 60);
    // A stall (for example a hidden tab) runs at most one catch-up frame, then
    // returns to real time instead of fast-forwarding through the backlog.
    const clock = new FrameClock();
    clock.advance(0);
    assert.equal(clock.advance(60000), 4);
    let after = 0;
    for (let i = 1; i <= 60; i++) after += clock.advance(60000 + i * 1000 / 60);
    assert(after >= 60 && after <= 61, `expected real-time ticks after a stall, got ${after}`);
    // A device that needs 20 ms per tick runs slower than real time. When it becomes
    // fast again, the world continues at real time instead of repaying ~50 s of debt.
    const slow = new FrameClock();
    let t = 0, resumed = 0;
    slow.advance(t);
    for (let i = 0; i < 600; i++) t += Math.max(1000 / 60, slow.advance(t) * 20 + 3);
    for (let i = 0; i < 60; i++) { resumed += slow.advance(t); t += 1000 / 60; }
    assert(resumed <= 66, `slow device repaid a backlog: ${resumed} ticks in one second`);
    assert.equal(clock.advance(70000, true), 0);
    assert.equal(clock.advance(70000 + 1000 / 60), 1);
});

test('rounded display timestamps do not alternate zero and double physics ticks', async () => {
    const clock = new FrameClock(); clock.advance(0);
    for (let i = 1; i <= 600; i++) assert.equal(clock.advance(Math.round(i * 1000 / 60 * 10) / 10), 1);
});

test('missed callbacks do not start a continuing multi-tick catch-up loop', async () => {
    for (const hz of [30, 60, 144]) {
        const clock = new FrameClock(), interval = 1000 / hz;
        clock.advance(0);
        clock.advance(10000, false, interval);
        let ticks = 0;
        for (let i = 1; i <= hz; i++) ticks += clock.advance(10000 + i * interval, false, interval);
        assert.equal(ticks, 60);
    }
    const clock = new FrameClock(); clock.advance(0);
    assert.equal(clock.advance(1000, false, 1000 / 60), 1);
    for (let i = 1; i <= 600; i++) assert.equal(clock.advance(1000 + i * 1000 / 60, false, 1000 / 60), 1);
});

test('display callbacks stay armed across GPU waits with one bounded pending frame', async () => {
    const callbacks = new Map(); let sequence = 0, release;
    const seen = [], errors = [];
    const pump = createFramePump(async now => {
        seen.push(now);
        await new Promise(resolve => { release = resolve; });
    }, { requestFrame: cb => { callbacks.set(++sequence, cb); return sequence; },
        cancelFrame: id => callbacks.delete(id), onError: error => errors.push(error) });
    function fire(now) {
        const [id, cb] = callbacks.entries().next().value;
        callbacks.delete(id); cb(now);
        assert.equal(callbacks.size, 1, 'next callback must be armed before GPU completion');
    }
    fire(0); fire(17); fire(34);
    assert.deepEqual(seen, [0], 'GPU operations must never overlap');
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, [0, 34], 'only the newest pending timestamp is retained');
    assert.deepEqual(pump.statistics(), { callbacks: 3, coalesced: 1 });
    pump.stop(); release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(callbacks.size, 0); assert.deepEqual(errors, []);
});

test('a failed GPU frame cancels future callbacks and reports the error once', async () => {
    const callbacks = new Map(), errors = []; let sequence = 0;
    createFramePump(async () => { throw new Error('GPU failure'); }, {
        requestFrame: cb => { callbacks.set(++sequence, cb); return sequence; },
        cancelFrame: id => callbacks.delete(id), onError: error => errors.push(error.message),
    });
    const [id, cb] = callbacks.entries().next().value; callbacks.delete(id); cb(0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(callbacks.size, 0); assert.deepEqual(errors, ['GPU failure']);
});

test('60 Hz acceptance rejects deadline misses, lost callbacks, and slowed physics despite average cadence', async () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ callback: i * 1000 / 60, completed: i * 1000 / 60 + 10,
        ticks: 1, completionDelayMs: 10, intervalMs: i ? 1000 / 60 : null }));
    assert.equal(pacingMetrics(rows, 0).locked60, true);
    assert.equal(pacingMetrics(rows.slice(0, 120), 0).locked60, false, 'two-second evidence is insufficient');
    assert.equal(pacingMetrics(rows, 1).locked60, false);
    for (const change of [{ completionDelayMs: 17 }, { intervalMs: 1000 / 30 }, { ticks: 0 }]) {
        const faulty = rows.map(row => ({ ...row })); Object.assign(faulty[300], change);
        assert.equal(pacingMetrics(faulty, 0).locked60, false, JSON.stringify(change));
    }
});

test('lighting gallery keeps its receivers, baffles and finite lava in each exhibit', async () => {
    const world = createStateSpaceField(256, 256);
    try {
        seedLighting(world);
        const initial = world.packedSnapshot();
        assert.equal(initial.packedCells.filter(cell => (cell & 255) === MAT.LAVA).length, 1536);
        assert(initial.energyQ.some(energy => energy > 255 * 256));
        await advance(world,132);
        for (const y of [0, 128]) for (const x of [0, 128]) {
            assert.equal(countRect(world, MAT.METAL, x + 28, y + 48, x + 99, y + 51), 288);
            assert(countRect(world, MAT.LAVA, x + 36, y + 72, x + 91, y + 115) >= 64);
            assert(world.sample(x + 36, y + 115).anchored);
            if (x || y) assert.equal(world.materialAt(x + 64, y + 63), x && y ? MAT.GLASS : MAT.STONE);
        }
        assert.equal(world.energyBalance().driftQ, 0n);
    } finally { world.close(); }
});

test('water lagoon retains finite emitters and water through a measured trajectory', async () => {
    const world = createStateSpaceField(256, 256);
    try {
        seedWater(world);
        const initial = world.packedSnapshot();
        await advance(world,132);
        const final = world.packedSnapshot();
        assert(final.packedCells.filter(cell => (cell & 255) === MAT.LAVA).length >= 64);
        assert(final.packedCells.filter(cell => (cell & 255) === MAT.WATER).length >= 1024);
        assert.equal(world.energyBalance().driftQ, 0n);
        world.restore(initial); await advance(world,132);
        assert.deepEqual(world.packedSnapshot(), final);
    } finally { world.close(); }
});

test('haze and heat chambers retain finite smoke, steam, and lava through measurement', async () => {
    for (const seed of [seedHaze, seedHeat]) {
        const world = createStateSpaceField(256, 256);
        try {
            seed(world);
            const initial = world.packedSnapshot();
            await advance(world,132);
            const final = world.packedSnapshot();
            for (const [material, minimum] of [[MAT.SMOKE, 1024], [MAT.STEAM, 1024], [MAT.LAVA, 64]]) {
                assert(final.packedCells.filter(cell => (cell & 255) === material).length >= minimum);
            }
            assert.equal(world.energyBalance().driftQ, 0n);
            world.restore(initial); await advance(world,132);
            assert.deepEqual(world.packedSnapshot(), final);
        } finally { world.close(); }
    }
});

test('picking matches square letterboxing, including high DPI CSS coordinates', async () => {
    const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 400 }) };
    assert.equal(canvasCell(canvas, 100, 200, 256, 256), null);
    assert.deepEqual(canvasCell(canvas, 210, 20, 256, 256), [0, 0]);
    assert.deepEqual(canvasCell(canvas, 609, 419, 256, 256), [255, 255]);
    assert.equal(canvasCell(canvas, 610, 420, 256, 256), null);
});

test('bridge is finite, burns real wood, and resumes the complete deterministic state', async () => {
    const world = createStateSpaceField(256, 256);
    try {
        seedBridge(world);
        const initial = world.packedSnapshot();
        assert.equal(world.materialAt(100, 220), MAT.WATER);
        assert.equal(world.materialAt(126, 170), MAT.WOOD);
        assert(world.sample(72, 135).anchored);
        await advance(world,12);
        assert.equal(countRect(world, MAT.WOOD, 106, 132, 146, 134), 0, 'Central span must drop after the pin burns');
        const saved = world.packedSnapshot();
        await advance(world,4);
        const continued = world.packedSnapshot();
        assert.equal(world.energyBalance().driftQ, 0n);
        world.restore(saved);
        await advance(world,4);
        assert.deepEqual(world.packedSnapshot(), continued);
        world.restore(initial);
        await advance(world,16);
        assert.deepEqual(world.packedSnapshot(), continued);
    } finally { world.close(); }
});

function countRect(world, material, x0, y0, x1, y1) {
    let count = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (world.materialAt(x, y) === material) count++;
    return count;
}

test('the unlit bridge carries its load without collapse', async () => {
    const world = createStateSpaceField(256, 256);
    try {
        seedBridge(world, { ignited: false });
        await advance(world,132);
        assert.equal(countRect(world, MAT.WOOD, 36, 132, 219, 134), 546);
        assert.equal(countRect(world, MAT.WOOD, 126, 135, 126, 179), 45);
        assert.equal(world.energyBalance().driftQ, 0n);
    } finally { world.close(); }
});

test('pressure gallery distinguishes wood from metal and sealed from vented steam', async () => {
    const world = createStateSpaceField(256, 256);
    try {
        seedPressure(world);
        const initial = world.packedSnapshot();
        await advance(world,30);
        assert(countRect(world, MAT.WOOD, 54, 74, 54, 143) < 70, 'Weak dam must breach');
        assert.equal(countRect(world, MAT.METAL, 124, 25, 124, 143), 119, 'Metal dam must hold');
        assert(countRect(world, MAT.WATER, 55, 74, 74, 204) > 0, 'Water must flow downstream');
        assert(countRect(world, MAT.GLASS, 154, 70, 183, 111) < 140, 'Sealed vessel must rupture');
        assert.equal(countRect(world, MAT.GLASS, 208, 70, 237, 111), 118, 'Vented vessel must retain its walls');
        assert.equal(world.energyBalance().driftQ, 0n);
        const final = world.packedSnapshot(); world.restore(initial); await advance(world,30);
        assert.deepEqual(world.packedSnapshot(), final);
    } finally { world.close(); }
});

test('slow viewing schedules fewer exact ticks without skipping or accumulating time debt', async () => {
    for (const rate of [0.1, 0.25, 1]) {
        const clock = new FrameClock(); clock.advance(0);
        let ticks = 0;
        for (let i = 1; i <= 600; i++) ticks += clock.advance(i * 1000 / 60 * rate, false, 1000 / 60 * rate);
        assert.equal(ticks, 600 * rate);
        clock.reset(); assert.equal(clock.advance(10000), 0);
    }
});

// Exact ticks with cooperative checkpoints; long demo trajectories must not
// monopolize a worker or hide progress from the verification supervisor.
async function advance(world,ticks){
    for(let n=1;n<=ticks;n++){
        world.step();
        if(n%8===0||n===ticks)console.log(`Demo trajectory ${n}/${ticks}`);
        await new Promise(resolve=>setTimeout(resolve,5));
    }
}
