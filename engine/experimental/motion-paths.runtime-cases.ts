/** Held real M5 equivalence/continuation cases. Never select in edit/mock checks. */
import { describe, expect, test } from 'vitest';
import { MAT } from './3d.js';
import { CpuStructuralWorld3D, type StructuralSnapshot3D } from './structural-world-core.js';
import { readMotionPaths3D } from './motion-paths.js';

function seed() {
  const w = new CpuStructuralWorld3D({ width: 4, height: 4, depth: 4, chunkSize: 4 });
  w.setCell(1, 1, 1, MAT.STONE, 180);
  w.setCell(2, 1, 1, MAT.STONE, 180);
  w.setIntegrity(1, 1, 1, 73);
  w.setCell(0, 0, 0, MAT.WATER, 130);
  w.setCell(3, 0, 0, MAT.SAND);
  w.setCell(3, 0, 3, MAT.ICE, 10);
  return w.snapshot();
}
function restore(s: StructuralSnapshot3D) {
  const w = new CpuStructuralWorld3D({
    width: s.width,
    height: s.height,
    depth: s.depth,
    chunkSize: s.chunkSize,
  });
  w.restore(s);
  return w;
}
describe('held full-state observed path acceptance', () => {
  test('paths, net-only capture and uncaptured physics have identical full states and ledgers', () => {
    const s = seed(),
      plain = restore(s),
      net = restore(s),
      paths = restore(s);
    for (let i = 0; i < 8; i++) {
      const before = paths.snapshot();
      plain.step(1);
      const motion = net.stepWithMotion({ maxEntries: 65536 });
      const observed = paths.stepWithMotionPaths({ maxEntries: 65536, maxPathEntries: 65536 }),
        after = paths.snapshot();
      expect(after).toEqual(plain.snapshot());
      expect(after).toEqual(net.snapshot());
      expect(observed.motion).toEqual(motion);
      expect(observed.paths.status).toBe('complete');
      expect(readMotionPaths3D(observed.paths, observed.motion, before, after)).toEqual(
        observed.paths,
      );
      expect(paths.energyBalance()).toEqual(plain.energyBalance());
      expect(paths.energyBalance().driftQ).toBe(0n);
    }
  });
  test('path overflow changes no authoritative state or accounting', () => {
    const s = seed(),
      plain = restore(s),
      observed = restore(s);
    plain.step(1);
    const r = observed.stepWithMotionPaths({ maxPathEntries: 0 });
    expect(r.paths).toMatchObject({ status: 'overflow', passes: [], requiresReexecution: true });
    expect(observed.snapshot()).toEqual(plain.snapshot());
    expect(observed.energyBalance()).toEqual(plain.energyBalance());
  });
  test('odd-tick restart reproduces full subsequent paths, net traces and authoritative states', () => {
    const a = restore(seed());
    for (let i = 0; i < 3; i++) a.stepWithMotionPaths();
    const b = restore(a.snapshot());
    for (let i = 0; i < 5; i++) {
      expect(b.stepWithMotionPaths()).toEqual(a.stepWithMotionPaths());
      expect(b.snapshot()).toEqual(a.snapshot());
    }
  });
  test('invalid path limits fail without advancing or editing the field', () => {
    const w = restore(seed()),
      before = w.snapshot(),
      ledger = w.energyBalance();
    expect(() => w.stepWithMotionPaths({ maxPathEntries: -1 })).toThrow();
    expect(w.snapshot()).toEqual(before);
    expect(w.energyBalance()).toEqual(ledger);
  });
});
