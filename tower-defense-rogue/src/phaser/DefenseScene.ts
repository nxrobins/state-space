import Phaser from 'phaser';
import {
  BUILD_PADS,
  CORE_CELL,
  ENEMY_DEFS,
  GRID_COLUMNS,
  GRID_ROWS,
  HERO_DEFS,
  PATH,
  TILE_SIZE,
  TOWER_DEFS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type GridPoint,
} from '../game/content';
import {
  GameModel,
  gridToWorld,
  inspectTower,
  pathPosition,
  selectedCard,
  terrainFrameForCell,
  worldToGrid,
  type EnemyState,
  type HeroState,
  type MachineState,
  type ProjectileState,
  type TowerState,
} from '../game/simulation';
import { MAT, MATERIAL_VISUALS, type StateSpaceField } from '../../../engine/browser_state_space';

const PROJECTILE_FRAME: Record<ProjectileState['kind'], number> = {
  ember: 0,
  frost: 1,
  bloom: 2,
  volt: 3,
  sun: 4,
  hero: 5,
};

const PROJECTILE_COLOR: Record<ProjectileState['kind'], number> = {
  ember: 0xff7a2f,
  frost: 0x8ed7ff,
  bloom: 0x86be64,
  volt: 0xd8f36a,
  sun: 0xffdd76,
  hero: 0x7ee3c6,
};

const TOWER_GLOW: Record<TowerState['kind'], number> = {
  emberCoil: 0xff7a2f,
  frostLoom: 0x8ed7ff,
  bloomMortar: 0x86be64,
  voltSpire: 0xd8f36a,
  sunForge: 0xffdd76,
};

const HERO_GLOW: Record<HeroState['kind'], number> = {
  kiteRanger: 0x8ed7ff,
  bulwark: 0xd8c877,
  fieldMechanic: 0x7ee3c6,
  cinderChemist: 0xff7a2f,
};

const AFFIX_TINT = {
  plated: 0xd8c877,
  hastened: 0x8ed7ff,
  volatileCore: 0xff7a2f,
  regenerator: 0x86be64,
} as const;

const MINIBOSS_TINT = {
  bulwarkPrime: 0xffd36c,
  phaseHerald: 0xc9b7ff,
  siphonMaw: 0x7ee3c6,
} as const;

export class DefenseScene extends Phaser.Scene {
  private enemySprites = new Map<string, Phaser.GameObjects.Sprite>();
  private towerSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private heroSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private projectileSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private machineSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private ambientGraphics?: Phaser.GameObjects.Graphics;
  private physicsGraphics?: Phaser.GameObjects.Graphics;
  private shadowGraphics?: Phaser.GameObjects.Graphics;
  private statusGraphics?: Phaser.GameObjects.Graphics;
  private rangeGraphics?: Phaser.GameObjects.Graphics;
  private effectGraphics?: Phaser.GameObjects.Graphics;
  private emitAccumulator = 0;

  constructor(private readonly model: GameModel) {
    super('DefenseScene');
  }

  preload(): void {
    this.load.spritesheet('terrain:tiles', 'assets/sprites/terrain/tiles.png', { frameWidth: 48, frameHeight: 48 });
    this.load.spritesheet('fx:projectiles', 'assets/sprites/fx/projectiles.png', { frameWidth: 24, frameHeight: 24 });
    this.load.spritesheet('machine:aetherMill', 'assets/sprites/machines/aether-mill.png', { frameWidth: 48, frameHeight: 48 });

    for (const def of Object.values(TOWER_DEFS)) {
      this.load.spritesheet(def.spriteKey, `assets/sprites/towers/${def.id}.png`, { frameWidth: 64, frameHeight: 64 });
    }
    for (const def of Object.values(ENEMY_DEFS)) {
      this.load.spritesheet(def.spriteKey, `assets/sprites/enemies/${def.id}.png`, { frameWidth: 48, frameHeight: 48 });
    }
    for (const def of Object.values(HERO_DEFS)) {
      this.load.spritesheet(def.spriteKey, `assets/sprites/heroes/${def.id}.png`, { frameWidth: 48, frameHeight: 48 });
    }
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#171a1f');
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.drawTerrain();
    this.ambientGraphics = this.add.graphics();
    this.ambientGraphics.setDepth(1);
    this.drawAmbientMap();
    this.physicsGraphics = this.add.graphics();
    this.physicsGraphics.setDepth(3);
    this.shadowGraphics = this.add.graphics();
    this.shadowGraphics.setDepth(5);
    this.effectGraphics = this.add.graphics();
    this.effectGraphics.setDepth(18);
    this.statusGraphics = this.add.graphics();
    this.statusGraphics.setDepth(19);
    this.rangeGraphics = this.add.graphics();
    this.rangeGraphics.setDepth(20);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const point = worldToGrid(pointer.worldX, pointer.worldY);
      if (point.x < 0 || point.y < 0 || point.x >= GRID_COLUMNS || point.y >= GRID_ROWS) {
        return;
      }
      this.model.playSelectedAt(point);
    });
  }

  update(_: number, delta: number): void {
    this.model.update(delta);
    this.syncRunSprites();
    this.drawRangesAndSelection();
    this.emitAccumulator += delta;
    if (this.emitAccumulator > 180) {
      this.emitAccumulator = 0;
      this.model.emit();
    }
  }

  private drawTerrain(): void {
    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < GRID_COLUMNS; x += 1) {
        const point = { x, y };
        const position = gridToWorld(point);
        this.add.sprite(position.x, position.y, 'terrain:tiles', terrainFrameForCell(point)).setDepth(0);
      }
    }
  }

  private syncRunSprites(): void {
    const run = this.model.run;
    if (!run) {
      this.clearAllDynamicSprites();
      return;
    }
    this.drawPhysicsOverlay(run.stateSpace);
    this.drawImpacts(run.impacts);
    this.drawProjectileTrails(run.projectiles);
    this.shadowGraphics?.clear();
    this.statusGraphics?.clear();

    const liveTowerIds = new Set(run.towers.map((tower) => tower.id));
    for (const [id, sprite] of this.towerSprites) {
      if (!liveTowerIds.has(id)) {
        sprite.destroy();
        this.towerSprites.delete(id);
      }
    }
    for (const tower of run.towers) {
      const def = TOWER_DEFS[tower.kind];
      const position = gridToWorld(tower);
      this.drawTowerGroundLight(tower, position.x, position.y, run.time);
      const sprite = this.towerSprites.get(tower.id) ?? this.add.sprite(position.x, position.y - 8, def.spriteKey, 0).setDepth(8);
      sprite.setPosition(position.x, position.y - 8);
      sprite.setFrame(Math.min(2, Math.max(0, tower.level - 1)));
      sprite.setScale(1);
      this.towerSprites.set(tower.id, sprite);
    }

    const liveMachineIds = new Set(run.machines.map((machine) => machine.id));
    for (const [id, sprite] of this.machineSprites) {
      if (!liveMachineIds.has(id)) {
        sprite.destroy();
        this.machineSprites.delete(id);
      }
    }
    for (const machine of run.machines) {
      const position = gridToWorld(machine);
      this.drawMachineGroundLight(machine, position.x, position.y, run.time);
      const sprite = this.machineSprites.get(machine.id) ?? this.add.sprite(position.x, position.y, 'machine:aetherMill', 0).setDepth(7);
      sprite.setPosition(position.x, position.y);
      sprite.setFrame(Math.floor(run.time * 4) % 4);
      this.machineSprites.set(machine.id, sprite);
    }

    const liveEnemyIds = new Set(run.enemies.map((enemy) => enemy.id));
    for (const [id, sprite] of this.enemySprites) {
      if (!liveEnemyIds.has(id)) {
        sprite.destroy();
        this.enemySprites.delete(id);
      }
    }
    for (const enemy of run.enemies) {
      const def = ENEMY_DEFS[enemy.kind];
      const position = pathPosition(enemy.distance);
      this.drawEnemyGroundStatus(enemy, position.x, position.y, run.time);
      const sprite = this.enemySprites.get(enemy.id) ?? this.add.sprite(position.x, position.y, def.spriteKey, 0).setDepth(10);
      sprite.setPosition(position.x, position.y);
      sprite.setRotation(position.angle * 0.12);
      sprite.setFrame(Math.floor(run.time * 8 + enemy.distance * 0.02) % 4);
      sprite.setAlpha(enemy.slowUntil > run.time ? 0.82 : 1);
      sprite.setTint(this.enemyTint(enemy, run.time));
      sprite.setScale(enemy.miniboss ? 1.28 : enemy.elite || (enemy.affixes?.length ?? 0) > 0 ? 1.1 : 1);
      this.enemySprites.set(enemy.id, sprite);
    }

    const liveHeroIds = new Set(run.heroes.map((hero) => hero.id));
    for (const [id, sprite] of this.heroSprites) {
      if (!liveHeroIds.has(id)) {
        sprite.destroy();
        this.heroSprites.delete(id);
      }
    }
    for (const hero of run.heroes) {
      const def = HERO_DEFS[hero.kind];
      this.drawHeroGroundStatus(hero, run.time);
      const sprite = this.heroSprites.get(hero.id) ?? this.add.sprite(hero.x, hero.y, def.spriteKey, 0).setDepth(12);
      sprite.setPosition(hero.x, hero.y);
      sprite.setFrame(Math.floor(run.time * 6) % 4);
      this.heroSprites.set(hero.id, sprite);
    }

    const liveProjectileIds = new Set(run.projectiles.map((projectile) => projectile.id));
    for (const [id, sprite] of this.projectileSprites) {
      if (!liveProjectileIds.has(id)) {
        sprite.destroy();
        this.projectileSprites.delete(id);
      }
    }
    for (const projectile of run.projectiles) {
      const x = Phaser.Math.Linear(projectile.fromX, projectile.toX, projectile.progress);
      const y = Phaser.Math.Linear(projectile.fromY, projectile.toY, projectile.progress);
      const sprite = this.projectileSprites.get(projectile.id) ?? this.add.sprite(x, y, 'fx:projectiles', PROJECTILE_FRAME[projectile.kind]).setDepth(15);
      sprite.setPosition(x, y);
      sprite.setFrame(PROJECTILE_FRAME[projectile.kind]);
      sprite.setScale(projectile.kind === 'bloom' || projectile.kind === 'sun' ? 1.15 : 1);
      sprite.setTint(PROJECTILE_COLOR[projectile.kind]);
      this.projectileSprites.set(projectile.id, sprite);
    }
  }

  private drawAmbientMap(): void {
    const graphics = this.ambientGraphics;
    if (!graphics) return;
    graphics.clear();

    graphics.lineStyle(26, 0x05070a, 0.32);
    for (let index = 0; index < PATH.length - 1; index += 1) {
      const start = gridToWorld(PATH[index]);
      const end = gridToWorld(PATH[index + 1]);
      graphics.lineBetween(start.x, start.y, end.x, end.y);
    }
    graphics.lineStyle(8, 0xcaa76a, 0.12);
    for (let index = 0; index < PATH.length - 1; index += 1) {
      const start = gridToWorld(PATH[index]);
      const end = gridToWorld(PATH[index + 1]);
      graphics.lineBetween(start.x, start.y, end.x, end.y);
    }

    for (const pad of BUILD_PADS) {
      const position = gridToWorld(pad);
      graphics.fillStyle(0xffdd76, 0.035);
      graphics.fillRoundedRect(position.x - 22, position.y - 22, 44, 44, 6);
      graphics.lineStyle(1, 0xd8c877, 0.14);
      graphics.strokeRoundedRect(position.x - 21, position.y - 21, 42, 42, 6);
    }

    const core = gridToWorld(CORE_CELL);
    graphics.fillStyle(0x7ee3c6, 0.09);
    graphics.fillCircle(core.x, core.y, 46);
    graphics.fillStyle(0xffdd76, 0.08);
    graphics.fillCircle(core.x, core.y, 26);
    graphics.lineStyle(2, 0x7ee3c6, 0.22);
    graphics.strokeCircle(core.x, core.y, 42);

    graphics.fillStyle(0x030407, 0.2);
    graphics.fillRect(0, 0, WORLD_WIDTH, 10);
    graphics.fillRect(0, WORLD_HEIGHT - 10, WORLD_WIDTH, 10);
    graphics.fillRect(0, 0, 10, WORLD_HEIGHT);
    graphics.fillRect(WORLD_WIDTH - 10, 0, 10, WORLD_HEIGHT);
  }

  private drawTowerGroundLight(tower: TowerState, x: number, y: number, time: number): void {
    this.drawSoftShadow(x, y + 15, 26 + tower.level * 2, 11, 0.24);
    const graphics = this.shadowGraphics;
    if (!graphics) return;
    const color = tower.buffUntil > time ? 0xffdd76 : TOWER_GLOW[tower.kind];
    const pulse = 0.5 + Math.sin(time * 5 + tower.level) * 0.5;
    graphics.fillStyle(color, tower.buffUntil > time ? 0.16 + pulse * 0.06 : 0.06);
    graphics.fillCircle(x, y + 2, 15 + tower.level * 3);
    graphics.lineStyle(1, color, tower.buffUntil > time ? 0.58 : 0.22);
    graphics.strokeCircle(x, y + 2, 18 + tower.level * 4 + pulse * 3);
  }

  private drawMachineGroundLight(machine: MachineState, x: number, y: number, time: number): void {
    this.drawSoftShadow(x, y + 13, 25, 10, 0.22);
    const graphics = this.shadowGraphics;
    if (!graphics) return;
    const spin = (time * 35 + machine.x * 7 + machine.y * 11) % 360;
    graphics.lineStyle(2, 0x7ee3c6, 0.34);
    graphics.beginPath();
    graphics.arc(x, y, 23, Phaser.Math.DegToRad(spin), Phaser.Math.DegToRad(spin + 250), false);
    graphics.strokePath();
    graphics.fillStyle(0x7ee3c6, 0.07);
    graphics.fillCircle(x, y, 18);
  }

  private drawEnemyGroundStatus(enemy: EnemyState, x: number, y: number, time: number): void {
    this.drawSoftShadow(x, y + 13, enemy.miniboss ? 26 : 19, enemy.miniboss ? 11 : 8, enemy.miniboss ? 0.32 : 0.2);
    const graphics = this.statusGraphics;
    if (!graphics) return;

    const affixes = enemy.affixes ?? [];
    const accent = enemy.miniboss ? MINIBOSS_TINT[enemy.miniboss] : enemy.elite ? 0xffd36c : affixes.length > 0 ? AFFIX_TINT[affixes[0]] : 0x7ee3c6;
    const radius = enemy.miniboss ? 24 : enemy.elite ? 20 : affixes.length > 0 ? 17 : 0;
    if (radius > 0) {
      graphics.lineStyle(enemy.miniboss ? 3 : 2, accent, enemy.miniboss ? 0.62 : 0.46);
      graphics.strokeCircle(x, y + 2, radius);
    }

    if (enemy.slowUntil > time) {
      graphics.lineStyle(1, 0x8ed7ff, 0.55);
      graphics.strokeCircle(x, y + 2, enemy.miniboss ? 29 : 21);
    }
    if (enemy.pinUntil > time) {
      graphics.lineStyle(2, 0xd8c877, 0.6);
      graphics.strokeRoundedRect(x - 15, y - 12, 30, 25, 5);
    }

    affixes.slice(0, 4).forEach((affix, index) => {
      graphics.fillStyle(AFFIX_TINT[affix], 0.88);
      graphics.fillCircle(x - 10 + index * 7, y - 27, 2.4);
    });

    const width = enemy.miniboss ? 38 : 28;
    const hpRatio = Phaser.Math.Clamp(enemy.hp / Math.max(1, enemy.maxHp), 0, 1);
    const barY = y - (enemy.miniboss ? 36 : 30);
    graphics.fillStyle(0x05070a, 0.78);
    graphics.fillRoundedRect(x - width / 2, barY, width, 5, 2);
    graphics.fillStyle(accent, 0.92);
    graphics.fillRoundedRect(x - width / 2 + 1, barY + 1, Math.max(1, (width - 2) * hpRatio), 3, 2);
    if (enemy.miniboss) {
      graphics.lineStyle(1, 0xfff0b0, 0.5);
      graphics.strokeRoundedRect(x - width / 2 - 1, barY - 1, width + 2, 7, 3);
    }
  }

  private drawHeroGroundStatus(hero: HeroState, time: number): void {
    this.drawSoftShadow(hero.x, hero.y + 13, 20, 8, 0.2);
    const graphics = this.statusGraphics;
    if (!graphics) return;
    const color = HERO_GLOW[hero.kind];
    const pulse = 0.5 + Math.sin(time * 4 + hero.powerups.length) * 0.5;
    graphics.lineStyle(2, color, 0.32 + pulse * 0.18);
    graphics.strokeCircle(hero.x, hero.y + 2, 17 + pulse * 2);
    hero.powerups.slice(0, 5).forEach((_, index) => {
      graphics.fillStyle(color, 0.72);
      graphics.fillCircle(hero.x - 12 + index * 6, hero.y - 25, 2);
    });
  }

  private drawProjectileTrails(projectiles: ProjectileState[]): void {
    const graphics = this.effectGraphics;
    if (!graphics) return;
    for (const projectile of projectiles) {
      const color = PROJECTILE_COLOR[projectile.kind];
      const x = Phaser.Math.Linear(projectile.fromX, projectile.toX, projectile.progress);
      const y = Phaser.Math.Linear(projectile.fromY, projectile.toY, projectile.progress);
      const tailX = Phaser.Math.Linear(projectile.fromX, projectile.toX, Math.max(0, projectile.progress - 0.18));
      const tailY = Phaser.Math.Linear(projectile.fromY, projectile.toY, Math.max(0, projectile.progress - 0.18));
      graphics.lineStyle(projectile.kind === 'sun' ? 4 : 3, color, 0.34);
      graphics.lineBetween(tailX, tailY, x, y);
      graphics.fillStyle(color, 0.13);
      graphics.fillCircle(x, y, projectile.kind === 'sun' ? 13 : 9);
    }
  }

  private drawSoftShadow(x: number, y: number, width: number, height: number, alpha: number): void {
    const graphics = this.shadowGraphics;
    if (!graphics) return;
    graphics.fillStyle(0x020304, alpha);
    graphics.fillEllipse(x, y, width, height);
    graphics.fillStyle(0x000000, alpha * 0.42);
    graphics.fillEllipse(x + 2, y + 1, width * 0.62, height * 0.58);
  }

  private enemyTint(enemy: EnemyState, time: number): number {
    if (enemy.exposedUntil > time) return 0xfff0b0;
    if (enemy.slowUntil > time) return 0xbbeeff;
    if (enemy.miniboss) return MINIBOSS_TINT[enemy.miniboss];
    if (enemy.elite) return 0xffd36c;
    const affix = enemy.affixes?.[0];
    return affix ? AFFIX_TINT[affix] : 0xffffff;
  }

  private drawPhysicsOverlay(field: StateSpaceField): void {
    const graphics = this.physicsGraphics;
    if (!graphics) return;
    graphics.clear();
    const cellWidth = WORLD_WIDTH / field.width;
    const cellHeight = WORLD_HEIGHT / field.height;
    for (let y = 0; y < field.height; y += 1) {
      for (let x = 0; x < field.width; x += 1) {
        const material = field.materialAt(x, y);
        if (material === MAT.AIR || material === MAT.STONE) continue;
        const color = Phaser.Display.Color.HexStringToColor(MATERIAL_VISUALS[material] ?? '#ff00ff').color;
        const alpha = material === MAT.FIRE || material === MAT.LAVA ? 0.56 : material === MAT.SMOKE || material === MAT.STEAM ? 0.2 : 0.28;
        graphics.fillStyle(color, alpha);
        graphics.fillRect(x * cellWidth, y * cellHeight, Math.ceil(cellWidth), Math.ceil(cellHeight));
      }
    }
  }

  private drawImpacts(impacts: Array<{ x: number; y: number; kind: string; ttl: number }>): void {
    const graphics = this.effectGraphics;
    if (!graphics) return;
    graphics.clear();
    for (const impact of impacts) {
      const color =
        impact.kind === 'burn'
          ? 0xff7a2f
          : impact.kind === 'frost'
            ? 0x8ed7ff
            : impact.kind === 'shock'
              ? 0xd8f36a
              : impact.kind === 'reward'
                ? 0xffdd76
                : impact.kind === 'earth'
                  ? 0xcaa76a
                  : 0x7ee3c6;
      const age = Math.max(0, Math.min(1, impact.ttl / 0.85));
      const radius = 8 + (1 - age) * 34;
      graphics.lineStyle(2, color, age * 0.8);
      graphics.strokeCircle(impact.x, impact.y, radius);
      graphics.fillStyle(color, age * 0.12);
      graphics.fillCircle(impact.x, impact.y, Math.max(6, radius * 0.45));
    }
  }

  private drawRangesAndSelection(): void {
    const graphics = this.rangeGraphics;
    const run = this.model.run;
    if (!graphics) return;
    graphics.clear();
    if (!run) return;

    const card = selectedCard(run);
    if (card && card.cardId.startsWith('build_')) {
      graphics.lineStyle(2, 0xd8c877, 0.55);
      for (const pad of this.openPads()) {
        const position = gridToWorld(pad);
        graphics.strokeRoundedRect(position.x - 20, position.y - 20, 40, 40, 8);
      }
    }

    if (card && CARD_TARGETS_CELL.has(card.cardId)) {
      graphics.lineStyle(1, 0x8ed7ff, 0.26);
      for (let y = 0; y < GRID_ROWS; y += 1) {
        for (let x = 0; x < GRID_COLUMNS; x += 1) {
          const position = gridToWorld({ x, y });
          graphics.strokeRect(position.x - 21, position.y - 21, 42, 42);
        }
      }
    }

    const tower = inspectTower(run);
    if (tower) {
      const position = gridToWorld(tower);
      const def = TOWER_DEFS[tower.kind];
      const radius = def.range + tower.branches.range * 28 + tower.level * 4;
      graphics.lineStyle(2, 0x85d7ff, 0.5);
      graphics.strokeCircle(position.x, position.y, radius);
      graphics.fillStyle(0x85d7ff, 0.08);
      graphics.fillCircle(position.x, position.y, radius);
    }
  }

  private openPads(): GridPoint[] {
    const run = this.model.run;
    if (!run) return [];
    const occupied = new Set([...run.towers.map((tower) => `${tower.x},${tower.y}`), ...run.machines.map((machine) => `${machine.x},${machine.y}`)]);
    const pads: GridPoint[] = [];
    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < GRID_COLUMNS; x += 1) {
        const point = { x, y };
        const frame = terrainFrameForCell(point);
        if (frame === 4 && !occupied.has(`${x},${y}`)) {
          pads.push(point);
        }
      }
    }
    return pads;
  }

  private clearAllDynamicSprites(): void {
    for (const map of [this.enemySprites, this.towerSprites, this.heroSprites, this.projectileSprites, this.machineSprites]) {
      for (const sprite of map.values()) {
        sprite.destroy();
      }
      map.clear();
    }
    this.effectGraphics?.clear();
  }
}

const CARD_TARGETS_CELL = new Set(['spill_water', 'oil_slick', 'ignite_patch', 'cryo_seed', 'sand_berm', 'conductor_rail', 'vent_smoke']);
