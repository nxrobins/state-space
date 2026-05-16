import type { ActionState } from '../simulation/types';

export function emptyActions(): ActionState {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    dash: false,
    block: false,
    basic: false,
    special1: false,
    special2: false,
    special3: false,
  };
}

export function cloneActions(actions: ActionState): ActionState {
  return { ...actions };
}
