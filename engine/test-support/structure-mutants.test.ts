import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STRUCTURE_MUTANTS } from './structure-mutants.js';

// The controls run only in the native suite; hosted CI still checks their anchors.
describe('native structure negative-control anchors', () => {
  it('each occur once in engine/structure.ts', () => {
    const source = readFileSync('engine/structure.ts', 'utf8');
    for (const [name, { before, after }] of Object.entries(STRUCTURE_MUTANTS)) {
      expect(source.split(before).length - 1, name).toBe(1);
      expect(after, name).not.toBe(before);
    }
  });
});
