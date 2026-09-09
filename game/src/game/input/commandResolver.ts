import type { ActionState, BufferedInput, FighterState, InputCommand, MoveDirection } from '../simulation/types';

export const INPUT_BUFFER_TICKS = 6;

export interface CommandResolution {
  command: InputCommand;
  direction: MoveDirection;
  facing: 1 | -1;
  airborne: boolean;
}

export function resolveCommandCandidate(fighter: FighterState, actions: ActionState): CommandResolution | null {
  const direction = resolveHeldDirection(actions, fighter.facing);
  const airborne = !fighter.onGround;
  if (actions.grab) {
    return {
      command: grabCommandFor(direction),
      direction,
      facing: fighter.facing,
      airborne,
    };
  }
  if (actions.attack) {
    return {
      command: attackCommandFor(fighter, actions, direction, airborne),
      direction,
      facing: fighter.facing,
      airborne,
    };
  }
  if (actions.special) {
    return {
      command: specialCommandFor(direction),
      direction,
      facing: fighter.facing,
      airborne,
    };
  }

  const legacy = resolveLegacyCommand(actions);
  if (legacy) {
    return {
      command: legacy,
      direction: legacyDirection(legacy),
      facing: fighter.facing,
      airborne,
    };
  }
  return null;
}

export function createBufferedInput(
  resolution: CommandResolution,
  tick: number,
  bufferTicks = INPUT_BUFFER_TICKS,
): BufferedInput {
  return {
    command: resolution.command,
    direction: resolution.direction,
    facing: resolution.facing,
    airborne: resolution.airborne,
    requestedTick: tick,
    expiresAtTick: tick + bufferTicks,
  };
}

function resolveLegacyCommand(actions: ActionState): InputCommand | null {
  if (actions.basic) return 'basic';
  if (actions.special1) return 'special1';
  if (actions.special2) return 'special2';
  if (actions.special3) return 'special3';
  return null;
}

function legacyDirection(command: InputCommand): MoveDirection {
  if (command === 'special2') return 'down';
  if (command === 'special3') return 'up';
  return 'neutral';
}

function resolveHeldDirection(actions: ActionState, facing: 1 | -1): MoveDirection {
  if (actions.up) return 'up';
  if (actions.down) return 'down';
  if (actions.left || actions.right) {
    const held = actions.right ? 1 : -1;
    return held === facing ? 'forward' : 'back';
  }
  return 'neutral';
}

function attackCommandFor(
  fighter: FighterState,
  actions: ActionState,
  direction: MoveDirection,
  airborne: boolean,
): InputCommand {
  if (!airborne) {
    if (direction === 'up') return 'attack-up';
    if (direction === 'down') return 'attack-down';
    if (actions.left || actions.right) return 'attack-side';
    return 'attack-neutral';
  }
  if (direction === 'up') return 'air-up';
  if (direction === 'down') return 'air-down';
  if (direction === 'back') return 'air-back';
  if (direction === 'forward') return 'air-forward';
  return fighter.onGround ? 'attack-neutral' : 'air-neutral';
}

function specialCommandFor(direction: MoveDirection): InputCommand {
  if (direction === 'up') return 'special-up';
  if (direction === 'down') return 'special-down';
  if (direction === 'forward' || direction === 'back') return 'special-side';
  return 'special-neutral';
}

function grabCommandFor(direction: MoveDirection): InputCommand {
  if (direction === 'up') return 'grab-up';
  if (direction === 'down') return 'grab-down';
  if (direction === 'back') return 'grab-back';
  return direction === 'forward' ? 'grab-forward' : 'grab-neutral';
}
