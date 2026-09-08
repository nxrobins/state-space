import { describe, expect, it } from 'vitest';
import { MAT, createStateSpaceField, packVoxel, unpackVoxel } from '../../../engine/browser_state_space';

describe('state-space browser adapter', () => {
  it('preserves the engine voxel pack/unpack bit layout', () => {
    const packed = packVoxel(MAT.WATER, 77, -2, 3, 2, 8);
    const unpacked = unpackVoxel(packed);

    expect(unpacked.material).toBe(MAT.WATER);
    expect(unpacked.thermal).toBe(77);
    expect(unpacked.kineticX).toBe(-2);
    expect(unpacked.kineticY).toBe(3);
    expect(unpacked.phase).toBe(2);
    expect(unpacked.flags).toBe(8);
  });

  it('steps material physics on a game-scale field', () => {
    const field = createStateSpaceField(8, 8, MAT.AIR);
    field.setCell(4, 2, MAT.SAND);
    field.step(4);

    expect(field.materialAt(4, 2)).not.toBe(MAT.SAND);
    expect([...field.snapshot().grid].some((voxel) => (voxel & 0xff) === MAT.SAND)).toBe(true);
  });
});
