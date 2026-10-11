import { createPhysicsState, packVoxel, MAT, DEFAULT_REGISTRY } from '../dist/sdk/state-space.js';

// Finite initial placement/energy only. Playback never injects fire or resets cells.
export function bridgeState(width = 256, height = 256) {
    if (width !== 256 || height !== 256) throw new Error('Bridge demo is a 256 × 256 scene');
    const cells = new Uint32Array(width * height).fill(packVoxel(MAT.AIR));
    const rectangle = (x0, y0, x1, y1, material, thermal = 20) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * width + x] = packVoxel(material, thermal);
    };
    rectangle(0, 242, 255, 255, MAT.STONE);
    for (let x = 0; x < width; x++) {
        if (x < 45 || x > 210) {
            const top = 140 + Math.floor(Math.sin(x * .16) * 4);
            rectangle(x, top, x, 241, MAT.STONE);
            rectangle(x, top - 2, x, top - 1, MAT.SAND);
        }
    }
    rectangle(45, 198, 210, 241, MAT.WATER, 35);
    rectangle(36, 132, 219, 134, MAT.WOOD);
    for (const x of [72, 126, 180]) {
        rectangle(x - 3, 186, x + 3, 241, MAT.STONE);
        rectangle(x - 2, 135, x + 2, 185, MAT.WOOD);
        rectangle(x - 5, 130, x + 5, 131, MAT.METAL);
    }
    rectangle(124, 151, 128, 175, MAT.WOOD, 205);
    rectangle(117, 132, 137, 133, MAT.WOOD, 190);
    rectangle(120, 129, 134, 131, MAT.FIRE, 255);
    for (const x of [25, 231]) {
        rectangle(x - 4, 130, x + 4, 138, MAT.STONE);
        rectangle(x - 2, 127, x + 2, 129, MAT.LAVA, 255);
    }
    rectangle(8, 134, 17, 137, MAT.ICE, 0);
    rectangle(239, 131, 245, 137, MAT.GLASS);
    const state = createPhysicsState(cells, width, height, DEFAULT_REGISTRY);
    for (let y = 129; y <= 131; y++) for (let x = 120; x <= 134; x++) state.energyQ[y * width + x] = 650 * 256;
    return state;
}

export function seedBridge(field) {
    const state = bridgeState(field.width, field.height);
    field.restore({ ...field.packedSnapshot(), tick: 0, packedCells: Array.from(state.grid),
        energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) });
    // Attach the ends to the stone abutments through supported public edits.
    for (const x of [36, 219]) field.setAnchor(x, 134);
}

// Distributed, finite sources keep the lighting benchmark active beyond warmup.
// Narrow receivers and separate pillars expose shadow edges and penumbrae.
export function seedLighting(field) {
    if (field.width !== 256 || field.height !== 256) throw new Error('Lighting gallery is a 256 × 256 scene');
    const cells = new Uint32Array(256 * 256).fill(packVoxel(MAT.AIR));
    const emitters = [];
    const rectangle = (x0, y0, x1, y1, material, thermal = 20) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * 256 + x] = packVoxel(material, thermal);
    };
    for (let y = 0; y < 256; y += 32) {
        rectangle(0, y + 29, 255, y + 31, MAT.STONE);
        for (let x = 0; x < 256; x += 32) {
            rectangle(x + 29, y, x + 30, y + 28, MAT.METAL);
            rectangle(x + 20, y + 13, x + 20, y + 28, MAT.STONE);
            rectangle(x + 5, y + 28, x + 14, y + 28, MAT.STONE);
            rectangle(x + 5, y + 20, x + 5, y + 27, MAT.STONE);
            rectangle(x + 14, y + 20, x + 14, y + 27, MAT.STONE);
            rectangle(x + 6, y + 20, x + 13, y + 27, MAT.LAVA, 255);
            for (let dy = 20; dy <= 27; dy++) for (let dx = 6; dx <= 13; dx++) emitters.push((y + dy) * 256 + x + dx);
        }
    }
    const state = createPhysicsState(cells, 256, 256, DEFAULT_REGISTRY);
    for (const index of emitters) state.energyQ[index] = 1250 * 256;
    field.restore({ ...field.packedSnapshot(), tick: 0, packedCells: Array.from(state.grid),
        energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) });
}

// Suspended finite lava bowls above a deep pool, with a patterned submerged bed.
// Geometry/energy are ordinary initial state; no source is replenished during play.
export function seedWater(field) {
    if (field.width !== 256 || field.height !== 256) throw new Error('Water gallery is a 256 × 256 scene');
    const cells = new Uint32Array(256 * 256).fill(packVoxel(MAT.AIR));
    const rectangle = (x0, y0, x1, y1, material, thermal = 20) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * 256 + x] = packVoxel(material, thermal);
    };
    rectangle(0, 242, 255, 255, MAT.STONE);
    rectangle(0, 158, 19, 241, MAT.STONE);
    rectangle(236, 158, 255, 241, MAT.STONE);
    rectangle(20, 160, 235, 241, MAT.WATER, 35);
    for (let x = 20; x < 236; x += 12) rectangle(x, 236, Math.min(235, x + 5), 241, MAT.METAL);
    for (const x of [60, 174]) {
        // A thick, cold stone thermal mass survives the finite hot reservoir.
        // The inner face may melt normally; anchors sit in the cooler outer base.
        rectangle(x - 11, 90, x - 1, 117, MAT.STONE);
        rectangle(x + 24, 90, x + 34, 117, MAT.STONE);
        rectangle(x - 11, 118, x + 34, 139, MAT.STONE);
        rectangle(x, 94, x + 23, 117, MAT.LAVA, 255);
        rectangle(x - 10, 118, x - 2, 120, MAT.WOOD, 190);
        rectangle(x - 10, 115, x - 2, 117, MAT.FIRE, 255);
        rectangle(x - 12, 121, x - 9, 159, MAT.STONE);
    }
    const state = createPhysicsState(cells, 256, 256, DEFAULT_REGISTRY);
    for (let i = 0; i < cells.length; i++) {
        if ((cells[i] & 255) === MAT.LAVA) state.energyQ[i] = 1250 * 256;
        if ((cells[i] & 255) === MAT.FIRE) state.energyQ[i] = 650 * 256;
    }
    field.restore({ ...field.packedSnapshot(), tick: 0, packedCells: Array.from(state.grid),
        energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) });
    // Native structural anchors keep the finite basins above the reflecting pool
    // even after the wooden side platforms burn. No edits occur during playback.
    for (const x of [49, 94, 163, 208]) field.setAnchor(x, 139);
}

export const FRAME_SCENES = Object.freeze(['bridge', 'emissive', 'lighting', 'water']);
export function seedScene(field, scene) {
    if (scene === 'bridge') seedBridge(field);
    else if (scene === 'lighting') seedLighting(field);
    else if (scene === 'water') seedWater(field);
    else if (scene === 'emissive') field.clear(MAT.LAVA);
    else throw new Error('Unknown demo scene');
}
