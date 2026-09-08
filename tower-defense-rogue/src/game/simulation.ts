import {
  BASE_DECK,
  BUILD_PADS,
  CARD_DEFS,
  CORE_CELL,
  CORE_AXIS_DEFS,
  CORE_AXIS_IDS,
  ENEMY_DEFS,
  FINAL_WAVE,
  GRID_COLUMNS,
  GRID_ROWS,
  HERO_DEFS,
  MAP_DEFS,
  PATH,
  RELIC_DEFS,
  ROUTE_NODE_DEFS,
  TERRAIN_HEURISTIC_DEFS,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  TOWER_DEFS,
  WAVES,
  cardPoolForUnlocks,
  isBuildPad,
  isInsideGrid,
  pointKey,
  type CardId,
  type CoreAxisId,
  type GridPoint,
  type HeroRole,
  type HeroKind,
  type RelicId,
  type RouteNodeType,
  type TowerKind,
  type EnemyKind,
  type MapId,
  type MapPocket,
  type MapPocketMaterial,
  type TerrainHeuristicId,
} from './content';
import {
  FLAG,
  MAT,
  createStateSpaceField,
  THERMAL_MASK,
  materialName,
  type FieldSample,
  type StateSpaceField,
} from '../../../engine/browser_state_space';
import {
  addUnique,
  loadProfile,
  resetProfile,
  saveProfile,
  type Profile,
  type StorageLike,
} from './profile';
import { createRng, type Rng } from './rng';

export type RunPhase = 'planning' | 'wave' | 'reward' | 'route' | 'paused' | 'defeat' | 'victory';
export type RewardType = 'card' | 'relic' | 'heroPower' | 'axisMastery' | 'axisKeystone' | 'axisProtocol';
export type InspectTarget = { kind: 'tower'; id: string } | { kind: 'hero'; id: string } | { kind: 'cell'; point: GridPoint } | null;
export type HeroDirective = 'balanced' | 'attack' | 'guard' | 'service';
export type AxisMasteryId =
  | 'fieldcraft_flowChannels'
  | 'fieldcraft_combustionLens'
  | 'engineering_reinforcedPads'
  | 'engineering_machineShop'
  | 'command_vanguardSignal'
  | 'command_relayGuard'
  | 'archive_deepScry'
  | 'archive_routeLedger';
export type AxisTrialId =
  | 'fieldcraft_volatileFront'
  | 'engineering_armoredColumn'
  | 'command_splitAssault'
  | 'archive_relicAudit';
export type AxisKeystoneId =
  | 'fieldcraft_reactionBloom'
  | 'fieldcraft_thermalSiphon'
  | 'engineering_autoForge'
  | 'engineering_millNetwork'
  | 'command_battleStandard'
  | 'command_heroCouncil'
  | 'archive_fateMarket'
  | 'archive_deckScribe';
export type AxisResonanceId =
  | 'fieldcraft_engineering'
  | 'fieldcraft_command'
  | 'fieldcraft_archive'
  | 'engineering_command'
  | 'engineering_archive'
  | 'command_archive';
export type EnemyAffixId = 'plated' | 'hastened' | 'volatileCore' | 'regenerator';
export type MinibossVariantId = 'bulwarkPrime' | 'phaseHerald' | 'siphonMaw';
export type PackSynergyId = 'armoredVanguard' | 'volatileScreen' | 'fractureRush' | 'bossEscort';
export type AxisProtocolRewardId = `axisProtocol:${CoreAxisId}`;
export type RewardId = CardId | RelicId | AxisMasteryId | AxisKeystoneId | AxisProtocolRewardId | `heroPower:${HeroKind}:${string}`;

export interface CardInstance {
  instanceId: string;
  cardId: CardId;
}

export interface TowerState {
  id: string;
  kind: TowerKind;
  x: number;
  y: number;
  level: number;
  branches: {
    damage: number;
    range: number;
    tempo: number;
  };
  cooldown: number;
  buffUntil: number;
  shots: number;
}

export interface HeroState {
  id: string;
  kind: HeroKind;
  x: number;
  y: number;
  cooldown: number;
  powerups: string[];
}

export interface EnemyState {
  id: string;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  distance: number;
  slowUntil: number;
  pinUntil: number;
  exposedUntil: number;
  elite: boolean;
  affixes?: EnemyAffixId[];
  miniboss?: MinibossVariantId | null;
  bountyPaid: boolean;
}

export interface ProjectileState {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  progress: number;
  speed: number;
  kind: 'ember' | 'frost' | 'bloom' | 'volt' | 'sun' | 'hero';
}

export interface MachineState {
  id: string;
  kind: 'aetherMill';
  x: number;
  y: number;
}

export interface SpawnItem {
  at: number;
  kind: EnemyKind;
  elite?: boolean;
  affixes?: EnemyAffixId[];
  miniboss?: MinibossVariantId | null;
  source?: 'authored' | 'route' | 'trial' | 'director' | 'synergy';
}

export interface RewardChoice {
  choiceId: string;
  type: RewardType;
  rewardId: RewardId;
  name: string;
  description: string;
}

export interface AxisMasteryDef {
  id: AxisMasteryId;
  axis: CoreAxisId;
  name: string;
  description: string;
}

export interface AxisTrialDef {
  id: AxisTrialId;
  axis: CoreAxisId;
  name: string;
  description: string;
  threat: number;
  reward: string;
}

export interface AxisTechniqueDef {
  axis: CoreAxisId;
  name: string;
  description: string;
  cost: number;
}

export interface AxisKeystoneDef {
  id: AxisKeystoneId;
  axis: CoreAxisId;
  name: string;
  description: string;
}

export interface AxisResonanceDef {
  id: AxisResonanceId;
  axes: [CoreAxisId, CoreAxisId];
  name: string;
  description: string;
}

export interface AxisBreakthroughDef {
  axis: CoreAxisId;
  tier: number;
  threshold: number;
  name: string;
  description: string;
}

export interface CoreAxisProtocolDef {
  axis: CoreAxisId;
  tier: number;
  rank: number;
  name: string;
  description: string;
}

export interface AxisFocusDef {
  axis: CoreAxisId;
  name: string;
  description: string;
  pressure: number;
}

export interface AxisProtocolRewardDef {
  axis: CoreAxisId;
  name: string;
  description: string;
}

export interface EnemyAffixDef {
  id: EnemyAffixId;
  name: string;
  description: string;
  budget: number;
  hpMultiplier: number;
  speedMultiplier: number;
  armorBonus: number;
  rewardBonus: number;
}

export interface MinibossVariantDef {
  id: MinibossVariantId;
  name: string;
  description: string;
  budget: number;
  hpMultiplier: number;
  speedMultiplier: number;
  armorBonus: number;
  rewardBonus: number;
}

export interface PackSynergyDef {
  id: PackSynergyId;
  name: string;
  description: string;
  budget: number;
}

export interface DifficultyDirectorState {
  wave: number;
  authoredBudget: number;
  directorBudget: number;
  spentBudget: number;
  playerPower: number;
  expectedPower: number;
  adaptivePressure: number;
  routePressure: number;
  trialPressure: number;
  focusAxis: CoreAxisId | null;
  focusPressure: number;
  affixes: EnemyAffixId[];
  minibosses: MinibossVariantId[];
  synergies: PackSynergyId[];
  summary: string;
}

export interface RouteChoice {
  choiceId: string;
  type: RouteNodeType;
  name: string;
  description: string;
  threat: number;
  trial?: AxisTrialId | null;
}

export interface ImpactEvent {
  id: string;
  x: number;
  y: number;
  kind: 'burn' | 'frost' | 'shock' | 'earth' | 'hero' | 'reward';
  ttl: number;
  label: string;
}

export interface FieldSummary {
  hot: number;
  cold: number;
  volatile: number;
  conductive: number;
  smoke: number;
  dominant: string;
}

export type TerrainPocketSource = 'map-anchor' | 'heuristic';

export interface GeneratedTerrainPocket extends MapPocket {
  source: TerrainPocketSource;
}

export interface GeneratedTerrainProfile {
  id: string;
  heuristicId: TerrainHeuristicId;
  name: string;
  description: string;
  tags: string[];
  pockets: GeneratedTerrainPocket[];
  generatedCount: number;
}

export interface AxisDirectiveState {
  axis: CoreAxisId;
  name: string;
  description: string;
  reward: string;
  progress: number;
  target: number;
  completed: boolean;
}

export interface RunState {
  seed: string;
  mapId: MapId;
  terrainProfile: GeneratedTerrainProfile;
  phase: RunPhase;
  previousPhase: RunPhase | null;
  time: number;
  wave: number;
  waveTime: number;
  lives: number;
  baseLives: number;
  scrap: number;
  charge: number;
  energy: number;
  firstCardRefundAvailable: boolean;
  selectedCardInstanceId: string | null;
  inspectTarget: InspectTarget;
  drawPile: CardInstance[];
  hand: CardInstance[];
  discardPile: CardInstance[];
  towers: TowerState[];
  heroes: HeroState[];
  enemies: EnemyState[];
  projectiles: ProjectileState[];
  machines: MachineState[];
  relics: RelicId[];
  rewardChoices: RewardChoice[];
  routeChoices: RouteChoice[];
  activeRoute: RouteNodeType;
  nextRoute: RouteNodeType;
  activeTrial: AxisTrialId | null;
  nextTrial: AxisTrialId | null;
  difficultyDirector: DifficultyDirectorState;
  coreAxes: Record<CoreAxisId, number>;
  axisDirectives: AxisDirectiveState[];
  axisSurges: Record<CoreAxisId, number>;
  axisMasteries: AxisMasteryId[];
  axisKeystones: AxisKeystoneId[];
  axisMomentum: Record<CoreAxisId, number>;
  axisBreakthroughs: Record<CoreAxisId, number>;
  axisFocus: CoreAxisId | null;
  spawnQueue: SpawnItem[];
  overclockUntil: number;
  heroDirective: HeroDirective;
  heroDirectiveUntil: number;
  forceRelicNextReward: boolean;
  runUnlocks: string[];
  stateSpace: StateSpaceField;
  physicsAccumulator: number;
  fieldSummary: FieldSummary;
  impacts: ImpactEvent[];
  physicsEvents: string[];
  log: string[];
  stats: {
    kills: number;
    cardsPlayed: number;
    towersBuilt: number;
    heroesRecruited: number;
    routesTaken: number;
    reactionsTriggered: number;
    fieldCardsPlayed: number;
    towersUpgraded: number;
    machinesBuilt: number;
    commandsIssued: number;
    rewardsClaimed: number;
    axisDirectivesCompleted: number;
    axisSurgesEarned: number;
    axisSurgesSpent: number;
    axisMasteriesClaimed: number;
    axisKeystonesClaimed: number;
    axisMomentumGained: number;
    axisTechniquesUsed: number;
    axisBreakthroughsUnlocked: number;
    axisTrialsTaken: number;
    axisTrialsCleared: number;
  };
}

export interface AppSnapshot {
  profile: Profile;
  run: RunState | null;
}

export type Listener = (snapshot: AppSnapshot) => void;

interface PathSegment {
  start: { x: number; y: number };
  end: { x: number; y: number };
  length: number;
  startDistance: number;
}

const PATH_PIXELS = PATH.map((point) => gridToWorld(point));
const PHYSICS_CELLS_PER_TILE = 4;
const PHYSICS_WIDTH = GRID_COLUMNS * PHYSICS_CELLS_PER_TILE;
const PHYSICS_HEIGHT = GRID_ROWS * PHYSICS_CELLS_PER_TILE;
const AXIS_MOMENTUM_MAX = 6;
const PATH_SEGMENTS: PathSegment[] = PATH_PIXELS.slice(0, -1).map((start, index) => {
  const end = PATH_PIXELS[index + 1];
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const startDistance = PATH_PIXELS.slice(0, index).reduce((total, current, segmentIndex) => {
    const next = PATH_PIXELS[segmentIndex + 1];
    return total + Math.hypot(next.x - current.x, next.y - current.y);
  }, 0);
  return { start, end, length, startDistance };
});
const PATH_LENGTH = PATH_SEGMENTS.reduce((total, segment) => total + segment.length, 0);
const HERO_POWER_POOL: Record<HeroKind, Array<{ id: string; name: string; description: string }>> = {
  kiteRanger: [
    { id: 'splitArrow', name: 'Split Arrow', description: 'Kite Ranger hits one extra nearby target.' },
    { id: 'leadHunter', name: 'Lead Hunter', description: 'Kite Ranger prioritizes and wounds the lead enemy.' },
  ],
  bulwark: [
    { id: 'rootStance', name: 'Root Stance', description: 'Bulwark pins longer and takes pressure off the core.' },
    { id: 'shieldPulse', name: 'Shield Pulse', description: 'Bulwark damages every pinned enemy in range.' },
  ],
  fieldMechanic: [
    { id: 'quickTune', name: 'Quick Tune', description: 'Mechanic buffs tower tempo more aggressively.' },
    { id: 'patchKit', name: 'Patch Kit', description: 'Mechanic repairs one life at each reward phase.' },
  ],
  cinderChemist: [
    { id: 'volatilePrimer', name: 'Volatile Primer', description: 'Cinder Chemist leaves oil primers near lead enemies.' },
    { id: 'steamTriage', name: 'Steam Triage', description: 'Steam and smoke reactions repair charge and pin longer.' },
  ],
};

const COMMAND_PROTOCOL_POWER: Record<HeroKind, string> = {
  kiteRanger: 'splitArrow',
  bulwark: 'rootStance',
  fieldMechanic: 'quickTune',
  cinderChemist: 'volatilePrimer',
};

const ENEMY_BUDGET: Record<EnemyKind, number> = {
  siltling: 1,
  glassWisp: 2,
  thornback: 2,
  oilSlug: 3,
  frostDrone: 3,
  ashHusk: 3,
  ironMite: 4,
  relicEater: 10,
};

export const ENEMY_AFFIX_DEFS: Record<EnemyAffixId, EnemyAffixDef> = {
  plated: {
    id: 'plated',
    name: 'Plated',
    description: 'Extra armor and a modest health lift.',
    budget: 2,
    hpMultiplier: 1.12,
    speedMultiplier: 0.96,
    armorBonus: 2,
    rewardBonus: 1,
  },
  hastened: {
    id: 'hastened',
    name: 'Hastened',
    description: 'Faster movement with a light health lift.',
    budget: 2,
    hpMultiplier: 1.05,
    speedMultiplier: 1.18,
    armorBonus: 0,
    rewardBonus: 1,
  },
  volatileCore: {
    id: 'volatileCore',
    name: 'Volatile Core',
    description: 'Leaves a fire burst when destroyed.',
    budget: 3,
    hpMultiplier: 1.08,
    speedMultiplier: 1,
    armorBonus: 0,
    rewardBonus: 2,
  },
  regenerator: {
    id: 'regenerator',
    name: 'Regenerator',
    description: 'Regains health unless exposed by terrain or command pressure.',
    budget: 3,
    hpMultiplier: 1.16,
    speedMultiplier: 0.92,
    armorBonus: 1,
    rewardBonus: 2,
  },
};

export const MINIBOSS_VARIANT_DEFS: Record<MinibossVariantId, MinibossVariantDef> = {
  bulwarkPrime: {
    id: 'bulwarkPrime',
    name: 'Bulwark Prime',
    description: 'Armored miniboss that anchors a heavy pack.',
    budget: 6,
    hpMultiplier: 1.75,
    speedMultiplier: 0.84,
    armorBonus: 3,
    rewardBonus: 6,
  },
  phaseHerald: {
    id: 'phaseHerald',
    name: 'Phase Herald',
    description: 'Fast miniboss that accelerates fractured packs.',
    budget: 6,
    hpMultiplier: 1.35,
    speedMultiplier: 1.24,
    armorBonus: 0,
    rewardBonus: 5,
  },
  siphonMaw: {
    id: 'siphonMaw',
    name: 'Siphon Maw',
    description: 'Material-eating miniboss that punishes overbuilt terrain.',
    budget: 7,
    hpMultiplier: 1.55,
    speedMultiplier: 0.9,
    armorBonus: 2,
    rewardBonus: 7,
  },
};

export const PACK_SYNERGY_DEFS: Record<PackSynergyId, PackSynergyDef> = {
  armoredVanguard: {
    id: 'armoredVanguard',
    name: 'Armored Vanguard',
    description: 'Armored bodies screen a fast follow-up pack.',
    budget: 3,
  },
  volatileScreen: {
    id: 'volatileScreen',
    name: 'Volatile Screen',
    description: 'Oil, smoke, and ash packs create a burning cover problem.',
    budget: 3,
  },
  fractureRush: {
    id: 'fractureRush',
    name: 'Fracture Rush',
    description: 'Glass and frost packs force quick conductive or steam answers.',
    budget: 3,
  },
  bossEscort: {
    id: 'bossEscort',
    name: 'Boss Escort',
    description: 'The boss wave receives a plated escort and faster pressure.',
    budget: 4,
  },
};

export const AXIS_MASTERY_DEFS: Record<AxisMasteryId, AxisMasteryDef> = {
  fieldcraft_flowChannels: {
    id: 'fieldcraft_flowChannels',
    axis: 'fieldcraft',
    name: 'Flow Channels',
    description: 'Field cards paint wider and recover 1 charge when played.',
  },
  fieldcraft_combustionLens: {
    id: 'fieldcraft_combustionLens',
    axis: 'fieldcraft',
    name: 'Combustion Lens',
    description: 'Damaging terrain reactions hit 25% harder.',
  },
  engineering_reinforcedPads: {
    id: 'engineering_reinforcedPads',
    axis: 'engineering',
    name: 'Reinforced Pads',
    description: 'Tower builds cost 1 less scrap and start 1 level higher.',
  },
  engineering_machineShop: {
    id: 'engineering_machineShop',
    axis: 'engineering',
    name: 'Machine Shop',
    description: 'Aether machines produce twice as much scrap and charge after waves.',
  },
  command_vanguardSignal: {
    id: 'command_vanguardSignal',
    axis: 'command',
    name: 'Vanguard Signal',
    description: 'Heroes gain extra cadence and damage while acting under command.',
  },
  command_relayGuard: {
    id: 'command_relayGuard',
    axis: 'command',
    name: 'Relay Guard',
    description: 'Raise base relay life and strengthen defensive command play.',
  },
  archive_deepScry: {
    id: 'archive_deepScry',
    axis: 'archive',
    name: 'Deep Scry',
    description: 'Reward drafts include one additional choice.',
  },
  archive_routeLedger: {
    id: 'archive_routeLedger',
    axis: 'archive',
    name: 'Route Ledger',
    description: 'Route drafts include one additional node and routes grant setup scrap.',
  },
};

export const AXIS_TRIAL_DEFS: Record<AxisTrialId, AxisTrialDef> = {
  fieldcraft_volatileFront: {
    id: 'fieldcraft_volatileFront',
    axis: 'fieldcraft',
    name: 'Volatile Front',
    description: 'The route opens with burning oil and volatile bodies in the lane.',
    threat: 2,
    reward: '+2 Fieldcraft Momentum and a Fieldcraft Surge if cleared.',
  },
  engineering_armoredColumn: {
    id: 'engineering_armoredColumn',
    axis: 'engineering',
    name: 'Armored Column',
    description: 'Armored machines enter with extra plating and elite pressure.',
    threat: 2,
    reward: '+2 Engineering Momentum, 2 scrap, and an Engineering Surge if cleared.',
  },
  command_splitAssault: {
    id: 'command_splitAssault',
    axis: 'command',
    name: 'Split Assault',
    description: 'Fast enemies arrive in staggered packs that test hero coverage.',
    threat: 2,
    reward: '+2 Command Momentum, 1 relay life, and a Command Surge if cleared.',
  },
  archive_relicAudit: {
    id: 'archive_relicAudit',
    axis: 'archive',
    name: 'Relic Audit',
    description: 'Archive phantoms and relic eaters pressure your unlocked economy.',
    threat: 3,
    reward: '+2 Archive Momentum, relic scouting, and an Archive Surge if cleared.',
  },
};

export const AXIS_TECHNIQUE_DEFS: Record<CoreAxisId, AxisTechniqueDef> = {
  fieldcraft: {
    axis: 'fieldcraft',
    name: 'Catalyze Front',
    description: 'Spend 3 momentum to ignite and expose the lead pack while seeding volatile terrain.',
    cost: 3,
  },
  engineering: {
    axis: 'engineering',
    name: 'Emergency Fabrication',
    description: 'Spend 3 momentum to tune towers, overclock the relay, and recover setup scrap.',
    cost: 3,
  },
  command: {
    axis: 'command',
    name: 'Rally Standard',
    description: 'Spend 3 momentum to rally heroes, recruit a ranger if needed, and brace relay life.',
    cost: 3,
  },
  archive: {
    axis: 'archive',
    name: 'Reindex Hand',
    description: 'Spend 3 momentum to draw cards, gain planning energy, and bias the next relic draft.',
    cost: 3,
  },
};

export const AXIS_KEYSTONE_DEFS: Record<AxisKeystoneId, AxisKeystoneDef> = {
  fieldcraft_reactionBloom: {
    id: 'fieldcraft_reactionBloom',
    axis: 'fieldcraft',
    name: 'Reaction Bloom',
    description: 'Field cards trigger an extra reaction pulse and recover charge.',
  },
  fieldcraft_thermalSiphon: {
    id: 'fieldcraft_thermalSiphon',
    axis: 'fieldcraft',
    name: 'Thermal Siphon',
    description: 'Field cards can convert stored charge into planning energy.',
  },
  engineering_autoForge: {
    id: 'engineering_autoForge',
    axis: 'engineering',
    name: 'Auto Forge',
    description: 'New towers start one level higher and branch work hits harder.',
  },
  engineering_millNetwork: {
    id: 'engineering_millNetwork',
    axis: 'engineering',
    name: 'Mill Network',
    description: 'Aether machines produce an extra scrap and charge cycle after waves.',
  },
  command_battleStandard: {
    id: 'command_battleStandard',
    axis: 'command',
    name: 'Battle Standard',
    description: 'Command cards brace relay life and refresh hero attacks.',
  },
  command_heroCouncil: {
    id: 'command_heroCouncil',
    axis: 'command',
    name: 'Hero Council',
    description: 'New recruits enter with a council vow and immediate action tempo.',
  },
  archive_fateMarket: {
    id: 'archive_fateMarket',
    axis: 'archive',
    name: 'Fate Market',
    description: 'Reward drafts gain another choice and lean toward relic scouting.',
  },
  archive_deckScribe: {
    id: 'archive_deckScribe',
    axis: 'archive',
    name: 'Deck Scribe',
    description: 'Card rewards add a second copy into the run deck.',
  },
};

export const AXIS_RESONANCE_DEFS: Record<AxisResonanceId, AxisResonanceDef> = {
  fieldcraft_engineering: {
    id: 'fieldcraft_engineering',
    axes: ['fieldcraft', 'engineering'],
    name: 'Elemental Machinery',
    description: 'Towers hit harder, and fabrication charges conductive terrain around tuned towers.',
  },
  fieldcraft_command: {
    id: 'fieldcraft_command',
    axes: ['fieldcraft', 'command'],
    name: 'Living Frontline',
    description: 'Catalyzed terrain rallies heroes into an immediate attack directive.',
  },
  fieldcraft_archive: {
    id: 'fieldcraft_archive',
    axes: ['fieldcraft', 'archive'],
    name: 'Terrain Index',
    description: 'Reward drafts deepen when field mastery and archive scouting overlap.',
  },
  engineering_command: {
    id: 'engineering_command',
    axes: ['engineering', 'command'],
    name: 'War Rig',
    description: 'Towers gain tempo, and rallies overclock nearby fortifications.',
  },
  engineering_archive: {
    id: 'engineering_archive',
    axes: ['engineering', 'archive'],
    name: 'Blueprint Ledger',
    description: 'Route drafts gain another branch as archive scouting catalogs machine options.',
  },
  command_archive: {
    id: 'command_archive',
    axes: ['command', 'archive'],
    name: 'Strategic Ledger',
    description: 'Planning starts with an extra card and energy when command intent is indexed.',
  },
};

export const AXIS_BREAKTHROUGH_DEFS: Record<CoreAxisId, AxisBreakthroughDef[]> = {
  fieldcraft: [
    {
      axis: 'fieldcraft',
      tier: 1,
      threshold: 2,
      name: 'Primer Mesh',
      description: 'Field cards paint wider and recover charge as the terrain network wakes up.',
    },
    {
      axis: 'fieldcraft',
      tier: 2,
      threshold: 4,
      name: 'Reaction Current',
      description: 'Terrain reactions hit harder and Catalyze Front becomes cheaper.',
    },
    {
      axis: 'fieldcraft',
      tier: 3,
      threshold: 6,
      name: 'Living Front',
      description: 'Field techniques and reactions seed stronger volatile zones.',
    },
  ],
  engineering: [
    {
      axis: 'engineering',
      tier: 1,
      threshold: 2,
      name: 'Fast Rigging',
      description: 'Towers gain more range and tempo from the axis lattice.',
    },
    {
      axis: 'engineering',
      tier: 2,
      threshold: 4,
      name: 'Machine Rhythm',
      description: 'Machines produce extra income and fabrication becomes cheaper.',
    },
    {
      axis: 'engineering',
      tier: 3,
      threshold: 6,
      name: 'Relay Foundry',
      description: 'Tower damage and emergency fabrication spike during hard waves.',
    },
  ],
  command: [
    {
      axis: 'command',
      tier: 1,
      threshold: 2,
      name: 'Rally Cadence',
      description: 'Hero directives brace relay life and improve hero tempo.',
    },
    {
      axis: 'command',
      tier: 2,
      threshold: 4,
      name: 'Vanguard Chain',
      description: 'Hero commands last longer and Rally Standard becomes cheaper.',
    },
    {
      axis: 'command',
      tier: 3,
      threshold: 6,
      name: 'Dual Standard',
      description: 'Rallies can field a defensive bulwark and push heroes harder.',
    },
  ],
  archive: [
    {
      axis: 'archive',
      tier: 1,
      threshold: 2,
      name: 'Route Index',
      description: 'Route drafts deepen and archive gains can prime relic scouting.',
    },
    {
      axis: 'archive',
      tier: 2,
      threshold: 4,
      name: 'Reward Loom',
      description: 'Reward drafts deepen and Reindex Hand becomes cheaper.',
    },
    {
      axis: 'archive',
      tier: 3,
      threshold: 6,
      name: 'Deep Ledger',
      description: 'Planning draws deeper and starts with extra energy.',
    },
  ],
};

export const CORE_AXIS_PROTOCOL_DEFS: Record<CoreAxisId, CoreAxisProtocolDef[]> = {
  fieldcraft: [
    {
      axis: 'fieldcraft',
      tier: 1,
      rank: 2,
      name: 'Primer Lattice',
      description: 'Field cards recover charge and pulse exposed terrain pressure into nearby enemies.',
    },
    {
      axis: 'fieldcraft',
      tier: 2,
      rank: 4,
      name: 'Reaction Relay',
      description: 'Field pulses slow and expose a wider pack when you paint the state-space field.',
    },
    {
      axis: 'fieldcraft',
      tier: 3,
      rank: 6,
      name: 'Living Biome',
      description: 'Field pulses deal direct reaction damage and count as extra reaction work.',
    },
  ],
  engineering: [
    {
      axis: 'engineering',
      tier: 1,
      rank: 2,
      name: 'Blueprint Ticks',
      description: 'Towers periodically tune themselves after sustained fire.',
    },
    {
      axis: 'engineering',
      tier: 2,
      rank: 4,
      name: 'Auto-Assembler',
      description: 'Blueprint ticks add tower levels and feed charge back into the relay.',
    },
    {
      axis: 'engineering',
      tier: 3,
      rank: 6,
      name: 'Adaptive Foundry',
      description: 'Blueprint ticks also grow the weakest tower branch during combat.',
    },
  ],
  command: [
    {
      axis: 'command',
      tier: 1,
      rank: 2,
      name: 'Standing Orders',
      description: 'New heroes enter ready and directives last longer.',
    },
    {
      axis: 'command',
      tier: 2,
      rank: 4,
      name: 'Veteran Muster',
      description: 'New heroes start with a role power that immediately sharpens their specialty.',
    },
    {
      axis: 'command',
      tier: 3,
      rank: 6,
      name: 'Dual Standard',
      description: 'Command cards can muster the missing specialist that matches the order.',
    },
  ],
  archive: [
    {
      axis: 'archive',
      tier: 1,
      rank: 2,
      name: 'Opening Index',
      description: 'Planning starts with a wider hand and route scouting deepens.',
    },
    {
      axis: 'archive',
      tier: 2,
      rank: 4,
      name: 'Reward Table',
      description: 'Reward drafts gain another slot and keep more deck-building options visible.',
    },
    {
      axis: 'archive',
      tier: 3,
      rank: 6,
      name: 'Deep Ledger',
      description: 'Planning starts with extra energy and reward drafts keep relic scouting live.',
    },
  ],
};

export const AXIS_PROTOCOL_REWARD_DEFS: Record<CoreAxisId, AxisProtocolRewardDef> = {
  fieldcraft: {
    axis: 'fieldcraft',
    name: 'Fieldcraft Infusion',
    description: 'Bank charge, seed the lane, and pulse active Fieldcraft protocol pressure through the front.',
  },
  engineering: {
    axis: 'engineering',
    name: 'Engineering Infusion',
    description: 'Recover scrap, tune the tower line, and accelerate auto-assembly pressure.',
  },
  command: {
    axis: 'command',
    name: 'Command Infusion',
    description: 'Brace relay life, ready heroes, and muster a missing specialist when the protocol is mature.',
  },
  archive: {
    axis: 'archive',
    name: 'Archive Infusion',
    description: 'Index the deck with scout tools and bias the next reward toward relic knowledge.',
  },
};

export const AXIS_FOCUS_DEFS: Record<CoreAxisId, AxisFocusDef> = {
  fieldcraft: {
    axis: 'fieldcraft',
    name: 'Fieldcraft Focus',
    description: 'Seed volatile terrain and bank charge before the wave. Adds pressure to the next director plan.',
    pressure: 1,
  },
  engineering: {
    axis: 'engineering',
    name: 'Engineering Focus',
    description: 'Tune towers and recover setup scrap before the wave. Adds pressure to the next director plan.',
    pressure: 1,
  },
  command: {
    axis: 'command',
    name: 'Command Focus',
    description: 'Brace the relay and ready heroes before the wave. Adds pressure to the next director plan.',
    pressure: 1,
  },
  archive: {
    axis: 'archive',
    name: 'Archive Focus',
    description: 'Index extra cards and bias relic scouting before the wave. Adds pressure to the next director plan.',
    pressure: 1,
  },
};

export function gridToWorld(point: GridPoint): { x: number; y: number } {
  return {
    x: point.x * TILE_SIZE + TILE_SIZE / 2,
    y: point.y * TILE_SIZE + TILE_SIZE / 2,
  };
}

export function worldToGrid(x: number, y: number): GridPoint {
  return {
    x: Math.floor(x / TILE_SIZE),
    y: Math.floor(y / TILE_SIZE),
  };
}

export function pathPosition(distance: number): { x: number; y: number; angle: number } {
  const clamped = Math.max(0, Math.min(distance, PATH_LENGTH));
  const segment = PATH_SEGMENTS.find((candidate) => clamped <= candidate.startDistance + candidate.length) ?? PATH_SEGMENTS[PATH_SEGMENTS.length - 1];
  const local = Math.max(0, Math.min(1, (clamped - segment.startDistance) / segment.length));
  const x = segment.start.x + (segment.end.x - segment.start.x) * local;
  const y = segment.start.y + (segment.end.y - segment.start.y) * local;
  return {
    x,
    y,
    angle: Math.atan2(segment.end.y - segment.start.y, segment.end.x - segment.start.x),
  };
}

export function pathLength(): number {
  return PATH_LENGTH;
}

function nextId(prefix: string, run: RunState): string {
  const value = `${prefix}-${Math.floor(run.time * 1000)}-${run.stats.cardsPlayed}-${run.towers.length}-${run.enemies.length}-${run.projectiles.length}`;
  return value.replace(/\./g, '-');
}

function seededCardInstance(cardId: CardId, index: number, rng: Rng): CardInstance {
  return { cardId, instanceId: `${cardId}-${index}-${rng.int(100000)}` };
}

function log(run: RunState, message: string): void {
  run.log.unshift(message);
  run.log = run.log.slice(0, 8);
}

function pointEquals(a: GridPoint, b: GridPoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distanceToSegment(point: { x: number; y: number }, start: { x: number; y: number }, end: { x: number; y: number }): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distanceBetween(point, start);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distanceBetween(point, { x: start.x + dx * t, y: start.y + dy * t });
}

function distanceToPathTiles(point: GridPoint): number {
  const cellCenter = gridToWorld(point);
  return Math.min(...PATH_SEGMENTS.map((segment) => distanceToSegment(cellCenter, segment.start, segment.end))) / TILE_SIZE;
}

function createCoreAxisSnapshot(profile: Profile): Record<CoreAxisId, number> {
  return CORE_AXIS_IDS.reduce(
    (axes, axis) => {
      axes[axis] = Math.max(0, Math.min(CORE_AXIS_DEFS[axis].cap, profile.coreAxes?.[axis] ?? 0));
      return axes;
    },
    {} as Record<CoreAxisId, number>,
  );
}

function createAxisCounter(value = 0): Record<CoreAxisId, number> {
  return CORE_AXIS_IDS.reduce(
    (axes, axis) => {
      axes[axis] = value;
      return axes;
    },
    {} as Record<CoreAxisId, number>,
  );
}

function axisRank(run: RunState, axis: CoreAxisId): number {
  return run.coreAxes[axis] ?? 0;
}

function axisMomentum(run: RunState, axis: CoreAxisId): number {
  return run.axisMomentum[axis] ?? 0;
}

function axisFocusPower(run: RunState, axis: CoreAxisId): number {
  return Math.max(1, Math.min(4, 1 + Math.floor(axisRank(run, axis) / 2) + (coreAxisProtocolTier(run, axis) >= 3 ? 1 : 0)));
}

export function coreAxisProtocolTier(run: RunState, axis: CoreAxisId): number {
  const rank = axisRank(run, axis);
  return CORE_AXIS_PROTOCOL_DEFS[axis].reduce((tier, protocol) => (rank >= protocol.rank ? Math.max(tier, protocol.tier) : tier), 0);
}

export function activeCoreAxisProtocols(run: RunState): CoreAxisProtocolDef[] {
  return CORE_AXIS_IDS.flatMap((axis) => CORE_AXIS_PROTOCOL_DEFS[axis].filter((protocol) => protocol.tier <= coreAxisProtocolTier(run, axis)));
}

export function axisBreakthroughTier(run: RunState, axis: CoreAxisId): number {
  return run.axisBreakthroughs[axis] ?? 0;
}

function axisResonanceIds(): AxisResonanceId[] {
  return Object.keys(AXIS_RESONANCE_DEFS) as AxisResonanceId[];
}

export function activeAxisResonances(run: RunState): AxisResonanceDef[] {
  return axisResonanceIds()
    .map((resonanceId) => AXIS_RESONANCE_DEFS[resonanceId])
    .filter((resonance) => resonance.axes.every((axis) => axisBreakthroughTier(run, axis) >= 2));
}

function hasAxisResonance(run: RunState, resonanceId: AxisResonanceId): boolean {
  const resonance = AXIS_RESONANCE_DEFS[resonanceId];
  return resonance.axes.every((axis) => axisBreakthroughTier(run, axis) >= 2);
}

export function axisTechniqueCost(run: RunState, axis: CoreAxisId): number {
  const baseCost = AXIS_TECHNIQUE_DEFS[axis].cost;
  const discount =
    (axis === 'fieldcraft' && axisBreakthroughTier(run, axis) >= 2) ||
    (axis === 'engineering' && axisBreakthroughTier(run, axis) >= 2) ||
    (axis === 'command' && axisBreakthroughTier(run, axis) >= 2) ||
    (axis === 'archive' && axisBreakthroughTier(run, axis) >= 2)
      ? 1
      : 0;
  return Math.max(1, baseCost - discount);
}

function applyAxisBreakthroughImmediate(run: RunState, axis: CoreAxisId, tier: number): void {
  if (axis === 'fieldcraft') {
    run.charge += tier === 1 ? 1 : 2;
    addImpact(run, gridToWorld(CORE_CELL), 'shock', '+field');
  } else if (axis === 'engineering') {
    run.scrap += tier === 1 ? 1 : 2;
    for (const tower of run.towers) {
      tower.buffUntil = Math.max(tower.buffUntil, run.time + 3 + tier);
    }
    addImpact(run, gridToWorld(CORE_CELL), 'shock', '+rig');
  } else if (axis === 'command') {
    run.lives = Math.min(run.baseLives + 5, run.lives + 1);
    run.heroDirectiveUntil = Math.max(run.heroDirectiveUntil, run.time + 4 + tier);
    addImpact(run, gridToWorld(CORE_CELL), 'hero', '+rally');
  } else {
    if (run.phase === 'planning') {
      run.energy += tier === 3 ? 2 : 1;
    } else {
      run.forceRelicNextReward = true;
    }
    addImpact(run, gridToWorld(CORE_CELL), 'reward', '+index');
  }
}

function refreshAxisBreakthroughs(run: RunState, axis: CoreAxisId): void {
  const currentTier = axisBreakthroughTier(run, axis);
  const momentum = axisMomentum(run, axis);
  const unlocked = AXIS_BREAKTHROUGH_DEFS[axis].filter((breakthrough) => momentum >= breakthrough.threshold);
  const nextTier = unlocked.reduce((maxTier, breakthrough) => Math.max(maxTier, breakthrough.tier), currentTier);
  if (nextTier <= currentTier) return;

  for (let tier = currentTier + 1; tier <= nextTier; tier += 1) {
    const breakthrough = AXIS_BREAKTHROUGH_DEFS[axis].find((candidate) => candidate.tier === tier);
    if (!breakthrough) continue;
    run.axisBreakthroughs[axis] = tier;
    run.stats.axisBreakthroughsUnlocked += 1;
    applyAxisBreakthroughImmediate(run, axis, tier);
    log(run, `${CORE_AXIS_DEFS[axis].name} Breakthrough ${tier}: ${breakthrough.name}.`);
  }
}

function addAxisMomentum(run: RunState, axis: CoreAxisId, amount = 1): void {
  const previous = axisMomentum(run, axis);
  const next = Math.min(AXIS_MOMENTUM_MAX, previous + Math.max(0, amount));
  if (next === previous) return;
  run.axisMomentum[axis] = next;
  run.stats.axisMomentumGained += next - previous;
  refreshAxisBreakthroughs(run, axis);
  if (previous < 3 && next >= 3) {
    log(run, `${CORE_AXIS_DEFS[axis].name} Momentum reached tier 1.`);
  } else if (previous < AXIS_MOMENTUM_MAX && next >= AXIS_MOMENTUM_MAX) {
    log(run, `${CORE_AXIS_DEFS[axis].name} Momentum is fully charged.`);
  }
}

function spendAxisMomentum(run: RunState, axis: CoreAxisId, amount: number): boolean {
  const current = axisMomentum(run, axis);
  if (current < amount) return false;
  run.axisMomentum[axis] = current - amount;
  return true;
}

function fieldRadius(run: RunState, base: number): number {
  const masteryBonus = hasAxisMastery(run, 'fieldcraft_flowChannels') ? 0.12 : 0;
  return base + axisRank(run, 'fieldcraft') * 0.06 + axisMomentum(run, 'fieldcraft') * 0.025 + axisBreakthroughTier(run, 'fieldcraft') * 0.04 + masteryBonus;
}

function hasAxisMastery(run: RunState, masteryId: AxisMasteryId): boolean {
  return run.axisMasteries.includes(masteryId);
}

function hasAxisMasteryForAxis(run: RunState, axis: CoreAxisId): boolean {
  return run.axisMasteries.some((masteryId) => AXIS_MASTERY_DEFS[masteryId].axis === axis);
}

function hasAxisKeystone(run: RunState, keystoneId: AxisKeystoneId): boolean {
  return run.axisKeystones.includes(keystoneId);
}

function hasAxisKeystoneForAxis(run: RunState, axis: CoreAxisId): boolean {
  return run.axisKeystones.some((keystoneId) => AXIS_KEYSTONE_DEFS[keystoneId].axis === axis);
}

export function axisSurgeForCard(cardId: CardId): CoreAxisId | null {
  const card = CARD_DEFS[cardId];
  if (card.type === 'field') return 'fieldcraft';
  if (card.type === 'hero' || card.type === 'command' || cardId === 'seed_barrier') return 'command';
  if (cardId === 'salvage_cache' || cardId === 'relic_probe') return 'archive';
  if (card.type === 'tower' || card.type === 'upgrade' || card.type === 'machine' || card.type === 'tool' || card.type === 'tactic') {
    return 'engineering';
  }
  return null;
}

export function effectiveCardCost(run: RunState, cardId: CardId): number {
  const surgeAxis = axisSurgeForCard(cardId);
  if (surgeAxis && run.axisSurges[surgeAxis] > 0) {
    return 0;
  }
  return CARD_DEFS[cardId].cost;
}

export function canUseAxisTechnique(run: RunState, axis: CoreAxisId): boolean {
  return (run.phase === 'planning' || run.phase === 'wave') && axisMomentum(run, axis) >= axisTechniqueCost(run, axis);
}

function axisMasteriesForAxis(axis: CoreAxisId): AxisMasteryDef[] {
  return (Object.keys(AXIS_MASTERY_DEFS) as AxisMasteryId[])
    .map((masteryId) => AXIS_MASTERY_DEFS[masteryId])
    .filter((mastery) => mastery.axis === axis);
}

function axisKeystonesForAxis(axis: CoreAxisId): AxisKeystoneDef[] {
  return (Object.keys(AXIS_KEYSTONE_DEFS) as AxisKeystoneId[])
    .map((keystoneId) => AXIS_KEYSTONE_DEFS[keystoneId])
    .filter((keystone) => keystone.axis === axis);
}

function makeAxisMasteryRewardChoices(run: RunState, rng: Rng): RewardChoice[] {
  const pendingAxis = CORE_AXIS_IDS.find(
    (axis) => run.axisDirectives.some((directive) => directive.axis === axis && directive.completed) && !hasAxisMasteryForAxis(run, axis),
  );
  if (!pendingAxis) return [];

  return rng.shuffle(axisMasteriesForAxis(pendingAxis)).map((mastery) => ({
    choiceId: `axisMastery:${mastery.id}:${run.wave}`,
    type: 'axisMastery',
    rewardId: mastery.id,
    name: `${CORE_AXIS_DEFS[mastery.axis].name}: ${mastery.name}`,
    description: mastery.description,
  }));
}

function makeAxisKeystoneRewardChoices(run: RunState, rng: Rng): RewardChoice[] {
  const pendingAxis = CORE_AXIS_IDS.find((axis) => axisBreakthroughTier(run, axis) >= 2 && !hasAxisKeystoneForAxis(run, axis));
  if (!pendingAxis) return [];

  return rng.shuffle(axisKeystonesForAxis(pendingAxis)).map((keystone) => ({
    choiceId: `axisKeystone:${keystone.id}:${run.wave}`,
    type: 'axisKeystone',
    rewardId: keystone.id,
    name: `${CORE_AXIS_DEFS[keystone.axis].name}: ${keystone.name}`,
    description: keystone.description,
  }));
}

function makeAxisProtocolRewardChoices(run: RunState, rng: Rng): RewardChoice[] {
  return rng
    .shuffle(CORE_AXIS_IDS.filter((axis) => coreAxisProtocolTier(run, axis) > 0))
    .map((axis) => {
      const tier = coreAxisProtocolTier(run, axis);
      const def = AXIS_PROTOCOL_REWARD_DEFS[axis];
      const protocol = CORE_AXIS_PROTOCOL_DEFS[axis].find((candidate) => candidate.tier === tier);
      return {
        choiceId: `axisProtocol:${axis}:${run.wave}`,
        type: 'axisProtocol',
        rewardId: `axisProtocol:${axis}` as AxisProtocolRewardId,
        name: `${CORE_AXIS_DEFS[axis].name}: ${def.name}`,
        description: `${def.description} Active protocol: ${protocol?.name ?? 'Protocol'} P${tier}.`,
      };
    });
}

function applyAxisMastery(run: RunState, masteryId: AxisMasteryId): void {
  if (run.axisMasteries.includes(masteryId)) return;

  run.axisMasteries.push(masteryId);
  run.stats.axisMasteriesClaimed += 1;
  const mastery = AXIS_MASTERY_DEFS[masteryId];

  if (masteryId === 'fieldcraft_flowChannels') {
    run.charge += 1;
  } else if (masteryId === 'engineering_machineShop') {
    run.scrap += Math.max(1, run.machines.length);
  } else if (masteryId === 'command_relayGuard') {
    run.baseLives += 1;
    run.lives = Math.min(run.baseLives + 4, run.lives + 2);
  } else if (masteryId === 'archive_deepScry') {
    run.forceRelicNextReward = true;
  } else if (masteryId === 'archive_routeLedger') {
    run.scrap += 1;
  }

  addImpact(run, gridToWorld(CORE_CELL), 'reward', mastery.name);
  addAxisMomentum(run, mastery.axis, 2);
  log(run, `Axis Mastery claimed: ${CORE_AXIS_DEFS[mastery.axis].name} / ${mastery.name}.`);
}

function applyAxisKeystone(run: RunState, keystoneId: AxisKeystoneId): void {
  if (run.axisKeystones.includes(keystoneId)) return;

  run.axisKeystones.push(keystoneId);
  run.stats.axisKeystonesClaimed += 1;
  const keystone = AXIS_KEYSTONE_DEFS[keystoneId];

  if (keystone.axis === 'fieldcraft') {
    run.charge += keystoneId === 'fieldcraft_reactionBloom' ? 2 : 1;
  } else if (keystone.axis === 'engineering') {
    run.scrap += keystoneId === 'engineering_millNetwork' ? 3 : 2;
    for (const tower of run.towers) {
      tower.buffUntil = Math.max(tower.buffUntil, run.time + 5);
    }
  } else if (keystone.axis === 'command') {
    run.lives = Math.min(run.baseLives + 5, run.lives + 2);
    for (const hero of run.heroes) {
      hero.cooldown = Math.min(hero.cooldown, -0.25);
      if (keystoneId === 'command_heroCouncil' && !hero.powerups.includes('councilVow')) {
        hero.powerups.push('councilVow');
      }
    }
  } else {
    run.forceRelicNextReward = true;
    run.energy += keystoneId === 'archive_fateMarket' ? 1 : 0;
  }

  addImpact(run, gridToWorld(CORE_CELL), 'reward', keystone.name);
  addAxisMomentum(run, keystone.axis, 1);
  log(run, `Axis Keystone claimed: ${CORE_AXIS_DEFS[keystone.axis].name} / ${keystone.name}.`);
}

function applyAxisProtocolReward(run: RunState, axis: CoreAxisId, rng: Rng): void {
  const tier = coreAxisProtocolTier(run, axis);
  if (tier <= 0) return;

  addAxisMomentum(run, axis, tier >= 3 ? 2 : 1);
  const core = gridToWorld(CORE_CELL);

  if (axis === 'fieldcraft') {
    const point = PATH[Math.max(1, Math.min(PATH.length - 2, 1 + rng.int(Math.max(1, PATH.length - 2))))];
    const position = gridToWorld(point);
    run.charge += 1 + tier;
    paintFieldCircle(run, position, fieldRadius(run, 0.62 + tier * 0.08), MAT.OIL, 74, FLAG.PRESSURIZED | FLAG.PLAYER_OWNED);
    if (tier >= 2) {
      paintFieldCircle(run, { x: position.x + TILE_SIZE * 0.42, y: position.y }, fieldRadius(run, 0.4), MAT.FIRE, 255, FLAG.BURNING | FLAG.PLAYER_OWNED);
    }
    applyFieldcraftProtocolPulse(run, position, AXIS_PROTOCOL_REWARD_DEFS.fieldcraft.name);
    run.stats.reactionsTriggered += 1;
  } else if (axis === 'engineering') {
    run.scrap += 2 + tier;
    const tuned = run.towers.slice(0, 2 + Math.floor(tier / 2));
    for (const tower of tuned) {
      tower.buffUntil = Math.max(tower.buffUntil, run.time + 5 + tier);
      tower.cooldown = Math.min(tower.cooldown, 0);
      if (tier >= 2) {
        tower.level += 1;
      }
      if (tier >= 3) {
        const branchCandidates: Array<keyof TowerState['branches']> = ['damage', 'range', 'tempo'];
        const branch = branchCandidates.sort((a, b) => tower.branches[a] - tower.branches[b])[0];
        tower.branches[branch] += 1;
      }
    }
    if (tuned.length > 0) {
      run.stats.towersUpgraded += tuned.length;
      addImpact(run, gridToWorld(tuned[0]), 'shock', `E${tier}`);
    } else {
      run.discardPile.push(seededCardInstance('field_spanner', run.stats.cardsPlayed + run.discardPile.length + 2000, rng));
      addImpact(run, core, 'reward', '+tool');
    }
  } else if (axis === 'command') {
    run.lives = Math.min(run.baseLives + 6, run.lives + 1 + tier);
    const musterKind: HeroKind =
      tier >= 3 && !run.heroes.some((hero) => hero.kind === 'bulwark')
        ? 'bulwark'
        : tier >= 2 && !run.heroes.some((hero) => hero.kind === 'fieldMechanic')
          ? 'fieldMechanic'
          : 'kiteRanger';
    if (!run.heroes.some((hero) => hero.kind === musterKind)) {
      const before = run.heroes.length;
      const home = heroHome(musterKind);
      const powerups = tier >= 2 ? [COMMAND_PROTOCOL_POWER[musterKind]] : [];
      run.heroes.push({
        id: nextId(`hero-${musterKind}`, run),
        kind: musterKind,
        x: home.x,
        y: home.y,
        cooldown: -0.5,
        powerups,
      });
      if (run.heroes.length > before) run.stats.heroesRecruited += 1;
    }
    for (const hero of run.heroes) {
      hero.cooldown = Math.min(hero.cooldown, -0.35);
    }
    run.heroDirective = 'guard';
    run.heroDirectiveUntil = Number.POSITIVE_INFINITY;
    addImpact(run, core, 'hero', `C${tier}`);
  } else {
    run.forceRelicNextReward = true;
    run.scrap += 1;
    run.discardPile.push(seededCardInstance('salvage_cache', run.stats.cardsPlayed + run.discardPile.length + 3000, rng));
    if (tier >= 2) {
      run.discardPile.push(seededCardInstance('relic_probe', run.stats.cardsPlayed + run.discardPile.length + 3001, rng));
    }
    if (tier >= 3) {
      run.energy += 1;
      drawCards(run, 1, rng);
    }
    addImpact(run, core, 'reward', `A${tier}`);
  }

  log(run, `${CORE_AXIS_DEFS[axis].name} Protocol infused: ${AXIS_PROTOCOL_REWARD_DEFS[axis].name}.`);
}

function recruitFocusedHero(run: RunState, heroKind: HeroKind, tier: number): void {
  if (run.heroes.some((hero) => hero.kind === heroKind)) return;
  const home = heroHome(heroKind);
  const powerups = tier >= 2 ? [COMMAND_PROTOCOL_POWER[heroKind]] : [];
  run.heroes.push({
    id: nextId(`hero-${heroKind}`, run),
    kind: heroKind,
    x: home.x,
    y: home.y,
    cooldown: -0.5,
    powerups,
  });
  run.stats.heroesRecruited += 1;
}

function applyAxisFocusWaveStart(run: RunState, rng: Rng): void {
  const axis = run.axisFocus;
  if (!axis) return;

  const power = axisFocusPower(run, axis);
  addAxisMomentum(run, axis, 1);
  const core = gridToWorld(CORE_CELL);

  if (axis === 'fieldcraft') {
    const pathIndex = Math.max(1, Math.min(PATH.length - 2, 1 + rng.int(Math.max(1, PATH.length - 2))));
    const position = gridToWorld(PATH[pathIndex]);
    run.charge += power;
    paintFieldCircle(run, position, fieldRadius(run, 0.62 + power * 0.05), MAT.OIL, 76, FLAG.PRESSURIZED | FLAG.PLAYER_OWNED);
    if (power >= 2) {
      paintFieldCircle(run, { x: position.x + TILE_SIZE * 0.45, y: position.y }, fieldRadius(run, 0.38), MAT.FIRE, 255, FLAG.BURNING | FLAG.PLAYER_OWNED);
    }
    if (power >= 3) {
      paintFieldCircle(run, { x: position.x - TILE_SIZE * 0.42, y: position.y }, fieldRadius(run, 0.42), MAT.WATER, 24, FLAG.PLAYER_OWNED);
    }
    addImpact(run, position, 'burn', `F${power}`);
    logPhysics(run, `${AXIS_FOCUS_DEFS.fieldcraft.name} primed the lane before the wave.`);
  } else if (axis === 'engineering') {
    run.scrap += Math.max(1, Math.floor(power / 2));
    const tuned = run.towers.slice(0, 1 + Math.floor(power / 2));
    for (const tower of tuned) {
      tower.buffUntil = Math.max(tower.buffUntil, run.time + 5 + power);
      tower.cooldown = Math.min(tower.cooldown, 0);
      if (power >= 3) tower.level += 1;
    }
    if (tuned.length > 0) {
      run.stats.towersUpgraded += tuned.length;
      addImpact(run, gridToWorld(tuned[0]), 'shock', `E${power}`);
    } else {
      run.discardPile.push(seededCardInstance('field_spanner', run.stats.cardsPlayed + run.discardPile.length + 4000, rng));
      addImpact(run, core, 'reward', '+tool');
    }
    log(run, `${AXIS_FOCUS_DEFS.engineering.name} tuned the line before the wave.`);
  } else if (axis === 'command') {
    run.lives = Math.min(run.baseLives + 6, run.lives + 1 + Math.floor(power / 2));
    if (power >= 3 && run.heroes.length === 0) {
      recruitFocusedHero(run, 'kiteRanger', coreAxisProtocolTier(run, 'command'));
    }
    for (const hero of run.heroes) {
      hero.cooldown = Math.min(hero.cooldown, -0.25);
    }
    run.heroDirective = 'guard';
    run.heroDirectiveUntil = Math.max(run.heroDirectiveUntil, run.time + 10 + power * 2);
    addImpact(run, core, 'hero', `C${power}`);
    log(run, `${AXIS_FOCUS_DEFS.command.name} braced the relay before the wave.`);
  } else {
    drawCards(run, 1 + (power >= 4 ? 1 : 0), rng);
    if (power >= 2) run.energy += 1;
    if (power >= 3) run.forceRelicNextReward = true;
    if (power >= 4) {
      run.discardPile.push(seededCardInstance('relic_probe', run.stats.cardsPlayed + run.discardPile.length + 5000, rng));
    }
    addImpact(run, core, 'reward', `A${power}`);
    log(run, `${AXIS_FOCUS_DEFS.archive.name} indexed the deck before the wave.`);
  }
}

function axisTrialIds(): AxisTrialId[] {
  return Object.keys(AXIS_TRIAL_DEFS) as AxisTrialId[];
}

function completeAxisTrial(run: RunState): void {
  if (!run.activeTrial) return;
  const trial = AXIS_TRIAL_DEFS[run.activeTrial];
  run.stats.axisTrialsCleared += 1;
  run.axisSurges[trial.axis] += 1;
  run.stats.axisSurgesEarned += 1;
  addAxisMomentum(run, trial.axis, 2);

  if (trial.axis === 'fieldcraft') {
    run.charge += 2;
  } else if (trial.axis === 'engineering') {
    run.scrap += 2;
    for (const tower of run.towers) {
      tower.buffUntil = Math.max(tower.buffUntil, run.time + 5);
    }
  } else if (trial.axis === 'command') {
    run.lives = Math.min(run.baseLives + 4, run.lives + 1);
    if (run.heroes.length > 0) {
      run.heroDirective = 'guard';
      run.heroDirectiveUntil = Math.max(run.heroDirectiveUntil, run.time + 8);
    }
  } else {
    run.energy += 1;
    run.forceRelicNextReward = true;
  }

  addImpact(run, gridToWorld(CORE_CELL), 'reward', trial.name);
  log(run, `Axis Trial cleared: ${CORE_AXIS_DEFS[trial.axis].name} / ${trial.name}.`);
  run.activeTrial = null;
}

function applyAxisTrialWaveStart(run: RunState, rng: Rng): void {
  if (!run.activeTrial) return;
  const trial = AXIS_TRIAL_DEFS[run.activeTrial];
  const pathIndex = Math.max(1, Math.min(PATH.length - 2, 1 + rng.int(Math.max(1, PATH.length - 2))));
  const point = PATH[pathIndex];
  const world = gridToWorld(point);

  if (run.activeTrial === 'fieldcraft_volatileFront') {
    paintFieldCircle(run, world, 0.9, MAT.OIL, 82, FLAG.PRESSURIZED);
    paintFieldCircle(run, gridToWorld(PATH[Math.min(PATH.length - 2, pathIndex + 1)]), 0.55, MAT.FIRE, 255, FLAG.BURNING);
    addImpact(run, world, 'burn', 'front');
    logPhysics(run, 'Volatile Front seeded burning oil into the route.');
  } else if (run.activeTrial === 'engineering_armoredColumn') {
    paintFieldCircle(run, world, 0.65, MAT.METAL, 72, FLAG.CONDUCTING);
    addImpact(run, world, 'shock', 'armor');
    logPhysics(run, 'Armored Column left conductive wreckage on the lane.');
  } else if (run.activeTrial === 'command_splitAssault') {
    paintFieldCircle(run, world, 0.75, MAT.SMOKE, 70, FLAG.PRESSURIZED);
    addImpact(run, world, 'hero', 'split');
    logPhysics(run, 'Split Assault obscured the route with pressurized smoke.');
  } else {
    paintFieldCircle(run, world, 0.7, MAT.GLASS, 45);
    addImpact(run, world, 'reward', 'audit');
    logPhysics(run, 'Relic Audit crystallized unstable archive traces in the lane.');
  }

  log(run, `Axis Trial active: ${CORE_AXIS_DEFS[trial.axis].name} / ${trial.name}.`);
}

function axisDirectiveTarget(axis: CoreAxisId, rank: number): number {
  const rankPressure = Math.min(3, Math.floor(rank / 2));
  if (axis === 'engineering') return 2 + rankPressure;
  if (axis === 'archive') return 2 + rankPressure;
  return 3 + rankPressure;
}

function createAxisDirectives(coreAxes: Record<CoreAxisId, number>): AxisDirectiveState[] {
  return CORE_AXIS_IDS.map((axis) => {
    const def = CORE_AXIS_DEFS[axis];
    const target = axisDirectiveTarget(axis, coreAxes[axis] ?? 0);
    if (axis === 'fieldcraft') {
      return {
        axis,
        name: `${def.name}: Shape the Field`,
        description: 'Play field cards or trigger material reactions.',
        reward: '+2 charge',
        progress: 0,
        target,
        completed: false,
      };
    }
    if (axis === 'engineering') {
      return {
        axis,
        name: `${def.name}: Build the Line`,
        description: 'Build, branch, tune, or install structures.',
        reward: '+3 scrap and tower tune',
        progress: 0,
        target,
        completed: false,
      };
    }
    if (axis === 'command') {
      return {
        axis,
        name: `${def.name}: Direct the Crew`,
        description: 'Recruit heroes, issue commands, or take routes.',
        reward: '+1 relay life',
        progress: 0,
        target,
        completed: false,
      };
    }
    return {
      axis,
      name: `${def.name}: Read the Pattern`,
      description: 'Claim rewards and choose route nodes.',
      reward: '+1 energy and relic-scout',
      progress: 0,
      target,
      completed: false,
    };
  });
}

function axisDirectiveProgress(run: RunState, axis: CoreAxisId): number {
  if (axis === 'fieldcraft') {
    return run.stats.fieldCardsPlayed + Math.floor(run.stats.reactionsTriggered / 2);
  }
  if (axis === 'engineering') {
    return run.stats.towersBuilt + run.stats.towersUpgraded + run.stats.machinesBuilt;
  }
  if (axis === 'command') {
    return run.stats.heroesRecruited + run.stats.commandsIssued + Math.min(2, run.stats.routesTaken);
  }
  return run.stats.rewardsClaimed + run.stats.routesTaken;
}

function grantAxisDirectiveReward(run: RunState, directive: AxisDirectiveState, rng: Rng): void {
  directive.completed = true;
  run.stats.axisDirectivesCompleted += 1;
  run.stats.axisSurgesEarned += 1;
  run.axisSurges[directive.axis] += 1;
  addAxisMomentum(run, directive.axis, 2);
  const origin = gridToWorld(CORE_CELL);

  if (directive.axis === 'fieldcraft') {
    run.charge += 2;
    addImpact(run, origin, 'shock', '+2');
  } else if (directive.axis === 'engineering') {
    run.scrap += 3;
    for (const tower of run.towers) {
      tower.buffUntil = Math.max(tower.buffUntil, run.time + 4);
    }
    addImpact(run, origin, 'reward', '+3');
  } else if (directive.axis === 'command') {
    run.lives = Math.min(run.baseLives + 4, run.lives + 1);
    if (run.heroes.length > 0) {
      run.heroDirective = 'guard';
      run.heroDirectiveUntil = Math.max(run.heroDirectiveUntil, run.time + 8);
    }
    addImpact(run, origin, 'hero', '+life');
  } else {
    run.energy += 1;
    run.forceRelicNextReward = true;
    if (run.phase === 'planning' || run.phase === 'wave') {
      drawCards(run, 1, rng);
    }
    addImpact(run, origin, 'reward', '+draft');
  }

  log(run, `${directive.name} complete: ${directive.reward}. ${CORE_AXIS_DEFS[directive.axis].name} Surge armed.`);
}

function refreshAxisDirectives(run: RunState, rng: Rng): void {
  for (const directive of run.axisDirectives) {
    directive.progress = Math.min(directive.target, axisDirectiveProgress(run, directive.axis));
    if (!directive.completed && directive.progress >= directive.target) {
      grantAxisDirectiveReward(run, directive, rng);
    }
  }
}

function fieldPointFromWorld(run: RunState, position: { x: number; y: number }): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(run.stateSpace.width - 1, Math.floor((position.x / WORLD_WIDTH) * run.stateSpace.width))),
    y: Math.max(0, Math.min(run.stateSpace.height - 1, Math.floor((position.y / WORLD_HEIGHT) * run.stateSpace.height))),
  };
}

function paintFieldCircle(run: RunState, position: { x: number; y: number }, radiusTiles: number, material: number, thermal?: number, flags = 0): void {
  const point = fieldPointFromWorld(run, position);
  run.stateSpace.paintCircle(point.x, point.y, Math.max(1, radiusTiles * PHYSICS_CELLS_PER_TILE), material, thermal, flags);
}

function paintFieldTile(run: RunState, point: GridPoint, material: number, thermal?: number, flags = 0): void {
  const startX = point.x * PHYSICS_CELLS_PER_TILE;
  const startY = point.y * PHYSICS_CELLS_PER_TILE;
  for (let y = startY; y < startY + PHYSICS_CELLS_PER_TILE; y += 1) {
    for (let x = startX; x < startX + PHYSICS_CELLS_PER_TILE; x += 1) {
      run.stateSpace.setCell(x, y, material, thermal, flags);
    }
  }
}

function materialForPocket(material: string): number {
  if (material === 'water') return MAT.WATER;
  if (material === 'ice') return MAT.ICE;
  if (material === 'oil') return MAT.OIL;
  if (material === 'sand') return MAT.SAND;
  if (material === 'glass') return MAT.GLASS;
  if (material === 'lava') return MAT.LAVA;
  if (material === 'smoke') return MAT.SMOKE;
  return MAT.AIR;
}

const TERRAIN_THERMAL_BANDS: Record<MapPocketMaterial, { min: number; max: number }> = {
  water: { min: 16, max: 32 },
  ice: { min: 1, max: 8 },
  oil: { min: 28, max: 84 },
  sand: { min: 16, max: 55 },
  glass: { min: 28, max: 92 },
  lava: { min: 180, max: THERMAL_MASK },
  smoke: { min: 50, max: 95 },
};

function randomIntInRange(rng: Rng, min: number, max: number): number {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return low + rng.int(high - low + 1);
}

function thermalForGeneratedPocket(rng: Rng, material: MapPocketMaterial, range: { min: number; max: number }): number {
  const band = TERRAIN_THERMAL_BANDS[material];
  const min = Math.max(band.min, range.min);
  const max = Math.min(band.max, range.max);
  return randomIntInRange(rng, min <= max ? min : band.min, min <= max ? max : band.max);
}

function terrainCandidateCells(
  heuristic: (typeof TERRAIN_HEURISTIC_DEFS)[TerrainHeuristicId],
  pockets: readonly GeneratedTerrainPocket[],
  radius: number,
  relaxed: boolean,
): GridPoint[] {
  const cells: GridPoint[] = [];
  const pathMin = Math.max(0, heuristic.pathBand.min - (relaxed ? 1.5 : 0));
  const pathMax = heuristic.pathBand.max + (relaxed ? 2.5 : 0);
  const padAvoidance = Math.max(0, heuristic.padAvoidance - (relaxed ? 0.8 : 0));
  const coreAvoidance = Math.max(1.4, heuristic.coreAvoidance - (relaxed ? 0.8 : 0));

  for (let y = 1; y < GRID_ROWS - 1; y += 1) {
    for (let x = 1; x < GRID_COLUMNS - 1; x += 1) {
      const point = { x, y };
      if (isBuildPad(point) || pointEquals(point, CORE_CELL)) continue;
      if (distanceBetween(point, CORE_CELL) < coreAvoidance) continue;
      if (Math.min(...BUILD_PADS.map((pad) => distanceBetween(point, pad))) < padAvoidance) continue;
      const pathDistance = distanceToPathTiles(point);
      if (pathDistance < pathMin || pathDistance > pathMax) continue;
      if (pockets.some((pocket) => distanceBetween(point, pocket.point) < Math.max(1.2, radius + (pocket.radius ?? 1) - 0.25))) continue;
      cells.push(point);
    }
  }

  return cells;
}

function chooseTerrainCandidate(
  rng: Rng,
  heuristic: (typeof TERRAIN_HEURISTIC_DEFS)[TerrainHeuristicId],
  pockets: readonly GeneratedTerrainPocket[],
  radius: number,
): GridPoint {
  const targetPathDistance = (heuristic.pathBand.min + heuristic.pathBand.max) / 2;
  const strictCandidates = terrainCandidateCells(heuristic, pockets, radius, false);
  const candidates = strictCandidates.length > 0 ? strictCandidates : terrainCandidateCells(heuristic, pockets, radius, true);
  const fallback =
    candidates.length > 0
      ? candidates
      : terrainCandidateCells(
          {
            ...heuristic,
            pathBand: { min: 0, max: GRID_COLUMNS },
            padAvoidance: 0,
            coreAvoidance: 1.4,
          },
          pockets,
          1,
          true,
        );

  if (fallback.length === 0) {
    return { x: 1 + rng.int(GRID_COLUMNS - 2), y: 1 + rng.int(GRID_ROWS - 2) };
  }

  return fallback
    .map((point) => ({
      point,
      score: Math.abs(distanceToPathTiles(point) - targetPathDistance) + rng.next() * 0.85,
    }))
    .sort((a, b) => a.score - b.score)[0].point;
}

export function generateStartingTerrain(mapId: MapId, rng: Rng): GeneratedTerrainProfile {
  const map = MAP_DEFS[mapId];
  const heuristicPool: readonly TerrainHeuristicId[] = map.terrainHeuristics.length > 0 ? map.terrainHeuristics : ['brookBraids'];
  const heuristicId = rng.pick(heuristicPool);
  const heuristic = TERRAIN_HEURISTIC_DEFS[heuristicId];
  const generatedCount = randomIntInRange(rng, heuristic.pocketCount.min, heuristic.pocketCount.max);
  const pockets: GeneratedTerrainPocket[] = map.pockets.map((pocket) => ({
    ...pocket,
    point: { ...pocket.point },
    source: 'map-anchor',
  }));

  for (let index = 0; index < generatedCount; index += 1) {
    const material = rng.pick(heuristic.materials);
    const radius = randomIntInRange(rng, heuristic.radiusRange.min, heuristic.radiusRange.max);
    const point = chooseTerrainCandidate(rng, heuristic, pockets, radius);
    pockets.push({
      point,
      material,
      thermal: thermalForGeneratedPocket(rng, material, heuristic.thermalRange),
      radius,
      source: 'heuristic',
    });
  }

  return {
    id: `${mapId}:${heuristicId}:${rng.int(1000000).toString(36)}`,
    heuristicId,
    name: heuristic.name,
    description: heuristic.description,
    tags: heuristic.tags,
    pockets,
    generatedCount,
  };
}

function createDefenseField(mapId: MapId = 'woodlandRelay', pockets: readonly MapPocket[] = MAP_DEFS[mapId].pockets): StateSpaceField {
  const field = createStateSpaceField(PHYSICS_WIDTH, PHYSICS_HEIGHT, MAT.AIR);
  for (let x = 0; x < PHYSICS_WIDTH; x += 1) {
    field.setCell(x, 0, MAT.STONE);
    field.setCell(x, PHYSICS_HEIGHT - 1, MAT.STONE);
  }
  for (let y = 0; y < PHYSICS_HEIGHT; y += 1) {
    field.setCell(0, y, MAT.STONE);
    field.setCell(PHYSICS_WIDTH - 1, y, MAT.STONE);
  }

  const seedRun = { stateSpace: field } as RunState;
  for (let index = 0; index < PATH.length - 1; index += 1) {
    const start = PATH[index];
    const end = PATH[index + 1];
    const steps = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
    for (let step = 0; step <= steps; step += 1) {
      const point = {
        x: Math.round(start.x + ((end.x - start.x) * step) / Math.max(1, steps)),
        y: Math.round(start.y + ((end.y - start.y) * step) / Math.max(1, steps)),
      };
      if (isInsideGrid(point)) {
        paintFieldTile(seedRun, point, MAT.WOOD, 30);
      }
    }
  }
  for (const pad of BUILD_PADS) {
    paintFieldTile(seedRun, pad, MAT.METAL, 22, FLAG.PLAYER_OWNED);
  }
  paintFieldTile(seedRun, CORE_CELL, MAT.METAL, 35, FLAG.PLAYER_OWNED);
  for (const pocket of pockets) {
    if (pocket.radius && pocket.radius > 1) {
      paintFieldCircle(seedRun, gridToWorld(pocket.point), pocket.radius, materialForPocket(pocket.material), pocket.thermal);
    } else {
      paintFieldTile(seedRun, pocket.point, materialForPocket(pocket.material), pocket.thermal);
    }
  }
  return field;
}

function sampleFieldAtWorld(run: RunState, position: { x: number; y: number }): FieldSample {
  const point = fieldPointFromWorld(run, position);
  return run.stateSpace.sample(point.x, point.y);
}

function logPhysics(run: RunState, message: string): void {
  if (run.physicsEvents[0] === message) return;
  run.physicsEvents.unshift(message);
  run.physicsEvents = run.physicsEvents.slice(0, 4);
}

function addImpact(run: RunState, position: { x: number; y: number }, kind: ImpactEvent['kind'], label: string): void {
  run.impacts.push({
    id: nextId(`impact-${kind}`, run),
    x: position.x,
    y: position.y,
    kind,
    label,
    ttl: 0.85,
  });
  run.impacts = run.impacts.slice(-24);
}

function updateImpacts(run: RunState, deltaSeconds: number): void {
  for (const impact of run.impacts) {
    impact.ttl -= deltaSeconds;
  }
  run.impacts = run.impacts.filter((impact) => impact.ttl > 0);
}

function summarizeField(field: StateSpaceField): FieldSummary {
  const counts = new Map<number, number>();
  let hot = 0;
  let cold = 0;
  let volatile = 0;
  let conductive = 0;
  let smoke = 0;

  for (let y = 0; y < field.height; y += 1) {
    for (let x = 0; x < field.width; x += 1) {
      const sample = field.sample(x, y);
      if (sample.material === MAT.AIR || sample.material === MAT.STONE) continue;
      counts.set(sample.material, (counts.get(sample.material) ?? 0) + 1);
      if (sample.thermal >= 120 || sample.material === MAT.FIRE || sample.material === MAT.LAVA) hot += 1;
      if (sample.material === MAT.ICE || sample.thermal <= 8) cold += 1;
      if (sample.material === MAT.OIL || sample.material === MAT.WOOD) volatile += 1;
      if (sample.material === MAT.METAL || sample.flags & FLAG.CONDUCTING) conductive += 1;
      if (sample.material === MAT.SMOKE || sample.material === MAT.STEAM) smoke += 1;
    }
  }

  const dominantMaterial = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? MAT.AIR;
  return {
    hot,
    cold,
    volatile,
    conductive,
    smoke,
    dominant: materialName(dominantMaterial),
  };
}

function makeDeck(profile: Profile, rng: Rng): CardInstance[] {
  const cards = [...BASE_DECK];
  for (const unlockedCard of profile.unlockedCards) {
    if (!cards.includes(unlockedCard)) {
      cards.push(unlockedCard);
    }
  }
  return rng.shuffle(cards).map((cardId, index) => seededCardInstance(cardId, index, rng));
}

function emptyDifficultyDirectorState(wave = 1): DifficultyDirectorState {
  return {
    wave,
    authoredBudget: 0,
    directorBudget: 0,
    spentBudget: 0,
    playerPower: 0,
    expectedPower: 0,
    adaptivePressure: 0,
    routePressure: 0,
    trialPressure: 0,
    focusAxis: null,
    focusPressure: 0,
    affixes: [],
    minibosses: [],
    synergies: [],
    summary: 'Director has not planned this wave yet.',
  };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function uniqueSorted<T extends string>(values: Iterable<T>): T[] {
  return [...new Set(values)].sort();
}

function spawnAffixes(spawn: SpawnItem): EnemyAffixId[] {
  return spawn.affixes ?? [];
}

function enemyAffixes(enemy: EnemyState): EnemyAffixId[] {
  return enemy.affixes ?? [];
}

function hasEnemyAffix(enemy: EnemyState, affix: EnemyAffixId): boolean {
  return enemyAffixes(enemy).includes(affix);
}

function spawnHpMultiplier(spawn: SpawnItem): number {
  const affixMultiplier = spawnAffixes(spawn).reduce((multiplier, affix) => multiplier * ENEMY_AFFIX_DEFS[affix].hpMultiplier, 1);
  const minibossMultiplier = spawn.miniboss ? MINIBOSS_VARIANT_DEFS[spawn.miniboss].hpMultiplier : 1;
  return affixMultiplier * minibossMultiplier;
}

function enemySpeedMultiplier(enemy: EnemyState): number {
  const affixMultiplier = enemyAffixes(enemy).reduce((multiplier, affix) => multiplier * ENEMY_AFFIX_DEFS[affix].speedMultiplier, 1);
  const minibossMultiplier = enemy.miniboss ? MINIBOSS_VARIANT_DEFS[enemy.miniboss].speedMultiplier : 1;
  return affixMultiplier * minibossMultiplier;
}

function enemyArmorBonus(enemy: EnemyState): number {
  const affixArmor = enemyAffixes(enemy).reduce((total, affix) => total + ENEMY_AFFIX_DEFS[affix].armorBonus, 0);
  const minibossArmor = enemy.miniboss ? MINIBOSS_VARIANT_DEFS[enemy.miniboss].armorBonus : 0;
  return affixArmor + minibossArmor;
}

function enemyRewardBonus(enemy: EnemyState): number {
  const affixReward = enemyAffixes(enemy).reduce((total, affix) => total + ENEMY_AFFIX_DEFS[affix].rewardBonus, 0);
  const minibossReward = enemy.miniboss ? MINIBOSS_VARIANT_DEFS[enemy.miniboss].rewardBonus : 0;
  return affixReward + minibossReward;
}

function enemyPressureName(enemy: EnemyState): string {
  const def = ENEMY_DEFS[enemy.kind];
  const minibossName = enemy.miniboss ? `${MINIBOSS_VARIANT_DEFS[enemy.miniboss].name} ` : '';
  const affixNames = enemyAffixes(enemy).map((affix) => ENEMY_AFFIX_DEFS[affix].name);
  const affixText = affixNames.length > 0 ? `${affixNames.join(' ')} ` : '';
  return `${enemy.elite ? 'Elite ' : ''}${affixText}${minibossName}${def.name}`.trim();
}

function spawnBudget(spawn: SpawnItem): number {
  const affixBudget = spawnAffixes(spawn).reduce((total, affix) => total + ENEMY_AFFIX_DEFS[affix].budget, 0);
  const minibossBudget = spawn.miniboss ? MINIBOSS_VARIANT_DEFS[spawn.miniboss].budget : 0;
  return ENEMY_BUDGET[spawn.kind] + (spawn.elite ? 3 : 0) + affixBudget + minibossBudget;
}

function scheduleBudget(schedule: SpawnItem[]): number {
  return schedule.reduce((total, spawn) => total + spawnBudget(spawn), 0);
}

function playerPowerScore(run: RunState): number {
  const towerPower = run.towers.reduce(
    (total, tower) => total + 2 + tower.level * 1.15 + tower.branches.damage * 0.9 + tower.branches.range * 0.55 + tower.branches.tempo * 0.7,
    0,
  );
  const heroPower = run.heroes.reduce((total, hero) => total + 2.6 + hero.powerups.length * 0.8, 0);
  const machinePower = run.machines.length * 1.8;
  const resourcePower = run.scrap * 0.24 + run.charge * 0.18 + run.hand.length * 0.28 + run.relics.length * 1.15;
  const axisPower =
    CORE_AXIS_IDS.reduce(
      (total, axis) => total + axisRank(run, axis) * 0.32 + axisMomentum(run, axis) * 0.22 + axisBreakthroughTier(run, axis) * 0.9,
      0,
    ) +
    run.axisMasteries.length * 0.85 +
    run.axisKeystones.length * 1.25 +
    activeAxisResonances(run).length * 0.7;
  return Math.round((towerPower + heroPower + machinePower + resourcePower + axisPower) * 10) / 10;
}

function expectedPowerForWave(run: RunState): number {
  const routeThreat = ROUTE_NODE_DEFS[run.activeRoute].threat;
  const trialThreat = run.activeTrial ? AXIS_TRIAL_DEFS[run.activeTrial].threat : 0;
  return Math.round((6 + run.wave * 4.2 + routeThreat * 1.4 + trialThreat * 1.8) * 10) / 10;
}

function detectPackSynergies(schedule: SpawnItem[], route: RouteNodeType, trial: AxisTrialId | null): PackSynergyId[] {
  const kinds = new Set(schedule.map((spawn) => spawn.kind));
  const synergies: PackSynergyId[] = [];
  const hasArmored = kinds.has('thornback') || kinds.has('ironMite');
  const hasFast = kinds.has('glassWisp') || kinds.has('frostDrone');
  const hasVolatile = kinds.has('oilSlug') || kinds.has('ashHusk') || route === 'hazard' || trial === 'fieldcraft_volatileFront';

  if (hasArmored && hasFast) synergies.push('armoredVanguard');
  if (hasVolatile && (kinds.has('oilSlug') || kinds.has('ashHusk') || route === 'hazard')) synergies.push('volatileScreen');
  if (hasFast && (kinds.has('glassWisp') || kinds.has('frostDrone'))) synergies.push('fractureRush');
  if (kinds.has('relicEater') || trial === 'archive_relicAudit') synergies.push('bossEscort');
  return uniqueSorted(synergies);
}

function addAffixToSpawn(spawn: SpawnItem, affix: EnemyAffixId): boolean {
  const affixes = spawn.affixes ?? [];
  if (affixes.includes(affix)) return false;
  spawn.affixes = [...affixes, affix];
  return true;
}

function addSpawn(schedule: SpawnItem[], spawn: SpawnItem): void {
  schedule.push(spawn);
  schedule.sort((a, b) => a.at - b.at);
}

function chooseDirectorEnemy(run: RunState, rng: Rng): EnemyKind {
  if (run.wave >= 6) return rng.pick<EnemyKind>(['ironMite', 'glassWisp', 'ashHusk', 'oilSlug', 'frostDrone']);
  if (run.wave >= 4) return rng.pick<EnemyKind>(['thornback', 'glassWisp', 'oilSlug', 'frostDrone', 'ashHusk']);
  if (run.wave >= 2) return rng.pick<EnemyKind>(['siltling', 'thornback', 'glassWisp', 'oilSlug']);
  return rng.pick<EnemyKind>(['siltling', 'siltling', 'thornback']);
}

function chooseDirectorAffix(run: RunState, synergies: PackSynergyId[], rng: Rng): EnemyAffixId {
  const pool: EnemyAffixId[] = [];
  if (run.activeRoute === 'elite' || synergies.includes('armoredVanguard')) pool.push('plated', 'regenerator');
  if (run.activeRoute === 'hazard' || synergies.includes('volatileScreen')) pool.push('volatileCore');
  if (synergies.includes('fractureRush') || run.wave >= 3) pool.push('hastened');
  if (run.wave >= 5) pool.push('regenerator', 'plated');
  return rng.pick(pool.length > 0 ? pool : ['hastened', 'plated']);
}

function chooseMinibossVariant(run: RunState, synergies: PackSynergyId[], rng: Rng): MinibossVariantId {
  if (synergies.includes('bossEscort') || run.activeTrial === 'archive_relicAudit') return 'siphonMaw';
  if (synergies.includes('armoredVanguard') || run.activeRoute === 'elite') return 'bulwarkPrime';
  if (synergies.includes('fractureRush')) return 'phaseHerald';
  return rng.pick<MinibossVariantId>(['bulwarkPrime', 'phaseHerald', 'siphonMaw']);
}

function minibossKindFor(run: RunState, miniboss: MinibossVariantId): EnemyKind {
  if (miniboss === 'phaseHerald') return 'glassWisp';
  if (miniboss === 'siphonMaw') return run.wave >= 7 ? 'relicEater' : 'oilSlug';
  return run.wave >= 5 ? 'ironMite' : 'thornback';
}

function applySynergyPressure(schedule: SpawnItem[], run: RunState, synergy: PackSynergyId, rng: Rng): void {
  if (synergy === 'armoredVanguard') {
    let applied = 0;
    for (const spawn of schedule) {
      if (applied >= 2) break;
      if ((spawn.kind === 'thornback' || spawn.kind === 'ironMite') && addAffixToSpawn(spawn, 'plated')) {
        spawn.source = spawn.source ?? 'synergy';
        applied += 1;
      }
    }
    addSpawn(schedule, { kind: 'glassWisp', at: 2.4 + rng.next() * 1.6, affixes: ['hastened'], source: 'synergy' });
  } else if (synergy === 'volatileScreen') {
    const volatileTarget = schedule.find((spawn) => spawn.kind === 'oilSlug' || spawn.kind === 'ashHusk');
    if (volatileTarget) {
      addAffixToSpawn(volatileTarget, 'volatileCore');
      volatileTarget.source = volatileTarget.source ?? 'synergy';
    }
    addSpawn(schedule, { kind: run.wave >= 5 ? 'ashHusk' : 'oilSlug', at: 3.0 + rng.next() * 2.2, affixes: ['volatileCore'], source: 'synergy' });
  } else if (synergy === 'fractureRush') {
    let applied = 0;
    for (const spawn of schedule) {
      if (applied >= 3) break;
      if ((spawn.kind === 'glassWisp' || spawn.kind === 'frostDrone') && addAffixToSpawn(spawn, 'hastened')) {
        spawn.source = spawn.source ?? 'synergy';
        applied += 1;
      }
    }
    addSpawn(schedule, { kind: run.wave >= 4 ? 'frostDrone' : 'glassWisp', at: 1.6 + rng.next() * 2.4, source: 'synergy' });
  } else {
    addSpawn(schedule, { kind: run.wave >= 5 ? 'ironMite' : 'thornback', at: 1.0, affixes: ['plated'], source: 'synergy' });
    addSpawn(schedule, { kind: 'glassWisp', at: 3.4, affixes: ['hastened'], source: 'synergy' });
  }
}

function scheduleAuthoredWave(wave: number, route: RouteNodeType, trial: AxisTrialId | null = null): SpawnItem[] {
  const waveDef = WAVES[Math.max(0, Math.min(WAVES.length - 1, wave - 1))];
  let schedule: SpawnItem[] = [];
  for (const pack of waveDef.packs) {
    for (let index = 0; index < pack.count; index += 1) {
      schedule.push({ kind: pack.kind, at: pack.delay + index * pack.gap, source: 'authored' });
    }
  }
  if (route === 'elite') {
    const eliteKind: EnemyKind = wave >= 5 ? 'ironMite' : wave >= 3 ? 'thornback' : 'siltling';
    schedule.push({ kind: eliteKind, at: 1.5, elite: true, source: 'route' });
    schedule.push({ kind: wave >= 4 ? 'oilSlug' : 'siltling', at: 2.2, source: 'route' });
  }
  if (route === 'hazard') {
    schedule.push({ kind: wave >= 4 ? 'ashHusk' : 'oilSlug', at: 2.0, source: 'route' });
    schedule.push({ kind: wave >= 5 ? 'frostDrone' : 'glassWisp', at: 5.0, source: 'route' });
  }
  if (route === 'forge') {
    schedule.push({ kind: wave >= 4 ? 'ironMite' : 'glassWisp', at: 3.2, elite: wave >= 5, source: 'route' });
  }
  if (route === 'cache') {
    schedule = schedule.filter((_, index) => index % 5 !== 0);
  }

  if (trial === 'fieldcraft_volatileFront') {
    schedule.push({ kind: 'oilSlug', at: 1.0, elite: wave >= 4, source: 'trial' });
    schedule.push({ kind: wave >= 4 ? 'ashHusk' : 'siltling', at: 3.6, source: 'trial' });
  } else if (trial === 'engineering_armoredColumn') {
    schedule.push({ kind: wave >= 4 ? 'ironMite' : 'thornback', at: 1.2, elite: true, source: 'trial' });
    schedule.push({ kind: wave >= 5 ? 'frostDrone' : 'thornback', at: 4.5, source: 'trial' });
  } else if (trial === 'command_splitAssault') {
    schedule.push({ kind: 'glassWisp', at: 0.9, source: 'trial' });
    schedule.push({ kind: 'glassWisp', at: 2.1, source: 'trial' });
    schedule.push({ kind: wave >= 4 ? 'frostDrone' : 'siltling', at: 5.4, source: 'trial' });
  } else if (trial === 'archive_relicAudit') {
    schedule.push({ kind: wave >= 4 ? 'relicEater' : 'glassWisp', at: 2.0, elite: wave < 4, source: 'trial' });
    schedule.push({ kind: 'glassWisp', at: 4.8, source: 'trial' });
  }

  return schedule.sort((a, b) => a.at - b.at);
}

function scheduleDirectedWave(run: RunState, rng: Rng): SpawnItem[] {
  const schedule = scheduleAuthoredWave(run.wave, run.activeRoute, run.activeTrial).map((spawn) => ({
    ...spawn,
    affixes: spawn.affixes ? [...spawn.affixes] : undefined,
  }));
  const authoredBudget = scheduleBudget(schedule);
  const routePressure = ROUTE_NODE_DEFS[run.activeRoute].threat;
  const trialPressure = run.activeTrial ? AXIS_TRIAL_DEFS[run.activeTrial].threat : 0;
  const playerPower = playerPowerScore(run);
  const expectedPower = expectedPowerForWave(run);
  const adaptivePressure = clampInt((playerPower - expectedPower) / 4, -3, 6);
  const focusPressure = run.axisFocus ? AXIS_FOCUS_DEFS[run.axisFocus].pressure + Math.floor(axisFocusPower(run, run.axisFocus) / 2) : 0;
  const baseDirectorBudget = Math.max(0, Math.floor(run.wave * 1.25) + routePressure * 2 + trialPressure * 2 + focusPressure - (run.activeRoute === 'cache' ? 2 : 0));
  let remainingBudget = Math.max(0, baseDirectorBudget + adaptivePressure);
  let spentBudget = 0;
  const activeAffixes = new Set<EnemyAffixId>();
  const activeMinibosses = new Set<MinibossVariantId>();
  const activeSynergies = new Set<PackSynergyId>();
  const detectedSynergies = detectPackSynergies(schedule, run.activeRoute, run.activeTrial);

  for (const synergy of detectedSynergies) {
    const cost = PACK_SYNERGY_DEFS[synergy].budget;
    if (remainingBudget < cost) continue;
    applySynergyPressure(schedule, run, synergy, rng);
    activeSynergies.add(synergy);
    remainingBudget -= cost;
    spentBudget += cost;
  }

  if (run.wave >= 3 && remainingBudget >= 6) {
    const miniboss = chooseMinibossVariant(run, detectedSynergies, rng);
    const cost = MINIBOSS_VARIANT_DEFS[miniboss].budget;
    if (remainingBudget >= cost) {
      addSpawn(schedule, {
        kind: minibossKindFor(run, miniboss),
        at: 1.1 + rng.next() * 2.2,
        elite: true,
        miniboss,
        source: 'director',
      });
      activeMinibosses.add(miniboss);
      remainingBudget -= cost;
      spentBudget += cost;
    }
  }

  const affixPasses = Math.min(5, Math.max(1, run.wave + Math.max(0, adaptivePressure)));
  for (let pass = 0; pass < affixPasses; pass += 1) {
    const affix = chooseDirectorAffix(run, detectedSynergies, rng);
    const cost = ENEMY_AFFIX_DEFS[affix].budget;
    if (remainingBudget < cost) continue;
    const candidates = rng.shuffle(schedule.filter((spawn) => spawn.kind !== 'relicEater' && !spawn.miniboss && !spawnAffixes(spawn).includes(affix)));
    const target = candidates[0];
    if (!target || !addAffixToSpawn(target, affix)) continue;
    target.source = target.source ?? 'director';
    activeAffixes.add(affix);
    remainingBudget -= cost;
    spentBudget += cost;
  }

  let guard = 0;
  while (remainingBudget >= 1 && guard < 12) {
    guard += 1;
    const kind = chooseDirectorEnemy(run, rng);
    const cost = ENEMY_BUDGET[kind];
    if (cost > remainingBudget) {
      if (remainingBudget >= ENEMY_BUDGET.siltling) {
        addSpawn(schedule, { kind: 'siltling', at: 1.2 + rng.next() * 8, source: 'director' });
        remainingBudget -= ENEMY_BUDGET.siltling;
        spentBudget += ENEMY_BUDGET.siltling;
      }
      break;
    }
    addSpawn(schedule, { kind, at: 1.2 + rng.next() * 8.5, source: 'director' });
    remainingBudget -= cost;
    spentBudget += cost;
  }

  const directorBudget = Math.max(0, baseDirectorBudget + adaptivePressure);
  const summaryParts = [
    `budget ${spentBudget}/${directorBudget}`,
    `power ${playerPower}/${expectedPower}`,
    adaptivePressure > 0 ? `adaptive +${adaptivePressure}` : adaptivePressure < 0 ? `adaptive ${adaptivePressure}` : 'adaptive even',
  ];
  if (activeSynergies.size > 0) summaryParts.push(`${activeSynergies.size} synergy`);
  if (activeMinibosses.size > 0) summaryParts.push(`${activeMinibosses.size} miniboss`);
  if (run.axisFocus) summaryParts.push(`${CORE_AXIS_DEFS[run.axisFocus].name.toLowerCase()} focus +${focusPressure}`);
  const scheduledAffixes = new Set<EnemyAffixId>([...activeAffixes, ...schedule.flatMap((spawn) => spawnAffixes(spawn))]);
  const scheduledMinibosses = new Set<MinibossVariantId>([
    ...activeMinibosses,
    ...schedule.map((spawn) => spawn.miniboss).filter((miniboss): miniboss is MinibossVariantId => Boolean(miniboss)),
  ]);

  run.difficultyDirector = {
    wave: run.wave,
    authoredBudget,
    directorBudget,
    spentBudget,
    playerPower,
    expectedPower,
    adaptivePressure,
    routePressure,
    trialPressure,
    focusAxis: run.axisFocus,
    focusPressure,
    affixes: uniqueSorted(scheduledAffixes),
    minibosses: uniqueSorted(scheduledMinibosses),
    synergies: uniqueSorted(activeSynergies),
    summary: summaryParts.join(' / '),
  };

  return schedule;
}

function drawCards(run: RunState, count: number, rng: Rng): void {
  for (let index = 0; index < count; index += 1) {
    if (run.drawPile.length === 0 && run.discardPile.length > 0) {
      run.drawPile = rng.shuffle(run.discardPile);
      run.discardPile = [];
      log(run, 'Discard reshuffled into the draw pile.');
    }

    const card = run.drawPile.shift();
    if (!card) {
      return;
    }
    run.hand.push(card);
  }
}

function routeDescription(type: RouteNodeType, wave: number, trial: AxisTrialId | null = null): string {
  const def = ROUTE_NODE_DEFS[type];
  const pressure = def.threat <= 0 ? 'low' : def.threat >= 3 ? 'high' : 'medium';
  const trialText = trial ? ` Axis Trial: ${AXIS_TRIAL_DEFS[trial].name}.` : '';
  return `${def.description} Wave ${wave} pressure: ${pressure}.${trialText}`;
}

function makeRouteChoices(run: RunState, rng: Rng): RouteChoice[] {
  const nextWave = Math.min(FINAL_WAVE, run.wave);
  const archiveProtocol = coreAxisProtocolTier(run, 'archive');
  const slots =
    3 +
    (run.relics.includes('biomeAtlas') ? 1 : 0) +
    (axisRank(run, 'archive') >= 2 ? 1 : 0) +
    (archiveProtocol >= 1 ? 1 : 0) +
    (hasAxisMastery(run, 'archive_routeLedger') ? 1 : 0) +
    (axisMomentum(run, 'archive') >= 5 ? 1 : 0) +
    (axisBreakthroughTier(run, 'archive') >= 1 ? 1 : 0) +
    (hasAxisResonance(run, 'engineering_archive') ? 1 : 0);
  const routeTypes = rng.shuffle<RouteNodeType>(['standard', 'cache', 'forge', 'elite', 'hazard']);
  const selected: RouteNodeType[] = ['standard'];
  for (const route of routeTypes) {
    if (selected.length >= slots) break;
    if (!selected.includes(route)) {
      selected.push(route);
    }
  }
  const trials = rng.shuffle(axisTrialIds());
  return selected.map((type, index) => {
    const def = ROUTE_NODE_DEFS[type];
    const trial = index === 0 ? null : trials[(index - 1) % trials.length];
    const trialThreat = trial ? AXIS_TRIAL_DEFS[trial].threat : 0;
    return {
      choiceId: `route:${type}:${trial ?? 'none'}:${nextWave}:${index}`,
      type,
      name: def.name,
      description: routeDescription(type, nextWave, trial),
      threat: def.threat + trialThreat,
      trial,
    };
  });
}

function beginPlanning(run: RunState, rng: Rng): void {
  run.phase = 'planning';
  run.waveTime = 0;
  run.selectedCardInstanceId = null;
  run.routeChoices = [];
  run.firstCardRefundAvailable = run.relics.includes('livingLedger');
  const archiveDirectiveBonus = run.axisDirectives.some((directive) => directive.axis === 'archive' && directive.completed) ? 1 : 0;
  const archiveProtocol = coreAxisProtocolTier(run, 'archive');
  run.energy =
    3 +
    (run.relics.includes('clockSeed') ? 1 : 0) +
    (axisRank(run, 'archive') >= 4 ? 1 : 0) +
    archiveDirectiveBonus +
    (axisMomentum(run, 'archive') >= AXIS_MOMENTUM_MAX ? 1 : 0) +
    (axisBreakthroughTier(run, 'archive') >= 3 ? 1 : 0) +
    (hasAxisResonance(run, 'command_archive') ? 1 : 0) +
    (archiveProtocol >= 3 ? 1 : 0);
  run.activeRoute = run.nextRoute;
  run.activeTrial = run.nextTrial;
  run.nextTrial = null;
  run.heroDirective = 'balanced';
  run.heroDirectiveUntil = 0;
  run.discardPile.push(...run.hand);
  run.hand = [];
  drawCards(
    run,
    5 +
      (axisRank(run, 'archive') >= 5 ? 1 : 0) +
      (archiveProtocol >= 1 ? 1 : 0) +
      (axisMomentum(run, 'archive') >= 5 ? 1 : 0) +
      (axisBreakthroughTier(run, 'archive') >= 3 ? 1 : 0) +
      (hasAxisResonance(run, 'command_archive') ? 1 : 0),
    rng,
  );
  const trialText = run.activeTrial ? ` with ${AXIS_TRIAL_DEFS[run.activeTrial].name}` : '';
  log(run, `Planning wave ${run.wave}: ${ROUTE_NODE_DEFS[run.activeRoute].name}${trialText}, draw ${run.hand.length} cards.`);
}

function chooseMapForRun(profile: Profile, rng: Rng, requestedMapId?: MapId): MapId {
  const unlockedMaps: MapId[] = profile.unlockedMaps && profile.unlockedMaps.length > 0 ? profile.unlockedMaps : ['woodlandRelay'];
  if (requestedMapId && unlockedMaps.includes(requestedMapId)) {
    return requestedMapId;
  }
  return rng.pick(unlockedMaps);
}

function createRun(profile: Profile, seed: string, requestedMapId?: MapId): RunState {
  const rng = createRng(seed);
  const mapId = chooseMapForRun(profile, rng, requestedMapId);
  const terrainProfile = generateStartingTerrain(mapId, createRng(`${seed}:terrain:${mapId}`));
  const stateSpace = createDefenseField(mapId, terrainProfile.pockets);
  const fieldSummary = summarizeField(stateSpace);
  const relics: RelicId[] = [];
  const deck = makeDeck(profile, rng);
  const coreAxes = createCoreAxisSnapshot(profile);
  const baseLives = 14 + Math.floor(coreAxes.command / 2);
  const run: RunState = {
    seed,
    mapId,
    terrainProfile,
    phase: 'planning',
    previousPhase: null,
    time: 0,
    wave: 1,
    waveTime: 0,
    lives: baseLives,
    baseLives,
    scrap: MAP_DEFS[mapId].startingScrap + (profile.unlockedRelics.includes('seedVault') ? 4 : 0) + coreAxes.engineering,
    charge: Math.floor(coreAxes.fieldcraft / 2),
    energy: 3,
    firstCardRefundAvailable: false,
    selectedCardInstanceId: null,
    inspectTarget: null,
    drawPile: deck,
    hand: [],
    discardPile: profile.unlockedRelics.includes('seedVault') ? [seededCardInstance('build_bloom', 99, rng)] : [],
    towers: [],
    heroes: [],
    enemies: [],
    projectiles: [],
    machines: [],
    relics,
    rewardChoices: [],
    routeChoices: [],
    activeRoute: 'standard',
    nextRoute: 'standard',
    activeTrial: null,
    nextTrial: null,
    difficultyDirector: emptyDifficultyDirectorState(1),
    coreAxes,
    axisDirectives: createAxisDirectives(coreAxes),
    axisSurges: createAxisCounter(),
    axisMasteries: [],
    axisKeystones: [],
    axisMomentum: createAxisCounter(),
    axisBreakthroughs: createAxisCounter(),
    axisFocus: null,
    spawnQueue: [],
    overclockUntil: 0,
    heroDirective: 'balanced',
    heroDirectiveUntil: 0,
    forceRelicNextReward: false,
    runUnlocks: [],
    stateSpace,
    physicsAccumulator: 0,
    fieldSummary,
    impacts: [],
    physicsEvents: [`State-space field online: ${MAP_DEFS[mapId].name} / ${terrainProfile.name}.`],
    log: [`Run initialized on ${MAP_DEFS[mapId].name} with ${terrainProfile.name}. Core axes loaded into the relay.`],
    stats: {
      kills: 0,
      cardsPlayed: 0,
      towersBuilt: 0,
      heroesRecruited: 0,
      routesTaken: 0,
      reactionsTriggered: 0,
      fieldCardsPlayed: 0,
      towersUpgraded: 0,
      machinesBuilt: 0,
      commandsIssued: 0,
      rewardsClaimed: 0,
      axisDirectivesCompleted: 0,
      axisSurgesEarned: 0,
      axisSurgesSpent: 0,
      axisMasteriesClaimed: 0,
      axisKeystonesClaimed: 0,
      axisMomentumGained: 0,
      axisTechniquesUsed: 0,
      axisBreakthroughsUnlocked: 0,
      axisTrialsTaken: 0,
      axisTrialsCleared: 0,
    },
  };
  beginPlanning(run, rng);
  return run;
}

function hasTowerAt(run: RunState, point: GridPoint): boolean {
  return run.towers.some((tower) => tower.x === point.x && tower.y === point.y);
}

function hasMachineAt(run: RunState, point: GridPoint): boolean {
  return run.machines.some((machine) => machine.x === point.x && machine.y === point.y);
}

function canBuildAt(run: RunState, point: GridPoint): boolean {
  return isInsideGrid(point) && isBuildPad(point) && !hasTowerAt(run, point) && !hasMachineAt(run, point);
}

function getTowerAt(run: RunState, point: GridPoint): TowerState | undefined {
  return run.towers.find((tower) => tower.x === point.x && tower.y === point.y);
}

function addProjectile(run: RunState, from: { x: number; y: number }, to: { x: number; y: number }, kind: ProjectileState['kind'], speed: number): void {
  run.projectiles.push({
    id: nextId('projectile', run),
    fromX: from.x,
    fromY: from.y,
    toX: to.x,
    toY: to.y,
    progress: 0,
    speed,
    kind,
  });
}

function paintTowerImpact(run: RunState, tower: TowerState, target: { x: number; y: number }): void {
  if (tower.kind === 'emberCoil') {
    paintFieldCircle(run, target, 0.38, MAT.FIRE, 255);
    addImpact(run, target, 'burn', 'heat');
  } else if (tower.kind === 'frostLoom') {
    paintFieldCircle(run, target, 0.44, MAT.ICE, 4);
    addImpact(run, target, 'frost', 'freeze');
  } else if (tower.kind === 'bloomMortar') {
    paintFieldCircle(run, target, 0.58, MAT.SAND, 28);
    addImpact(run, target, 'earth', 'berm');
  } else if (tower.kind === 'voltSpire') {
    paintFieldCircle(run, target, 0.35, MAT.METAL, 90, FLAG.CONDUCTING);
    run.charge += 1;
    addImpact(run, target, 'shock', '+charge');
  } else if (tower.kind === 'sunForge') {
    paintFieldCircle(run, target, 0.5, MAT.LAVA, 245);
    addImpact(run, target, 'burn', 'forge');
  }
}

function paintHeroImpact(run: RunState, hero: HeroState, target: { x: number; y: number }): void {
  if (hero.kind === 'bulwark') {
    paintFieldCircle(run, target, 0.25, MAT.STONE, 22, FLAG.PLAYER_OWNED);
  } else if (hero.kind === 'fieldMechanic') {
    paintFieldCircle(run, hero, 0.22, MAT.PLAYER, 22, FLAG.PLAYER_OWNED);
  } else {
    paintFieldCircle(run, target, 0.2, MAT.WOOD, 36, FLAG.PLAYER_OWNED);
  }
}

function applyFieldcraftProtocolPulse(run: RunState, position: { x: number; y: number }, label: string): void {
  const tier = coreAxisProtocolTier(run, 'fieldcraft');
  if (tier <= 0) return;

  const radius = 62 + tier * 18;
  let affected = 0;
  for (const enemy of run.enemies) {
    if (enemy.hp <= 0) continue;
    const enemyPosition = pathPosition(enemy.distance);
    if (distanceBetween(position, enemyPosition) > radius) continue;

    affected += 1;
    enemy.exposedUntil = Math.max(enemy.exposedUntil, run.time + 0.7 + tier * 0.35);
    if (tier >= 2) {
      enemy.slowUntil = Math.max(enemy.slowUntil, run.time + 0.35 + tier * 0.16);
    }
    if (tier >= 3) {
      damageEnemy(run, enemy, 5 + axisRank(run, 'fieldcraft') * 1.5);
    }
  }

  run.charge += 1;
  if (tier >= 3 && affected > 0) {
    run.stats.reactionsTriggered += 1;
  }
  addImpact(run, position, tier >= 3 ? 'burn' : 'shock', `F${tier}`);
  logPhysics(
    run,
    affected > 0
      ? `${CORE_AXIS_PROTOCOL_DEFS.fieldcraft[tier - 1].name} pulsed ${label} through ${affected} ${affected === 1 ? 'enemy' : 'enemies'}.`
      : `${CORE_AXIS_PROTOCOL_DEFS.fieldcraft[tier - 1].name} banked charge from ${label}.`,
  );
}

function damageEnemy(run: RunState, enemy: EnemyState, rawDamage: number): void {
  const def = ENEMY_DEFS[enemy.kind];
  const exposedMultiplier = enemy.exposedUntil > run.time ? 1.28 : 1;
  const eliteReduction = enemy.elite ? 0.88 : 1;
  const damage = Math.max(1, rawDamage * exposedMultiplier * eliteReduction - (def.armor + enemyArmorBonus(enemy)));
  enemy.hp -= damage;
  if (enemy.hp <= 0 && !enemy.bountyPaid) {
    enemy.bountyPaid = true;
    const bounty = def.reward + (enemy.elite ? 4 : 0) + (run.activeRoute === 'cache' ? 1 : 0) + enemyRewardBonus(enemy);
    run.scrap += bounty;
    run.stats.kills += 1;
    if (hasEnemyAffix(enemy, 'volatileCore')) {
      const position = pathPosition(enemy.distance);
      paintFieldCircle(run, position, 0.5, MAT.FIRE, 255, FLAG.BURNING);
      applySplash(run, enemy, 54, 18);
      addImpact(run, position, 'burn', 'volatile');
      run.stats.reactionsTriggered += 1;
    }
    log(run, `${enemyPressureName(enemy)} dropped ${bounty} scrap.`);
  }
}

function applySplash(run: RunState, origin: EnemyState, radius: number, damage: number): void {
  if (radius <= 0) {
    return;
  }
  const originPosition = pathPosition(origin.distance);
  for (const enemy of run.enemies) {
    if (enemy.id === origin.id || enemy.hp <= 0) {
      continue;
    }
    const enemyPosition = pathPosition(enemy.distance);
    if (distanceBetween(originPosition, enemyPosition) <= radius) {
      damageEnemy(run, enemy, damage * 0.6);
    }
  }
}

function towerStats(run: RunState, tower: TowerState): { damage: number; range: number; fireRate: number; splash: number; slow: number } {
  const def = TOWER_DEFS[tower.kind];
  const relicDamage = run.relics.includes('emberLens') ? 1.15 : 1;
  const overclock = run.time < run.overclockUntil ? 1.55 : 1;
  const mechanic = run.time < tower.buffUntil ? 1.25 : 1;
  const engineeringBreakthrough = axisBreakthroughTier(run, 'engineering');
  const engineering = 1 + axisRank(run, 'engineering') * 0.035 + axisMomentum(run, 'engineering') * 0.025 + engineeringBreakthrough * 0.035;
  const fieldMachine = hasAxisResonance(run, 'fieldcraft_engineering') ? 1.08 : 1;
  const warRig = hasAxisResonance(run, 'engineering_command') ? 1.08 : 1;
  return {
    damage: def.damage * (1 + tower.level * 0.18 + tower.branches.damage * 0.36) * relicDamage * engineering * fieldMachine,
    range: def.range + tower.branches.range * 28 + tower.level * 4 + axisRank(run, 'engineering') * 3 + axisMomentum(run, 'engineering') * 2 + engineeringBreakthrough * 4,
    fireRate:
      def.fireRate *
      (1 + tower.branches.tempo * 0.26) *
      overclock *
      mechanic *
      (1 + axisRank(run, 'engineering') * 0.02 + axisMomentum(run, 'engineering') * 0.015 + engineeringBreakthrough * 0.02) *
      warRig,
    splash: def.splash + tower.branches.damage * 8,
    slow: def.slow,
  };
}

function towerProjectileKind(kind: TowerKind): ProjectileState['kind'] {
  if (kind === 'frostLoom') return 'frost';
  if (kind === 'bloomMortar') return 'bloom';
  if (kind === 'voltSpire') return 'volt';
  if (kind === 'sunForge') return 'sun';
  return 'ember';
}

function applyEngineeringProtocolShot(run: RunState, tower: TowerState, target: { x: number; y: number }): void {
  const tier = coreAxisProtocolTier(run, 'engineering');
  if (tier <= 0) return;

  const cadence = tier >= 3 ? 4 : tier >= 2 ? 5 : 6;
  if (tower.shots <= 0 || tower.shots % cadence !== 0) return;

  tower.buffUntil = Math.max(tower.buffUntil, run.time + 2.5 + tier);
  if (tier >= 2) {
    tower.level += 1;
    run.charge += 1;
    run.stats.towersUpgraded += 1;
  }
  if (tier >= 3) {
    const branchCandidates: Array<keyof TowerState['branches']> = ['damage', 'range', 'tempo'];
    const branch = branchCandidates.sort((a, b) => tower.branches[a] - tower.branches[b])[0];
    tower.branches[branch] += 1;
  }

  addImpact(run, target, 'shock', `E${tier}`);
  logPhysics(run, `${CORE_AXIS_PROTOCOL_DEFS.engineering[tier - 1].name} tuned ${TOWER_DEFS[tower.kind].name} after sustained fire.`);
}

function updateTowers(run: RunState, deltaSeconds: number): void {
  for (const tower of run.towers) {
    tower.cooldown -= deltaSeconds;
    if (tower.cooldown > 0) {
      continue;
    }

    const stats = towerStats(run, tower);
    const towerPosition = gridToWorld(tower);
    const target = run.enemies
      .filter((enemy) => enemy.hp > 0)
      .map((enemy) => ({ enemy, position: pathPosition(enemy.distance) }))
      .filter(({ position }) => distanceBetween(towerPosition, position) <= stats.range)
      .sort((a, b) => b.enemy.distance - a.enemy.distance)[0];

    if (!target) {
      continue;
    }

    damageEnemy(run, target.enemy, stats.damage);
    applySplash(run, target.enemy, stats.splash, stats.damage);
    if (stats.slow > 0) {
      target.enemy.slowUntil = Math.max(target.enemy.slowUntil, run.time + 1.4 + tower.branches.tempo * 0.25);
    }
    paintTowerImpact(run, tower, target.position);
    tower.shots += 1;
    applyEngineeringProtocolShot(run, tower, target.position);
    tower.cooldown = 1 / Math.max(0.1, stats.fireRate);
    addProjectile(run, towerPosition, target.position, towerProjectileKind(tower.kind), TOWER_DEFS[tower.kind].projectileSpeed);
  }
}

function heroHome(kind: HeroKind): { x: number; y: number } {
  if (kind === 'bulwark') return gridToWorld({ x: 13, y: 7 });
  if (kind === 'fieldMechanic') return gridToWorld({ x: 8, y: 6 });
  if (kind === 'cinderChemist') return gridToWorld({ x: 9, y: 5 });
  return gridToWorld({ x: 4, y: 5 });
}

function moveToward(current: { x: number; y: number }, target: { x: number; y: number }, maxDistance: number): { x: number; y: number } {
  const distance = distanceBetween(current, target);
  if (distance <= maxDistance || distance === 0) {
    return target;
  }
  const ratio = maxDistance / distance;
  return {
    x: current.x + (target.x - current.x) * ratio,
    y: current.y + (target.y - current.y) * ratio,
  };
}

function updateHeroes(run: RunState, deltaSeconds: number): void {
  const directiveActive = run.heroDirectiveUntil === Number.POSITIVE_INFINITY || run.heroDirectiveUntil > run.time;
  if (!directiveActive && run.heroDirective !== 'balanced') {
    run.heroDirective = 'balanced';
  }

  for (const hero of run.heroes) {
    const def = HERO_DEFS[hero.kind];
    const hasWardenBell = run.relics.includes('wardenBell');
    const directive = directiveActive ? run.heroDirective : 'balanced';
    const serviceBoost = directive === 'service';
    const masteryCommandBoost = hasAxisMastery(run, 'command_vanguardSignal') && directive !== 'balanced' ? 0.16 : 0;
    const commandBoost = 1 + axisRank(run, 'command') * 0.04 + axisMomentum(run, 'command') * 0.025 + axisBreakthroughTier(run, 'command') * 0.04 + masteryCommandBoost;
    const tacticalRole: HeroRole =
      directive === 'attack' ? 'attack' : directive === 'guard' ? 'defend' : def.role;
    const cadenceMultiplier = (hasWardenBell ? 1.2 : 1) * (directive === 'attack' ? 1.25 : serviceBoost ? 1.15 : 1) * commandBoost;
    const damageMultiplier = (hero.powerups.includes('leadHunter') ? 1.35 : 1) * (directive === 'attack' ? 1.15 : 1) * commandBoost;
    hero.cooldown -= deltaSeconds;

    if (hero.kind === 'cinderChemist') {
      const target = run.enemies
        .filter((enemy) => enemy.hp > 0)
        .map((enemy) => ({ enemy, position: pathPosition(enemy.distance), score: -enemy.distance }))
        .sort((a, b) => a.score - b.score)[0];
      if (!target) {
        const home = heroHome(hero.kind);
        const moved = moveToward(hero, home, 88 * deltaSeconds);
        hero.x = moved.x;
        hero.y = moved.y;
        continue;
      }

      const desired = { x: target.position.x - 52, y: target.position.y + 28 };
      const moved = moveToward(hero, desired, (serviceBoost ? 112 : 92) * deltaSeconds);
      hero.x = moved.x;
      hero.y = moved.y;
      if (hero.cooldown > 0 || distanceBetween(hero, target.position) > def.range) {
        continue;
      }

      const sample = sampleFieldAtWorld(run, target.position);
      const triage = hero.powerups.includes('steamTriage') || serviceBoost;
      if (triage && (sample.material === MAT.WATER || sample.material === MAT.ICE || sample.material === MAT.SMOKE || sample.material === MAT.STEAM)) {
        paintFieldCircle(run, target.position, 0.55, MAT.STEAM, 145, FLAG.PRESSURIZED);
        target.enemy.pinUntil = Math.max(target.enemy.pinUntil, run.time + (hero.powerups.includes('steamTriage') ? 1.1 : 0.7));
        run.charge += hero.powerups.includes('steamTriage') ? 1 : 0;
        addImpact(run, target.position, 'frost', 'steam');
        logPhysics(run, 'Cinder Chemist vented steam into the lane.');
      } else if (hero.powerups.includes('volatilePrimer') || sample.material !== MAT.OIL) {
        paintFieldCircle(run, target.position, 0.5, MAT.OIL, 70, FLAG.PLAYER_OWNED);
        target.enemy.exposedUntil = Math.max(target.enemy.exposedUntil, run.time + 1.2);
        addImpact(run, target.position, 'earth', 'primer');
        logPhysics(run, 'Cinder Chemist primed the lane with volatile oil.');
      } else {
        paintFieldCircle(run, target.position, 0.5, MAT.FIRE, 255, FLAG.BURNING);
        addImpact(run, target.position, 'burn', 'ignite');
        logPhysics(run, 'Cinder Chemist ignited a primed patch.');
      }
      damageEnemy(run, target.enemy, def.damage * (sample.material === MAT.OIL ? 2.1 : 1.2));
      addProjectile(run, hero, target.position, 'hero', 420);
      hero.cooldown = 1 / (def.cadence * cadenceMultiplier);
      continue;
    }

    if (def.role === 'support') {
      const tower = run.towers
        .map((candidate) => ({ tower: candidate, distance: distanceBetween(hero, gridToWorld(candidate)) }))
        .sort((a, b) => a.distance - b.distance)[0]?.tower;
      if (tower) {
        const target = gridToWorld(tower);
        const moved = moveToward(hero, { x: target.x - 28, y: target.y + 26 }, (serviceBoost ? 112 : 82) * deltaSeconds);
        hero.x = moved.x;
        hero.y = moved.y;
        tower.buffUntil = Math.max(tower.buffUntil, run.time + (hero.powerups.includes('quickTune') || serviceBoost ? 1.35 : 0.7));
      }
      if (hero.cooldown <= 0 && hero.powerups.includes('patchKit') && run.lives < run.baseLives + 2) {
        run.lives += 1;
        hero.cooldown = 6;
        log(run, 'Field Mechanic patched the relay core.');
      }
      continue;
    }

    const target = run.enemies
      .filter((enemy) => enemy.hp > 0)
      .map((enemy) => ({
        enemy,
        position: pathPosition(enemy.distance),
        score: tacticalRole === 'defend' ? Math.abs(enemy.distance - PATH_LENGTH * (directive === 'guard' ? 0.84 : 0.72)) : -enemy.distance,
      }))
      .sort((a, b) => a.score - b.score)[0];

    if (!target) {
      const home = heroHome(hero.kind);
      const moved = moveToward(hero, home, 90 * deltaSeconds);
      hero.x = moved.x;
      hero.y = moved.y;
      continue;
    }

    const desired = tacticalRole === 'defend' ? target.position : { x: target.position.x - 40, y: target.position.y - 36 };
    const moved = moveToward(hero, desired, (tacticalRole === 'defend' ? 76 : 116) * deltaSeconds);
    hero.x = moved.x;
    hero.y = moved.y;

    if (hero.cooldown > 0 || distanceBetween(hero, target.position) > def.range) {
      continue;
    }

    damageEnemy(run, target.enemy, def.damage * damageMultiplier);
    paintHeroImpact(run, hero, target.position);
    addProjectile(run, hero, target.position, 'hero', 440);
    if (tacticalRole === 'defend') {
      const pinDuration =
        (hero.powerups.includes('rootStance') ? 1.8 : 1.0) +
        (directive === 'guard' ? 0.45 : 0) +
        axisRank(run, 'command') * 0.08 +
        axisBreakthroughTier(run, 'command') * 0.06;
      target.enemy.pinUntil = Math.max(target.enemy.pinUntil, run.time + pinDuration);
      if (hero.powerups.includes('shieldPulse')) {
        applySplash(run, target.enemy, 58, def.damage);
      }
    }
    if (hero.powerups.includes('splitArrow')) {
      const secondary = run.enemies
        .filter((enemy) => enemy.id !== target.enemy.id && enemy.hp > 0)
        .map((enemy) => ({ enemy, position: pathPosition(enemy.distance) }))
        .filter(({ position }) => distanceBetween(hero, position) <= def.range)
        .sort((a, b) => b.enemy.distance - a.enemy.distance)[0];
      if (secondary) {
        damageEnemy(run, secondary.enemy, def.damage * 0.7);
      }
    }
    hero.cooldown = 1 / (def.cadence * cadenceMultiplier);
  }
}

function updateStateSpace(run: RunState, deltaSeconds: number): void {
  run.physicsAccumulator += deltaSeconds;
  let ticks = 0;
  while (run.physicsAccumulator >= 0.08 && ticks < 3) {
    run.stateSpace.step(1);
    run.physicsAccumulator -= 0.08;
    ticks += 1;
  }
  if (ticks > 0) {
    run.fieldSummary = summarizeField(run.stateSpace);
  }
}

function applyStateSpaceEffects(run: RunState, deltaSeconds: number): void {
  const reactionDamageMultiplier =
    (hasAxisMastery(run, 'fieldcraft_combustionLens') ? 1.25 : 1) +
    axisMomentum(run, 'fieldcraft') * 0.04 +
    axisBreakthroughTier(run, 'fieldcraft') * 0.05;
  for (const enemy of run.enemies) {
    if (enemy.hp <= 0) continue;
    const position = pathPosition(enemy.distance);
    const sample = sampleFieldAtWorld(run, position);
    const traits = ENEMY_DEFS[enemy.kind].traits;

    if (sample.material === MAT.FIRE || sample.material === MAT.LAVA) {
      const volatileBonus = traits.includes('volatile') ? 2.2 : traits.includes('burnable-spines') ? 1.45 : traits.includes('cold-core') ? 1.6 : 1;
      const heatDamage = (sample.material === MAT.LAVA ? 24 : 13) * volatileBonus * reactionDamageMultiplier * deltaSeconds;
      damageEnemy(run, enemy, heatDamage);
      enemy.exposedUntil = Math.max(enemy.exposedUntil, run.time + 0.6);
      if (traits.includes('volatile')) {
        paintFieldCircle(run, position, 0.55, MAT.FIRE, 255);
        addImpact(run, position, 'burn', 'flare');
        run.stats.reactionsTriggered += 1;
      }
      logPhysics(run, `${materialName(sample.material)} scorched an enemy on the path.`);
    } else if (sample.material === MAT.ICE || sample.material === MAT.WATER || sample.material === MAT.SAND || sample.material === MAT.ASH) {
      let duration = sample.material === MAT.ICE ? 0.75 : 0.35;
      if (sample.material === MAT.WATER && traits.includes('water-drag')) duration += 0.45;
      if (sample.material === MAT.WATER && traits.includes('water-break')) {
        damageEnemy(run, enemy, 18 * deltaSeconds);
        enemy.exposedUntil = Math.max(enemy.exposedUntil, run.time + 1.2);
      }
      if (sample.material === MAT.ICE && traits.includes('cold-core')) duration = 0;
      if (duration > 0) {
        enemy.slowUntil = Math.max(enemy.slowUntil, run.time + duration);
        logPhysics(run, `${sample.materialName} terrain slowed the front.`);
      }
    } else if (sample.material === MAT.OIL && sample.thermal > 70) {
      damageEnemy(run, enemy, (traits.includes('volatile') ? 24 : 16) * reactionDamageMultiplier * deltaSeconds);
      enemy.exposedUntil = Math.max(enemy.exposedUntil, run.time + 0.8);
      logPhysics(run, 'heated oil flared under the wave.');
    } else if (sample.material === MAT.SMOKE || sample.material === MAT.STEAM) {
      const pressure = run.relics.includes('pressureCrown') ? 0.28 : 0.12;
      if (!traits.includes('smoke-cloak') || sample.material === MAT.STEAM) {
        enemy.pinUntil = Math.max(enemy.pinUntil, run.time + pressure);
      }
      if (run.relics.includes('pressureCrown')) {
        damageEnemy(run, enemy, 5 * reactionDamageMultiplier * deltaSeconds);
      }
      if (sample.material === MAT.STEAM && traits.includes('steam-vulnerable')) {
        damageEnemy(run, enemy, 22 * reactionDamageMultiplier * deltaSeconds);
        enemy.exposedUntil = Math.max(enemy.exposedUntil, run.time + 1.2);
      }
    } else if (sample.material === MAT.METAL && (sample.flags & FLAG.CONDUCTING || run.charge > 0)) {
      if (traits.includes('conductive') || traits.includes('conductive-fracture')) {
        damageEnemy(run, enemy, (traits.includes('conductive-fracture') ? 18 : 10) * reactionDamageMultiplier * deltaSeconds);
        enemy.exposedUntil = Math.max(enemy.exposedUntil, run.time + 0.6);
        logPhysics(run, 'conductive field shocked a conductive enemy.');
      }
    } else if (sample.material === MAT.GLASS && run.relics.includes('glassHeart')) {
      enemy.exposedUntil = Math.max(enemy.exposedUntil, run.time + 1.5);
      damageEnemy(run, enemy, 7 * reactionDamageMultiplier * deltaSeconds);
      logPhysics(run, 'glass fracture exposed the wave.');
    }

    if ((traits.includes('eats-owned-material') || enemy.miniboss === 'siphonMaw') && sample.flags & FLAG.PLAYER_OWNED) {
      const fieldPoint = fieldPointFromWorld(run, position);
      run.stateSpace.setCell(fieldPoint.x, fieldPoint.y, MAT.AIR);
      run.lives = Math.max(0, run.lives - 1);
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + 12);
      logPhysics(run, `${enemy.miniboss === 'siphonMaw' ? 'Siphon Maw' : 'Relic Eater'} consumed player-owned matter.`);
    }
  }
}

function updateEnemies(run: RunState, deltaSeconds: number): void {
  for (const enemy of run.enemies) {
    if (enemy.hp <= 0) {
      continue;
    }
    const def = ENEMY_DEFS[enemy.kind];
    if (hasEnemyAffix(enemy, 'regenerator') && enemy.exposedUntil <= run.time) {
      enemy.hp = Math.min(enemy.maxHp, enemy.hp + 4.5 * deltaSeconds);
    }
    const slowed = enemy.slowUntil > run.time ? 0.58 : 1;
    const pinned = enemy.pinUntil > run.time ? 0.35 : 1;
    enemy.distance += def.speed * enemySpeedMultiplier(enemy) * slowed * pinned * deltaSeconds;
    if (enemy.distance >= PATH_LENGTH) {
      enemy.hp = 0;
      run.lives -= enemy.kind === 'relicEater' ? 4 : 1;
      log(run, `${enemyPressureName(enemy)} breached the relay.`);
    }
  }
  run.enemies = run.enemies.filter((enemy) => enemy.hp > 0);
}

function updateProjectiles(run: RunState, deltaSeconds: number): void {
  for (const projectile of run.projectiles) {
    const distance = Math.hypot(projectile.toX - projectile.fromX, projectile.toY - projectile.fromY);
    projectile.progress += distance === 0 ? 1 : (projectile.speed * deltaSeconds) / distance;
  }
  run.projectiles = run.projectiles.filter((projectile) => projectile.progress < 1);
}

function spawnEnemies(run: RunState): void {
  while (run.spawnQueue.length > 0 && run.spawnQueue[0].at <= run.waveTime) {
    const spawn = run.spawnQueue.shift();
    if (!spawn) break;
    const base = ENEMY_DEFS[spawn.kind];
    const routeThreat = ROUTE_NODE_DEFS[run.activeRoute].threat;
    const trialThreat = run.activeTrial ? AXIS_TRIAL_DEFS[run.activeTrial].threat : 0;
    const hpScale = (1 + (run.wave - 1) * 0.23 + routeThreat * 0.08 + trialThreat * 0.06 + (spawn.elite ? 0.65 : 0)) * spawnHpMultiplier(spawn);
    const maxHp = Math.ceil(base.hp * hpScale);
    const enemy: EnemyState = {
      id: nextId(`enemy-${spawn.kind}`, run),
      kind: spawn.kind,
      hp: maxHp,
      maxHp,
      distance: 0,
      slowUntil: 0,
      pinUntil: 0,
      exposedUntil: spawn.elite ? run.time + 999 : 0,
      elite: spawn.elite ?? false,
      affixes: spawn.affixes ? [...spawn.affixes] : [],
      miniboss: spawn.miniboss ?? null,
      bountyPaid: false,
    };
    run.enemies.push(enemy);
    if (spawn.elite || enemyAffixes(enemy).length > 0 || enemy.miniboss) {
      log(run, `${enemyPressureName(enemy)} entered the line.`);
    }
  }
}

function machineIncome(run: RunState): { scrap: number; charge: number } {
  const mills = run.machines.filter((machine) => machine.kind === 'aetherMill').length;
  const multiplier =
    (hasAxisMastery(run, 'engineering_machineShop') ? 2 : 1) +
    (axisMomentum(run, 'engineering') >= AXIS_MOMENTUM_MAX ? 1 : 0) +
    (axisBreakthroughTier(run, 'engineering') >= 2 ? 1 : 0) +
    (hasAxisKeystone(run, 'engineering_millNetwork') ? 1 : 0);
  return { scrap: mills * multiplier, charge: mills * multiplier };
}

function rewardDescriptionFor(choice: RewardChoice): string {
  return `${choice.name}: ${choice.description}`;
}

function makeRewardChoices(run: RunState, profile: Profile, rng: Rng): RewardChoice[] {
  const choices: RewardChoice[] = makeAxisMasteryRewardChoices(run, rng);
  if (choices.length === 0) {
    choices.push(...makeAxisKeystoneRewardChoices(run, rng));
  }
  const archiveProtocol = coreAxisProtocolTier(run, 'archive');
  const rewardCount =
    (axisRank(run, 'archive') >= 3 ? 4 : 3) +
    (hasAxisMastery(run, 'archive_deepScry') ? 1 : 0) +
    (archiveProtocol >= 2 ? 1 : 0) +
    (axisMomentum(run, 'archive') >= 4 ? 1 : 0) +
    (axisBreakthroughTier(run, 'archive') >= 2 ? 1 : 0) +
    (hasAxisKeystone(run, 'archive_fateMarket') ? 1 : 0) +
    (hasAxisResonance(run, 'fieldcraft_archive') ? 1 : 0);
  const protocolSlotBudget = Math.max(0, Math.min(choices.length === 0 ? 2 : 1, rewardCount - choices.length - 2));
  if (protocolSlotBudget > 0) {
    choices.push(...makeAxisProtocolRewardChoices(run, rng).slice(0, protocolSlotBudget));
  }
  const cardPool = cardPoolForUnlocks(profile.unlockedCards);
  const rewardBias = ROUTE_NODE_DEFS[run.activeRoute].rewardBias;
  const preferred = cardPool.filter((cardId) => {
    const card = CARD_DEFS[cardId];
    if (rewardBias === 'upgrade') return card.type === 'upgrade' || card.archetype === 'machine';
    if (rewardBias === 'scrap') return card.archetype === 'economy';
    if (run.activeRoute === 'hazard') return card.type === 'field' || card.archetype === 'control';
    return false;
  });
  const orderedPool = [...rng.shuffle(preferred), ...rng.shuffle(cardPool.filter((cardId) => !preferred.includes(cardId)))];
  for (const cardId of orderedPool) {
    if (choices.length >= Math.min(3, rewardCount - 1)) break;
    const def = CARD_DEFS[cardId];
    choices.push({
      choiceId: `card:${cardId}:${run.wave}`,
      type: 'card',
      rewardId: cardId,
      name: def.name,
      description: `Add this ${def.type} card to your deck. ${def.description}`,
    });
  }

  const availableRelics = profile.unlockedRelics.filter((relicId) => !run.relics.includes(relicId));
  if (run.forceRelicNextReward || rewardBias === 'relic' || choices.length < rewardCount || archiveProtocol >= 3) {
    const relicId = rng.pick(availableRelics.length > 0 ? availableRelics : profile.unlockedRelics);
    const relic = RELIC_DEFS[relicId];
    choices.push({
      choiceId: `relic:${relicId}:${run.wave}`,
      type: 'relic',
      rewardId: relicId,
      name: relic.name,
      description: relic.description,
    });
  }

  const heroKinds = rng.shuffle(profile.unlockedHeroes);
  const heroKind = run.heroes[0]?.kind ?? heroKinds[0];
  if (heroKind && choices.length < rewardCount + 1) {
    const power = rng.pick(HERO_POWER_POOL[heroKind]);
    choices.push({
      choiceId: `heroPower:${heroKind}:${power.id}:${run.wave}`,
      type: 'heroPower',
      rewardId: `heroPower:${heroKind}:${power.id}`,
      name: `${HERO_DEFS[heroKind].name}: ${power.name}`,
      description: power.description,
    });
  }

  return choices.slice(0, rewardCount);
}

function enterReward(run: RunState, profile: Profile, rng: Rng): void {
  const income = machineIncome(run);
  if (income.scrap > 0 || income.charge > 0) {
    run.scrap += income.scrap;
    run.charge += income.charge;
    log(run, `Aether machines produced ${income.scrap} scrap and ${income.charge} charge.`);
  }
  if (run.relics.includes('sparkScrip') && run.charge >= 4) {
    const converted = Math.floor(run.charge / 4);
    run.charge %= 4;
    run.scrap += converted;
    log(run, `Spark Scrip converted ${converted * 4} charge into ${converted} scrap.`);
  }
  if (run.heroes.some((hero) => hero.kind === 'fieldMechanic' && hero.powerups.includes('patchKit')) && run.lives < run.baseLives + 2) {
    run.lives += 1;
    log(run, 'Patch Kit repaired the relay after the wave.');
  }
  if (run.heroes.some((hero) => hero.kind === 'cinderChemist' && hero.powerups.includes('steamTriage')) && run.fieldSummary.smoke > 0) {
    run.charge += 1;
    log(run, 'Steam Triage recovered 1 charge from the field.');
  }
  completeAxisTrial(run);
  run.phase = 'reward';
  run.selectedCardInstanceId = null;
  run.rewardChoices = makeRewardChoices(run, profile, rng);
  run.forceRelicNextReward = false;
  log(run, `Wave ${run.wave} cleared. Choose a reward.`);
}

function grantRunProfileUnlocks(run: RunState, profile: Profile): string[] {
  const unlocked: string[] = [];

  function unlockCard(cardId: CardId): void {
    if (addUnique(profile.unlockedCards, cardId)) unlocked.push(`Card unlocked: ${CARD_DEFS[cardId].name}`);
  }

  function unlockRelic(relicId: RelicId): void {
    if (addUnique(profile.unlockedRelics, relicId)) unlocked.push(`Relic unlocked: ${RELIC_DEFS[relicId].name}`);
  }

  function unlockHero(heroId: HeroKind): void {
    if (addUnique(profile.unlockedHeroes, heroId)) unlocked.push(`Hero unlocked: ${HERO_DEFS[heroId].name}`);
  }

  function unlockMap(mapId: MapId): void {
    if (addUnique(profile.unlockedMaps, mapId)) unlocked.push(`Map unlocked: ${MAP_DEFS[mapId].name}`);
  }

  if (run.wave >= 2 || run.stats.kills >= 18) {
    unlockCard('build_volt');
    unlockCard('oil_slick');
    unlockCard('command_attack');
    unlockRelic('livingLedger');
  }
  if (run.wave >= 3) {
    unlockHero('bulwark');
    unlockRelic('wardenBell');
    unlockRelic('pressureCrown');
    unlockCard('seed_barrier');
    unlockCard('sand_berm');
    unlockCard('command_guard');
    unlockMap('floodedBasin');
  }
  if (run.wave >= 4) {
    unlockHero('fieldMechanic');
    unlockCard('upgrade_tempo');
    unlockCard('conductor_rail');
    unlockCard('salvage_cache');
    unlockRelic('sparkScrip');
    unlockMap('oilworks');
  }
  if (run.wave >= 5) {
    unlockHero('cinderChemist');
    unlockCard('build_sun');
    unlockCard('recruit_chemist');
    unlockCard('cryo_seed');
    unlockCard('vent_smoke');
    unlockCard('command_service');
    unlockRelic('echoCore');
    unlockRelic('glassHeart');
    unlockMap('glassFoundry');
  }
  if (run.phase === 'victory') {
    unlockCard('aether_mill');
    unlockCard('relic_probe');
    unlockRelic('seedVault');
    unlockRelic('biomeAtlas');
  }

  return unlocked;
}

function advanceCoreAxes(run: RunState, profile: Profile): string[] {
  const unlocked: string[] = [];
  const directiveBonus = (axis: CoreAxisId) => (run.axisDirectives.some((directive) => directive.axis === axis && directive.completed) ? 1 : 0);
  const plannedGains: Record<CoreAxisId, number> = {
    fieldcraft: Math.floor(run.stats.reactionsTriggered / 3) + directiveBonus('fieldcraft'),
    engineering: Math.floor((run.stats.towersBuilt + run.machines.length + Math.floor(run.charge / 3)) / 2) + directiveBonus('engineering'),
    command: Math.floor((run.stats.heroesRecruited + run.stats.routesTaken) / 2) + directiveBonus('command'),
    archive: Math.floor(run.wave / 2) + (run.phase === 'victory' ? 1 : 0) + directiveBonus('archive'),
  };

  for (const axis of CORE_AXIS_IDS) {
    const current = Math.max(0, profile.coreAxes?.[axis] ?? 0);
    const cap = CORE_AXIS_DEFS[axis].cap;
    const gain = Math.max(0, plannedGains[axis]);
    if (gain <= 0 || current >= cap) continue;
    const next = Math.min(cap, current + gain);
    profile.coreAxes[axis] = next;
    if (next > current) {
      unlocked.push(`Core Axis raised: ${CORE_AXIS_DEFS[axis].name} ${current}->${next}`);
    }
  }

  return unlocked;
}

function applyRouteBonus(run: RunState, route: RouteNodeType, rng: Rng): void {
  if (hasAxisMastery(run, 'archive_routeLedger')) {
    run.scrap += 1;
    log(run, 'Route Ledger banked 1 setup scrap.');
  }

  if (route === 'standard') {
    run.scrap += 1;
    log(run, 'Stable Line granted 1 setup scrap.');
    return;
  }

  if (route === 'cache') {
    const cacheScrap = run.relics.includes('biomeAtlas') ? 5 : 3;
    run.scrap += cacheScrap;
    run.discardPile.push(seededCardInstance('salvage_cache', run.stats.cardsPlayed + run.discardPile.length + 1000, rng));
    addImpact(run, gridToWorld(CORE_CELL), 'reward', `+${cacheScrap}`);
    log(run, `Salvage Cache route banked ${cacheScrap} scrap and a cache card.`);
    return;
  }

  if (route === 'forge') {
    run.charge += 3;
    const point = PATH[Math.max(1, Math.min(PATH.length - 2, 2 + rng.int(PATH.length - 3)))];
    paintFieldCircle(run, gridToWorld(point), 0.75, MAT.FIRE, 255, FLAG.BURNING);
    addImpact(run, gridToWorld(point), 'burn', '+charge');
    log(run, 'Field Forge route added 3 charge and heated the lane.');
    return;
  }

  if (route === 'elite') {
    run.forceRelicNextReward = true;
    run.charge += 1;
    log(run, 'Elite Breach route primed a relic-heavy reward draft.');
    return;
  }

  const point = PATH[Math.max(1, Math.min(PATH.length - 2, 1 + rng.int(PATH.length - 2)))];
  const material = rng.next() > 0.5 ? MAT.SMOKE : MAT.OIL;
  paintFieldCircle(run, gridToWorld(point), 0.9, material, material === MAT.SMOKE ? 65 : 70, FLAG.PRESSURIZED);
  run.scrap += run.relics.includes('biomeAtlas') ? 2 : 0;
  addImpact(run, gridToWorld(point), material === MAT.SMOKE ? 'frost' : 'earth', 'hazard');
  log(run, 'Unstable Biome route reshaped the field before planning.');
}

export class GameModel {
  private listeners = new Set<Listener>();
  private readonly storage?: StorageLike;
  private rng: Rng = createRng('menu');
  profile: Profile;
  run: RunState | null = null;

  constructor(storage: StorageLike | undefined = globalThis.localStorage) {
    this.storage = storage;
    this.profile = loadProfile(storage);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  snapshot(): AppSnapshot {
    return {
      profile: this.profile,
      run: this.run,
    };
  }

  emit(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  startRun(seed = `${Date.now()}`, mapId?: MapId): void {
    this.rng = createRng(seed);
    this.run = createRun(this.profile, seed, mapId);
    this.emit();
  }

  resetProfile(): void {
    this.profile = resetProfile(this.storage);
    this.run = null;
    this.emit();
  }

  save(): void {
    saveProfile(this.profile, this.storage);
  }

  update(deltaMs: number): void {
    const run = this.run;
    if (!run || run.phase !== 'wave') {
      updateProjectiles(run ?? emptyRun(), deltaMs / 1000);
      return;
    }

    const deltaSeconds = Math.min(0.05, deltaMs / 1000);
    run.time += deltaSeconds;
    run.waveTime += deltaSeconds;
    spawnEnemies(run);
    updateStateSpace(run, deltaSeconds);
    applyStateSpaceEffects(run, deltaSeconds);
    updateHeroes(run, deltaSeconds);
    updateTowers(run, deltaSeconds);
    updateEnemies(run, deltaSeconds);
    updateProjectiles(run, deltaSeconds);
    updateImpacts(run, deltaSeconds);
    refreshAxisDirectives(run, this.rng);

    if (run.lives <= 0) {
      run.phase = 'defeat';
      run.lives = 0;
      log(run, 'Relay core collapsed.');
      this.finalizeRun();
      this.emit();
      return;
    }

    if (run.spawnQueue.length === 0 && run.enemies.length === 0) {
      enterReward(run, this.profile, this.rng);
      this.emit();
    }
  }

  selectCard(instanceId: string | null): void {
    if (!this.run) return;
    this.run.selectedCardInstanceId = this.run.selectedCardInstanceId === instanceId ? null : instanceId;
    this.emit();
  }

  inspectCell(point: GridPoint): void {
    const run = this.run;
    if (!run) return;
    const tower = getTowerAt(run, point);
    if (tower) {
      run.inspectTarget = { kind: 'tower', id: tower.id };
    } else {
      run.inspectTarget = { kind: 'cell', point };
    }
    this.emit();
  }

  playSelectedAt(point: GridPoint): boolean {
    const run = this.run;
    if (!run || !run.selectedCardInstanceId) {
      this.inspectCell(point);
      return false;
    }
    return this.playCard(run.selectedCardInstanceId, point);
  }

  playCard(instanceId: string, target?: GridPoint): boolean {
    const run = this.run;
    if (!run || run.phase === 'reward' || run.phase === 'route' || run.phase === 'defeat' || run.phase === 'victory') {
      return false;
    }

    const handIndex = run.hand.findIndex((card) => card.instanceId === instanceId);
    const instance = run.hand[handIndex];
    if (!instance) {
      return false;
    }

    const card = CARD_DEFS[instance.cardId];
    const surgeAxis = axisSurgeForCard(instance.cardId);
    const surgeSpent = surgeAxis ? run.axisSurges[surgeAxis] > 0 : false;
    const cardCost = effectiveCardCost(run, instance.cardId);
    if (run.energy < cardCost) {
      log(run, 'Not enough energy for that card.');
      this.emit();
      return false;
    }

    if (card.target !== 'none' && !target) {
      run.selectedCardInstanceId = instanceId;
      const targetName = card.target === 'tower' ? 'tower' : card.target === 'cell' ? 'field cell' : 'build pad';
      log(run, `Choose a ${targetName} for ${card.name}.`);
      this.emit();
      return false;
    }

    const success = this.applyCard(run, instance.cardId, target, surgeSpent ? surgeAxis : null);
    if (!success) {
      this.emit();
      return false;
    }

    run.energy -= cardCost;
    if (surgeSpent && surgeAxis) {
      run.axisSurges[surgeAxis] = Math.max(0, run.axisSurges[surgeAxis] - 1);
      run.stats.axisSurgesSpent += 1;
      log(run, `${CORE_AXIS_DEFS[surgeAxis].name} Surge spent on ${card.name}.`);
    }
    if (run.firstCardRefundAvailable) {
      run.scrap += 1;
      run.firstCardRefundAvailable = false;
      log(run, 'Living Ledger refunded 1 scrap.');
    }
    run.stats.cardsPlayed += 1;
    run.selectedCardInstanceId = null;
    run.hand.splice(handIndex, 1);
    run.discardPile.push(instance);
    const playedAxis = axisSurgeForCard(instance.cardId);
    if (playedAxis) {
      addAxisMomentum(run, playedAxis, 1);
    }
    refreshAxisDirectives(run, this.rng);
    this.profile.seenCards = [...new Set([...this.profile.seenCards, instance.cardId])];
    this.save();
    this.emit();
    return true;
  }

  startWave(): void {
    const run = this.run;
    if (!run || run.phase !== 'planning') return;
    run.phase = 'wave';
    run.spawnQueue = scheduleDirectedWave(run, this.rng);
    run.waveTime = 0;
    run.selectedCardInstanceId = null;
    applyAxisTrialWaveStart(run, this.rng);
    applyAxisFocusWaveStart(run, this.rng);
    if (run.relics.includes('echoCore') && run.discardPile.length > 0) {
      const cheapest = [...run.discardPile].sort((a, b) => CARD_DEFS[a.cardId].cost - CARD_DEFS[b.cardId].cost)[0];
      run.hand.push({ ...cheapest, instanceId: `${cheapest.instanceId}-echo-${run.wave}` });
      log(run, 'Echo Core copied a cheap discard into hand.');
    }
    log(run, `Difficulty Director: ${run.difficultyDirector.summary}.`);
    log(run, `Wave ${run.wave} started.`);
    this.emit();
  }

  setAxisFocus(axis: CoreAxisId | null): boolean {
    const run = this.run;
    if (!run || run.phase !== 'planning') return false;
    run.axisFocus = axis;
    if (axis) {
      log(run, `${AXIS_FOCUS_DEFS[axis].name} armed for the next wave.`);
    } else {
      log(run, 'Axis Focus cleared.');
    }
    this.emit();
    return true;
  }

  chooseReward(choiceId: string): void {
    const run = this.run;
    if (!run || run.phase !== 'reward') return;
    const choice = run.rewardChoices.find((candidate) => candidate.choiceId === choiceId);
    if (!choice) return;

    if (choice.type === 'card') {
      const cardId = choice.rewardId as CardId;
      run.discardPile.push(seededCardInstance(cardId, run.stats.cardsPlayed + run.discardPile.length, this.rng));
      if (hasAxisKeystone(run, 'archive_deckScribe')) {
        run.discardPile.push(seededCardInstance(cardId, run.stats.cardsPlayed + run.discardPile.length + 1, this.rng));
        log(run, 'Deck Scribe copied the card reward.');
      }
      this.profile.seenCards = [...new Set([...this.profile.seenCards, cardId])];
      log(run, `Deck gained ${CARD_DEFS[cardId].name}.`);
    } else if (choice.type === 'relic') {
      const relicId = choice.rewardId as RelicId;
      if (!run.relics.includes(relicId)) {
        run.relics.push(relicId);
      }
      this.profile.seenRelics = [...new Set([...this.profile.seenRelics, relicId])];
      log(run, `Relic equipped: ${RELIC_DEFS[relicId].name}.`);
    } else if (choice.type === 'heroPower') {
      const [, heroKind, powerId] = choice.rewardId.split(':') as ['heroPower', HeroKind, string];
      const hero = run.heroes.find((candidate) => candidate.kind === heroKind);
      if (hero) {
        if (!hero.powerups.includes(powerId)) {
          hero.powerups.push(powerId);
        }
      } else {
        this.addHero(run, heroKind);
        const addedHero = run.heroes.find((candidate) => candidate.kind === heroKind);
        addedHero?.powerups.push(powerId);
      }
      this.profile.seenHeroes = [...new Set([...this.profile.seenHeroes, heroKind])];
      log(run, `Hero power gained: ${choice.name}.`);
    } else if (choice.type === 'axisKeystone') {
      applyAxisKeystone(run, choice.rewardId as AxisKeystoneId);
    } else if (choice.type === 'axisProtocol') {
      const [, axis] = choice.rewardId.split(':') as ['axisProtocol', CoreAxisId];
      applyAxisProtocolReward(run, axis, this.rng);
    } else {
      applyAxisMastery(run, choice.rewardId as AxisMasteryId);
    }

    run.stats.rewardsClaimed += 1;
    addAxisMomentum(run, 'archive', 1);
    run.rewardChoices = [];
    if (run.wave >= FINAL_WAVE) {
      run.phase = 'victory';
      log(run, 'Final wave broken. The relic line holds.');
      this.finalizeRun();
      this.emit();
      return;
    }

    run.wave += 1;
    run.scrap += 2;
    run.routeChoices = makeRouteChoices(run, this.rng);
    run.phase = 'route';
    refreshAxisDirectives(run, this.rng);
    log(run, `Choose a route into wave ${run.wave}.`);
    this.save();
    this.emit();
  }

  chooseRoute(choiceId: string): void {
    const run = this.run;
    if (!run || run.phase !== 'route') return;
    const choice = run.routeChoices.find((candidate) => candidate.choiceId === choiceId);
    if (!choice) return;
    run.nextRoute = choice.type;
    run.nextTrial = choice.trial ?? null;
    run.routeChoices = [];
    run.stats.routesTaken += 1;
    addAxisMomentum(run, 'archive', 1);
    addAxisMomentum(run, 'command', 1);
    if (run.nextTrial) {
      const trial = AXIS_TRIAL_DEFS[run.nextTrial];
      run.stats.axisTrialsTaken += 1;
      addAxisMomentum(run, trial.axis, 1);
      log(run, `Axis Trial armed: ${CORE_AXIS_DEFS[trial.axis].name} / ${trial.name}.`);
    }
    applyRouteBonus(run, choice.type, this.rng);
    beginPlanning(run, this.rng);
    refreshAxisDirectives(run, this.rng);
    this.emit();
  }

  useAxisTechnique(axis: CoreAxisId): boolean {
    const run = this.run;
    if (!run || run.phase === 'reward' || run.phase === 'route' || run.phase === 'paused' || run.phase === 'defeat' || run.phase === 'victory') {
      return false;
    }

    const def = AXIS_TECHNIQUE_DEFS[axis];
    const cost = axisTechniqueCost(run, axis);
    if (!spendAxisMomentum(run, axis, cost)) {
      log(run, `${CORE_AXIS_DEFS[axis].name} Technique needs ${cost} momentum.`);
      this.emit();
      return false;
    }

    run.stats.axisTechniquesUsed += 1;
    if (axis === 'fieldcraft') {
      const targets = run.enemies
        .filter((enemy) => enemy.hp > 0)
        .sort((a, b) => b.distance - a.distance)
        .slice(0, 3);
      const fallbackPoint = PATH[Math.max(1, Math.min(PATH.length - 2, 2 + this.rng.int(Math.max(1, PATH.length - 3))))];
      const positions = targets.length > 0 ? targets.map((enemy) => pathPosition(enemy.distance)) : [gridToWorld(fallbackPoint)];
      const fieldTier = axisBreakthroughTier(run, 'fieldcraft');
      for (const position of positions) {
        paintFieldCircle(run, position, fieldRadius(run, fieldTier >= 3 ? 0.78 : 0.62), MAT.OIL, 82, FLAG.PRESSURIZED | FLAG.PLAYER_OWNED);
        paintFieldCircle(run, { x: position.x + 18, y: position.y }, fieldRadius(run, fieldTier >= 3 ? 0.56 : 0.42), MAT.FIRE, 255, FLAG.BURNING | FLAG.PLAYER_OWNED);
        addImpact(run, position, 'burn', 'catalyze');
      }
      for (const enemy of targets) {
        enemy.exposedUntil = Math.max(enemy.exposedUntil, run.time + 4);
        enemy.slowUntil = Math.max(enemy.slowUntil, run.time + 0.65);
        damageEnemy(run, enemy, 18 + axisRank(run, 'fieldcraft') * 3 + fieldTier * 4);
      }
      run.charge += 1;
      run.stats.reactionsTriggered += Math.max(1, targets.length);
      logPhysics(run, 'Catalyze Front forced a controlled oil-fire reaction.');
      if (hasAxisResonance(run, 'fieldcraft_command')) {
        run.heroDirective = 'attack';
        run.heroDirectiveUntil = run.phase === 'planning' ? Number.POSITIVE_INFINITY : Math.max(run.heroDirectiveUntil, run.time + 8 + fieldTier);
        for (const hero of run.heroes) {
          hero.cooldown = Math.min(hero.cooldown, -0.2);
        }
        log(run, `${AXIS_RESONANCE_DEFS.fieldcraft_command.name} rallied heroes through the burning line.`);
      }
    } else if (axis === 'engineering') {
      const tuned = run.towers.slice(0, 4);
      const engineeringTier = axisBreakthroughTier(run, 'engineering');
      for (const tower of tuned) {
        tower.level += engineeringTier >= 3 ? 2 : 1;
        tower.cooldown = Math.min(tower.cooldown, 0);
        tower.buffUntil = Math.max(tower.buffUntil, run.time + 7 + engineeringTier);
      }
      if (hasAxisResonance(run, 'fieldcraft_engineering')) {
        run.charge += Math.max(1, Math.min(3, tuned.length));
        for (const tower of tuned) {
          paintFieldCircle(run, gridToWorld(tower), 0.42, MAT.METAL, 76, FLAG.CONDUCTING | FLAG.PLAYER_OWNED);
        }
        logPhysics(run, `${AXIS_RESONANCE_DEFS.fieldcraft_engineering.name} wired fabrication into conductive terrain.`);
      }
      run.scrap += 1 + run.machines.length + (engineeringTier >= 3 ? 2 : 0);
      run.overclockUntil = Math.max(run.overclockUntil, run.time + 5 + engineeringTier);
      if (tuned.length > 0) {
        run.stats.towersUpgraded += tuned.length;
        addImpact(run, gridToWorld(tuned[0]), 'shock', 'fabricate');
      } else {
        run.scrap += 2;
        addImpact(run, gridToWorld(CORE_CELL), 'reward', '+fabricate');
      }
    } else if (axis === 'command') {
      if (run.heroes.length === 0 && !run.heroes.some((hero) => hero.kind === 'kiteRanger')) {
        this.addHero(run, 'kiteRanger');
      }
      const commandTier = axisBreakthroughTier(run, 'command');
      if (commandTier >= 3 && !run.heroes.some((hero) => hero.kind === 'bulwark')) {
        this.addHero(run, 'bulwark');
      }
      run.heroDirective = run.enemies.some((enemy) => enemy.hp > 0) ? 'attack' : 'guard';
      run.heroDirectiveUntil = run.phase === 'planning' ? Number.POSITIVE_INFINITY : Math.max(run.heroDirectiveUntil, run.time + 16 + commandTier * 2);
      run.lives = Math.min(run.baseLives + 5, run.lives + 2 + Math.floor(commandTier / 2));
      for (const hero of run.heroes) {
        hero.cooldown = Math.min(hero.cooldown, -0.35);
      }
      if (hasAxisResonance(run, 'engineering_command')) {
        for (const tower of run.towers) {
          tower.buffUntil = Math.max(tower.buffUntil, run.time + 8 + commandTier);
        }
        if (run.towers.length > 0) {
          addImpact(run, gridToWorld(run.towers[0]), 'shock', 'war rig');
        }
        log(run, `${AXIS_RESONANCE_DEFS.engineering_command.name} overclocked the tower line.`);
      }
      run.stats.commandsIssued += 1;
      addImpact(run, gridToWorld(CORE_CELL), 'hero', 'rally');
    } else {
      const drawCount =
        2 +
        (axisRank(run, 'archive') >= 3 ? 1 : 0) +
        (axisBreakthroughTier(run, 'archive') >= 3 ? 1 : 0) +
        (hasAxisResonance(run, 'command_archive') ? 1 : 0);
      drawCards(run, drawCount, this.rng);
      run.energy += 1 + (hasAxisResonance(run, 'command_archive') ? 1 : 0);
      run.forceRelicNextReward = true;
      addImpact(run, gridToWorld(CORE_CELL), 'reward', '+index');
    }

    log(run, `${CORE_AXIS_DEFS[axis].name} Technique used: ${def.name}.`);
    refreshAxisDirectives(run, this.rng);
    this.save();
    this.emit();
    return true;
  }

  togglePause(): void {
    const run = this.run;
    if (!run || run.phase === 'defeat' || run.phase === 'victory' || run.phase === 'reward' || run.phase === 'route') return;
    if (run.phase === 'paused') {
      run.phase = run.previousPhase ?? 'planning';
      run.previousPhase = null;
    } else {
      run.previousPhase = run.phase;
      run.phase = 'paused';
    }
    this.emit();
  }

  private addHero(run: RunState, heroKind: HeroKind): void {
    const home = heroHome(heroKind);
    const commandProtocol = coreAxisProtocolTier(run, 'command');
    const powerups = hasAxisKeystone(run, 'command_heroCouncil') ? ['councilVow'] : [];
    if (commandProtocol >= 2 && !powerups.includes(COMMAND_PROTOCOL_POWER[heroKind])) {
      powerups.push(COMMAND_PROTOCOL_POWER[heroKind]);
    }
    run.heroes.push({
      id: nextId(`hero-${heroKind}`, run),
      kind: heroKind,
      x: home.x,
      y: home.y,
      cooldown: commandProtocol >= 1 || hasAxisKeystone(run, 'command_heroCouncil') ? -0.5 : 0,
      powerups,
    });
    run.stats.heroesRecruited += 1;
    if (commandProtocol >= 1) {
      run.lives = Math.min(run.baseLives + 5, run.lives + 1);
    }
  }

  private applyCard(run: RunState, cardId: CardId, target?: GridPoint, surgedAxis: CoreAxisId | null = null): boolean {
    const card = CARD_DEFS[cardId];
    if (card.type === 'tower') {
      if (!card.tower || !target || !canBuildAt(run, target)) {
        log(run, 'That card needs an open build pad.');
        return false;
      }
      const towerDef = TOWER_DEFS[card.tower];
      const engineeringSurge = surgedAxis === 'engineering';
      const reinforcedPads = hasAxisMastery(run, 'engineering_reinforcedPads');
      const momentumDiscount = Math.floor(axisMomentum(run, 'engineering') / 3);
      const scrapCost = Math.max(0, towerDef.cost - (engineeringSurge ? 2 : 0) - (reinforcedPads ? 1 : 0) - momentumDiscount);
      if (run.scrap < scrapCost) {
        log(run, `Need ${scrapCost} scrap for ${towerDef.name}.`);
        return false;
      }
      run.scrap -= scrapCost;
      run.towers.push({
        id: nextId(`tower-${card.tower}`, run),
        kind: card.tower,
        x: target.x,
        y: target.y,
        level: 1 + (engineeringSurge ? 1 : 0) + (reinforcedPads ? 1 : 0) + (hasAxisKeystone(run, 'engineering_autoForge') ? 1 : 0),
        branches: { damage: 0, range: 0, tempo: 0 },
        cooldown: 0,
        buffUntil: engineeringSurge || reinforcedPads || hasAxisKeystone(run, 'engineering_autoForge') ? run.time + 6 : 0,
        shots: 0,
      });
      paintFieldTile(run, target, MAT.METAL, 30, FLAG.PLAYER_OWNED);
      run.stats.towersBuilt += 1;
      log(run, `${towerDef.name} raised${engineeringSurge ? ' with an Engineering Surge' : ''}.`);
      return true;
    }

    if (card.type === 'upgrade') {
      if (!card.branch || !target) {
        return false;
      }
      const tower = getTowerAt(run, target);
      if (!tower) {
        log(run, 'Choose a tower to branch.');
        return false;
      }
      const branchGain = (surgedAxis === 'engineering' ? 2 : 1) + (hasAxisKeystone(run, 'engineering_autoForge') ? 1 : 0);
      tower.branches[card.branch] += branchGain;
      tower.level += branchGain;
      if (surgedAxis === 'engineering') {
        tower.buffUntil = Math.max(tower.buffUntil, run.time + 6);
      }
      run.stats.towersUpgraded += 1;
      log(run, `${TOWER_DEFS[tower.kind].name} branched into ${card.branch}${surgedAxis === 'engineering' ? ' twice' : ''}.`);
      return true;
    }

    if (cardId === 'overclock') {
      const baseDuration = surgedAxis === 'engineering' ? 12 : 8;
      const chargedBonus = run.charge >= 2 ? 4 : 0;
      if (chargedBonus > 0) {
        run.charge -= 2;
      }
      run.overclockUntil = Math.max(run.overclockUntil, run.time + baseDuration + chargedBonus);
      log(run, `Relay overclock active for ${baseDuration + chargedBonus} seconds.`);
      return true;
    }

    if (cardId === 'field_spanner') {
      if (!target) {
        log(run, 'Choose a tower for Field Spanner.');
        return false;
      }
      const tower = getTowerAt(run, target);
      if (!tower) {
        log(run, 'Field Spanner needs a tower.');
        return false;
      }
      tower.level += surgedAxis === 'engineering' ? 2 : 1;
      tower.buffUntil = Math.max(tower.buffUntil, run.time + (surgedAxis === 'engineering' ? 8 : 5));
      run.stats.towersUpgraded += 1;
      if (run.enemies.length > 0) {
        run.scrap += surgedAxis === 'engineering' ? 2 : 1;
      }
      log(run, `${TOWER_DEFS[tower.kind].name} tuned with a Field Spanner.`);
      return true;
    }

    if (cardId === 'seed_barrier') {
      const lives = surgedAxis === 'command' ? 3 : 2;
      run.lives += lives;
      log(run, `Seed Barrier added ${lives} temporary relay lives.`);
      return true;
    }

    if (card.type === 'field') {
      if (!target || !isInsideGrid(target)) {
        log(run, 'Choose a field cell.');
        return false;
      }
      const position = gridToWorld(target);
      const surgeRadius = surgedAxis === 'fieldcraft' ? 0.24 : 0;
      if (cardId === 'spill_water') {
        paintFieldCircle(run, position, fieldRadius(run, 0.75 + surgeRadius), MAT.WATER, 24, FLAG.PLAYER_OWNED);
        addImpact(run, position, 'frost', 'water');
      } else if (cardId === 'oil_slick') {
        paintFieldCircle(run, position, fieldRadius(run, 0.85 + surgeRadius), MAT.OIL, 55, FLAG.PLAYER_OWNED);
        addImpact(run, position, 'earth', 'oil');
      } else if (cardId === 'ignite_patch') {
        paintFieldCircle(run, position, fieldRadius(run, 0.65 + surgeRadius), MAT.FIRE, 255, FLAG.BURNING | FLAG.PLAYER_OWNED);
        addImpact(run, position, 'burn', 'ignite');
      } else if (cardId === 'cryo_seed') {
        paintFieldCircle(run, position, fieldRadius(run, 0.75 + surgeRadius), MAT.ICE, 2, FLAG.PLAYER_OWNED);
        addImpact(run, position, 'frost', 'cryo');
      } else if (cardId === 'sand_berm') {
        paintFieldCircle(run, position, fieldRadius(run, 0.8 + surgeRadius), MAT.SAND, 18, FLAG.PLAYER_OWNED);
        addImpact(run, position, 'earth', 'sand');
      } else if (cardId === 'conductor_rail') {
        paintFieldCircle(run, position, fieldRadius(run, 0.72 + surgeRadius), MAT.METAL, 70, FLAG.PLAYER_OWNED | FLAG.CONDUCTING);
        run.charge += 1;
        addImpact(run, position, 'shock', '+charge');
      } else if (cardId === 'vent_smoke') {
        paintFieldCircle(run, position, fieldRadius(run, 0.85 + surgeRadius), MAT.SMOKE, 68, FLAG.PRESSURIZED | FLAG.PLAYER_OWNED);
        addImpact(run, position, 'frost', 'smoke');
      }
      applyFieldcraftProtocolPulse(run, position, card.name);
      if (surgedAxis === 'fieldcraft') {
        run.charge += 1;
        addImpact(run, position, 'shock', '+surge');
      }
      if (hasAxisKeystone(run, 'fieldcraft_reactionBloom')) {
        run.charge += 1;
        run.stats.reactionsTriggered += 1;
        addImpact(run, position, 'shock', 'bloom');
      }
      if (hasAxisKeystone(run, 'fieldcraft_thermalSiphon') && run.charge >= 2) {
        run.charge -= 2;
        run.energy += 1;
        addImpact(run, position, 'reward', '+energy');
      }
      if (axisBreakthroughTier(run, 'fieldcraft') >= 1) {
        run.charge += 1;
      }
      if (hasAxisMastery(run, 'fieldcraft_flowChannels')) {
        run.charge += 1;
      }
      run.stats.fieldCardsPlayed += 1;
      run.stats.reactionsTriggered += 1;
      log(run, `${card.name} changed the field.`);
      return true;
    }

    if (card.type === 'command') {
      if (cardId === 'command_attack') {
        run.heroDirective = 'attack';
      } else if (cardId === 'command_guard') {
        run.heroDirective = 'guard';
      } else {
        run.heroDirective = 'service';
      }
      run.stats.commandsIssued += 1;
      const relayGuard = hasAxisMastery(run, 'command_relayGuard');
      const commandProtocol = coreAxisProtocolTier(run, 'command');
      run.heroDirectiveUntil =
        run.phase === 'planning' ? Number.POSITIVE_INFINITY : run.time + (surgedAxis === 'command' ? 18 : 12) + (relayGuard ? 4 : 0) + commandProtocol * 2;
      if (surgedAxis === 'command') {
        run.lives = Math.min(run.baseLives + 4, run.lives + 1);
        for (const hero of run.heroes) {
          hero.cooldown = Math.min(hero.cooldown, 0);
        }
      }
      if (hasAxisKeystone(run, 'command_battleStandard')) {
        run.lives = Math.min(run.baseLives + 5, run.lives + 1);
        for (const hero of run.heroes) {
          hero.cooldown = Math.min(hero.cooldown, -0.2);
        }
      }
      if (relayGuard && run.heroDirective === 'guard') {
        run.lives = Math.min(run.baseLives + 4, run.lives + 1);
      }
      if (commandProtocol >= 3) {
        const musterKind: HeroKind = cardId === 'command_attack' ? 'kiteRanger' : cardId === 'command_guard' ? 'bulwark' : 'fieldMechanic';
        if (!run.heroes.some((hero) => hero.kind === musterKind)) {
          this.addHero(run, musterKind);
          log(run, `${CORE_AXIS_PROTOCOL_DEFS.command[commandProtocol - 1].name} mustered ${HERO_DEFS[musterKind].name}.`);
        }
      }
      log(run, `${card.name} issued to all heroes.`);
      return true;
    }

    if (cardId === 'salvage_cache') {
      const scrap = (run.activeRoute === 'cache' ? 4 : 2) + (surgedAxis === 'archive' ? 2 : 0);
      const drawCount = surgedAxis === 'archive' ? 2 : 1;
      run.scrap += scrap;
      drawCards(run, drawCount, this.rng);
      addImpact(run, gridToWorld(CORE_CELL), 'reward', `+${scrap}`);
      log(run, `Salvage Cache recovered ${scrap} scrap and drew ${drawCount} card${drawCount === 1 ? '' : 's'}.`);
      return true;
    }

    if (card.type === 'hero') {
      if (!card.hero) return false;
      if (run.heroes.some((hero) => hero.kind === card.hero)) {
        log(run, `${HERO_DEFS[card.hero].name} is already recruited.`);
        return false;
      }
      this.addHero(run, card.hero);
      if (surgedAxis === 'command') {
        const addedHero = run.heroes.find((hero) => hero.kind === card.hero);
        if (addedHero) {
          addedHero.cooldown = -1;
        }
        run.heroDirective = 'attack';
        run.heroDirectiveUntil = run.phase === 'planning' ? Number.POSITIVE_INFINITY : Math.max(run.heroDirectiveUntil, run.time + 18);
        run.lives = Math.min(run.baseLives + 4, run.lives + 1);
      }
      log(run, `${HERO_DEFS[card.hero].name} recruited.`);
      return true;
    }

    if (cardId === 'aether_mill') {
      if (!target || !canBuildAt(run, target)) {
        log(run, 'Aether Mill needs an open build pad.');
        return false;
      }
      const machineCost = surgedAxis === 'engineering' ? 1 : 3;
      if (run.scrap < machineCost) {
        log(run, `Need ${machineCost} scrap for Aether Mill.`);
        return false;
      }
      run.scrap -= machineCost;
      run.machines.push({ id: nextId('machine-aether-mill', run), kind: 'aetherMill', x: target.x, y: target.y });
      paintFieldTile(run, target, MAT.METAL, 45, FLAG.PLAYER_OWNED | FLAG.CONDUCTING);
      run.charge += surgedAxis === 'engineering' ? 2 : 1;
      run.stats.machinesBuilt += 1;
      log(run, 'Aether Mill installed.');
      return true;
    }

    if (cardId === 'relic_probe') {
      run.forceRelicNextReward = true;
      if (surgedAxis === 'archive') {
        run.energy += 1;
        drawCards(run, 1, this.rng);
      }
      log(run, 'Relic Probe tuned the next reward draft.');
      return true;
    }

    return false;
  }

  private finalizeRun(): void {
    const run = this.run;
    if (!run) return;
    this.profile.runs += 1;
    if (run.phase === 'victory') {
      this.profile.wins += 1;
    }
    this.profile.bestWave = Math.max(this.profile.bestWave, run.wave);
    this.profile.memoryShards += Math.max(1, run.wave) + Math.floor(run.stats.kills / 10) + (run.phase === 'victory' ? 5 : 0);
    const unlocks = [...grantRunProfileUnlocks(run, this.profile), ...advanceCoreAxes(run, this.profile)];
    run.runUnlocks = unlocks;
    if (unlocks.length > 0) {
      for (const unlock of unlocks) {
        log(run, unlock);
      }
    }
    this.save();
  }
}

function emptyRun(): RunState {
  const terrainProfile = generateStartingTerrain('woodlandRelay', createRng('empty:terrain:woodlandRelay'));
  const stateSpace = createDefenseField('woodlandRelay', terrainProfile.pockets);
  return {
    seed: 'empty',
    mapId: 'woodlandRelay',
    terrainProfile,
    phase: 'paused',
    previousPhase: null,
    time: 0,
    wave: 1,
    waveTime: 0,
    lives: 0,
    baseLives: 0,
    scrap: 0,
    charge: 0,
    energy: 0,
    firstCardRefundAvailable: false,
    selectedCardInstanceId: null,
    inspectTarget: null,
    drawPile: [],
    hand: [],
    discardPile: [],
    towers: [],
    heroes: [],
    enemies: [],
    projectiles: [],
    machines: [],
    relics: [],
    rewardChoices: [],
    routeChoices: [],
    activeRoute: 'standard',
    nextRoute: 'standard',
    activeTrial: null,
    nextTrial: null,
    difficultyDirector: emptyDifficultyDirectorState(1),
    coreAxes: { fieldcraft: 0, engineering: 0, command: 0, archive: 0 },
    axisDirectives: createAxisDirectives({ fieldcraft: 0, engineering: 0, command: 0, archive: 0 }),
    axisSurges: createAxisCounter(),
    axisMasteries: [],
    axisKeystones: [],
    axisMomentum: createAxisCounter(),
    axisBreakthroughs: createAxisCounter(),
    axisFocus: null,
    spawnQueue: [],
    overclockUntil: 0,
    heroDirective: 'balanced',
    heroDirectiveUntil: 0,
    forceRelicNextReward: false,
    runUnlocks: [],
    stateSpace,
    physicsAccumulator: 0,
    fieldSummary: summarizeField(stateSpace),
    impacts: [],
    physicsEvents: [],
    log: [],
    stats: {
      kills: 0,
      cardsPlayed: 0,
      towersBuilt: 0,
      heroesRecruited: 0,
      routesTaken: 0,
      reactionsTriggered: 0,
      fieldCardsPlayed: 0,
      towersUpgraded: 0,
      machinesBuilt: 0,
      commandsIssued: 0,
      rewardsClaimed: 0,
      axisDirectivesCompleted: 0,
      axisSurgesEarned: 0,
      axisSurgesSpent: 0,
      axisMasteriesClaimed: 0,
      axisKeystonesClaimed: 0,
      axisMomentumGained: 0,
      axisTechniquesUsed: 0,
      axisBreakthroughsUnlocked: 0,
      axisTrialsTaken: 0,
      axisTrialsCleared: 0,
    },
  };
}

export function terrainFrameForCell(point: GridPoint): number {
  if (pointEquals(point, CORE_CELL)) return 5;
  if (BUILD_PADS.some((pad) => pointEquals(pad, point))) return 4;
  const onPath = PATH_SEGMENTS.some((segment) => {
    const cellCenter = gridToWorld(point);
    const segmentVector = { x: segment.end.x - segment.start.x, y: segment.end.y - segment.start.y };
    const cellVector = { x: cellCenter.x - segment.start.x, y: cellCenter.y - segment.start.y };
    const segmentLengthSq = segmentVector.x * segmentVector.x + segmentVector.y * segmentVector.y;
    const dot = (cellVector.x * segmentVector.x + cellVector.y * segmentVector.y) / segmentLengthSq;
    if (dot < 0 || dot > 1) return false;
    const closest = {
      x: segment.start.x + segmentVector.x * dot,
      y: segment.start.y + segmentVector.y * dot,
    };
    return distanceBetween(cellCenter, closest) < TILE_SIZE * 0.45;
  });
  if (onPath) return 1;
  if ((point.x + point.y) % 11 === 0) return 6;
  if (point.x === 0 || point.y === 0 || point.x === GRID_COLUMNS - 1 || point.y === GRID_ROWS - 1) return 2;
  if ((point.x * 3 + point.y * 7) % 17 === 0) return 3;
  if ((point.x + point.y * 2) % 9 === 0) return 7;
  return 0;
}

export function selectedCard(run: RunState | null): CardInstance | null {
  if (!run?.selectedCardInstanceId) return null;
  return run.hand.find((card) => card.instanceId === run.selectedCardInstanceId) ?? null;
}

export function inspectTower(run: RunState | null): TowerState | null {
  if (!run || run.inspectTarget?.kind !== 'tower') return null;
  const target = run.inspectTarget;
  return run.towers.find((tower) => tower.id === target.id) ?? null;
}

export function rewardLabel(choice: RewardChoice): string {
  return rewardDescriptionFor(choice);
}
