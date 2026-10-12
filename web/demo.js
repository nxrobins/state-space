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
    // The cool outer shell stays supported after pressure fractures the hot
    // inner face. Anchors remain ordinary state and can still melt away.
    for (const x of [60, 174]) {
        for (let y = 90; y <= 139; y++) for (const dx of [-11, 34]) state.structure[y * 256 + x + dx] |= 4096;
        for (let dx = -11; dx <= 34; dx++) state.structure[139 * 256 + x + dx] |= 4096;
    }
    field.restore({ ...field.packedSnapshot(), tick: 0, packedCells: Array.from(state.grid),
        energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) });
    // Native structural anchors keep the finite basins above the reflecting pool
    // even after the wooden side platforms burn. No edits occur during playback.
    for (const x of [49, 94, 163, 208]) field.setAnchor(x, 139);
}

// Closed chambers keep finite real gas and lava in view throughout measurement.
// Steam may condense and basin faces may melt; nothing is replenished afterward.
export function seedHaze(field) {
    if (field.width !== 256 || field.height !== 256) throw new Error('Haze gallery is a 256 × 256 scene');
    const cells = new Uint32Array(256 * 256).fill(packVoxel(MAT.AIR));
    const rectangle = (x0, y0, x1, y1, material, thermal = 20) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * 256 + x] = packVoxel(material, thermal);
    };
    for (let y = 0; y < 256; y += 128) for (let x = 0; x < 256; x += 128) {
        rectangle(x, y, x + 127, y + 3, MAT.STONE);
        rectangle(x, y + 124, x + 127, y + 127, MAT.STONE);
        rectangle(x, y + 4, x + 3, y + 123, MAT.STONE);
        rectangle(x + 124, y + 4, x + 127, y + 123, MAT.STONE);
        rectangle(x + 4, y + 4, x + 59, y + 123, MAT.SMOKE, 40);
        rectangle(x + 60, y + 4, x + 123, y + 123, MAT.STEAM, 180);
        rectangle(x + 30, y + 80, x + 39, y + 107, MAT.STONE);
        rectangle(x + 64, y + 80, x + 75, y + 107, MAT.STONE);
        rectangle(x + 30, y + 108, x + 75, y + 123, MAT.STONE);
        rectangle(x + 40, y + 84, x + 63, y + 107, MAT.LAVA, 255);
        rectangle(x + 91, y + 60, x + 93, y + 123, MAT.STONE);
        rectangle(x + 83, y + 118, x + 90, y + 123, MAT.WOOD, 190);
        rectangle(x + 83, y + 115, x + 90, y + 117, MAT.FIRE, 255);
    }
    const state = createPhysicsState(cells, 256, 256, DEFAULT_REGISTRY);
    for (let i = 0; i < cells.length; i++) {
        if ((cells[i] & 255) === MAT.LAVA) state.energyQ[i] = 1250 * 256;
        if ((cells[i] & 255) === MAT.FIRE) state.energyQ[i] = 650 * 256;
    }
    field.restore({ ...field.packedSnapshot(), tick: 0, packedCells: Array.from(state.grid),
        energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) });
}

// The same finite chambers, with cold smoke bands making refraction visible in
// the open medium. This changes only initial placement, never playback physics.
export function seedHeat(field) {
    seedHaze(field);
    const initial = field.packedSnapshot();
    const cells = Uint32Array.from(initial.packedCells);
    for (let y = 4; y < 256; y += 128) for (let x = 4; x < 256; x += 128) {
        for (let dy = 0; dy < 72; dy++) for (let dx = 0; dx < 116; dx++) {
            cells[(y + dy) * 256 + x + dx] = packVoxel(dx % 8 < 4 ? MAT.SMOKE : MAT.AIR, 40);
        }
    }
    const state = createPhysicsState(cells, 256, 256, DEFAULT_REGISTRY);
    for (let i = 0; i < cells.length; i++) {
        if ((cells[i] & 255) === MAT.LAVA || (cells[i] & 255) === MAT.FIRE) state.energyQ[i] = initial.energyQ[i];
    }
    field.restore({ ...initial, packedCells: Array.from(state.grid), energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) });
}

// Weak and strong dams above a receiving pool; sealed and vented glass vessels.
// All heat, pressure buildup and wall failures come from ordinary finite state.
export function seedPressure(field) {
    if (field.width !== 256 || field.height !== 256) throw new Error('Pressure gallery is a 256 × 256 scene');
    const cells = new Uint32Array(256 * 256).fill(packVoxel(MAT.AIR));
    const rect = (x0, y0, x1, y1, material, thermal = 20) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * 256 + x] = packVoxel(material, thermal);
    };
    rect(0, 245, 255, 255, MAT.STONE);
    rect(0, 205, 255, 244, MAT.WATER, 35);
    for (const [x, dam] of [[8, MAT.WOOD], [78, MAT.METAL]]) {
        rect(x, 25, x + 3, 143, MAT.STONE);
        rect(x, 144, x + 53, 148, MAT.STONE);
        rect(x + 4, 74, x + 45, 143, MAT.WATER, 35);
        rect(x + 46, 25, x + 46, 143, dam);
        rect(x + 2, 149, x + 8, 244, MAT.STONE);
    }
    for (const [x, vented] of [[154, false], [208, true]]) {
        rect(x, 70, x + 29, 70, MAT.GLASS);
        rect(x, 71, x, 110, MAT.GLASS);
        rect(x + 29, 71, x + 29, 110, MAT.GLASS);
        rect(x, 111, x + 29, 111, MAT.GLASS);
        rect(x + 1, 71, x + 28, 110, MAT.STEAM, 160);
        if (vented) rect(x + 4, 70, x + 25, 70, MAT.AIR);
        rect(x - 2, 112, x + 31, 115, MAT.STONE);
        rect(x + 12, 116, x + 17, 244, MAT.STONE);
    }
    rect(145, 167, 250, 198, MAT.STONE);
    rect(145, 137, 155, 166, MAT.STONE);
    rect(240, 137, 250, 166, MAT.STONE);
    rect(156, 155, 239, 166, MAT.LAVA, 255);
    rect(178, 162, 185, 166, MAT.WOOD, 190);
    rect(178, 159, 185, 161, MAT.FIRE, 255);
    const state = createPhysicsState(cells, 256, 256, DEFAULT_REGISTRY);
    for (let i = 0; i < cells.length; i++) {
        if ((cells[i] & 255) === MAT.LAVA) state.energyQ[i] = 1250 * 256;
        if ((cells[i] & 255) === MAT.FIRE) state.energyQ[i] = 650 * 256;
    }
    for (let y = 137; y <= 198; y++) for (const x of [145, 250]) state.structure[y * 256 + x] |= 4096;
    for (let x = 145; x <= 250; x++) state.structure[198 * 256 + x] |= 4096;
    field.restore({ ...field.packedSnapshot(), tick: 0, packedCells: Array.from(state.grid),
        energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) });
}

export const FRAME_SCENES = Object.freeze(['bridge', 'emissive', 'lighting', 'water', 'haze', 'heat', 'pressure']);
export function seedScene(field, scene) {
    if (scene === 'bridge') seedBridge(field);
    else if (scene === 'lighting') seedLighting(field);
    else if (scene === 'water') seedWater(field);
    else if (scene === 'haze') seedHaze(field);
    else if (scene === 'heat') seedHeat(field);
    else if (scene === 'pressure') seedPressure(field);
    else if (scene === 'emissive') field.clear(MAT.LAVA);
    else throw new Error('Unknown demo scene');
}
