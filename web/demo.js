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
