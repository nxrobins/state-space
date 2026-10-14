import { createStateSpaceField3D, MAT } from '../../dist/sdk/state-space-3d.js';

export const SCENES = Object.freeze([
  { id: 'flow', name: 'Sand & water', description: 'Sand settles around fixed obstacles. Water spreads across both horizontal axes.' },
  { id: 'phase', name: 'Hot / cold chamber', description: 'Finite hot and cold blocks drive boiling, condensation, freezing and melting.' },
  { id: 'melt', name: 'From rock to liquid', description: 'Hot stone becomes lava; sand vitrifies into glass. Cool blocks solidify the molten material.' },
]);

export function createScene(id) {
  if (!SCENES.some(s => s.id === id)) throw new Error('Unknown volume scene.');
  const field = createStateSpaceField3D(32, 32, 32);
  const box = (x0, y0, z0, x1, y1, z1, material, thermal = 20, energy) => {
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      field.setCell(x, y, z, material, thermal);
      if (energy !== undefined) field.setEnergy(x, y, z, energy);
    }
  };
  box(0, 30, 0, 31, 31, 31, MAT.STONE);
  box(0, 14, 0, 0, 29, 31, MAT.GLASS); box(31, 14, 0, 31, 29, 31, MAT.GLASS);
  box(1, 14, 0, 30, 29, 0, MAT.GLASS); box(1, 14, 31, 30, 29, 31, MAT.GLASS);
  if (id === 'flow') {
    box(5, 2, 5, 12, 10, 13, MAT.SAND);
    box(19, 5, 5, 27, 15, 18, MAT.WATER);
    box(7, 18, 5, 10, 29, 10, MAT.STONE);
    box(7, 17, 5, 23, 18, 10, MAT.STONE);
    box(21, 19, 7, 23, 29, 10, MAT.STONE);
    box(3, 24, 23, 6, 27, 26, MAT.STEAM, 180);
  } else if (id === 'phase') {
    box(15, 2, 1, 16, 29, 30, MAT.GLASS);
    box(3, 18, 5, 12, 27, 26, MAT.WATER);
    box(3, 28, 5, 12, 29, 26, MAT.STONE, 0);
    box(19, 17, 5, 28, 25, 26, MAT.WATER);
    box(19, 26, 5, 28, 29, 26, MAT.STONE, 255, 700 * 256);
    box(19, 3, 5, 28, 4, 26, MAT.GLASS, 0);
    box(4, 14, 9, 9, 17, 15, MAT.ICE, 5);
    box(21, 12, 10, 26, 15, 17, MAT.ICE, 5);
  } else {
    box(15, 12, 1, 16, 29, 30, MAT.GLASS, 0);
    box(4, 7, 5, 11, 13, 14, MAT.STONE, 255, 600 * 256);
    box(20, 5, 5, 27, 12, 14, MAT.SAND, 255, 600 * 256);
    box(3, 27, 3, 12, 29, 27, MAT.STONE, 0);
    box(19, 27, 3, 28, 29, 27, MAT.GLASS, 0);
    box(4, 24, 19, 10, 26, 25, MAT.LAVA, 255);
    box(21, 24, 19, 27, 26, 25, MAT.MOLTEN_GLASS, 255);
  }
  // Scene construction is placement; establish a clean continuation baseline.
  field.restore(field.snapshot());
  return field;
}
