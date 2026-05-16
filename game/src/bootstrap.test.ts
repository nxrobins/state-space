import { describe, expect, it, vi } from 'vitest';
import {
  BOOTSTRAP_ERROR_LOG,
  BOOTSTRAP_ERROR_STATUS,
  BOOTSTRAP_LOADING_STATUS,
  bootstrapGame,
  createGameConfig,
} from './bootstrap';
import { ARENA_HEIGHT, ARENA_WIDTH } from './game/simulation/constants';

class FakeGame {
  static lastConfig: unknown;

  constructor(config: unknown) {
    FakeGame.lastConfig = config;
  }
}

function createStatusDoc() {
  const status = { textContent: '' };
  const doc = {
    getElementById: (id: string) => (id === 'status' ? status : null),
  };
  return { doc, status };
}

describe('createGameConfig', () => {
  it('maps arena and scale constants into the Phaser config shape', () => {
    const fakeScene = class FakeScene {};
    const fakePhaser = {
      AUTO: 'AUTO',
      Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
      Game: FakeGame,
    };
    const config = createGameConfig(fakePhaser as never, fakeScene as never);

    expect(config.parent).toBe('game-root');
    expect(config.width).toBe(ARENA_WIDTH);
    expect(config.height).toBe(ARENA_HEIGHT);
    expect(config.scale).toEqual({ mode: 'FIT', autoCenter: 'CENTER_BOTH' });
    expect(config.scene).toEqual([fakeScene]);
  });
});

describe('bootstrapGame', () => {
  it('loads runtime and creates a Phaser game on success', async () => {
    FakeGame.lastConfig = null;
    const { doc, status } = createStatusDoc();
    const reportError = vi.fn();
    const fakeScene = class FakeScene {};
    const fakePhaser = {
      AUTO: 'AUTO',
      Scale: { FIT: 'FIT', CENTER_BOTH: 'CENTER_BOTH' },
      Game: FakeGame,
    };
    const loadRuntime = vi.fn().mockResolvedValue({ Phaser: fakePhaser, BattleScene: fakeScene });

    const ok = await bootstrapGame({ doc, loadRuntime, reportError });

    expect(ok).toBe(true);
    expect(status.textContent).toBe(BOOTSTRAP_LOADING_STATUS);
    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
    expect(FakeGame.lastConfig).toMatchObject({
      parent: 'game-root',
      width: ARENA_WIDTH,
      height: ARENA_HEIGHT,
      scene: [fakeScene],
    });
  });

  it('updates status and reports error when runtime loading fails', async () => {
    const { doc, status } = createStatusDoc();
    const reportError = vi.fn();
    const failure = new Error('runtime unavailable');
    const loadRuntime = vi.fn().mockRejectedValue(failure);

    const ok = await bootstrapGame({ doc, loadRuntime, reportError });

    expect(ok).toBe(false);
    expect(status.textContent).toBe(BOOTSTRAP_ERROR_STATUS);
    expect(loadRuntime).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(BOOTSTRAP_ERROR_LOG, failure);
  });
});
