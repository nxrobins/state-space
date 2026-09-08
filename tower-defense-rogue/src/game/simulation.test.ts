import { describe, expect, it } from 'vitest';
import {
  AXIS_KEYSTONE_DEFS,
  AXIS_TRIAL_DEFS,
  GameModel,
  activeAxisResonances,
  axisBreakthroughTier,
  canUseAxisTechnique,
  coreAxisProtocolTier,
  type AxisTrialId,
  type CardInstance,
  type EnemyState,
  type RunState,
} from './simulation';
import {
  BUILD_PADS,
  CORE_CELL,
  ENEMY_DEFS,
  GRID_COLUMNS,
  GRID_ROWS,
  ROUTE_NODE_DEFS,
  TERRAIN_HEURISTIC_DEFS,
  isBuildPad,
  type EnemyKind,
  type GridPoint,
} from './content';
import { type StorageLike } from './profile';

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function oneCard(cardId: CardInstance['cardId'], instanceId = `${cardId}-test`): CardInstance {
  return { cardId, instanceId };
}

function distanceBetweenPoints(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function terrainFingerprint(run: RunState): string {
  return run.terrainProfile.pockets
    .filter((pocket) => pocket.source === 'heuristic')
    .map((pocket) => `${pocket.material}:${pocket.point.x},${pocket.point.y}:r${pocket.radius}:t${pocket.thermal}`)
    .join('|');
}

function prepareDirectorRoute(run: RunState): void {
  run.phase = 'planning';
  run.wave = 6;
  run.activeRoute = 'elite';
  run.activeTrial = 'engineering_armoredColumn';
  run.spawnQueue = [];
  run.enemies = [];
}

function strengthenForDirector(run: RunState): void {
  prepareDirectorRoute(run);
  run.scrap = 24;
  run.charge = 12;
  run.hand = [
    oneCard('build_ember', 'power-hand-1'),
    oneCard('build_sun', 'power-hand-2'),
    oneCard('overclock', 'power-hand-3'),
    oneCard('command_attack', 'power-hand-4'),
    oneCard('conductor_rail', 'power-hand-5'),
  ];
  run.relics = ['emberLens', 'clockSeed', 'pressureCrown', 'glassHeart'];
  run.towers = [
    { id: 'power-tower-1', kind: 'sunForge', x: 1, y: 3, level: 4, branches: { damage: 3, range: 2, tempo: 2 }, cooldown: 0, buffUntil: 0, shots: 0 },
    { id: 'power-tower-2', kind: 'emberCoil', x: 3, y: 6, level: 3, branches: { damage: 2, range: 1, tempo: 2 }, cooldown: 0, buffUntil: 0, shots: 0 },
    { id: 'power-tower-3', kind: 'voltSpire', x: 8, y: 2, level: 3, branches: { damage: 1, range: 2, tempo: 3 }, cooldown: 0, buffUntil: 0, shots: 0 },
  ];
  run.heroes = [
    { id: 'power-hero-1', kind: 'kiteRanger', x: 0, y: 0, cooldown: 0, powerups: ['splitArrow'] },
    { id: 'power-hero-2', kind: 'bulwark', x: 0, y: 0, cooldown: 0, powerups: ['rootStance'] },
  ];
  run.machines = [{ id: 'power-machine-1', kind: 'aetherMill', x: 13, y: 3 }];
  run.axisMomentum = { fieldcraft: 6, engineering: 6, command: 6, archive: 6 };
  run.axisBreakthroughs = { fieldcraft: 3, engineering: 3, command: 3, archive: 3 };
  run.axisMasteries = ['fieldcraft_combustionLens', 'engineering_machineShop', 'command_vanguardSignal', 'archive_routeLedger'];
  run.axisKeystones = ['engineering_autoForge', 'command_battleStandard', 'archive_fateMarket'];
}

describe('tower defense simulation', () => {
  it('plays a tower card onto an open build pad', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('build-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    run.hand = [oneCard('build_ember')];
    run.energy = 3;
    run.scrap = 8;

    const played = model.playCard('build_ember-test', { x: 1, y: 3 });

    expect(played).toBe(true);
    expect(run.towers).toHaveLength(1);
    expect(run.towers[0].kind).toBe('emberCoil');
    expect(run.scrap).toBe(5);
    expect(run.discardPile.map((card) => card.cardId)).toContain('build_ember');
  });

  it('keeps targeted cards selected until a valid target is supplied', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('target-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    run.hand = [oneCard('build_bloom')];
    run.energy = 2;
    run.scrap = 10;

    const played = model.playCard('build_bloom-test');

    expect(played).toBe(false);
    expect(run.selectedCardInstanceId).toBe('build_bloom-test');
    expect(run.towers).toHaveLength(0);
  });

  it('lets towers damage enemies through the renderer-independent update loop', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('combat-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    run.hand = [oneCard('build_ember')];
    run.energy = 3;
    run.scrap = 8;
    model.playCard('build_ember-test', { x: 3, y: 6 });
    run.phase = 'wave';
    run.spawnQueue = [];
    const maxHp = ENEMY_DEFS.siltling.hp;
    const enemy: EnemyState = {
      id: 'enemy-test',
      kind: 'siltling',
      hp: maxHp,
      maxHp,
      distance: 92,
      slowUntil: 0,
      pinUntil: 0,
      exposedUntil: 0,
      elite: false,
      bountyPaid: false,
    };
    run.enemies = [enemy];

    model.update(100);

    expect(enemy.hp).toBeLessThan(maxHp);
  });

  it('adds reward cards into the run deck and advances into route choice', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('reward-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    run.phase = 'reward';
    run.wave = 1;
    run.rewardChoices = [
      {
        choiceId: 'card:overclock:1',
        type: 'card',
        rewardId: 'overclock',
        name: 'Overclock Relay',
        description: 'Add this card.',
      },
    ];

    model.chooseReward('card:overclock:1');

    expect(run.wave).toBe(2);
    expect(run.phase).toBe('route');
    expect(run.routeChoices.length).toBeGreaterThanOrEqual(3);
    const runDeck = [...run.hand, ...run.drawPile, ...run.discardPile];
    expect(runDeck.some((card) => card.cardId === 'overclock')).toBe(true);
  });

  it('applies route choices before the next planning phase', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('route-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    run.phase = 'route';
    run.wave = 2;
    run.scrap = 0;
    run.routeChoices = [
      {
        choiceId: 'route:cache:2:0',
        type: 'cache',
        name: 'Salvage Cache',
        description: 'Cache test.',
        threat: 0,
      },
    ];

    model.chooseRoute('route:cache:2:0');

    expect(run.phase).toBe('planning');
    expect(run.activeRoute).toBe('cache');
    expect(run.scrap).toBeGreaterThanOrEqual(3);
    expect(run.stats.routesTaken).toBe(1);
  });

  it('starts on a selected unlocked map and applies persistent core axis bonuses', () => {
    const model = new GameModel(new MemoryStorage());
    model.profile.unlockedMaps.push('oilworks');
    model.profile.coreAxes.engineering = 2;
    model.profile.coreAxes.command = 2;
    model.profile.coreAxes.fieldcraft = 2;
    model.startRun('map-axis-test', 'oilworks');
    const run = model.run;
    if (!run) throw new Error('run was not created');

    expect(run.mapId).toBe('oilworks');
    expect(run.scrap).toBeGreaterThanOrEqual(12);
    expect(run.baseLives).toBe(15);
    expect(run.charge).toBe(1);
    expect(run.coreAxes.engineering).toBe(2);
  });

  it('generates deterministic seeded starting terrain and paints it into state-space', () => {
    const first = new GameModel(new MemoryStorage());
    first.profile.unlockedMaps.push('floodedBasin');
    first.startRun('terrain-seed-test', 'floodedBasin');
    const firstRun = first.run;
    if (!firstRun) throw new Error('run was not created');

    const second = new GameModel(new MemoryStorage());
    second.profile.unlockedMaps.push('floodedBasin');
    second.startRun('terrain-seed-test', 'floodedBasin');
    const secondRun = second.run;
    if (!secondRun) throw new Error('run was not created');

    expect(firstRun.terrainProfile).toEqual(secondRun.terrainProfile);
    expect(firstRun.physicsEvents[0]).toContain(firstRun.terrainProfile.name);
    expect(firstRun.fieldSummary.dominant).not.toBe('air');

    const generatedPocket = firstRun.terrainProfile.pockets.find((pocket) => pocket.source === 'heuristic');
    if (!generatedPocket) throw new Error('terrain generation did not create a pocket');
    const sampleX = Math.floor((generatedPocket.point.x + 0.5) * (firstRun.stateSpace.width / GRID_COLUMNS));
    const sampleY = Math.floor((generatedPocket.point.y + 0.5) * (firstRun.stateSpace.height / GRID_ROWS));
    expect(firstRun.stateSpace.sample(sampleX, sampleY).material).toBeGreaterThan(0);
  });

  it('rolls diverse starting terrain layouts from the same map pool', () => {
    const fingerprints = new Set<string>();
    for (const seed of ['terrain-a', 'terrain-b', 'terrain-c', 'terrain-d', 'terrain-e']) {
      const model = new GameModel(new MemoryStorage());
      model.startRun(seed, 'woodlandRelay');
      const run = model.run;
      if (!run) throw new Error('run was not created');
      fingerprints.add(`${run.terrainProfile.heuristicId}:${terrainFingerprint(run)}`);
    }

    expect(fingerprints.size).toBeGreaterThan(1);
  });

  it('keeps generated terrain inside map bounds and selected heuristic constraints', () => {
    const model = new GameModel(new MemoryStorage());
    model.profile.unlockedMaps.push('glassFoundry');
    model.startRun('terrain-constraint-test', 'glassFoundry');
    const run = model.run;
    if (!run) throw new Error('run was not created');

    const heuristic = TERRAIN_HEURISTIC_DEFS[run.terrainProfile.heuristicId];
    const generated = run.terrainProfile.pockets.filter((pocket) => pocket.source === 'heuristic');

    expect(generated.length).toBe(run.terrainProfile.generatedCount);
    expect(generated.length).toBeGreaterThanOrEqual(heuristic.pocketCount.min);
    expect(generated.length).toBeLessThanOrEqual(heuristic.pocketCount.max);

    for (const pocket of generated) {
      expect(pocket.point.x).toBeGreaterThan(0);
      expect(pocket.point.x).toBeLessThan(GRID_COLUMNS - 1);
      expect(pocket.point.y).toBeGreaterThan(0);
      expect(pocket.point.y).toBeLessThan(GRID_ROWS - 1);
      expect(isBuildPad(pocket.point)).toBe(false);
      expect(BUILD_PADS.every((pad) => distanceBetweenPoints(pocket.point, pad) > 0)).toBe(true);
      expect(distanceBetweenPoints(pocket.point, CORE_CELL)).toBeGreaterThan(0);
      expect(heuristic.materials).toContain(pocket.material);
      expect(pocket.radius ?? 1).toBeGreaterThanOrEqual(heuristic.radiusRange.min);
      expect(pocket.radius ?? 1).toBeLessThanOrEqual(heuristic.radiusRange.max);
    }
  });

  it('activates rank-gated Core Axis Protocols across all four axes', () => {
    const fieldcraft = new GameModel(new MemoryStorage());
    fieldcraft.profile.coreAxes.fieldcraft = 6;
    fieldcraft.startRun('fieldcraft-protocol-test');
    const fieldRun = fieldcraft.run;
    if (!fieldRun) throw new Error('run was not created');
    const fieldHp = ENEMY_DEFS.thornback.hp;
    fieldRun.hand = [oneCard('spill_water')];
    fieldRun.energy = 1;
    fieldRun.enemies = [
      {
        id: 'field-protocol-target',
        kind: 'thornback',
        hp: fieldHp,
        maxHp: fieldHp,
        distance: 480,
        slowUntil: 0,
        pinUntil: 0,
        exposedUntil: 0,
        elite: false,
        bountyPaid: false,
      },
    ];
    const chargeBefore = fieldRun.charge;

    expect(coreAxisProtocolTier(fieldRun, 'fieldcraft')).toBe(3);
    expect(fieldcraft.playCard('spill_water-test', { x: 5, y: 5 })).toBe(true);
    expect(fieldRun.charge).toBeGreaterThan(chargeBefore);
    expect(fieldRun.enemies[0].exposedUntil).toBeGreaterThan(fieldRun.time);
    expect(fieldRun.enemies[0].hp).toBeLessThan(fieldHp);

    const engineering = new GameModel(new MemoryStorage());
    engineering.profile.coreAxes.engineering = 6;
    engineering.startRun('engineering-protocol-test');
    const engineeringRun = engineering.run;
    if (!engineeringRun) throw new Error('run was not created');
    engineeringRun.hand = [oneCard('build_ember')];
    engineeringRun.energy = 1;
    engineeringRun.scrap = 8;
    expect(engineering.playCard('build_ember-test', { x: 3, y: 6 })).toBe(true);
    const tower = engineeringRun.towers[0];
    tower.shots = 3;
    const towerLevel = tower.level;
    engineeringRun.phase = 'wave';
    engineeringRun.spawnQueue = [];
    engineeringRun.enemies = [
      {
        id: 'engineering-protocol-target',
        kind: 'thornback',
        hp: ENEMY_DEFS.thornback.hp,
        maxHp: ENEMY_DEFS.thornback.hp,
        distance: 92,
        slowUntil: 0,
        pinUntil: 0,
        exposedUntil: 0,
        elite: false,
        bountyPaid: false,
      },
    ];

    expect(coreAxisProtocolTier(engineeringRun, 'engineering')).toBe(3);
    engineering.update(100);
    expect(tower.level).toBeGreaterThan(towerLevel);
    expect(tower.branches.damage + tower.branches.range + tower.branches.tempo).toBeGreaterThan(0);
    expect(engineeringRun.charge).toBeGreaterThan(0);

    const command = new GameModel(new MemoryStorage());
    command.profile.coreAxes.command = 6;
    command.startRun('command-protocol-test');
    const commandRun = command.run;
    if (!commandRun) throw new Error('run was not created');
    commandRun.hand = [oneCard('recruit_ranger')];
    commandRun.energy = 2;

    expect(coreAxisProtocolTier(commandRun, 'command')).toBe(3);
    expect(command.playCard('recruit_ranger-test')).toBe(true);
    expect(commandRun.heroes[0].powerups).toContain('splitArrow');
    expect(commandRun.heroes[0].cooldown).toBeLessThan(0);

    commandRun.hand = [oneCard('command_guard')];
    commandRun.energy = 1;
    expect(command.playCard('command_guard-test')).toBe(true);
    expect(commandRun.heroes.map((hero) => hero.kind)).toContain('bulwark');
    expect(commandRun.heroes.find((hero) => hero.kind === 'bulwark')?.powerups).toContain('rootStance');

    const archive = new GameModel(new MemoryStorage());
    archive.profile.coreAxes.archive = 6;
    archive.startRun('archive-protocol-test');
    const archiveRun = archive.run;
    if (!archiveRun) throw new Error('run was not created');

    expect(coreAxisProtocolTier(archiveRun, 'archive')).toBe(3);
    expect(archiveRun.energy).toBeGreaterThanOrEqual(5);
    expect(archiveRun.hand.length).toBeGreaterThanOrEqual(7);

    archiveRun.phase = 'wave';
    archiveRun.spawnQueue = [];
    archiveRun.enemies = [];
    archive.update(16);

    expect(archiveRun.phase).toBe('reward');
    expect(archiveRun.rewardChoices).toHaveLength(5);
    expect(archiveRun.rewardChoices.some((choice) => choice.type === 'relic')).toBe(true);
  });

  it('offers and applies Core Axis Protocol reward infusions', () => {
    const offerModel = new GameModel(new MemoryStorage());
    offerModel.profile.coreAxes.fieldcraft = 6;
    offerModel.profile.coreAxes.engineering = 6;
    offerModel.profile.coreAxes.command = 6;
    offerModel.profile.coreAxes.archive = 6;
    offerModel.startRun('protocol-infusion-offer-test');
    const offerRun = offerModel.run;
    if (!offerRun) throw new Error('run was not created');
    offerRun.phase = 'wave';
    offerRun.spawnQueue = [];
    offerRun.enemies = [];

    offerModel.update(16);

    const protocolChoices = offerRun.rewardChoices.filter((choice) => choice.type === 'axisProtocol');
    expect(protocolChoices.length).toBeGreaterThan(0);
    expect(protocolChoices.every((choice) => `${choice.rewardId}`.startsWith('axisProtocol:'))).toBe(true);

    const applyProtocol = (axis: 'fieldcraft' | 'engineering' | 'command' | 'archive') => {
      const model = new GameModel(new MemoryStorage());
      model.profile.coreAxes[axis] = 6;
      model.startRun(`protocol-infusion-${axis}`);
      const run = model.run;
      if (!run) throw new Error('run was not created');
      run.phase = 'reward';
      run.wave = 1;
      run.rewardChoices = [
        {
          choiceId: `axisProtocol:${axis}:test`,
          type: 'axisProtocol',
          rewardId: `axisProtocol:${axis}`,
          name: `${axis} protocol`,
          description: 'Protocol test.',
        },
      ];
      return { model, run };
    };

    const fieldcraft = applyProtocol('fieldcraft');
    const fieldCharge = fieldcraft.run.charge;
    fieldcraft.model.chooseReward('axisProtocol:fieldcraft:test');
    expect(fieldcraft.run.charge).toBeGreaterThan(fieldCharge);
    expect(fieldcraft.run.axisMomentum.fieldcraft).toBeGreaterThan(0);
    expect(fieldcraft.run.stats.reactionsTriggered).toBeGreaterThan(0);

    const engineering = applyProtocol('engineering');
    engineering.run.towers = [
      { id: 'protocol-tower', kind: 'emberCoil', x: 1, y: 3, level: 1, branches: { damage: 0, range: 0, tempo: 0 }, cooldown: 1, buffUntil: 0, shots: 0 },
    ];
    const engineeringScrap = engineering.run.scrap;
    engineering.model.chooseReward('axisProtocol:engineering:test');
    expect(engineering.run.scrap).toBeGreaterThan(engineeringScrap);
    expect(engineering.run.towers[0].level).toBeGreaterThan(1);
    expect(engineering.run.towers[0].branches.damage + engineering.run.towers[0].branches.range + engineering.run.towers[0].branches.tempo).toBeGreaterThan(0);

    const command = applyProtocol('command');
    const commandLives = command.run.lives;
    command.model.chooseReward('axisProtocol:command:test');
    expect(command.run.lives).toBeGreaterThan(commandLives);
    expect(command.run.heroes.map((hero) => hero.kind)).toContain('bulwark');
    expect(command.run.heroes[0].cooldown).toBeLessThan(0);

    const archive = applyProtocol('archive');
    archive.model.chooseReward('axisProtocol:archive:test');
    expect(archive.run.forceRelicNextReward).toBe(true);
    expect(archive.run.discardPile.map((card) => card.cardId)).toEqual(expect.arrayContaining(['salvage_cache', 'relic_probe']));
    expect(archive.run.axisMomentum.archive).toBeGreaterThan(0);
  });

  it('arms active Axis Focus choices with bonuses and director pressure', () => {
    const fieldcraft = new GameModel(new MemoryStorage());
    fieldcraft.profile.coreAxes.fieldcraft = 4;
    fieldcraft.startRun('fieldcraft-focus-test');
    const fieldRun = fieldcraft.run;
    if (!fieldRun) throw new Error('run was not created');
    const fieldCharge = fieldRun.charge;

    expect(fieldcraft.setAxisFocus('fieldcraft')).toBe(true);
    fieldcraft.startWave();

    expect(fieldRun.axisFocus).toBe('fieldcraft');
    expect(fieldRun.charge).toBeGreaterThan(fieldCharge);
    expect(fieldRun.axisMomentum.fieldcraft).toBeGreaterThan(0);
    expect(fieldRun.difficultyDirector.focusAxis).toBe('fieldcraft');
    expect(fieldRun.difficultyDirector.focusPressure).toBeGreaterThan(0);

    const engineering = new GameModel(new MemoryStorage());
    engineering.profile.coreAxes.engineering = 6;
    engineering.startRun('engineering-focus-test');
    const engineeringRun = engineering.run;
    if (!engineeringRun) throw new Error('run was not created');
    engineeringRun.hand = [oneCard('build_ember')];
    engineeringRun.energy = 1;
    engineeringRun.scrap = 6;
    expect(engineering.playCard('build_ember-test', { x: 1, y: 3 })).toBe(true);
    const towerLevel = engineeringRun.towers[0].level;

    expect(engineering.setAxisFocus('engineering')).toBe(true);
    engineering.startWave();

    expect(engineeringRun.towers[0].buffUntil).toBeGreaterThan(engineeringRun.time);
    expect(engineeringRun.towers[0].level).toBeGreaterThanOrEqual(towerLevel + 1);
    expect(engineeringRun.axisMomentum.engineering).toBeGreaterThan(0);
    expect(engineeringRun.difficultyDirector.focusAxis).toBe('engineering');

    const command = new GameModel(new MemoryStorage());
    command.profile.coreAxes.command = 6;
    command.startRun('command-focus-test');
    const commandRun = command.run;
    if (!commandRun) throw new Error('run was not created');
    const livesBefore = commandRun.lives;

    expect(command.setAxisFocus('command')).toBe(true);
    command.startWave();

    expect(commandRun.lives).toBeGreaterThan(livesBefore);
    expect(commandRun.heroDirective).toBe('guard');
    expect(commandRun.heroes.map((hero) => hero.kind)).toContain('kiteRanger');
    expect(commandRun.axisMomentum.command).toBeGreaterThan(0);
    expect(commandRun.difficultyDirector.focusAxis).toBe('command');

    const archive = new GameModel(new MemoryStorage());
    archive.profile.coreAxes.archive = 6;
    archive.startRun('archive-focus-test');
    const archiveRun = archive.run;
    if (!archiveRun) throw new Error('run was not created');
    const handBefore = archiveRun.hand.length;

    expect(archive.setAxisFocus('archive')).toBe(true);
    archive.startWave();

    expect(archiveRun.hand.length).toBeGreaterThan(handBefore);
    expect(archiveRun.energy).toBeGreaterThan(3);
    expect(archiveRun.forceRelicNextReward).toBe(true);
    expect(archiveRun.axisMomentum.archive).toBeGreaterThan(0);
    expect(archiveRun.difficultyDirector.focusAxis).toBe('archive');

    expect(archive.setAxisFocus('fieldcraft')).toBe(false);
  });

  it('completes active axis directives and grants run rewards', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('directive-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    run.hand = [oneCard('spill_water', 'spill-1'), oneCard('spill_water', 'spill-2')];
    run.energy = 3;
    run.charge = 0;

    expect(model.playCard('spill-1', { x: 5, y: 5 })).toBe(true);
    expect(model.playCard('spill-2', { x: 6, y: 5 })).toBe(true);

    const directive = run.axisDirectives.find((candidate) => candidate.axis === 'fieldcraft');
    expect(directive?.completed).toBe(true);
    expect(run.charge).toBeGreaterThanOrEqual(2);
    expect(run.axisSurges.fieldcraft).toBe(1);
    expect(run.stats.axisSurgesEarned).toBe(1);
    expect(run.stats.axisDirectivesCompleted).toBe(1);

    run.hand = [oneCard('ignite_patch', 'ignite-free')];
    run.energy = 0;

    expect(model.playCard('ignite-free', { x: 8, y: 5 })).toBe(true);
    expect(run.energy).toBe(0);
    expect(run.charge).toBeGreaterThanOrEqual(3);
    expect(run.axisSurges.fieldcraft).toBe(0);
    expect(run.stats.axisSurgesSpent).toBe(1);
  });

  it('spends engineering surges on stronger discounted builds', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('engineering-surge-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    run.hand = [oneCard('build_ember')];
    run.energy = 0;
    run.scrap = 1;
    run.axisSurges.engineering = 1;

    expect(model.playCard('build_ember-test', { x: 1, y: 3 })).toBe(true);

    expect(run.scrap).toBe(0);
    expect(run.towers).toHaveLength(1);
    expect(run.towers[0].level).toBe(2);
    expect(run.towers[0].buffUntil).toBeGreaterThan(run.time);
    expect(run.axisSurges.engineering).toBe(0);
    expect(run.stats.axisSurgesSpent).toBe(1);
  });

  it('spends command and archive surges on matching deck plays', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('command-archive-surge-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');

    run.hand = [oneCard('recruit_ranger')];
    run.energy = 0;
    run.axisSurges.command = 1;
    const livesBefore = run.lives;

    expect(model.playCard('recruit_ranger-test')).toBe(true);
    expect(run.heroes).toHaveLength(1);
    expect(run.heroDirective).toBe('attack');
    expect(run.lives).toBe(livesBefore + 1);
    expect(run.axisSurges.command).toBe(0);

    run.hand = [oneCard('relic_probe'), oneCard('spill_water', 'draw-card')];
    run.drawPile = [oneCard('ignite_patch', 'drawn-ignite')];
    run.energy = 0;
    run.axisSurges.archive = 1;

    expect(model.playCard('relic_probe-test')).toBe(true);
    expect(run.forceRelicNextReward).toBe(true);
    expect(run.energy).toBe(1);
    expect(run.hand.some((card) => card.instanceId === 'drawn-ignite')).toBe(true);
    expect(run.axisSurges.archive).toBe(0);
    expect(run.stats.axisSurgesSpent).toBe(2);
  });

  it('offers axis mastery branches after completed directives', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('mastery-reward-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    run.hand = [oneCard('spill_water', 'spill-1'), oneCard('ignite_patch', 'ignite-1')];
    run.energy = 3;
    run.charge = 0;

    expect(model.playCard('spill-1', { x: 5, y: 5 })).toBe(true);
    expect(model.playCard('ignite-1', { x: 6, y: 5 })).toBe(true);
    run.phase = 'wave';
    run.spawnQueue = [];
    run.enemies = [];

    model.update(16);

    const masteryChoices = run.rewardChoices.filter((choice) => choice.type === 'axisMastery');
    expect(run.phase).toBe('reward');
    expect(masteryChoices).toHaveLength(2);
    expect(masteryChoices.map((choice) => choice.rewardId)).toEqual(
      expect.arrayContaining(['fieldcraft_flowChannels', 'fieldcraft_combustionLens']),
    );

    const flowChoice = masteryChoices.find((choice) => choice.rewardId === 'fieldcraft_flowChannels');
    if (!flowChoice) throw new Error('Flow Channels was not offered');
    model.chooseReward(flowChoice.choiceId);

    expect(run.axisMasteries).toContain('fieldcraft_flowChannels');
    expect(run.stats.axisMasteriesClaimed).toBe(1);
    expect(run.charge).toBeGreaterThanOrEqual(3);
  });

  it('axis mastery branches change engineering, command, and archive systems', () => {
    const engineering = new GameModel(new MemoryStorage());
    engineering.startRun('engineering-mastery-test');
    const engineeringRun = engineering.run;
    if (!engineeringRun) throw new Error('run was not created');
    engineeringRun.axisMasteries.push('engineering_reinforcedPads');
    engineeringRun.hand = [oneCard('build_ember')];
    engineeringRun.energy = 1;
    engineeringRun.scrap = 2;

    expect(engineering.playCard('build_ember-test', { x: 1, y: 3 })).toBe(true);
    expect(engineeringRun.scrap).toBeGreaterThanOrEqual(0);
    expect(engineeringRun.towers[0].level).toBe(2);

    const command = new GameModel(new MemoryStorage());
    command.startRun('command-mastery-test');
    const commandRun = command.run;
    if (!commandRun) throw new Error('run was not created');
    commandRun.phase = 'reward';
    commandRun.rewardChoices = [
      {
        choiceId: 'axisMastery:command_relayGuard:1',
        type: 'axisMastery',
        rewardId: 'command_relayGuard',
        name: 'Command: Relay Guard',
        description: 'Test mastery.',
      },
    ];
    const baseLives = commandRun.baseLives;
    const lives = commandRun.lives;

    command.chooseReward('axisMastery:command_relayGuard:1');

    expect(commandRun.axisMasteries).toContain('command_relayGuard');
    expect(commandRun.baseLives).toBe(baseLives + 1);
    expect(commandRun.lives).toBeGreaterThan(lives);

    const archive = new GameModel(new MemoryStorage());
    archive.startRun('archive-mastery-test');
    const archiveRun = archive.run;
    if (!archiveRun) throw new Error('run was not created');
    archiveRun.axisMasteries.push('archive_deepScry');
    archiveRun.phase = 'wave';
    archiveRun.spawnQueue = [];
    archiveRun.enemies = [];

    archive.update(16);

    expect(archiveRun.phase).toBe('reward');
    expect(archiveRun.rewardChoices).toHaveLength(4);
  });

  it('builds axis momentum and feeds it back into all core systems', () => {
    const fieldcraft = new GameModel(new MemoryStorage());
    fieldcraft.startRun('fieldcraft-momentum-test');
    const fieldRun = fieldcraft.run;
    if (!fieldRun) throw new Error('run was not created');
    fieldRun.hand = [oneCard('spill_water')];
    fieldRun.energy = 1;

    expect(fieldcraft.playCard('spill_water-test', { x: 5, y: 5 })).toBe(true);
    expect(fieldRun.axisMomentum.fieldcraft).toBe(1);
    expect(fieldRun.stats.axisMomentumGained).toBe(1);

    const engineering = new GameModel(new MemoryStorage());
    engineering.startRun('engineering-momentum-test');
    const engineeringRun = engineering.run;
    if (!engineeringRun) throw new Error('run was not created');
    engineeringRun.axisMomentum.engineering = 3;
    engineeringRun.hand = [oneCard('build_ember')];
    engineeringRun.energy = 1;
    engineeringRun.scrap = 2;

    expect(engineering.playCard('build_ember-test', { x: 1, y: 3 })).toBe(true);
    expect(engineeringRun.scrap).toBeGreaterThanOrEqual(0);
    expect(engineeringRun.axisMomentum.engineering).toBe(4);

    const route = new GameModel(new MemoryStorage());
    route.startRun('route-momentum-test');
    const routeRun = route.run;
    if (!routeRun) throw new Error('run was not created');
    routeRun.phase = 'route';
    routeRun.wave = 2;
    routeRun.routeChoices = [
      {
        choiceId: 'route:standard:2:0',
        type: 'standard',
        name: 'Stable Line',
        description: 'Momentum route test.',
        threat: 1,
      },
    ];

    route.chooseRoute('route:standard:2:0');

    expect(routeRun.axisMomentum.archive).toBe(1);
    expect(routeRun.axisMomentum.command).toBe(1);

    const archive = new GameModel(new MemoryStorage());
    archive.startRun('archive-momentum-test');
    const archiveRun = archive.run;
    if (!archiveRun) throw new Error('run was not created');
    archiveRun.axisMomentum.archive = 4;
    archiveRun.phase = 'wave';
    archiveRun.spawnQueue = [];
    archiveRun.enemies = [];

    archive.update(16);

    expect(archiveRun.phase).toBe('reward');
    expect(archiveRun.rewardChoices).toHaveLength(4);
  });

  it('spends axis momentum on active techniques for each core axis', () => {
    const fieldcraft = new GameModel(new MemoryStorage());
    fieldcraft.startRun('fieldcraft-technique-test');
    const fieldRun = fieldcraft.run;
    if (!fieldRun) throw new Error('run was not created');
    fieldRun.phase = 'wave';
    fieldRun.axisMomentum.fieldcraft = 3;
    const maxHp = ENEMY_DEFS.thornback.hp;
    fieldRun.enemies = [
      {
        id: 'fieldcraft-target',
        kind: 'thornback',
        hp: maxHp,
        maxHp,
        distance: 140,
        slowUntil: 0,
        pinUntil: 0,
        exposedUntil: 0,
        elite: false,
        bountyPaid: false,
      },
    ];

    expect(canUseAxisTechnique(fieldRun, 'fieldcraft')).toBe(true);
    expect(fieldcraft.useAxisTechnique('fieldcraft')).toBe(true);
    expect(fieldRun.axisMomentum.fieldcraft).toBe(0);
    expect(fieldRun.enemies[0].hp).toBeLessThan(maxHp);
    expect(fieldRun.charge).toBe(1);
    expect(fieldRun.physicsEvents.some((event) => event.includes('Catalyze Front'))).toBe(true);
    expect(fieldRun.stats.axisTechniquesUsed).toBe(1);
    expect(fieldcraft.useAxisTechnique('fieldcraft')).toBe(false);

    const engineering = new GameModel(new MemoryStorage());
    engineering.startRun('engineering-technique-test');
    const engineeringRun = engineering.run;
    if (!engineeringRun) throw new Error('run was not created');
    engineeringRun.hand = [oneCard('build_ember')];
    engineeringRun.energy = 1;
    engineeringRun.scrap = 5;
    expect(engineering.playCard('build_ember-test', { x: 1, y: 3 })).toBe(true);
    engineeringRun.axisMomentum.engineering = 3;
    const towerLevel = engineeringRun.towers[0].level;
    const scrapBefore = engineeringRun.scrap;

    expect(engineering.useAxisTechnique('engineering')).toBe(true);
    expect(engineeringRun.axisMomentum.engineering).toBeLessThan(3);
    expect(engineeringRun.towers[0].level).toBe(towerLevel + 1);
    expect(engineeringRun.towers[0].buffUntil).toBeGreaterThan(engineeringRun.time);
    expect(engineeringRun.scrap).toBeGreaterThanOrEqual(scrapBefore + 1);
    expect(engineeringRun.overclockUntil).toBeGreaterThan(engineeringRun.time);

    const command = new GameModel(new MemoryStorage());
    command.startRun('command-technique-test');
    const commandRun = command.run;
    if (!commandRun) throw new Error('run was not created');
    commandRun.axisMomentum.command = 3;
    const livesBefore = commandRun.lives;

    expect(command.useAxisTechnique('command')).toBe(true);
    expect(commandRun.axisMomentum.command).toBe(0);
    expect(commandRun.heroes.map((hero) => hero.kind)).toContain('kiteRanger');
    expect(commandRun.heroDirective).toBe('guard');
    expect(commandRun.lives).toBeGreaterThan(livesBefore);
    expect(commandRun.stats.commandsIssued).toBe(1);

    const archive = new GameModel(new MemoryStorage());
    archive.startRun('archive-technique-test');
    const archiveRun = archive.run;
    if (!archiveRun) throw new Error('run was not created');
    archiveRun.axisMomentum.archive = 3;
    archiveRun.energy = 0;
    archiveRun.hand = [];
    archiveRun.drawPile = [oneCard('spill_water', 'draw-1'), oneCard('ignite_patch', 'draw-2')];

    expect(archive.useAxisTechnique('archive')).toBe(true);
    expect(archiveRun.axisMomentum.archive).toBe(0);
    expect(archiveRun.hand.map((card) => card.instanceId)).toEqual(['draw-1', 'draw-2']);
    expect(archiveRun.energy).toBe(1);
    expect(archiveRun.forceRelicNextReward).toBe(true);
  });

  it('unlocks axis breakthrough tiers and feeds later systems', () => {
    const fieldcraft = new GameModel(new MemoryStorage());
    fieldcraft.startRun('fieldcraft-breakthrough-test');
    const fieldRun = fieldcraft.run;
    if (!fieldRun) throw new Error('run was not created');
    fieldRun.axisMomentum.fieldcraft = 1;
    fieldRun.hand = [oneCard('spill_water')];
    fieldRun.energy = 1;
    fieldRun.charge = 0;

    expect(fieldcraft.playCard('spill_water-test', { x: 5, y: 5 })).toBe(true);
    expect(axisBreakthroughTier(fieldRun, 'fieldcraft')).toBe(1);
    expect(fieldRun.charge).toBeGreaterThanOrEqual(1);
    expect(fieldRun.stats.axisBreakthroughsUnlocked).toBe(1);

    fieldRun.axisMomentum.fieldcraft = 3;
    fieldRun.axisBreakthroughs.fieldcraft = 1;
    fieldRun.hand = [oneCard('oil_slick')];
    fieldRun.energy = 1;

    expect(fieldcraft.playCard('oil_slick-test', { x: 6, y: 5 })).toBe(true);
    expect(axisBreakthroughTier(fieldRun, 'fieldcraft')).toBeGreaterThanOrEqual(2);
    expect(canUseAxisTechnique(fieldRun, 'fieldcraft')).toBe(true);

    const engineering = new GameModel(new MemoryStorage());
    engineering.startRun('engineering-breakthrough-test');
    const engineeringRun = engineering.run;
    if (!engineeringRun) throw new Error('run was not created');
    engineeringRun.axisMomentum.engineering = 1;
    engineeringRun.hand = [oneCard('build_ember')];
    engineeringRun.energy = 1;
    engineeringRun.scrap = 4;

    expect(engineering.playCard('build_ember-test', { x: 1, y: 3 })).toBe(true);
    expect(axisBreakthroughTier(engineeringRun, 'engineering')).toBe(1);
    expect(engineeringRun.towers[0].buffUntil).toBeGreaterThan(engineeringRun.time);

    const command = new GameModel(new MemoryStorage());
    command.startRun('command-breakthrough-test');
    const commandRun = command.run;
    if (!commandRun) throw new Error('run was not created');
    commandRun.phase = 'route';
    commandRun.wave = 2;
    commandRun.axisMomentum.command = 1;
    const commandLives = commandRun.lives;
    commandRun.routeChoices = [
      {
        choiceId: 'route:standard:command-breakthrough',
        type: 'standard',
        name: 'Stable Line',
        description: 'Command breakthrough route.',
        threat: 1,
      },
    ];

    command.chooseRoute('route:standard:command-breakthrough');
    expect(axisBreakthroughTier(commandRun, 'command')).toBe(1);
    expect(commandRun.lives).toBeGreaterThan(commandLives);

    commandRun.axisMomentum.command = 2;
    commandRun.axisBreakthroughs.command = 3;
    expect(command.useAxisTechnique('command')).toBe(true);
    expect(commandRun.heroes.map((hero) => hero.kind)).toEqual(expect.arrayContaining(['kiteRanger', 'bulwark']));

    const archive = new GameModel(new MemoryStorage());
    archive.startRun('archive-breakthrough-test');
    const archiveRun = archive.run;
    if (!archiveRun) throw new Error('run was not created');
    archiveRun.phase = 'route';
    archiveRun.wave = 2;
    archiveRun.axisMomentum.archive = 1;
    archiveRun.routeChoices = [
      {
        choiceId: 'route:standard:archive-breakthrough',
        type: 'standard',
        name: 'Stable Line',
        description: 'Archive breakthrough route.',
        threat: 1,
      },
    ];

    archive.chooseRoute('route:standard:archive-breakthrough');
    expect(axisBreakthroughTier(archiveRun, 'archive')).toBe(1);
    expect(archiveRun.forceRelicNextReward).toBe(true);

    archiveRun.axisBreakthroughs.archive = 2;
    archiveRun.axisMomentum.archive = 2;
    archiveRun.phase = 'planning';
    expect(canUseAxisTechnique(archiveRun, 'archive')).toBe(true);
  });

  it('offers axis keystone branches from breakthrough progress', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('axis-keystone-offer-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    run.axisBreakthroughs.fieldcraft = 2;
    run.phase = 'wave';
    run.spawnQueue = [];
    run.enemies = [];

    model.update(16);

    const keystoneChoices = run.rewardChoices.filter((choice) => choice.type === 'axisKeystone');
    expect(run.phase).toBe('reward');
    expect(keystoneChoices).toHaveLength(2);
    expect(keystoneChoices.map((choice) => choice.rewardId)).toEqual(
      expect.arrayContaining(['fieldcraft_reactionBloom', 'fieldcraft_thermalSiphon']),
    );

    const reactionBloom = keystoneChoices.find((choice) => choice.rewardId === 'fieldcraft_reactionBloom');
    if (!reactionBloom) throw new Error('Reaction Bloom was not offered');
    model.chooseReward(reactionBloom.choiceId);

    expect(run.axisKeystones).toContain('fieldcraft_reactionBloom');
    expect(run.stats.axisKeystonesClaimed).toBe(1);
    expect(AXIS_KEYSTONE_DEFS.fieldcraft_reactionBloom.axis).toBe('fieldcraft');
  });

  it('axis keystones change field, tower, command, and archive systems', () => {
    const fieldcraft = new GameModel(new MemoryStorage());
    fieldcraft.startRun('fieldcraft-keystone-test');
    const fieldRun = fieldcraft.run;
    if (!fieldRun) throw new Error('run was not created');
    fieldRun.axisKeystones.push('fieldcraft_reactionBloom');
    fieldRun.hand = [oneCard('spill_water')];
    fieldRun.energy = 1;
    fieldRun.charge = 0;

    expect(fieldcraft.playCard('spill_water-test', { x: 5, y: 5 })).toBe(true);
    expect(fieldRun.charge).toBeGreaterThanOrEqual(1);
    expect(fieldRun.stats.reactionsTriggered).toBeGreaterThanOrEqual(2);

    const engineering = new GameModel(new MemoryStorage());
    engineering.startRun('engineering-keystone-test');
    const engineeringRun = engineering.run;
    if (!engineeringRun) throw new Error('run was not created');
    engineeringRun.axisKeystones.push('engineering_autoForge');
    engineeringRun.hand = [oneCard('build_ember')];
    engineeringRun.energy = 1;
    engineeringRun.scrap = 5;

    expect(engineering.playCard('build_ember-test', { x: 1, y: 3 })).toBe(true);
    expect(engineeringRun.towers[0].level).toBe(2);
    expect(engineeringRun.towers[0].buffUntil).toBeGreaterThan(engineeringRun.time);

    const command = new GameModel(new MemoryStorage());
    command.startRun('command-keystone-test');
    const commandRun = command.run;
    if (!commandRun) throw new Error('run was not created');
    commandRun.axisKeystones.push('command_battleStandard');
    commandRun.heroes = [{ id: 'hero-test', kind: 'kiteRanger', x: 0, y: 0, cooldown: 2, powerups: [] }];
    commandRun.hand = [oneCard('command_guard')];
    commandRun.energy = 1;
    const commandLives = commandRun.lives;

    expect(command.playCard('command_guard-test')).toBe(true);
    expect(commandRun.lives).toBeGreaterThan(commandLives);
    expect(commandRun.heroes[0].cooldown).toBeLessThan(0);

    const archive = new GameModel(new MemoryStorage());
    archive.startRun('archive-keystone-test');
    const archiveRun = archive.run;
    if (!archiveRun) throw new Error('run was not created');
    archiveRun.axisKeystones.push('archive_deckScribe');
    archiveRun.phase = 'reward';
    archiveRun.wave = 1;
    archiveRun.rewardChoices = [
      {
        choiceId: 'card:overclock:1',
        type: 'card',
        rewardId: 'overclock',
        name: 'Overclock Relay',
        description: 'Add this card.',
      },
    ];

    archive.chooseReward('card:overclock:1');

    expect(archiveRun.discardPile.filter((card) => card.cardId === 'overclock')).toHaveLength(2);
  });

  it('activates pair resonances from breakthrough pairs', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('axis-resonance-activation-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');

    run.axisBreakthroughs.fieldcraft = 2;
    run.axisBreakthroughs.engineering = 2;
    run.axisBreakthroughs.command = 2;
    run.axisBreakthroughs.archive = 2;

    expect(activeAxisResonances(run).map((resonance) => resonance.id)).toEqual(
      expect.arrayContaining([
        'fieldcraft_engineering',
        'fieldcraft_command',
        'fieldcraft_archive',
        'engineering_command',
        'engineering_archive',
        'command_archive',
      ]),
    );

    run.axisBreakthroughs.command = 1;

    expect(activeAxisResonances(run).map((resonance) => resonance.id)).not.toEqual(
      expect.arrayContaining(['fieldcraft_command', 'engineering_command', 'command_archive']),
    );
  });

  it('axis resonances deepen reward, route, and planning branches', () => {
    const rewardModel = new GameModel(new MemoryStorage());
    rewardModel.startRun('fieldcraft-archive-resonance-test');
    const rewardRun = rewardModel.run;
    if (!rewardRun) throw new Error('run was not created');
    rewardRun.axisBreakthroughs.fieldcraft = 2;
    rewardRun.axisBreakthroughs.archive = 2;
    rewardRun.phase = 'wave';
    rewardRun.spawnQueue = [];
    rewardRun.enemies = [];

    rewardModel.update(16);

    expect(rewardRun.phase).toBe('reward');
    expect(rewardRun.rewardChoices).toHaveLength(5);

    const routeModel = new GameModel(new MemoryStorage());
    routeModel.startRun('engineering-archive-resonance-test');
    const routeRun = routeModel.run;
    if (!routeRun) throw new Error('run was not created');
    routeRun.axisBreakthroughs.engineering = 2;
    routeRun.axisBreakthroughs.archive = 2;
    routeRun.phase = 'reward';
    routeRun.wave = 1;
    routeRun.rewardChoices = [
      {
        choiceId: 'card:overclock:1',
        type: 'card',
        rewardId: 'overclock',
        name: 'Overclock Relay',
        description: 'Add this card.',
      },
    ];

    routeModel.chooseReward('card:overclock:1');

    expect(routeRun.routeChoices).toHaveLength(5);

    const planningModel = new GameModel(new MemoryStorage());
    planningModel.startRun('command-archive-resonance-test');
    const planningRun = planningModel.run;
    if (!planningRun) throw new Error('run was not created');
    planningRun.axisBreakthroughs.command = 2;
    planningRun.axisBreakthroughs.archive = 2;
    planningRun.phase = 'route';
    planningRun.wave = 2;
    planningRun.hand = [];
    planningRun.discardPile = [];
    planningRun.drawPile = [
      oneCard('build_ember', 'draw-1'),
      oneCard('build_bloom', 'draw-2'),
      oneCard('spill_water', 'draw-3'),
      oneCard('ignite_patch', 'draw-4'),
      oneCard('overclock', 'draw-5'),
      oneCard('seed_barrier', 'draw-6'),
    ];
    planningRun.routeChoices = [
      {
        choiceId: 'route:standard:command-archive',
        type: 'standard',
        name: 'Stable Line',
        description: 'Command archive resonance route.',
        threat: 1,
      },
    ];

    planningModel.chooseRoute('route:standard:command-archive');

    expect(planningRun.energy).toBe(4);
    expect(planningRun.hand).toHaveLength(6);
  });

  it('axis resonances amplify field, engineering, and command techniques', () => {
    const fieldModel = new GameModel(new MemoryStorage());
    fieldModel.startRun('fieldcraft-command-resonance-test');
    const fieldRun = fieldModel.run;
    if (!fieldRun) throw new Error('run was not created');
    fieldRun.phase = 'wave';
    fieldRun.axisBreakthroughs.fieldcraft = 2;
    fieldRun.axisBreakthroughs.command = 2;
    fieldRun.axisMomentum.fieldcraft = 2;
    fieldRun.heroes = [{ id: 'hero-test', kind: 'kiteRanger', x: 0, y: 0, cooldown: 1, powerups: [] }];
    fieldRun.enemies = [
      {
        id: 'field-resonance-target',
        kind: 'thornback',
        hp: ENEMY_DEFS.thornback.hp,
        maxHp: ENEMY_DEFS.thornback.hp,
        distance: 140,
        slowUntil: 0,
        pinUntil: 0,
        exposedUntil: 0,
        elite: false,
        bountyPaid: false,
      },
    ];

    expect(fieldModel.useAxisTechnique('fieldcraft')).toBe(true);
    expect(fieldRun.heroDirective).toBe('attack');
    expect(fieldRun.heroes[0].cooldown).toBeLessThan(0);

    const engineeringModel = new GameModel(new MemoryStorage());
    engineeringModel.startRun('fieldcraft-engineering-resonance-test');
    const engineeringRun = engineeringModel.run;
    if (!engineeringRun) throw new Error('run was not created');
    engineeringRun.axisBreakthroughs.fieldcraft = 2;
    engineeringRun.axisBreakthroughs.engineering = 2;
    engineeringRun.axisMomentum.engineering = 2;
    engineeringRun.hand = [oneCard('build_ember')];
    engineeringRun.energy = 1;
    engineeringRun.scrap = 5;
    expect(engineeringModel.playCard('build_ember-test', { x: 1, y: 3 })).toBe(true);
    const chargeBefore = engineeringRun.charge;

    expect(engineeringModel.useAxisTechnique('engineering')).toBe(true);
    expect(engineeringRun.charge).toBeGreaterThan(chargeBefore);
    expect(engineeringRun.physicsEvents.some((event) => event.includes('Elemental Machinery'))).toBe(true);

    const commandModel = new GameModel(new MemoryStorage());
    commandModel.startRun('engineering-command-resonance-test');
    const commandRun = commandModel.run;
    if (!commandRun) throw new Error('run was not created');
    commandRun.axisBreakthroughs.engineering = 2;
    commandRun.axisBreakthroughs.command = 2;
    commandRun.axisMomentum.command = 2;
    commandRun.hand = [oneCard('build_ember')];
    commandRun.energy = 1;
    commandRun.scrap = 5;
    expect(commandModel.playCard('build_ember-test', { x: 1, y: 3 })).toBe(true);

    expect(commandModel.useAxisTechnique('command')).toBe(true);
    expect(commandRun.towers[0].buffUntil).toBeGreaterThan(commandRun.time);
    expect(commandRun.log.some((entry) => entry.includes('War Rig'))).toBe(true);
  });

  it('difficulty director adapts enemy budget to player power', () => {
    const weakModel = new GameModel(new MemoryStorage());
    weakModel.startRun('director-weak-test');
    const weakRun = weakModel.run;
    if (!weakRun) throw new Error('run was not created');
    prepareDirectorRoute(weakRun);
    weakRun.scrap = 0;
    weakRun.charge = 0;
    weakRun.hand = [];

    weakModel.startWave();

    const strongModel = new GameModel(new MemoryStorage());
    strongModel.startRun('director-strong-test');
    const strongRun = strongModel.run;
    if (!strongRun) throw new Error('run was not created');
    strengthenForDirector(strongRun);

    strongModel.startWave();

    expect(strongRun.difficultyDirector.playerPower).toBeGreaterThan(strongRun.difficultyDirector.expectedPower);
    expect(weakRun.difficultyDirector.playerPower).toBeLessThan(weakRun.difficultyDirector.expectedPower);
    expect(strongRun.difficultyDirector.adaptivePressure).toBeGreaterThan(weakRun.difficultyDirector.adaptivePressure);
    expect(strongRun.difficultyDirector.directorBudget).toBeGreaterThan(weakRun.difficultyDirector.directorBudget);
    expect(strongRun.log.some((entry) => entry.includes('Difficulty Director'))).toBe(true);
  });

  it('difficulty director spends pressure on affixes, minibosses, and multi-pack synergies', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('director-pressure-plan-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    strengthenForDirector(run);

    model.startWave();

    expect(run.difficultyDirector.spentBudget).toBeGreaterThan(0);
    expect(run.difficultyDirector.synergies).toEqual(expect.arrayContaining(['armoredVanguard', 'fractureRush', 'volatileScreen']));
    expect(run.difficultyDirector.affixes.length).toBeGreaterThan(0);
    expect(run.difficultyDirector.minibosses.length).toBeGreaterThan(0);
    expect(run.spawnQueue.some((spawn) => (spawn.affixes?.length ?? 0) > 0)).toBe(true);
    expect(run.spawnQueue.some((spawn) => spawn.miniboss)).toBe(true);
  });

  it('difficulty director spawns enemies with active pressure modifiers', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('director-modified-spawn-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    strengthenForDirector(run);

    model.startWave();

    const minibossSpawn = run.spawnQueue.find((spawn) => spawn.miniboss);
    if (!minibossSpawn?.miniboss) throw new Error('director did not schedule a miniboss');
    run.waveTime = minibossSpawn.at;
    model.update(16);

    const miniboss = run.enemies.find((enemy) => enemy.miniboss === minibossSpawn.miniboss);
    if (!miniboss) throw new Error('miniboss did not spawn');
    const baseHp = ENEMY_DEFS[miniboss.kind].hp;

    expect(miniboss.elite).toBe(true);
    expect(miniboss.maxHp).toBeGreaterThan(baseHp * 2);
    expect(run.enemies.some((enemy) => (enemy.affixes?.length ?? 0) > 0)).toBe(true);
  });

  it('offers and arms axis trials from route choices', () => {
    const model = new GameModel(new MemoryStorage());
    model.startRun('axis-trial-route-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    run.phase = 'reward';
    run.wave = 1;
    run.rewardChoices = [
      {
        choiceId: 'card:overclock:1',
        type: 'card',
        rewardId: 'overclock',
        name: 'Overclock Relay',
        description: 'Add this card.',
      },
    ];

    model.chooseReward('card:overclock:1');

    const trialChoice = run.routeChoices.find((choice) => choice.trial);
    if (!trialChoice?.trial) throw new Error('no axis trial route was offered');
    expect(trialChoice.threat).toBeGreaterThan(ROUTE_NODE_DEFS[trialChoice.type].threat);

    const trial = AXIS_TRIAL_DEFS[trialChoice.trial];
    model.chooseRoute(trialChoice.choiceId);

    expect(run.phase).toBe('planning');
    expect(run.activeTrial).toBe(trial.id);
    expect(run.stats.axisTrialsTaken).toBe(1);
    expect(run.axisMomentum[trial.axis]).toBeGreaterThan(0);
  });

  it('axis trials add wave pressure and pay clear rewards', () => {
    const cases: Array<{ trial: AxisTrialId; wave: number; expectedKind: EnemyKind; physicsText?: string }> = [
      { trial: 'fieldcraft_volatileFront', wave: 4, expectedKind: 'oilSlug', physicsText: 'Volatile Front' },
      { trial: 'engineering_armoredColumn', wave: 5, expectedKind: 'ironMite' },
      { trial: 'command_splitAssault', wave: 4, expectedKind: 'glassWisp' },
      { trial: 'archive_relicAudit', wave: 4, expectedKind: 'relicEater' },
    ];

    for (const trialCase of cases) {
      const model = new GameModel(new MemoryStorage());
      model.startRun(`axis-trial-${trialCase.trial}`);
      const run = model.run;
      if (!run) throw new Error('run was not created');
      const trial = AXIS_TRIAL_DEFS[trialCase.trial];
      run.phase = 'route';
      run.wave = trialCase.wave;
      run.routeChoices = [
        {
          choiceId: `trial:${trialCase.trial}`,
          type: 'standard',
          name: 'Trial Route',
          description: 'Axis trial test.',
          threat: ROUTE_NODE_DEFS.standard.threat + trial.threat,
          trial: trialCase.trial,
        },
      ];

      model.chooseRoute(`trial:${trialCase.trial}`);
      expect(run.activeTrial).toBe(trialCase.trial);

      model.startWave();

      expect(run.spawnQueue.some((spawn) => spawn.kind === trialCase.expectedKind)).toBe(true);
      if (trialCase.physicsText) {
        expect(run.physicsEvents.some((event) => event.includes(trialCase.physicsText ?? ''))).toBe(true);
      }

      run.spawnQueue = [];
      run.enemies = [];
      model.update(16);

      expect(run.phase).toBe('reward');
      expect(run.activeTrial).toBeNull();
      expect(run.stats.axisTrialsTaken).toBe(1);
      expect(run.stats.axisTrialsCleared).toBe(1);
      expect(run.axisSurges[trial.axis]).toBe(1);
      expect(run.axisMomentum[trial.axis]).toBeGreaterThanOrEqual(3);
    }
  });

  it('persists profile unlocks after a defeated run reaches thresholds', () => {
    const storage = new MemoryStorage();
    const model = new GameModel(storage);
    model.startRun('unlock-test');
    const run = model.run;
    if (!run) throw new Error('run was not created');
    run.phase = 'wave';
    run.wave = 3;
    run.lives = 0;

    model.update(16);

    expect(model.profile.runs).toBe(1);
    expect(model.profile.unlockedHeroes).toContain('bulwark');
    expect(model.profile.unlockedRelics).toContain('livingLedger');
    expect(model.profile.coreAxes.archive).toBeGreaterThan(0);
  });
});
