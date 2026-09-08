import { describe, expect, it } from 'vitest';
import { createStateSpaceField, MAT } from './browser_state_space';
import { MAX_ENERGY_Q } from './thermal';

describe('ca-v2 public energy state', () => {
  it('roundtrips fractional and latent state through ordinary JSON', () => {
    const field = createStateSpaceField(1, 1);
    field.setCell(0, 0, MAT.ICE, 35, 9);
    expect(field.sample(0, 0)).toMatchObject({ thermal: 30, energyQ: 35 * 256, flags: 9 });
    const saved = JSON.parse(JSON.stringify(field.packedSnapshot()));
    saved.energyQ[0] += 17; // Same temperature plateau, extra latent energy.
    field.restore(saved);
    field.step(64);
    expect(field.materialAt(0, 0)).toBe(MAT.ICE);
    expect(field.energyQ[0]).toBe(35 * 256 + 17);
    expect(field.energyBalance().driftQ).toBe(0n);
    const restored = createStateSpaceField(1, 1);
    restored.restore(JSON.parse(JSON.stringify(field.packedSnapshot())));
    expect(restored.packedSnapshot()).toEqual(field.packedSnapshot());
  });

  it('accounts for external cell replacements and conservative physics separately', () => {
    const field = createStateSpaceField(3, 3);
    field.paintCircle(1, 1, 4, MAT.WOOD, 20);
    expect(field.energyBalance().externalQ).toBe(9n * 80n * 256n);
    field.setCell(0, 0, MAT.FIRE, 255);
    const edited = field.energyBalance();
    field.step(128);
    expect(field.energyBalance().externalQ).toBe(edited.externalQ);
    expect(field.energyBalance().currentQ).toBe(edited.currentQ);
    expect(field.energyBalance().driftQ).toBe(0n);
    const replacedEnergy = field.energyQ[4];
    field.setCell(1, 1, MAT.AIR, 20);
    expect(field.energyBalance().externalQ).toBe(edited.externalQ + 5120n - BigInt(replacedEnergy));
    expect(field.energyBalance().driftQ).toBe(0n);
  });

  it('rejects incomplete or inconsistent restores atomically', () => {
    const field = createStateSpaceField(2, 1);
    field.setCell(0, 0, MAT.OIL, 50);
    const before = field.packedSnapshot();
    for (const energyQ of [[0, 5120], [MAX_ENERGY_Q + 1, 5120], [51200.5, 5120], []]) {
      expect(() => field.restore({ ...before, energyQ })).toThrow();
      expect(field.packedSnapshot()).toEqual(before);
    }
    const missing = { ...before } as Partial<typeof before>;
    delete missing.energyQ;
    expect(() => field.restore(missing as typeof before)).toThrow();
    expect(field.packedSnapshot()).toEqual(before);
  });

  it('protects both halves of the state from caller and observer aliases', () => {
    const field = createStateSpaceField(3, 1);
    field.setCell(0, 0, MAT.WOOD, 255);
    const before = field.packedSnapshot();
    field.grid.fill(0);
    field.energyQ.fill(0);
    const legacy = field.snapshot();
    legacy.grid.fill(0);
    legacy.energyQ.fill(0);
    expect(field.packedSnapshot()).toEqual(before);
  });
});
