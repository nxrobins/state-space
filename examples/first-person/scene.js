import { createStateSpaceField3D, MAT } from '../../dist/sdk/state-space-3d.js';

export const SIZE = 32;
export function createLevel() {
  const field = createStateSpaceField3D(SIZE,SIZE,SIZE);
  const box=(x0,y0,z0,x1,y1,z1,m,t=20)=>{for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)field.setCell(x,y,z,m,t);};
  box(0,29,0,31,31,31,MAT.STONE);
  box(0,15,0,0,28,31,MAT.STONE);box(31,15,0,31,28,31,MAT.STONE);
  box(1,15,0,30,28,0,MAT.STONE);box(1,15,31,30,28,31,MAT.STONE);
  // Raised shores and a three-cell-deep channel. Fixed solids are intentional.
  box(1,24,1,11,28,30,MAT.STONE);box(20,24,1,30,28,30,MAT.STONE);
  box(12,27,5,19,28,18,MAT.STONE);
  box(11,18,4,20,26,4,MAT.STONE);
  box(11,18,5,11,26,12,MAT.STONE);box(20,18,5,20,26,12,MAT.STONE);
  box(12,24,19,19,28,19,MAT.STONE);
  box(12,20,12,19,26,12,MAT.STONE); // Carve this dam to open the finite reservoir.
  box(12,21,5,19,26,11,MAT.WATER,25);
  // Finite hot/cold bays remain visible beyond the crossing.
  box(24,23,23,28,23,27,MAT.GLASS,0);box(25,22,24,27,22,26,MAT.ICE,5);
  box(3,23,24,7,23,28,MAT.STONE);box(4,22,25,6,22,27,MAT.LAVA,240);
  // Pale exit pad, readable from the first-person shore.
  box(24,24,13,27,24,17,MAT.GLASS);
  field.restore(field.snapshot());return field;
}
