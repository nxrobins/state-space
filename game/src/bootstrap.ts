import { ARENA_HEIGHT, ARENA_WIDTH } from './game/simulation/constants';

export const BOOTSTRAP_LOADING_STATUS = 'Loading fighter runtime...';
export const BOOTSTRAP_ERROR_STATUS = 'Runtime failed to load. Refresh to retry.';
export const BOOTSTRAP_ERROR_LOG = 'Failed to bootstrap Phaser runtime.';

interface StatusElement {
  textContent: string | null;
}

export interface StatusDocument {
  getElementById: (id: string) => StatusElement | null;
}

type PhaserModule = typeof import('phaser');
type PhaserGameConfig = import('phaser').Types.Core.GameConfig;
type SceneType = import('phaser').Types.Scenes.SceneType;
type ScaleConfig = NonNullable<PhaserGameConfig['scale']>;

export interface PhaserLike {
  AUTO: PhaserGameConfig['type'];
  Scale: {
    FIT: ScaleConfig['mode'];
    CENTER_BOTH: ScaleConfig['autoCenter'];
  };
  Game: new (config: PhaserGameConfig) => unknown;
}

export interface PhaserRuntime {
  Phaser: PhaserLike;
  BattleScene: SceneType;
}

export interface BootstrapDeps {
  loadRuntime?: () => Promise<PhaserRuntime>;
  doc?: StatusDocument;
  reportError?: (message: string, error: unknown) => void;
}

export async function loadRuntime(): Promise<PhaserRuntime> {
  const [phaserModule, battleSceneModule] = await Promise.all([import('phaser'), import('./phaser/scenes/BattleScene')]);
  const moduleWithDefault = phaserModule as PhaserModule & { default?: unknown };
  const Phaser = (moduleWithDefault.default ?? phaserModule) as PhaserLike;
  return { Phaser, BattleScene: battleSceneModule.BattleScene as SceneType };
}

export function createGameConfig(Phaser: PhaserRuntime['Phaser'], BattleScene: PhaserRuntime['BattleScene']): PhaserGameConfig {
  return {
    type: Phaser.AUTO,
    parent: 'game-root',
    width: ARENA_WIDTH,
    height: ARENA_HEIGHT,
    backgroundColor: '#171a1e',
    pixelArt: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [BattleScene],
  };
}

export async function bootstrapGame(deps: BootstrapDeps = {}): Promise<boolean> {
  const doc = deps.doc ?? document;
  const reportError = deps.reportError ?? ((message: string, error: unknown) => console.error(message, error));
  setStatus(doc, BOOTSTRAP_LOADING_STATUS);

  try {
    const runtime = await (deps.loadRuntime ?? loadRuntime)();
    const config = createGameConfig(runtime.Phaser, runtime.BattleScene);
    new runtime.Phaser.Game(config);
    return true;
  } catch (error) {
    setStatus(doc, BOOTSTRAP_ERROR_STATUS);
    reportError(BOOTSTRAP_ERROR_LOG, error);
    return false;
  }
}

function setStatus(doc: StatusDocument, text: string): void {
  const status = doc.getElementById('status');
  if (status) status.textContent = text;
}
