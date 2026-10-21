import type { GameplayCommit3D, GameplayRules3D } from '../gameplay/gameplay-view.js';

/** M5 has a positional crossing goal; it does not require legacy tool events.
 * Evaluate only a completed tick, after collision/loss resolution. The corrected
 * actor is published and uploaded on the next request at the existing boundary.
 * Paused presentation never evaluates or emits gameplay transitions.
 */
export function commitStructuralGoal(
  commit: GameplayCommit3D,
  rules: GameplayRules3D,
): GameplayCommit3D {
  const p = commit.player,
    g = rules.goal;
  if (commit.status !== 'playing' || p.x < g.minX || p.y > g.maxY || p.z < g.minZ || p.z > g.maxZ)
    return commit;
  return {
    ...commit,
    status: 'won',
    events: [...commit.events, { tick: commit.tick, type: 'crossed' }],
  };
}
