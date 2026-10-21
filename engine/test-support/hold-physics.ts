import { afterAll, expect, vi } from 'vitest';
import { CpuVolume } from '../experimental/3d-core.js';
import { CpuStructuralWorld3D } from '../experimental/structural-world-core.js';
import * as mechanics from '../experimental/structural-mechanics.js';

export const STRUCTURAL_CALLS = [
  'step',
  'stepWithMotion',
  'stepWithMotionPaths',
  'inspectStructure',
] as const;
type PhysicalCall = (typeof STRUCTURAL_CALLS)[number] | 'volumeStep' | 'solveStructure3D';

/** Keep caught attempts visible across Vitest's per-test clearing of mock call history. */
export function holdPhysics(...calls: PhysicalCall[]) {
  const attempted = new Set<PhysicalCall>();
  const guards = calls.map((call) => {
    const guard =
      call === 'volumeStep'
        ? vi.spyOn(CpuVolume.prototype, 'step')
        : call === 'solveStructure3D'
          ? vi.spyOn(mechanics, 'solveStructure3D')
          : vi.spyOn(CpuStructuralWorld3D.prototype, call);
    return guard.mockImplementation(() => {
      attempted.add(call);
      throw Error('Physical runtime is held.');
    });
  });
  afterAll(() => {
    try {
      expect([...attempted], 'Held physical calls, including caught errors').toEqual([]);
    } finally {
      for (const guard of guards) guard.mockRestore();
    }
  });
}
