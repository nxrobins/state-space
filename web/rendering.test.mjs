import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateSpaceField, MAT } from '../dist/sdk/state-space.js';
import { seedBridge, seedLighting, seedWater, seedHaze, seedHeat } from './demo.js';
import { FrameClock } from './frame-clock.js';
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
