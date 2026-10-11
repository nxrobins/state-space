import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateSpaceField, MAT } from '../dist/sdk/state-space.js';
import { seedBridge, seedLighting, seedWater, seedHaze, seedHeat } from './demo.js';
import { FrameClock } from './frame-clock.js';
import { createFramePump } from './frame-pump.js';
import { pacingMetrics } from './frame-benchmark.js';
import { canvasCell } from './renderer.js';

test('display scheduling keeps 60 ticks per second without an unbounded backlog', () => {
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

test('rounded display timestamps do not alternate zero and double physics ticks', () => {
    const clock = new FrameClock(); clock.advance(0);
    for (let i = 1; i <= 600; i++) assert.equal(clock.advance(Math.round(i * 1000 / 60 * 10) / 10), 1);
});

test('missed callbacks do not start a continuing multi-tick catch-up loop', () => {
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

test('60 Hz acceptance rejects deadline misses, lost callbacks, and slowed physics despite average cadence', () => {
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

test('lighting gallery retains finite lava sources through a measured trajectory', () => {
    const world = createStateSpaceField(256, 256);
    try {
        seedLighting(world);
        const initial = world.packedSnapshot();
        assert.equal(initial.packedCells.filter(cell => (cell & 255) === MAT.LAVA).length, 4096);
        assert(initial.energyQ.some(energy => energy > 255 * 256));
        world.step(132);
        assert(world.packedSnapshot().packedCells.filter(cell => (cell & 255) === MAT.LAVA).length >= 64);
        assert.equal(world.energyBalance().driftQ, 0n);
    } finally { world.close(); }
});

test('water lagoon retains finite emitters and water through a measured trajectory', () => {
    const world = createStateSpaceField(256, 256);
    try {
        seedWater(world);
        const initial = world.packedSnapshot();
        world.step(132);
        const final = world.packedSnapshot();
        assert(final.packedCells.filter(cell => (cell & 255) === MAT.LAVA).length >= 64);
        assert(final.packedCells.filter(cell => (cell & 255) === MAT.WATER).length >= 1024);
        assert.equal(world.energyBalance().driftQ, 0n);
        world.restore(initial); world.step(132);
        assert.deepEqual(world.packedSnapshot(), final);
    } finally { world.close(); }
});

test('haze and heat chambers retain finite smoke, steam, and lava through measurement', () => {
    for (const seed of [seedHaze, seedHeat]) {
        const world = createStateSpaceField(256, 256);
        try {
            seed(world);
            const initial = world.packedSnapshot();
            world.step(132);
            const final = world.packedSnapshot();
            for (const [material, minimum] of [[MAT.SMOKE, 1024], [MAT.STEAM, 1024], [MAT.LAVA, 64]]) {
                assert(final.packedCells.filter(cell => (cell & 255) === material).length >= minimum);
            }
            assert.equal(world.energyBalance().driftQ, 0n);
            world.restore(initial); world.step(132);
            assert.deepEqual(world.packedSnapshot(), final);
        } finally { world.close(); }
    }
});

test('picking matches square letterboxing, including high DPI CSS coordinates', () => {
    const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 400 }) };
    assert.equal(canvasCell(canvas, 100, 200, 256, 256), null);
    assert.deepEqual(canvasCell(canvas, 210, 20, 256, 256), [0, 0]);
    assert.deepEqual(canvasCell(canvas, 609, 419, 256, 256), [255, 255]);
    assert.equal(canvasCell(canvas, 610, 420, 256, 256), null);
});

test('bridge is finite, burns real wood, and resumes the complete deterministic state', () => {
    const world = createStateSpaceField(256, 256);
    try {
        seedBridge(world);
        const initial = world.packedSnapshot();
        assert.equal(world.materialAt(100, 220), MAT.WATER);
        assert.equal(world.materialAt(124, 160), MAT.WOOD);
        assert(world.sample(36, 134).anchored);
        world.step(12);
        assert.notEqual(world.materialAt(124, 160), MAT.WOOD, 'Exposed hot support must be consumed');
        const saved = world.packedSnapshot();
        world.step(4);
        const continued = world.packedSnapshot();
        assert.equal(world.energyBalance().driftQ, 0n);
        world.restore(saved);
        world.step(4);
        assert.deepEqual(world.packedSnapshot(), continued);
        world.restore(initial);
        world.step(16);
        assert.deepEqual(world.packedSnapshot(), continued);
    } finally { world.close(); }
});
