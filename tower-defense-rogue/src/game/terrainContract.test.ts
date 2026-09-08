import { describe, expect, it } from 'vitest';
import { THERMAL_MASK } from '../../../engine/generated/materials';
import { MAP_DEFS, type MapId } from './content';
import { createRng } from './rng';
import { generateStartingTerrain } from './simulation';

describe('terrain obeys the engine encoding contract', () => {
  it('keeps every generated placement in range across maps and seeds', () => {
    for (const map of Object.keys(MAP_DEFS) as MapId[]) {
      for (let seed = 0; seed < 100; seed += 1) {
        for (const pocket of generateStartingTerrain(map, createRng(`encoding-${seed}`)).pockets) {
          expect(Number.isInteger(pocket.thermal)).toBe(true);
          expect(pocket.thermal).toBeGreaterThanOrEqual(0);
          expect(pocket.thermal).toBeLessThanOrEqual(THERMAL_MASK);
        }
      }
    }
  });
});
