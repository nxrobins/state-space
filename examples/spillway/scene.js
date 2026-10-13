import { MAT, packVoxel, createPhysicsState } from '../../dist/sdk/state-space.js';

export const SIZE = 256;
export const EXIT = Object.freeze({ x: 230, y: 166 });

// Finite initial conditions. Nothing refills, repairs, or heats the scene later.
export function seedSpillway(field) {
    if (field.width !== SIZE || field.height !== SIZE) throw new Error('Spillway requires a 256 × 256 field');
    const cells = new Uint32Array(SIZE * SIZE).fill(packVoxel(MAT.AIR));
    const anchors = new Set();
    const rect = (x0, y0, x1, y1, mat, thermal = 20) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) cells[y * SIZE + x] = packVoxel(mat, thermal);
    };
    const anchor = (x0, y0, x1 = x0, y1 = y0) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) anchors.add(y * SIZE + x);
    };
    rect(0, 236, 255, 255, MAT.STONE);
    rect(0, 176, 55, 235, MAT.STONE); anchor(0, 176, 55, 176);
    rect(200, 176, 255, 235, MAT.STONE); anchor(200, 176, 255, 176);
    rect(56, 210, 199, 235, MAT.WATER, 35);
    for (const x of [90, 170]) {
        rect(x - 4, 177, x + 4, 235, MAT.STONE); anchor(x - 4, 177, x + 4, 177);
    }
    rect(50, 174, 205, 176, MAT.WOOD);
    rect(106, 174, 106, 176, MAT.AIR); rect(150, 174, 150, 176, MAT.AIR);
    rect(128, 177, 128, 221, MAT.WOOD);
    rect(121, 222, 135, 235, MAT.STONE); anchor(121, 222, 135, 222);
    rect(64, 157, 66, 173, MAT.WOOD); // Cut this barricade or jump over it.
    // Steps out of the water, still subject to normal heat and fracture rules.
    for (let s = 0; s < 5; s++) {
        rect(175 + s * 5, 207 - s * 7, 179 + s * 5, 235, MAT.STONE);
        anchor(175 + s * 5, 207 - s * 7, 179 + s * 5, 207 - s * 7);
    }
    // Lava furnaces above the water illuminate smoke, steam and reflections.
    for (const x of [8, 200]) {
        rect(x, 90, x + 15, 133, MAT.STONE); rect(x + 40, 90, x + 55, 133, MAT.STONE);
        rect(x, 110, x + 55, 133, MAT.STONE);
        rect(x + 16, 94, x + 39, 109, MAT.LAVA, 255);
        anchor(x, 90, x, 133); anchor(x + 55, 90, x + 55, 133); anchor(x, 133, x + 55, 133);
        rect(x + 17, 74, x + 22, 89, MAT.SMOKE, 170);
        rect(x + 29, 78, x + 34, 93, MAT.STEAM, 255);
    }
    const state = createPhysicsState(cells, SIZE, SIZE, field.registry);
    for (let i = 0; i < cells.length; i++) if ((cells[i] & 255) === MAT.LAVA) state.energyQ[i] = 1350 * 256;
    field.restore({ ...field.packedSnapshot(), tick: 0, packedCells: Array.from(state.grid),
        energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) });
    for (const i of anchors) field.setAnchor(i % SIZE, Math.floor(i / SIZE));
}
