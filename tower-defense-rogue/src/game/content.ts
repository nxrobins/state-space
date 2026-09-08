export const GRID_COLUMNS = 18;
export const GRID_ROWS = 12;
export const TILE_SIZE = 48;
export const WORLD_WIDTH = GRID_COLUMNS * TILE_SIZE;
export const WORLD_HEIGHT = GRID_ROWS * TILE_SIZE;
export const FINAL_WAVE = 7;

export type TowerKind = 'emberCoil' | 'frostLoom' | 'bloomMortar' | 'voltSpire' | 'sunForge';
export type EnemyKind = 'siltling' | 'thornback' | 'glassWisp' | 'ironMite' | 'oilSlug' | 'frostDrone' | 'ashHusk' | 'relicEater';
export type HeroKind = 'kiteRanger' | 'bulwark' | 'fieldMechanic' | 'cinderChemist';
export type HeroRole = 'attack' | 'defend' | 'support';
export type RelicId =
  | 'emberLens'
  | 'clockSeed'
  | 'livingLedger'
  | 'wardenBell'
  | 'echoCore'
  | 'seedVault'
  | 'pressureCrown'
  | 'glassHeart'
  | 'sparkScrip'
  | 'biomeAtlas';
export type CardId =
  | 'build_ember'
  | 'build_frost'
  | 'build_bloom'
  | 'build_volt'
  | 'build_sun'
  | 'upgrade_damage'
  | 'upgrade_range'
  | 'upgrade_tempo'
  | 'overclock'
  | 'field_spanner'
  | 'seed_barrier'
  | 'recruit_ranger'
  | 'recruit_bulwark'
  | 'recruit_mechanic'
  | 'recruit_chemist'
  | 'spill_water'
  | 'oil_slick'
  | 'ignite_patch'
  | 'cryo_seed'
  | 'sand_berm'
  | 'conductor_rail'
  | 'vent_smoke'
  | 'command_attack'
  | 'command_guard'
  | 'command_service'
  | 'salvage_cache'
  | 'aether_mill'
  | 'relic_probe';

export type RewardId = CardId | RelicId | `heroPower:${HeroKind}:${string}`;
export type CardArchetype = 'burn' | 'frost' | 'earth' | 'machine' | 'hero' | 'economy' | 'control';
export type MapId = 'woodlandRelay' | 'floodedBasin' | 'oilworks' | 'glassFoundry';
export type MapPocketMaterial = 'water' | 'ice' | 'oil' | 'sand' | 'glass' | 'lava' | 'smoke';
export type TerrainHeuristicId = 'brookBraids' | 'smokeFen' | 'frostMirror' | 'slagLattice' | 'dustglassSteppe';
export type RouteNodeType = 'standard' | 'elite' | 'cache' | 'forge' | 'hazard';
export type CoreAxisId = 'fieldcraft' | 'engineering' | 'command' | 'archive';

export interface GridPoint {
  x: number;
  y: number;
}

export interface TowerDef {
  id: TowerKind;
  name: string;
  cardId: CardId;
  spriteKey: string;
  cost: number;
  damage: number;
  range: number;
  fireRate: number;
  projectileSpeed: number;
  splash: number;
  slow: number;
  description: string;
}

export interface EnemyDef {
  id: EnemyKind;
  name: string;
  spriteKey: string;
  hp: number;
  speed: number;
  reward: number;
  armor: number;
  traits: string[];
  description: string;
}

export interface HeroDef {
  id: HeroKind;
  name: string;
  role: HeroRole;
  spriteKey: string;
  damage: number;
  range: number;
  cadence: number;
  description: string;
}

export interface RelicDef {
  id: RelicId;
  name: string;
  iconKey: string;
  description: string;
}

export type CardTarget = 'none' | 'buildable' | 'tower' | 'cell';
export type CardType = 'tower' | 'upgrade' | 'tactic' | 'hero' | 'machine' | 'tool' | 'field' | 'command';

export interface CardDef {
  id: CardId;
  name: string;
  type: CardType;
  target: CardTarget;
  cost: number;
  tower?: TowerKind;
  hero?: HeroKind;
  branch?: 'damage' | 'range' | 'tempo';
  archetype: CardArchetype;
  description: string;
  unlock: 'base' | 'profile';
}

export interface WaveDef {
  wave: number;
  packs: Array<{ kind: EnemyKind; count: number; gap: number; delay: number }>;
}

export interface MapPocket {
  point: GridPoint;
  material: MapPocketMaterial;
  thermal: number;
  radius?: number;
}

export interface TerrainHeuristicDef {
  id: TerrainHeuristicId;
  name: string;
  description: string;
  materials: MapPocketMaterial[];
  tags: string[];
  pocketCount: { min: number; max: number };
  radiusRange: { min: number; max: number };
  thermalRange: { min: number; max: number };
  pathBand: { min: number; max: number };
  padAvoidance: number;
  coreAvoidance: number;
}

export interface MapDef {
  id: MapId;
  name: string;
  description: string;
  unlockWave: number;
  startingScrap: number;
  pockets: MapPocket[];
  terrainHeuristics: TerrainHeuristicId[];
  modifiers: string[];
}

export interface RouteNodeDef {
  type: RouteNodeType;
  name: string;
  description: string;
  threat: number;
  rewardBias: 'card' | 'relic' | 'scrap' | 'upgrade';
}

export interface CoreAxisDef {
  id: CoreAxisId;
  name: string;
  description: string;
  cap: number;
}

export const PATH: GridPoint[] = [
  { x: -1, y: 5 },
  { x: 2, y: 5 },
  { x: 2, y: 3 },
  { x: 5, y: 3 },
  { x: 5, y: 8 },
  { x: 9, y: 8 },
  { x: 9, y: 4 },
  { x: 13, y: 4 },
  { x: 13, y: 7 },
  { x: 18, y: 7 },
];

export const CORE_CELL: GridPoint = { x: 16, y: 7 };

export const BUILD_PADS: GridPoint[] = [
  { x: 1, y: 3 },
  { x: 3, y: 6 },
  { x: 4, y: 2 },
  { x: 4, y: 9 },
  { x: 7, y: 6 },
  { x: 8, y: 2 },
  { x: 10, y: 9 },
  { x: 11, y: 5 },
  { x: 12, y: 2 },
  { x: 14, y: 6 },
  { x: 15, y: 9 },
];

export const TOWER_DEFS: Record<TowerKind, TowerDef> = {
  emberCoil: {
    id: 'emberCoil',
    name: 'Ember Coil',
    cardId: 'build_ember',
    spriteKey: 'tower:emberCoil',
    cost: 3,
    damage: 14,
    range: 128,
    fireRate: 0.9,
    projectileSpeed: 420,
    splash: 0,
    slow: 0,
    description: 'Reliable single-target heat bolts.',
  },
  frostLoom: {
    id: 'frostLoom',
    name: 'Frost Loom',
    cardId: 'build_frost',
    spriteKey: 'tower:frostLoom',
    cost: 4,
    damage: 7,
    range: 118,
    fireRate: 0.75,
    projectileSpeed: 360,
    splash: 0,
    slow: 0.42,
    description: 'Threads slow into enemies and weakens rushes.',
  },
  bloomMortar: {
    id: 'bloomMortar',
    name: 'Bloom Mortar',
    cardId: 'build_bloom',
    spriteKey: 'tower:bloomMortar',
    cost: 5,
    damage: 18,
    range: 168,
    fireRate: 0.48,
    projectileSpeed: 280,
    splash: 72,
    slow: 0,
    description: 'Arcing splash pods for dense packs.',
  },
  voltSpire: {
    id: 'voltSpire',
    name: 'Volt Spire',
    cardId: 'build_volt',
    spriteKey: 'tower:voltSpire',
    cost: 5,
    damage: 10,
    range: 142,
    fireRate: 1.2,
    projectileSpeed: 520,
    splash: 0,
    slow: 0,
    description: 'Fast machine tower that rewards tempo branches.',
  },
  sunForge: {
    id: 'sunForge',
    name: 'Sun Forge',
    cardId: 'build_sun',
    spriteKey: 'tower:sunForge',
    cost: 6,
    damage: 22,
    range: 136,
    fireRate: 0.62,
    projectileSpeed: 360,
    splash: 42,
    slow: 0,
    description: 'Late-run forge tower with heavy relic scaling.',
  },
};

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  siltling: {
    id: 'siltling',
    name: 'Siltling',
    spriteKey: 'enemy:siltling',
    hp: 32,
    speed: 62,
    reward: 1,
    armor: 0,
    traits: ['soft-body', 'water-drag'],
    description: 'Light pack enemy that bogs down in water and sand.',
  },
  thornback: {
    id: 'thornback',
    name: 'Thornback',
    spriteKey: 'enemy:thornback',
    hp: 64,
    speed: 46,
    reward: 2,
    armor: 2,
    traits: ['armored', 'burnable-spines'],
    description: 'Armored creeper that takes extra damage from sustained fire.',
  },
  glassWisp: {
    id: 'glassWisp',
    name: 'Glass Wisp',
    spriteKey: 'enemy:glassWisp',
    hp: 42,
    speed: 88,
    reward: 2,
    armor: 0,
    traits: ['phasing', 'conductive-fracture'],
    description: 'Fast phaser that ignores ash but fractures on charged metal.',
  },
  ironMite: {
    id: 'ironMite',
    name: 'Iron Mite',
    spriteKey: 'enemy:ironMite',
    hp: 92,
    speed: 38,
    reward: 3,
    armor: 4,
    traits: ['heavy', 'conductive'],
    description: 'Heavy enemy that resists heat but carries shock through metal.',
  },
  oilSlug: {
    id: 'oilSlug',
    name: 'Oil Slug',
    spriteKey: 'enemy:oilSlug',
    hp: 72,
    speed: 42,
    reward: 3,
    armor: 1,
    traits: ['volatile', 'leaves-oil'],
    description: 'Volatile body that ignites hard and stains the path with oil.',
  },
  frostDrone: {
    id: 'frostDrone',
    name: 'Frost Drone',
    spriteKey: 'enemy:frostDrone',
    hp: 58,
    speed: 66,
    reward: 3,
    armor: 1,
    traits: ['cold-core', 'steam-vulnerable'],
    description: 'Cold machine that shrugs ice but cracks under steam and lava.',
  },
  ashHusk: {
    id: 'ashHusk',
    name: 'Ash Husk',
    spriteKey: 'enemy:ashHusk',
    hp: 82,
    speed: 52,
    reward: 3,
    armor: 2,
    traits: ['smoke-cloak', 'water-break'],
    description: 'Cloaked husk that hides in smoke and breaks apart in water.',
  },
  relicEater: {
    id: 'relicEater',
    name: 'Relic Eater',
    spriteKey: 'enemy:relicEater',
    hp: 230,
    speed: 34,
    reward: 10,
    armor: 5,
    traits: ['boss', 'eats-owned-material'],
    description: 'Boss that consumes player-owned field material near the core.',
  },
};

export const HERO_DEFS: Record<HeroKind, HeroDef> = {
  kiteRanger: {
    id: 'kiteRanger',
    name: 'Kite Ranger',
    role: 'attack',
    spriteKey: 'hero:kiteRanger',
    damage: 10,
    range: 132,
    cadence: 0.85,
    description: 'Autonomous attacker that chases the lead enemy.',
  },
  bulwark: {
    id: 'bulwark',
    name: 'Bulwark',
    role: 'defend',
    spriteKey: 'hero:bulwark',
    damage: 7,
    range: 88,
    cadence: 0.65,
    description: 'Defender that pins enemies near the core path.',
  },
  fieldMechanic: {
    id: 'fieldMechanic',
    name: 'Field Mechanic',
    role: 'support',
    spriteKey: 'hero:fieldMechanic',
    damage: 3,
    range: 120,
    cadence: 1.1,
    description: 'Support unit that buffs nearby towers and repairs the relay.',
  },
  cinderChemist: {
    id: 'cinderChemist',
    name: 'Cinder Chemist',
    role: 'support',
    spriteKey: 'hero:cinderChemist',
    damage: 5,
    range: 116,
    cadence: 0.9,
    description: 'Support controller that primes oil, steam, and combustion reactions.',
  },
};

export const RELIC_DEFS: Record<RelicId, RelicDef> = {
  emberLens: {
    id: 'emberLens',
    name: 'Ember Lens',
    iconKey: 'relic:emberLens',
    description: 'Towers deal 15% more damage.',
  },
  clockSeed: {
    id: 'clockSeed',
    name: 'Clock Seed',
    iconKey: 'relic:clockSeed',
    description: 'Gain +1 energy at the start of each planning phase.',
  },
  livingLedger: {
    id: 'livingLedger',
    name: 'Living Ledger',
    iconKey: 'relic:livingLedger',
    description: 'The first card played each wave refunds 1 scrap.',
  },
  wardenBell: {
    id: 'wardenBell',
    name: 'Warden Bell',
    iconKey: 'relic:wardenBell',
    description: 'Heroes attack 20% faster and pin harder.',
  },
  echoCore: {
    id: 'echoCore',
    name: 'Echo Core',
    iconKey: 'relic:echoCore',
    description: 'When a wave starts, copy the cheapest card in your discard into hand.',
  },
  seedVault: {
    id: 'seedVault',
    name: 'Seed Vault',
    iconKey: 'relic:seedVault',
    description: 'Start each run with +4 scrap and a Bloom Mortar card.',
  },
  pressureCrown: {
    id: 'pressureCrown',
    name: 'Pressure Crown',
    iconKey: 'relic:pressureCrown',
    description: 'Steam and smoke pin enemies longer and deal chip damage.',
  },
  glassHeart: {
    id: 'glassHeart',
    name: 'Glass Heart',
    iconKey: 'relic:glassHeart',
    description: 'Glass terrain fractures enemies for +30% burst damage.',
  },
  sparkScrip: {
    id: 'sparkScrip',
    name: 'Spark Scrip',
    iconKey: 'relic:sparkScrip',
    description: 'Every 4 charge converts into 1 scrap at wave end.',
  },
  biomeAtlas: {
    id: 'biomeAtlas',
    name: 'Biome Atlas',
    iconKey: 'relic:biomeAtlas',
    description: 'Route choices include one extra node and hazard nodes pay better.',
  },
};

export const CARD_DEFS: Record<CardId, CardDef> = {
  build_ember: {
    id: 'build_ember',
    name: 'Raise Ember Coil',
    type: 'tower',
    target: 'buildable',
    cost: 1,
    tower: 'emberCoil',
    archetype: 'burn',
    description: 'Build an Ember Coil on an open pad. Costs 3 scrap.',
    unlock: 'base',
  },
  build_frost: {
    id: 'build_frost',
    name: 'Weave Frost Loom',
    type: 'tower',
    target: 'buildable',
    cost: 1,
    tower: 'frostLoom',
    archetype: 'frost',
    description: 'Build a slowing tower. Costs 4 scrap.',
    unlock: 'profile',
  },
  build_bloom: {
    id: 'build_bloom',
    name: 'Plant Bloom Mortar',
    type: 'tower',
    target: 'buildable',
    cost: 2,
    tower: 'bloomMortar',
    archetype: 'earth',
    description: 'Build a splash tower. Costs 5 scrap.',
    unlock: 'base',
  },
  build_volt: {
    id: 'build_volt',
    name: 'Mount Volt Spire',
    type: 'tower',
    target: 'buildable',
    cost: 2,
    tower: 'voltSpire',
    archetype: 'machine',
    description: 'Build a fast machine tower. Costs 5 scrap.',
    unlock: 'profile',
  },
  build_sun: {
    id: 'build_sun',
    name: 'Cast Sun Forge',
    type: 'tower',
    target: 'buildable',
    cost: 2,
    tower: 'sunForge',
    archetype: 'burn',
    description: 'Build a heavy forge tower. Costs 6 scrap.',
    unlock: 'profile',
  },
  upgrade_damage: {
    id: 'upgrade_damage',
    name: 'Branch: Thornfire',
    type: 'upgrade',
    target: 'tower',
    cost: 1,
    branch: 'damage',
    archetype: 'burn',
    description: 'Chosen tower gains a damage branch.',
    unlock: 'base',
  },
  upgrade_range: {
    id: 'upgrade_range',
    name: 'Branch: Farroot',
    type: 'upgrade',
    target: 'tower',
    cost: 1,
    branch: 'range',
    archetype: 'control',
    description: 'Chosen tower gains a range branch.',
    unlock: 'base',
  },
  upgrade_tempo: {
    id: 'upgrade_tempo',
    name: 'Branch: Quickgear',
    type: 'upgrade',
    target: 'tower',
    cost: 1,
    branch: 'tempo',
    archetype: 'machine',
    description: 'Chosen tower gains a firing tempo branch.',
    unlock: 'profile',
  },
  overclock: {
    id: 'overclock',
    name: 'Overclock Relay',
    type: 'tactic',
    target: 'none',
    cost: 1,
    archetype: 'machine',
    description: 'All towers fire faster for 8 seconds.',
    unlock: 'base',
  },
  field_spanner: {
    id: 'field_spanner',
    name: 'Field Spanner',
    type: 'tool',
    target: 'tower',
    cost: 0,
    archetype: 'economy',
    description: 'Repair and sharpen a tower: +1 level and +1 scrap if damaged enemies are present.',
    unlock: 'base',
  },
  seed_barrier: {
    id: 'seed_barrier',
    name: 'Seed Barrier',
    type: 'tool',
    target: 'none',
    cost: 1,
    archetype: 'control',
    description: 'Gain 2 temporary lives for this run.',
    unlock: 'profile',
  },
  recruit_ranger: {
    id: 'recruit_ranger',
    name: 'Recruit Kite Ranger',
    type: 'hero',
    target: 'none',
    cost: 2,
    hero: 'kiteRanger',
    archetype: 'hero',
    description: 'Recruit an autonomous attack hero.',
    unlock: 'base',
  },
  recruit_bulwark: {
    id: 'recruit_bulwark',
    name: 'Recruit Bulwark',
    type: 'hero',
    target: 'none',
    cost: 2,
    hero: 'bulwark',
    archetype: 'hero',
    description: 'Recruit an autonomous defender.',
    unlock: 'profile',
  },
  recruit_mechanic: {
    id: 'recruit_mechanic',
    name: 'Recruit Mechanic',
    type: 'hero',
    target: 'none',
    cost: 2,
    hero: 'fieldMechanic',
    archetype: 'hero',
    description: 'Recruit an autonomous support hero.',
    unlock: 'profile',
  },
  recruit_chemist: {
    id: 'recruit_chemist',
    name: 'Recruit Cinder Chemist',
    type: 'hero',
    target: 'none',
    cost: 2,
    hero: 'cinderChemist',
    archetype: 'hero',
    description: 'Recruit a reaction-focused support hero.',
    unlock: 'profile',
  },
  spill_water: {
    id: 'spill_water',
    name: 'Spill Water',
    type: 'field',
    target: 'cell',
    cost: 1,
    archetype: 'frost',
    description: 'Paint water on the field. Water drags soft bodies and extinguishes fire into steam.',
    unlock: 'base',
  },
  oil_slick: {
    id: 'oil_slick',
    name: 'Oil Slick',
    type: 'field',
    target: 'cell',
    cost: 1,
    archetype: 'burn',
    description: 'Paint oil on the field. Oil is slow until heated, then flares hard.',
    unlock: 'profile',
  },
  ignite_patch: {
    id: 'ignite_patch',
    name: 'Ignite Patch',
    type: 'field',
    target: 'cell',
    cost: 1,
    archetype: 'burn',
    description: 'Ignite a field cell. Fire turns oil and wood into high-damage reactions.',
    unlock: 'base',
  },
  cryo_seed: {
    id: 'cryo_seed',
    name: 'Cryo Seed',
    type: 'field',
    target: 'cell',
    cost: 1,
    archetype: 'frost',
    description: 'Freeze a patch into ice. Ice stalls most enemies but helps Frost Drones.',
    unlock: 'profile',
  },
  sand_berm: {
    id: 'sand_berm',
    name: 'Sand Berm',
    type: 'field',
    target: 'cell',
    cost: 1,
    archetype: 'earth',
    description: 'Drop sand that falls, piles, and drags pack enemies.',
    unlock: 'profile',
  },
  conductor_rail: {
    id: 'conductor_rail',
    name: 'Conductor Rail',
    type: 'field',
    target: 'cell',
    cost: 1,
    archetype: 'machine',
    description: 'Paint charged metal and gain charge. Conductive enemies chain shock.',
    unlock: 'profile',
  },
  vent_smoke: {
    id: 'vent_smoke',
    name: 'Vent Smoke',
    type: 'field',
    target: 'cell',
    cost: 1,
    archetype: 'control',
    description: 'Vent smoke that pins enemies; ash enemies use it as cover.',
    unlock: 'profile',
  },
  command_attack: {
    id: 'command_attack',
    name: 'Command: Pursue',
    type: 'command',
    target: 'none',
    cost: 0,
    archetype: 'hero',
    description: 'Heroes prioritize lead enemies and gain attack cadence this wave.',
    unlock: 'profile',
  },
  command_guard: {
    id: 'command_guard',
    name: 'Command: Hold',
    type: 'command',
    target: 'none',
    cost: 0,
    archetype: 'hero',
    description: 'Heroes guard the core lane and pin enemies harder this wave.',
    unlock: 'profile',
  },
  command_service: {
    id: 'command_service',
    name: 'Command: Service',
    type: 'command',
    target: 'none',
    cost: 0,
    archetype: 'hero',
    description: 'Support heroes buff towers and field reactions more often this wave.',
    unlock: 'profile',
  },
  salvage_cache: {
    id: 'salvage_cache',
    name: 'Salvage Cache',
    type: 'tool',
    target: 'none',
    cost: 0,
    archetype: 'economy',
    description: 'Gain 2 scrap, then draw a card. Stronger after cache route nodes.',
    unlock: 'profile',
  },
  aether_mill: {
    id: 'aether_mill',
    name: 'Aether Mill',
    type: 'machine',
    target: 'buildable',
    cost: 1,
    archetype: 'economy',
    description: 'Place a machine that produces +1 scrap and +1 charge at each wave end. Costs 3 scrap.',
    unlock: 'profile',
  },
  relic_probe: {
    id: 'relic_probe',
    name: 'Relic Probe',
    type: 'machine',
    target: 'none',
    cost: 1,
    archetype: 'economy',
    description: 'Add a relic reward to the next reward draft.',
    unlock: 'profile',
  },
};

export const TERRAIN_HEURISTIC_DEFS: Record<TerrainHeuristicId, TerrainHeuristicDef> = {
  brookBraids: {
    id: 'brookBraids',
    name: 'Brook Braids',
    description: 'Cold water and sand braid near the route, creating slow lanes and steam setups.',
    materials: ['water', 'water', 'ice', 'sand'],
    tags: ['slow', 'steam', 'soft cover'],
    pocketCount: { min: 4, max: 6 },
    radiusRange: { min: 1, max: 2 },
    thermalRange: { min: 3, max: 28 },
    pathBand: { min: 0, max: 3 },
    padAvoidance: 1.2,
    coreAvoidance: 2.2,
  },
  smokeFen: {
    id: 'smokeFen',
    name: 'Smoke Fen',
    description: 'Oil, smoke, and hot vents settle along flanks where ignition can swing a wave.',
    materials: ['oil', 'oil', 'smoke', 'lava'],
    tags: ['volatile', 'gas', 'ignition'],
    pocketCount: { min: 4, max: 7 },
    radiusRange: { min: 1, max: 2 },
    thermalRange: { min: 42, max: 155 },
    pathBand: { min: 0, max: 4 },
    padAvoidance: 1.5,
    coreAvoidance: 2.5,
  },
  frostMirror: {
    id: 'frostMirror',
    name: 'Frost Mirror',
    description: 'Ice, glass, and chilled water form brittle control pockets away from the core.',
    materials: ['ice', 'ice', 'glass', 'water'],
    tags: ['freeze', 'fracture', 'stall'],
    pocketCount: { min: 5, max: 7 },
    radiusRange: { min: 1, max: 2 },
    thermalRange: { min: 2, max: 32 },
    pathBand: { min: 1, max: 4 },
    padAvoidance: 1.4,
    coreAvoidance: 2.5,
  },
  slagLattice: {
    id: 'slagLattice',
    name: 'Slag Lattice',
    description: 'Hot glass, lava, and oil build a narrow hazard lattice for high-risk burst play.',
    materials: ['glass', 'lava', 'oil', 'smoke'],
    tags: ['hot', 'fracture', 'burst'],
    pocketCount: { min: 3, max: 5 },
    radiusRange: { min: 1, max: 2 },
    thermalRange: { min: 55, max: 245 },
    pathBand: { min: 1, max: 5 },
    padAvoidance: 1.8,
    coreAvoidance: 3,
  },
  dustglassSteppe: {
    id: 'dustglassSteppe',
    name: 'Dustglass Steppe',
    description: 'Sand and glass fields spread into wider backline pockets that reward path shaping.',
    materials: ['sand', 'sand', 'glass', 'smoke'],
    tags: ['earth', 'cover', 'routing'],
    pocketCount: { min: 4, max: 6 },
    radiusRange: { min: 1, max: 3 },
    thermalRange: { min: 18, max: 70 },
    pathBand: { min: 2, max: 7 },
    padAvoidance: 1.1,
    coreAvoidance: 2.2,
  },
};

export const MAP_DEFS: Record<MapId, MapDef> = {
  woodlandRelay: {
    id: 'woodlandRelay',
    name: 'Woodland Relay',
    description: 'Balanced relay lane with wood path, metal pads, and small volatile pockets.',
    unlockWave: 0,
    startingScrap: 8,
    pockets: [
      { point: { x: 6, y: 2 }, material: 'water', thermal: 24 },
      { point: { x: 10, y: 10 }, material: 'ice', thermal: 4 },
      { point: { x: 15, y: 5 }, material: 'oil', thermal: 30 },
      { point: { x: 1, y: 9 }, material: 'sand', thermal: 20 },
    ],
    terrainHeuristics: ['brookBraids', 'smokeFen', 'dustglassSteppe'],
    modifiers: ['baseline', 'mixed-material'],
  },
  floodedBasin: {
    id: 'floodedBasin',
    name: 'Flooded Basin',
    description: 'Water pockets slow soft enemies and create steam when heated.',
    unlockWave: 3,
    startingScrap: 9,
    pockets: [
      { point: { x: 2, y: 6 }, material: 'water', thermal: 22, radius: 2 },
      { point: { x: 8, y: 4 }, material: 'water', thermal: 22, radius: 1 },
      { point: { x: 13, y: 8 }, material: 'ice', thermal: 4, radius: 1 },
    ],
    terrainHeuristics: ['brookBraids', 'frostMirror', 'smokeFen'],
    modifiers: ['wet-path', 'steam-reactions'],
  },
  oilworks: {
    id: 'oilworks',
    name: 'Oilworks',
    description: 'Volatile oil seams reward controlled ignition and punish careless burning.',
    unlockWave: 4,
    startingScrap: 10,
    pockets: [
      { point: { x: 4, y: 5 }, material: 'oil', thermal: 34, radius: 1 },
      { point: { x: 9, y: 7 }, material: 'oil', thermal: 34, radius: 2 },
      { point: { x: 14, y: 4 }, material: 'smoke', thermal: 60, radius: 1 },
    ],
    terrainHeuristics: ['smokeFen', 'slagLattice', 'dustglassSteppe'],
    modifiers: ['volatile', 'high-scrap'],
  },
  glassFoundry: {
    id: 'glassFoundry',
    name: 'Glass Foundry',
    description: 'Glass seams fracture enemies, while lava pockets reshape the path under pressure.',
    unlockWave: 5,
    startingScrap: 11,
    pockets: [
      { point: { x: 5, y: 2 }, material: 'glass', thermal: 35, radius: 1 },
      { point: { x: 11, y: 5 }, material: 'glass', thermal: 35, radius: 1 },
      { point: { x: 15, y: 8 }, material: 'lava', thermal: 245, radius: 1 },
    ],
    terrainHeuristics: ['frostMirror', 'slagLattice', 'dustglassSteppe'],
    modifiers: ['fracture', 'lava-risk'],
  },
};

export const ROUTE_NODE_DEFS: Record<RouteNodeType, RouteNodeDef> = {
  standard: {
    type: 'standard',
    name: 'Stable Line',
    description: 'Normal wave pressure with a balanced reward draft.',
    threat: 1,
    rewardBias: 'card',
  },
  elite: {
    type: 'elite',
    name: 'Elite Breach',
    description: 'Adds elite armor and an extra pack. Reward draft leans relic or hero power.',
    threat: 3,
    rewardBias: 'relic',
  },
  cache: {
    type: 'cache',
    name: 'Salvage Cache',
    description: 'Slightly easier wave; grants scrap and economy cards.',
    threat: 0,
    rewardBias: 'scrap',
  },
  forge: {
    type: 'forge',
    name: 'Field Forge',
    description: 'Hotter field, extra charge, and upgrade-heavy rewards.',
    threat: 2,
    rewardBias: 'upgrade',
  },
  hazard: {
    type: 'hazard',
    name: 'Unstable Biome',
    description: 'Adds volatile terrain and higher shard payout.',
    threat: 2,
    rewardBias: 'card',
  },
};

export const CORE_AXIS_IDS: CoreAxisId[] = ['fieldcraft', 'engineering', 'command', 'archive'];

export const CORE_AXIS_DEFS: Record<CoreAxisId, CoreAxisDef> = {
  fieldcraft: {
    id: 'fieldcraft',
    name: 'Fieldcraft',
    description: 'Improves painted terrain, reactions, and starting charge.',
    cap: 6,
  },
  engineering: {
    id: 'engineering',
    name: 'Engineering',
    description: 'Improves starting scrap, towers, and machine economy.',
    cap: 6,
  },
  command: {
    id: 'command',
    name: 'Command',
    description: 'Improves heroes, route control, and relay durability.',
    cap: 6,
  },
  archive: {
    id: 'archive',
    name: 'Archive',
    description: 'Improves route scouting, reward depth, and planning energy.',
    cap: 6,
  },
};

export const BASE_DECK: CardId[] = [
  'build_ember',
  'build_ember',
  'build_bloom',
  'spill_water',
  'ignite_patch',
  'upgrade_damage',
  'upgrade_range',
  'overclock',
  'field_spanner',
  'recruit_ranger',
];

export const PROFILE_START_UNLOCKS = {
  cards: ['build_frost'] as CardId[],
  relics: ['emberLens', 'clockSeed'] as RelicId[],
  heroes: ['kiteRanger'] as HeroKind[],
  maps: ['woodlandRelay'] as MapId[],
};

export const WAVES: WaveDef[] = [
  { wave: 1, packs: [{ kind: 'siltling', count: 10, gap: 0.78, delay: 0.2 }] },
  {
    wave: 2,
    packs: [
      { kind: 'siltling', count: 12, gap: 0.62, delay: 0.2 },
      { kind: 'thornback', count: 3, gap: 1.4, delay: 4.2 },
    ],
  },
  {
    wave: 3,
    packs: [
      { kind: 'glassWisp', count: 8, gap: 0.58, delay: 0.2 },
      { kind: 'oilSlug', count: 4, gap: 1.1, delay: 2.6 },
      { kind: 'siltling', count: 12, gap: 0.48, delay: 3.5 },
    ],
  },
  {
    wave: 4,
    packs: [
      { kind: 'thornback', count: 8, gap: 0.9, delay: 0.3 },
      { kind: 'glassWisp', count: 10, gap: 0.5, delay: 2.4 },
      { kind: 'frostDrone', count: 5, gap: 0.8, delay: 5.0 },
    ],
  },
  {
    wave: 5,
    packs: [
      { kind: 'ironMite', count: 8, gap: 0.9, delay: 0.2 },
      { kind: 'ashHusk', count: 6, gap: 0.72, delay: 2.4 },
      { kind: 'siltling', count: 20, gap: 0.34, delay: 3.2 },
    ],
  },
  {
    wave: 6,
    packs: [
      { kind: 'ironMite', count: 9, gap: 0.74, delay: 0.2 },
      { kind: 'glassWisp', count: 18, gap: 0.42, delay: 2.8 },
      { kind: 'thornback', count: 7, gap: 0.7, delay: 5.2 },
      { kind: 'oilSlug', count: 8, gap: 0.58, delay: 6.5 },
    ],
  },
  {
    wave: 7,
    packs: [
      { kind: 'relicEater', count: 1, gap: 0.5, delay: 0.2 },
      { kind: 'ironMite', count: 12, gap: 0.58, delay: 1.5 },
      { kind: 'glassWisp', count: 20, gap: 0.35, delay: 5.0 },
      { kind: 'ashHusk', count: 10, gap: 0.6, delay: 7.0 },
    ],
  },
];

export function pointKey(point: GridPoint): string {
  return `${point.x},${point.y}`;
}

export function isBuildPad(point: GridPoint): boolean {
  return BUILD_PADS.some((pad) => pad.x === point.x && pad.y === point.y);
}

export function isInsideGrid(point: GridPoint): boolean {
  return point.x >= 0 && point.x < GRID_COLUMNS && point.y >= 0 && point.y < GRID_ROWS;
}

export function cardPoolForUnlocks(unlockedCards: readonly CardId[]): CardId[] {
  const unlocked = new Set<CardId>([
    'build_ember',
    'build_bloom',
    'spill_water',
    'ignite_patch',
    'upgrade_damage',
    'upgrade_range',
    'overclock',
    'field_spanner',
    'recruit_ranger',
    ...unlockedCards,
  ]);
  return (Object.keys(CARD_DEFS) as CardId[]).filter((cardId) => unlocked.has(cardId));
}
