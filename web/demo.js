import { createPhysicsState, packVoxel, MAT, DEFAULT_REGISTRY } from '../dist/sdk/state-space.js';

// Finite initial conditions only. Playback never refills, repairs, or adds heat.
// Anchors are ordinary, destructible structural state.
function layout(field, name) {
    if (field.width !== 256 || field.height !== 256) throw new Error(`${name} demo is a 256 × 256 scene`);
    const cells = new Uint32Array(256 * 256).fill(packVoxel(MAT.AIR));
    const anchors = new Set();
    const rect = (x0, y0, x1, y1, material, thermal = 20) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * 256 + x] = packVoxel(material, thermal);
    };
    const anchor = (x0, y0, x1 = x0, y1 = y0) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) anchors.add(y * 256 + x);
    };
    const finish = (lavaEnergy = 950) => {
        const state = createPhysicsState(cells, 256, 256, DEFAULT_REGISTRY);
        for (let i = 0; i < cells.length; i++) {
            if ((cells[i] & 255) === MAT.LAVA) state.energyQ[i] = lavaEnergy * 256;
            if ((cells[i] & 255) === MAT.FIRE) state.energyQ[i] = 650 * 256;
        }
        field.restore({ ...field.packedSnapshot(), tick: 0, packedCells: Array.from(state.grid),
            energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) });
        for (const i of anchors) field.setAnchor(i % 256, Math.floor(i / 256));
    };
    return { cells, rect, anchor, finish };
}

export function bridgeState(width = 256, height = 256, ignited = true) {
    if (width !== 256 || height !== 256) throw new Error('Bridge demo is a 256 × 256 scene');
    const { cells, rect } = layout({ width, height }, 'Bridge');
    rect(0, 242, 255, 255, MAT.STONE);
    for (let x = 0; x < width; x++) if (x < 45 || x > 210) {
        const top = 140 + Math.floor(Math.sin(x * .16) * 4);
        rect(x, top, x, 241, MAT.STONE);
        rect(x, top - 2, x, top - 1, MAT.SAND);
    }
    rect(45, 198, 210, 241, MAT.WATER, 35);
    rect(36, 135, 44, 241, MAT.STONE);
    rect(211, 135, 219, 241, MAT.STONE);
    rect(36, 132, 219, 134, MAT.WOOD);
    // Expansion joints isolate the central span, so loss of its pin produces a
    // visible drop instead of hanging indefinitely from the adjoining deck.
    rect(105, 132, 105, 134, MAT.AIR);
    rect(147, 132, 147, 134, MAT.AIR);
    // Cold piers carry the load. Only the short central wooden support is lit.
    for (const x of [72, 180]) {
        rect(x - 4, 135, x + 4, 241, MAT.STONE);
        rect(x - 5, 130, x + 5, 131, MAT.METAL);
    }
    rect(121, 180, 131, 241, MAT.STONE);
    rect(126, 135, 126, 179, MAT.WOOD, ignited ? 205 : 20);
    if (ignited) {
        rect(125, 145, 125, 164, MAT.FIRE, 255);
        rect(127, 145, 127, 164, MAT.FIRE, 255);
    }
    const state = createPhysicsState(cells, width, height, DEFAULT_REGISTRY);
    for (let i = 0; i < cells.length; i++) if ((cells[i] & 255) === MAT.FIRE) state.energyQ[i] = 650 * 256;
    return state;
}

export function seedBridge(field, { ignited = true } = {}) {
    const state = bridgeState(field.width, field.height, ignited);
    field.restore({ ...field.packedSnapshot(), tick: 0, packedCells: Array.from(state.grid),
        energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) });
    // Anchor the masonry, not the wooden deck: anchoring a deck cell makes it
    // carry the adjoining riverbanks through the global shortest support paths.
    for (const [left, right, y] of [[36, 44, 135], [68, 76, 135], [121, 131, 180], [176, 184, 135], [211, 219, 135]]) {
        for (let x = left; x <= right; x++) field.setAnchor(x, y);
    }
}

// Shallow lava limits hydrostatic load; a large cold shell absorbs heat.
// Support the cool outer base after the hot inner face melts or fractures.
function basin(scene, x, y) {
    scene.rect(x, y, x + 15, y + 43, MAT.STONE);
    scene.rect(x + 40, y, x + 55, y + 43, MAT.STONE);
    scene.rect(x, y + 20, x + 55, y + 43, MAT.STONE);
    scene.rect(x + 16, y + 4, x + 39, y + 19, MAT.LAVA, 255);
    scene.anchor(x, y, x, y + 43);
    scene.anchor(x + 55, y, x + 55, y + 43);
    scene.anchor(x, y + 43, x + 55, y + 43);
}

export function seedLighting(field) {
    const scene = layout(field, 'Lighting'), { rect, anchor } = scene;
    // Four readable exhibits replace 64 tiny bowls that melted their floors.
    for (const y of [0, 128]) for (const x of [0, 128]) {
        rect(x, y + 116, x + 127, y + 127, MAT.STONE);
        anchor(x, y + 127, x + 127, y + 127);
        basin(scene, x + 36, y + 72);
        // Receivers sit above the open basin, within the renderer's light reach.
        // Compare clear / narrow stone / wide stone / transparent glass paths.
        rect(x + 28, y + 48, x + 99, y + 51, MAT.METAL);
        anchor(x + 28, y + 48, x + 28, y + 51);
        anchor(x + 99, y + 48, x + 99, y + 51);
        if (x || y) {
            const half = x === 0 ? 9 : 4;
            rect(x + 64 - half, y + 62, x + 63 + half, y + 64, x && y ? MAT.GLASS : MAT.STONE);
            anchor(x + 64 - half, y + 62);
            anchor(x + 63 + half, y + 62);
        }
    }
    scene.finish();
}

export function seedWater(field) {
    const scene = layout(field, 'Water'), { rect } = scene;
    rect(0, 242, 255, 255, MAT.STONE);
    rect(0, 158, 19, 241, MAT.STONE);
    rect(236, 158, 255, 241, MAT.STONE);
    rect(20, 160, 235, 241, MAT.WATER, 35);
    for (let x = 20; x < 236; x += 12) rect(x, 236, Math.min(235, x + 5), 241, MAT.METAL);
    for (const x of [42, 158]) {
        basin(scene, x, 90);
        rect(x - 4, 134, x + 3, 241, MAT.STONE);
        rect(x + 4, 84, x + 11, 89, MAT.WOOD, 190);
        rect(x + 4, 81, x + 11, 83, MAT.FIRE, 255);
    }
    scene.finish();
}

function atmosphere(field, striped) {
    const scene = layout(field, striped ? 'Heat' : 'Haze'), { rect, anchor } = scene;
    for (const y of [0, 128]) for (const x of [0, 128]) {
        rect(x, y, x + 3, y + 127, MAT.STONE);
        rect(x + 124, y, x + 127, y + 127, MAT.STONE);
        rect(x, y + 116, x + 127, y + 127, MAT.STONE);
        // A shaft through the upper floor also vents the lower bay.
        if (y === 0) rect(x + 74, 116, x + 81, 127, MAT.AIR);
        anchor(x, y + 127, x + 73, y + 127);
        anchor(x + 82, y + 127, x + 127, y + 127);
        // Open tops connect gas to cooler air. Space between wisps provides
        // finite oxidizer. These viewing bays are not pressure vessels.
        for (let dx = 4; dx < 124; dx++) {
            if (dx % 8 < 4 || (!striped && dx < 64)) rect(x + dx, y + 8, x + dx, y + 71, MAT.SMOKE, 40);
            if (dx >= 68 && dx % 8 >= 4) rect(x + dx, y + 24, x + dx, y + 105, MAT.STEAM, 255);
            if (dx >= 20 && dx < 60 && dx % 8 >= 4) rect(x + dx, y + 40, x + dx, y + 71, MAT.STEAM, 255);
        }
        basin(scene, x + 12, y + 72);
        rect(x + 87, y + 60, x + 90, y + 115, MAT.STONE);
        anchor(x + 87, y + 115, x + 90, y + 115);
        rect(x + 104, y + 110, x + 115, y + 115, MAT.WOOD, 190);
        rect(x + 104, y + 107, x + 115, y + 109, MAT.FIRE, 255);
    }
    scene.finish(1350);
}

export function seedHaze(field) { atmosphere(field, false); }
export function seedHeat(field) { atmosphere(field, true); }

// Equal water heads and identical steam doses make causal comparisons.
// Lava is below the vessels, away from the walls whose early failure we compare.
export function seedPressure(field) {
    const scene = layout(field, 'Pressure'), { rect, anchor } = scene;
    rect(0, 245, 255, 255, MAT.STONE);
    rect(0, 205, 255, 244, MAT.WATER, 35);
    for (const [x, dam] of [[8, MAT.WOOD], [78, MAT.METAL]]) {
        rect(x, 25, x + 3, 143, MAT.STONE);
        rect(x, 144, x + 53, 151, MAT.STONE);
        rect(x + 4, 74, x + 45, 143, MAT.WATER, 35);
        rect(x + 46, 25, x + 46, 143, dam);
        rect(x + 2, 152, x + 8, 244, MAT.STONE);
        anchor(x, 151, x + 53, 151);
    }
    for (const [x, vented] of [[154, false], [208, true]]) {
        rect(x, 70, x + 29, 70, MAT.GLASS);
        rect(x, 71, x, 110, MAT.GLASS);
        rect(x + 29, 71, x + 29, 110, MAT.GLASS);
        rect(x, 111, x + 29, 111, MAT.GLASS);
        rect(x + 1, 71, x + 28, 110, MAT.STEAM, 160);
        if (vented) rect(x + 4, 70, x + 25, 70, MAT.AIR);
        rect(x - 2, 112, x + 31, 119, MAT.STONE);
        rect(x + 12, 120, x + 17, 244, MAT.STONE);
        anchor(x - 2, 119, x + 31, 119);
    }
    basin(scene, 172, 152);
    rect(176, 146, 183, 151, MAT.WOOD, 190);
    rect(176, 143, 183, 145, MAT.FIRE, 255);
    scene.finish();
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
