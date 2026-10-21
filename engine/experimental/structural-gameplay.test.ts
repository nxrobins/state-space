import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { commitStructuralGoal } from './structural-gameplay.js';
import { createStateSpaceStructuralWorld3D } from './structural-world-core.js';
import type { GameplayCommit3D, GameplayRules3D } from './gameplay-view.js';

const rules: GameplayRules3D = {
  goal: { minX: 2304, maxY: 2048, minZ: 1536, maxZ: 2560 },
  fallY: 3584,
  toolCeiling: 15,
};
const committed = (): GameplayCommit3D => ({
  tick: 4,
  player: {
    x: 2304,
    y: 2048,
    z: 2048,
    vy: 0,
    grounded: true,
    wet: false,
    jumpHeld: false,
    cooldown: 0,
    blocked: false,
  },
  look: [256, 0, 0],
  status: 'playing',
  carved: false,
  iceWalk: false,
  events: [],
  target: null,
  submissions: 1,
  completionBoundaries: 1,
  actorReadbackBytes: 512,
});

test('crossing commits a single event without legacy tool flags and preserves the decoded input', () => {
  const input = committed(),
    before = structuredClone(input),
    won = commitStructuralGoal(input, rules);
  expect(won.status).toBe('won');
  expect(won.events).toEqual([{ tick: 4, type: 'crossed' }]);
  expect(won.carved).toBe(false);
  expect(won.iceWalk).toBe(false);
  expect(input).toEqual(before);
  expect(commitStructuralGoal({ ...won, tick: 5, events: [] }, rules).events).toEqual([]);
});

test('all goal bounds are enforced and lost actors cannot win', () => {
  for (const player of [{ x: 2303 }, { y: 2049 }, { z: 1535 }, { z: 2561 }]) {
    const c = committed();
    Object.assign(c.player, player);
    expect(commitStructuralGoal(c, rules)).toBe(c);
  }
  const lost = { ...committed(), status: 'lost' as const };
  expect(commitStructuralGoal(lost, rules)).toBe(lost);
  for (const z of [1536, 2560]) {
    const c = committed();
    c.player.z = z;
    expect(commitStructuralGoal(c, rules).status).toBe('won');
  }
});

test('both constructor expressions in the published quickstart describe a valid 32 cubed world', () => {
  const readme = readFileSync(
    new URL('../../examples/structural-cavern/README.md', import.meta.url),
    'utf8',
  );
  const expressions = Array.from(
    readme.matchAll(
      /const (?:cpu|gpu) = (?:await )?(createStateSpaceStructuralWorld3D(?:GPU)?\([^;]+\));/g,
    ),
    (m) => m[1],
  );
  expect(expressions).toHaveLength(2);
  for (const expression of expressions) {
    // Exercise the literal documentation, using the same geometry validation
    // for the GPU constructor without requesting a GPU in this CPU-only stage.
    const w = runInNewContext(expression, {
      createStateSpaceStructuralWorld3D,
      createStateSpaceStructuralWorld3DGPU: ({
        mode,
        ...geometry
      }: {
        mode: string;
        width: number;
        height: number;
        depth: number;
        chunkSize: number;
      }) => {
        expect(mode).toBe('active');
        return createStateSpaceStructuralWorld3D(geometry);
      },
    });
    expect([w.width, w.height, w.depth, w.chunkSize]).toEqual([32, 32, 32, 8]);
    expect(w.energyBalance().driftQ).toBe(0n);
  }
});
