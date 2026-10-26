/** Exact source edits for the native negative controls in `engine/structure.test.ts`.
 * Each `before` must occur once in `engine/structure.ts`; the CPU suite checks this,
 * so a formatting change cannot silently disable a control. */
export interface SourceMutant {
  readonly before: string;
  readonly after: string;
}

const CAPACITY = 'Math.floor((nominal * integrity * remaining) / (255 * 64 * ENERGY_SCALE))';

export const STRUCTURE_MUTANTS = {
  noMotion: { before: 'moving[index] = 1;', after: 'moving[index] = 0;' },
  lostEnergy: { before: 'Uint32Array.from(sources, (i) => energyQ[i])', after: 'energyQ.slice()' },
  automaticWelding: {
    before: 'if (reciprocal || (structure[i] | structure[j]) & FRESH)',
    after: 'if (true)',
  },
  missingLoadRemainder: { before: 'share + (rank < remainder ? 1 : 0)', after: 'share' },
  fractionalCapacity: {
    before: CAPACITY,
    after: '(nominal * integrity * remaining / (255 * 64 * ENERGY_SCALE))',
  },
  narrowCapacity: {
    before: CAPACITY,
    after: 'Math.floor((nominal * integrity * remaining | 0) / (255 * 64 * ENERGY_SCALE))',
  },
} as const satisfies Record<string, SourceMutant>;
