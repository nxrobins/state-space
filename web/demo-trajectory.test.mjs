import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStateSpaceField, MAT } from '../dist/sdk/state-space.js';
import { seedBridge, seedLighting, seedWater, seedHaze, seedHeat, seedPressure } from './demo.js';

if(process.env.STATE_SPACE_RUN_LEGACY_DEMOS!=='isolated-host'){
    throw Error('Legacy demo trajectories are quarantined after a host freeze. Run only on an isolated verification host.');
}

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

// Quarantined from the default suite. Never hide a long synchronous step.
async function advance(world,ticks){
    for(let n=1;n<=ticks;n++){
        console.log(`Demo tick ${n}/${ticks}: starting`);
        const started=performance.now();
        world.step();
        const elapsed=performance.now()-started;
        console.log(`Demo tick ${n}/${ticks}: completed in ${elapsed.toFixed(3)} ms`);
        assert(elapsed<=100, 'CPU demo tick exceeded the 100 ms responsiveness budget');
        await new Promise(resolve=>setTimeout(resolve,Math.max(20,Math.ceil(elapsed*4))));
    }
}
