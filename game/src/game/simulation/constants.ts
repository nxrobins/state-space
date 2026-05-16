export const ARENA_WIDTH = 1280;
export const ARENA_HEIGHT = 720;
export const CELL_SIZE = 8;
export const GRID_WIDTH = 160;
export const GRID_HEIGHT = 90;
export const TICK_RATE = 60;
export const MATCH_SECONDS = 180;
export const MATCH_TICKS = MATCH_SECONDS * TICK_RATE;
export const MAX_HEALTH = 100;
export const MAX_METER = 100;
export const STARTING_STOCKS = 3;
export const BOOST_RADIUS_CELLS = 6;
export const BOOST_REQUIRED_CELLS = 12;
export const TEMPORARY_CELL_CAP = 700;
export const RESPAWN_INVULN_TICKS = 120;
export const REPLAY_SCHEMA_VERSION = 1;

export enum MaterialType {
  Air = 0,
  Stone = 1,
  Water = 2,
  Sand = 3,
  Fire = 4,
  Metal = 5,
  Oil = 6,
  Wood = 7,
  Ice = 8,
  Steam = 9,
  Lava = 10,
  Glass = 11,
  Player = 12,
  Ash = 13,
  Smoke = 14,
}

export const MATERIAL_NAMES: Record<MaterialType, string> = {
  [MaterialType.Air]: 'air',
  [MaterialType.Stone]: 'stone',
  [MaterialType.Water]: 'water',
  [MaterialType.Sand]: 'sand',
  [MaterialType.Fire]: 'fire',
  [MaterialType.Metal]: 'metal',
  [MaterialType.Oil]: 'oil',
  [MaterialType.Wood]: 'wood',
  [MaterialType.Ice]: 'ice',
  [MaterialType.Steam]: 'steam',
  [MaterialType.Lava]: 'lava',
  [MaterialType.Glass]: 'glass',
  [MaterialType.Player]: 'player',
  [MaterialType.Ash]: 'ash',
  [MaterialType.Smoke]: 'smoke',
};

export const MATERIAL_COLORS: Record<MaterialType, number> = {
  [MaterialType.Air]: 0x11151a,
  [MaterialType.Stone]: 0x747b82,
  [MaterialType.Water]: 0x2767d8,
  [MaterialType.Sand]: 0xc8b678,
  [MaterialType.Fire]: 0xff6a1a,
  [MaterialType.Metal]: 0xaab1b8,
  [MaterialType.Oil]: 0x2b1d14,
  [MaterialType.Wood]: 0x8a572e,
  [MaterialType.Ice]: 0x9ee7ff,
  [MaterialType.Steam]: 0xd8e7ec,
  [MaterialType.Lava]: 0xff330f,
  [MaterialType.Glass]: 0x9bd8ef,
  [MaterialType.Player]: 0x40d87a,
  [MaterialType.Ash]: 0x5f5a54,
  [MaterialType.Smoke]: 0x666b73,
};

export const SOLID_MATERIALS = new Set<MaterialType>([
  MaterialType.Stone,
  MaterialType.Sand,
  MaterialType.Ice,
  MaterialType.Metal,
  MaterialType.Glass,
]);

export const HAZARD_MATERIALS = new Set<MaterialType>([
  MaterialType.Fire,
  MaterialType.Lava,
]);

export const PLATFORM_RELEVANT_MATERIALS = new Set<MaterialType>([
  MaterialType.Stone,
  MaterialType.Sand,
  MaterialType.Ice,
]);
