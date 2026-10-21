import type { TerrainCamera, TerrainRenderer } from '../volume/3d-view.js';

/** Optional fixed-point first-person controller. No GPU handles cross this API. */
export type GameplayPlayer3D = {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  wet: boolean;
  jumpHeld: boolean;
  cooldown: number;
  blocked: boolean;
};
export type GameplayState3D = {
  player: GameplayPlayer3D;
  look: readonly number[];
  status: 'playing' | 'won' | 'lost';
  carved: boolean;
  iceWalk: boolean;
};
export type GameplayRules3D = {
  /** Fixed-point goal bounds; tool ceiling is an exclusive voxel coordinate. */
  goal: { minX: number; maxY: number; minZ: number; maxZ: number };
  fallY: number;
  toolCeiling: number;
};
export type GameplayCommand3D = {
  tick: number;
  moveX: number;
  moveZ: number;
  jump: boolean;
  tool: 'none' | 'carve' | 'freeze';
  look: readonly number[];
};
export type GameplayHit3D = { cell: number[]; material: number };
export type GameplayEvent3D = {
  tick: number;
  type: 'carved' | 'cooled' | 'trapped' | 'ice-walk' | 'crossed' | 'fell';
  cells?: number;
  target?: number[];
};
export type GameplayCommit3D = GameplayState3D & {
  tick: number;
  events: GameplayEvent3D[];
  target: GameplayHit3D | null;
  submissions: 1;
  completionBoundaries: 1;
  actorReadbackBytes: 512;
};
export type GameplayPresentation3D = {
  renderer: TerrainRenderer;
  camera: Omit<TerrainCamera, 'eye' | 'target'>;
};
export interface ResidentGameplay3D {
  step(
    command: GameplayCommand3D,
    presentation?: GameplayPresentation3D,
  ): Promise<GameplayCommit3D>;
  present(presentation: GameplayPresentation3D): Promise<GameplayCommit3D>;
  /** Call after terrain restore; refreshes the resident collision neighborhood. */
  restore(state: GameplayState3D): Promise<void>;
  close(): void;
}
