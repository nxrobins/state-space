import Phaser from 'phaser';
import {
  ARENA_HEIGHT,
  ARENA_WIDTH,
  CELL_SIZE,
  GRID_WIDTH,
  GRID_HEIGHT,
  MATERIAL_COLORS,
  MaterialType,
  REPLAY_SCHEMA_VERSION,
  TICK_RATE,
} from '../../game/simulation/constants';
import {
  MAX_PRESENTATION_HITSTOP_TICKS,
  feelForMove,
  impactFeedbackFor,
  ringOutDangerFor,
  startupTelegraphProgress,
} from '../../game/combatFeel';
import { FIGHTER_SPECS } from '../../game/simulation/fighters';
import { consumeDirtyMaterialIndices } from '../../game/simulation/grid';
import { createBattleState, EMPTY_ACTIONS, stepBattle } from '../../game/simulation/battle';
import { emptyActions } from '../../game/input/actions';
import { KEY_BINDINGS } from '../../game/input/bindings';
import {
  bindHudControls,
  setCharacterSelectVisible,
  setDebugButtonActive,
  setRecoveryNoticeVisible,
  setResultOverlayVisible,
  setVersusIntroVisible,
  updateHud,
} from '../../ui/hud';
import { installGlobalOpsHandlers, recordOpsEvent, syncRuntimeStats } from '../../game/ops';
import { appendReplayFrame, createReplayLog, replayBattle } from '../../game/replay';
import { clearRunningReplay, loadRunningReplay, saveCompletedReplay, saveRunningReplay } from '../../game/replayStorage';
import {
  FIGHTER_SPRITE_ANIMATIONS,
  FIGHTER_SPRITE_FRAME_HEIGHT,
  FIGHTER_SPRITE_FRAME_WIDTH,
  createFighterAnimationDecision,
  fighterAnimationKey,
  fighterSpriteAnimationIdsForSpec,
  fighterSpriteSheetKey,
  fighterSpriteSheetUrl,
  resolveFighterSpriteAnimation,
  selectFighterAnimation,
  stabilizeFighterAnimation,
  type FighterAnimationDecision,
} from '../../game/sprites';
import { setDebugOverlayVisible, updateDebugOverlay } from '../../ui/debugOverlay';
import { CombatAudio } from '../combatAudio';
import type { ActionState, BattleState, FighterId, FighterSpecId, FighterState, MoveSpec, Rect, ReplayLog } from '../../game/simulation/types';

const STEP_MS = 1000 / TICK_RATE;
const MAX_SIM_STEPS_PER_FRAME = 4;

interface FighterVisualFreeze {
  x: number;
  y: number;
  facing: 1 | -1;
}

interface ImpactEffect {
  x: number;
  y: number;
  kind: 'hit' | 'block';
  weight: 'light' | 'medium' | 'heavy';
  expiresAtTick: number;
}

interface ArenaMote {
  x: number;
  y: number;
  drift: number;
  speed: number;
  radius: number;
  phase: number;
  color: number;
  alpha: number;
}

interface MaterialFlare {
  x: number;
  y: number;
  color: number;
  radius: number;
  startedAtTick: number;
  expiresAtTick: number;
}

const MAX_MATERIAL_FLARES = 72;

const MATERIAL_FLARE_COLORS: Partial<Record<MaterialType, number>> = {
  [MaterialType.Water]: 0x54c7ff,
  [MaterialType.Fire]: 0xff8a3d,
  [MaterialType.Ice]: 0xb8f2ff,
  [MaterialType.Steam]: 0xe4f7ff,
  [MaterialType.Lava]: 0xff3b1f,
  [MaterialType.Glass]: 0x9ff6e0,
  [MaterialType.Smoke]: 0x9ba3ad,
};

export class BattleScene extends Phaser.Scene {
  private state: BattleState = createBattleState('water');
  private selectedSpec: FighterSpecId = 'water';
  private accumulator = 0;
  private backdrop!: Phaser.GameObjects.Graphics;
  private atmosphere!: Phaser.GameObjects.Graphics;
  private materialTexture!: Phaser.Textures.CanvasTexture;
  private materialCtx!: CanvasRenderingContext2D;
  private materialImage!: Phaser.GameObjects.Image;
  private materialGlows!: Phaser.GameObjects.Graphics;
  private fighterUnderlays!: Phaser.GameObjects.Graphics;
  private fighterOverlays!: Phaser.GameObjects.Graphics;
  private fighterSprites!: Record<FighterId, Phaser.GameObjects.Sprite>;
  private fighterAnimationDecisions!: Record<FighterId, FighterAnimationDecision>;
  private effects!: Phaser.GameObjects.Graphics;
  private keys!: Record<keyof typeof KEY_BINDINGS, Phaser.Input.Keyboard.Key>;
  private replayLog: ReplayLog | null = null;
  private lastReplayFlushTick = 0;
  private completedReplaySaved = false;
  private debugVisible = false;
  private touchActions: ActionState = emptyActions();
  private combatAudio = new CombatAudio();
  private hitstopTicks = 0;
  private impactFlashTicks = 0;
  private impactEffects: ImpactEffect[] = [];
  private materialFlares: MaterialFlare[] = [];
  private ambientMotes = createArenaMotes();
  private frozenFighters: Record<FighterId, FighterVisualFreeze> | null = null;
  private startupCueKeys = new Set<string>();
  private ringDangerActive: Record<FighterId, boolean> = { p1: false, cpu: false };
  private reducedMotion = false;
  private lastCombatImpactSeq = 0;
  private matchStarted = false;
  private introTicks = 0;

  constructor() {
    super('BattleScene');
  }

  preload(): void {
    for (const specId of Object.keys(FIGHTER_SPECS) as FighterSpecId[]) {
      for (const animation of fighterSpriteAnimationIdsForSpec(specId)) {
        this.load.spritesheet(fighterSpriteSheetKey(specId, animation), fighterSpriteSheetUrl(specId, animation), {
          frameWidth: FIGHTER_SPRITE_FRAME_WIDTH,
          frameHeight: FIGHTER_SPRITE_FRAME_HEIGHT,
        });
      }
    }
  }

  create(): void {
    this.cameras.main.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.cameras.main.setBackgroundColor(0x171a1e);
    this.backdrop = this.add.graphics().setDepth(0);
    this.drawStaticBackdrop();
    this.atmosphere = this.add.graphics().setDepth(0.5);
    this.createMaterialLayer();
    this.materialGlows = this.add.graphics().setDepth(1.5);
    this.fighterUnderlays = this.add.graphics().setDepth(2);
    this.registerFighterAnimations();
    this.createFighterSprites();
    this.fighterOverlays = this.add.graphics().setDepth(4);
    this.effects = this.add.graphics().setDepth(5);
    this.keys = this.input.keyboard!.addKeys(KEY_BINDINGS) as Record<keyof typeof KEY_BINDINGS, Phaser.Input.Keyboard.Key>;
    this.reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.input.keyboard?.on('keydown', () => this.combatAudio.unlock());
    this.input.on('pointerdown', () => this.combatAudio.unlock());

    bindHudControls({
      onSelect: (specId) => {
        clearRunningReplay();
        this.startMatch(specId);
      },
      onRestart: () => {
        clearRunningReplay();
        this.startMatch(this.selectedSpec);
      },
      onOpenSelect: () => {
        clearRunningReplay();
        this.openCharacterSelect();
      },
      onToggleDebug: () => this.toggleDebugOverlay(),
      onDismissRecovery: () => setRecoveryNoticeVisible(false),
      onTouchAction: (action, pressed) => {
        if (pressed) this.combatAudio.unlock();
        this.touchActions[action] = pressed;
      },
    });
    installGlobalOpsHandlers(() => this.state);
    this.debugVisible = new URLSearchParams(window.location.search).get('debug') === '1';
    setDebugOverlayVisible(this.debugVisible);
    setDebugButtonActive(this.debugVisible);
    if (this.recoverRunningMatch()) {
      this.matchStarted = true;
    } else {
      this.openCharacterSelect();
    }
  }

  update(_time: number, delta: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.keys.restart)) {
      clearRunningReplay();
      if (this.matchStarted) {
        this.startMatch(this.selectedSpec);
      } else {
        this.openCharacterSelect();
      }
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.debug)) {
      this.toggleDebugOverlay();
    }
    if (!this.matchStarted) {
      this.renderState();
      updateHud(this.state);
      updateDebugOverlay(this.state, this.debugVisible);
      return;
    }
    if (this.introTicks > 0) {
      this.tickIntro(delta);
      this.renderState();
      updateHud(this.state);
      updateDebugOverlay(this.state, this.debugVisible);
      return;
    }

    this.accumulator += Math.min(delta, 250);
    const actions = this.readActions();
    let simSteps = 0;
    while (this.accumulator >= STEP_MS && simSteps < MAX_SIM_STEPS_PER_FRAME) {
      this.recordReplayFrame(actions);
      stepBattle(this.state, actions);
      this.handleCombatImpactFeedback();
      this.accumulator -= STEP_MS;
      simSteps++;
      this.persistReplayIfNeeded();
    }
    if (this.accumulator >= STEP_MS) {
      this.accumulator = 0;
      this.state.runtimeStats.catchupClamps++;
      recordOpsEvent({
        matchId: this.state.matchId,
        tick: this.state.tick,
        type: 'catchup-clamp',
        message: 'Dropped accumulated simulation time after hitting the per-frame step cap.',
        details: { simSteps },
      });
    }

    this.handleStartupCueFeedback();
    this.handleRingDangerFeedback();
    syncRuntimeStats(this.state, { frameMs: delta, simSteps });
    this.advancePresentationTimers();
    this.renderState();
    updateHud(this.state);
    updateDebugOverlay(this.state, this.debugVisible);
    this.persistCompletedReplayIfNeeded();
  }

  private startMatch(specId: FighterSpecId): void {
    this.selectedSpec = specId;
    this.state = createBattleState(specId);
    this.matchStarted = true;
    this.introTicks = TICK_RATE * 3;
    this.replayLog = createReplayLog(specId, this.state.initialSeed, this.state.matchId);
    this.lastReplayFlushTick = 0;
    this.completedReplaySaved = false;
    this.accumulator = 0;
    this.touchActions = emptyActions();
    this.resetPresentationFeedback();
    this.resetMaterialLayer();
    setCharacterSelectVisible(false);
    setRecoveryNoticeVisible(false);
    setResultOverlayVisible(false, this.state);
    setVersusIntroVisible(true, this.state, this.introTicks);
    saveRunningReplay(this.replayLog);
    recordOpsEvent({
      matchId: this.state.matchId,
      tick: this.state.tick,
      type: 'match-start',
      message: `Started ${specId} match.`,
      details: { seed: this.state.initialSeed, schemaVersion: REPLAY_SCHEMA_VERSION },
    });
    updateHud(this.state);
  }

  private openCharacterSelect(): void {
    this.matchStarted = false;
    this.introTicks = 0;
    this.state = createBattleState(this.selectedSpec);
    this.replayLog = null;
    this.completedReplaySaved = false;
    this.accumulator = 0;
    this.touchActions = emptyActions();
    this.resetPresentationFeedback();
    this.resetMaterialLayer();
    setRecoveryNoticeVisible(false);
    setCharacterSelectVisible(true);
    setVersusIntroVisible(false, this.state);
    setResultOverlayVisible(false, this.state);
    this.renderState();
    updateHud(this.state);
  }

  private recoverRunningMatch(): boolean {
    const log = loadRunningReplay();
    if (!log) return false;
    const recovered = replayBattle(log);
    if (!recovered || recovered.matchPhase === 'finished') {
      clearRunningReplay();
      return false;
    }
    this.selectedSpec = log.selectedFighter;
    this.state = recovered;
    this.replayLog = log;
    this.matchStarted = true;
    this.introTicks = 0;
    this.lastReplayFlushTick = recovered.tick;
    this.completedReplaySaved = false;
    this.accumulator = 0;
    this.touchActions = emptyActions();
    this.resetPresentationFeedback();
    this.resetMaterialLayer();
    setCharacterSelectVisible(false);
    setVersusIntroVisible(false, this.state);
    setResultOverlayVisible(false, this.state);
    setRecoveryNoticeVisible(true);
    recordOpsEvent({
      matchId: recovered.matchId,
      tick: recovered.tick,
      type: 'match-recovered',
      message: 'Recovered running match from session replay.',
      details: { frames: log.frames.length, seed: log.seed },
    });
    updateHud(this.state);
    return true;
  }

  private resetPresentationFeedback(): void {
    this.hitstopTicks = 0;
    this.impactFlashTicks = 0;
    this.impactEffects = [];
    this.materialFlares = [];
    this.frozenFighters = null;
    this.startupCueKeys.clear();
    this.ringDangerActive = { p1: false, cpu: false };
    this.lastCombatImpactSeq = this.state.runtimeStats.combatImpactSeq;
    this.resetFighterAnimationDecisions();
  }

  private tickIntro(delta: number): void {
    this.accumulator += Math.min(delta, 250);
    while (this.accumulator >= STEP_MS && this.introTicks > 0) {
      this.introTicks--;
      this.accumulator -= STEP_MS;
    }
    if (this.introTicks > 0) {
      setVersusIntroVisible(true, this.state, this.introTicks);
      return;
    }
    this.accumulator = 0;
    setVersusIntroVisible(false, this.state);
  }

  private readActions(): ActionState {
    const actions = emptyActions();
    actions.left = this.keys.left.isDown || this.touchActions.left;
    actions.right = this.keys.right.isDown || this.touchActions.right;
    actions.up = this.keys.up.isDown || this.keys.jumpAlt.isDown || this.touchActions.up;
    actions.down = this.keys.down.isDown || this.touchActions.down;
    actions.dash = this.keys.dash.isDown || this.touchActions.dash;
    actions.shield = this.keys.shield.isDown || this.keys.block.isDown || this.touchActions.shield || this.touchActions.block;
    actions.block = actions.shield;
    actions.attack = this.keys.attack.isDown || this.keys.basic.isDown || this.touchActions.attack || this.touchActions.basic;
    actions.special = this.keys.special.isDown || this.keys.special1.isDown || this.touchActions.special || this.touchActions.special1;
    actions.grab = this.keys.grab.isDown || this.touchActions.grab;
    actions.basic = this.keys.basic.isDown || this.touchActions.basic;
    actions.special1 = this.keys.special1.isDown || this.touchActions.special1;
    actions.special2 = this.keys.special2.isDown || this.touchActions.special2;
    actions.special3 = this.keys.special3.isDown || this.touchActions.special3;
    return actions;
  }

  private renderState(): void {
    this.drawAtmosphere();
    this.flushDirtyMaterials();
    this.drawMaterialGlows();
    this.drawEffects();
    this.drawFighters();
  }

  private drawStaticBackdrop(): void {
    this.backdrop.clear();
    this.backdrop.fillStyle(0x090c11, 1);
    this.backdrop.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.backdrop.fillStyle(0x111820, 1);
    this.backdrop.fillRect(0, 0, ARENA_WIDTH, 212);
    this.backdrop.fillStyle(0x151b21, 1);
    this.backdrop.fillRect(0, 212, ARENA_WIDTH, 438);
    this.backdrop.fillStyle(0x0a0e12, 1);
    this.backdrop.fillRect(0, 650, ARENA_WIDTH, 70);

    this.backdrop.lineStyle(1, 0x2d3842, 0.36);
    for (let x = 0; x <= ARENA_WIDTH; x += 80) this.backdrop.lineBetween(x, 0, x, ARENA_HEIGHT);
    for (let y = 10; y <= ARENA_HEIGHT; y += 80) this.backdrop.lineBetween(0, y, ARENA_WIDTH, y);

    this.backdrop.fillStyle(0x0f151b, 0.92);
    for (let x = -34; x < ARENA_WIDTH + 80; x += 132) {
      const height = 310 + (x % 3) * 24;
      this.backdrop.fillRect(x, 176, 34, height);
      this.backdrop.fillStyle(0x1a232c, 0.78);
      this.backdrop.fillRect(x + 34, 202, 28, height - 42);
      this.backdrop.fillStyle(0x0f151b, 0.92);
    }

    this.backdrop.lineStyle(3, 0x273540, 0.62);
    this.backdrop.strokeRect(42, 118, ARENA_WIDTH - 84, 496);
    this.backdrop.lineStyle(1, 0x74f3d0, 0.22);
    this.backdrop.strokeRect(54, 130, ARENA_WIDTH - 108, 472);

    this.backdrop.lineStyle(2, 0x4e6371, 0.42);
    this.backdrop.strokeEllipse(ARENA_WIDTH / 2, 662, 720, 96);
    this.backdrop.lineStyle(1, 0xd0ad6d, 0.24);
    this.backdrop.strokeEllipse(ARENA_WIDTH / 2, 662, 482, 58);

    this.backdrop.fillStyle(0x11161b, 0.86);
    this.backdrop.fillRect(0, 650, ARENA_WIDTH, 70);
    this.backdrop.lineStyle(2, 0x34404a, 0.75);
    this.backdrop.lineBetween(0, 650, ARENA_WIDTH, 650);
    this.backdrop.lineStyle(1, 0x74f3d0, 0.18);
    for (let x = 80; x < ARENA_WIDTH; x += 160) this.backdrop.lineBetween(x, 650, x + 64, ARENA_HEIGHT);
  }

  private drawAtmosphere(): void {
    this.atmosphere.clear();
    const pulse = this.reducedMotion ? 0 : Math.sin(this.state.tick * 0.016);
    this.atmosphere.fillStyle(0x54c7ff, 0.025 + pulse * 0.006);
    this.atmosphere.fillRect(0, 0, ARENA_WIDTH * 0.44, ARENA_HEIGHT);
    this.atmosphere.fillStyle(0xff7848, 0.022 - pulse * 0.005);
    this.atmosphere.fillRect(ARENA_WIDTH * 0.56, 0, ARENA_WIDTH * 0.44, ARENA_HEIGHT);
    this.atmosphere.fillStyle(0xd0ad6d, 0.035);
    this.atmosphere.fillRect(0, ARENA_HEIGHT - 90, ARENA_WIDTH, 90);

    this.atmosphere.lineStyle(2, 0x74f3d0, 0.12 + Math.abs(pulse) * 0.04);
    this.atmosphere.strokeEllipse(ARENA_WIDTH / 2, 658, 760, 104);
    this.atmosphere.lineStyle(1, 0xffd166, 0.08 + Math.max(0, -pulse) * 0.04);
    this.atmosphere.strokeEllipse(ARENA_WIDTH / 2, 660, 546, 70);

    const moteTick = this.reducedMotion ? 0 : this.state.tick;
    for (const mote of this.ambientMotes) {
      const x = wrap(mote.x + Math.sin(moteTick * 0.014 + mote.phase) * mote.drift, -20, ARENA_WIDTH + 20);
      const y = wrap(mote.y - moteTick * mote.speed, 80, ARENA_HEIGHT + 70);
      this.atmosphere.fillStyle(mote.color, mote.alpha);
      this.atmosphere.fillCircle(x, y, mote.radius);
    }
  }

  private createMaterialLayer(): void {
    const texture = this.textures.createCanvas('material-grid', GRID_WIDTH, GRID_HEIGHT);
    if (!texture) throw new Error('Unable to create material-grid canvas texture');
    this.materialTexture = texture;
    this.materialCtx = this.materialTexture.getContext();
    this.materialCtx.imageSmoothingEnabled = false;
    this.materialImage = this.add.image(0, 0, 'material-grid');
    this.materialImage.setOrigin(0, 0);
    this.materialImage.setDisplaySize(ARENA_WIDTH, ARENA_HEIGHT);
    this.materialImage.setDepth(1);
  }

  private registerFighterAnimations(): void {
    for (const specId of Object.keys(FIGHTER_SPECS) as FighterSpecId[]) {
      for (const animationId of fighterSpriteAnimationIdsForSpec(specId)) {
        const animationKey = fighterAnimationKey(specId, animationId);
        if (this.anims.exists(animationKey)) continue;
        const config = FIGHTER_SPRITE_ANIMATIONS[animationId];
        this.anims.create({
          key: animationKey,
          frames: this.anims.generateFrameNumbers(fighterSpriteSheetKey(specId, animationId), {
            start: 0,
            end: config.frames - 1,
          }),
          frameRate: config.frameRate,
          repeat: config.repeat,
        });
      }
    }
  }

  private createFighterSprites(): void {
    this.fighterSprites = {
      p1: this.createFighterSprite(this.state.fighters.p1),
      cpu: this.createFighterSprite(this.state.fighters.cpu),
    };
    this.resetFighterAnimationDecisions();
  }

  private createFighterSprite(fighter: FighterState): Phaser.GameObjects.Sprite {
    return this.add
      .sprite(fighter.x, fighter.y + fighter.height / 2 + 7, fighterSpriteSheetKey(fighter.specId, 'idle'), 0)
      .setOrigin(0.5, 1)
      .setScale(1.08)
      .setDepth(3);
  }

  private resetFighterAnimationDecisions(): void {
    this.fighterAnimationDecisions = {
      p1: createFighterAnimationDecision(initialVisualAnimationFor(this.state.fighters.p1)),
      cpu: createFighterAnimationDecision(initialVisualAnimationFor(this.state.fighters.cpu)),
    };
  }

  private resetMaterialLayer(): void {
    this.materialCtx.clearRect(0, 0, GRID_WIDTH, GRID_HEIGHT);
    this.flushDirtyMaterials();
  }

  private flushDirtyMaterials(): void {
    const dirty = consumeDirtyMaterialIndices(this.state);
    if (dirty.length === 0) {
      syncRuntimeStats(this.state, { dirtyCells: 0 });
      return;
    }
    for (const index of dirty) {
      const x = index % GRID_WIDTH;
      const y = Math.floor(index / GRID_WIDTH);
      const cell = this.state.materialGrid[index];
      this.materialCtx.clearRect(x, y, 1, 1);
      if (cell.material === MaterialType.Air) continue;
      const renderColor = materialRenderColor(cell.material);
      this.materialCtx.globalAlpha = cell.expiresAtTick === null ? 0.92 : 0.9;
      this.materialCtx.fillStyle = colorToCss(renderColor);
      this.materialCtx.fillRect(x, y, 1, 1);
      if (cell.material === MaterialType.Fire || cell.material === MaterialType.Lava || cell.material === MaterialType.Ice) {
        this.materialCtx.globalAlpha = cell.material === MaterialType.Ice ? 0.28 : 0.34;
        this.materialCtx.fillStyle = '#fff2c2';
        this.materialCtx.fillRect(x, y, 1, 1);
      }
      if (cell.expiresAtTick !== null) this.queueMaterialFlare(index, cell.material);
    }
    this.materialCtx.globalAlpha = 1;
    this.materialTexture.refresh();
    syncRuntimeStats(this.state, { dirtyCells: dirty.length });
  }

  private queueMaterialFlare(index: number, material: MaterialType): void {
    const color = MATERIAL_FLARE_COLORS[material];
    if (!color) return;
    const x = (index % GRID_WIDTH) * CELL_SIZE + CELL_SIZE / 2;
    const y = Math.floor(index / GRID_WIDTH) * CELL_SIZE + CELL_SIZE / 2;
    this.materialFlares.push({
      x,
      y,
      color,
      radius: 16 + (index % 13),
      startedAtTick: this.state.tick,
      expiresAtTick: this.state.tick + 14 + (index % 8),
    });
    if (this.materialFlares.length > MAX_MATERIAL_FLARES) {
      this.materialFlares.splice(0, this.materialFlares.length - MAX_MATERIAL_FLARES);
    }
  }

  private drawMaterialGlows(): void {
    this.materialGlows.clear();
    this.materialFlares = this.materialFlares.filter((flare) => flare.expiresAtTick >= this.state.tick);
    for (const flare of this.materialFlares) {
      const duration = Math.max(1, flare.expiresAtTick - flare.startedAtTick);
      const progress = Phaser.Math.Clamp((this.state.tick - flare.startedAtTick) / duration, 0, 1);
      const alpha = (1 - progress) * 0.26;
      const radius = flare.radius + progress * 12;
      this.materialGlows.fillStyle(flare.color, alpha * 0.38);
      this.materialGlows.fillCircle(flare.x, flare.y, radius);
      this.materialGlows.lineStyle(1, flare.color, alpha);
      this.materialGlows.strokeCircle(flare.x, flare.y, radius * 0.62);
    }
  }

  private drawEffects(): void {
    this.effects.clear();
    this.drawRingDanger();
    for (const hitbox of this.state.activeHitboxes) {
      const ownerColor = hitbox.ownerId === 'p1' ? 0xffffff : 0xff4d6d;
      this.effects.fillStyle(ownerColor, 0.16);
      this.effects.fillRect(hitbox.rect.x, hitbox.rect.y, hitbox.rect.width, hitbox.rect.height);
      this.effects.lineStyle(2, ownerColor, 0.55);
      this.effects.strokeRect(hitbox.rect.x, hitbox.rect.y, hitbox.rect.width, hitbox.rect.height);
    }

    this.drawMoveTelegraph(this.state.fighters.p1);
    this.drawMoveTelegraph(this.state.fighters.cpu);
    this.drawImpactEffects();

    if (this.impactFlashTicks > 0) {
      const alpha = this.reducedMotion
        ? 0.05
        : Phaser.Math.Clamp(0.04 + this.impactFlashTicks * 0.025, 0.04, 0.18);
      this.effects.fillStyle(0xfdf4d0, alpha);
      this.effects.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    }
  }

  private drawMoveTelegraph(fighter: FighterState): void {
    if (!fighter.activeMove || fighter.activeMove.spawned) return;
    const spec = FIGHTER_SPECS[fighter.specId].moves.find((move) => move.id === fighter.activeMove?.moveId);
    if (!spec) return;
    const rect = previewHitbox(fighter, spec, fighter.activeMove.boosted);
    const progress = startupTelegraphProgress(fighter.activeMove, spec, this.state.tick);
    const feel = feelForMove(spec.id, fighter.activeMove.boosted);
    const color = FIGHTER_SPECS[fighter.specId].accentColor;
    const lineWidth = feel.telegraphStyle === 'heavy' ? 4 : 2;
    const fillHeight = rect.height * progress;
    this.effects.fillStyle(color, feel.telegraphStyle === 'heavy' ? 0.14 : 0.09);
    this.effects.fillRect(rect.x, rect.y + rect.height - fillHeight, rect.width, fillHeight);
    this.effects.lineStyle(lineWidth, color, 0.35 + progress * 0.45);
    this.effects.strokeRect(rect.x, rect.y, rect.width, rect.height);
    if (feel.telegraphStyle === 'heavy' && progress >= 0.72) {
      const pulse = this.reducedMotion ? 0.6 : 0.45 + Math.sin(this.state.tick * 0.75) * 0.18;
      this.effects.lineStyle(3, 0xfff0a6, pulse);
      this.effects.strokeRect(rect.x - 5, rect.y - 5, rect.width + 10, rect.height + 10);
    }
  }

  private drawImpactEffects(): void {
    this.impactEffects = this.impactEffects.filter((effect) => effect.expiresAtTick >= this.state.tick);
    for (const effect of this.impactEffects) {
      const remaining = Math.max(0, effect.expiresAtTick - this.state.tick);
      const alpha = Phaser.Math.Clamp(remaining / 12, 0.12, 0.85);
      if (effect.kind === 'block') {
        this.effects.lineStyle(effect.weight === 'heavy' ? 5 : 4, 0xddeaff, alpha);
        this.effects.strokeCircle(effect.x, effect.y, effect.weight === 'heavy' ? 31 : 24);
        this.effects.lineStyle(2, 0x7ec8ff, alpha * 0.8);
        this.effects.lineBetween(effect.x - 20, effect.y, effect.x + 20, effect.y);
        this.effects.lineBetween(effect.x, effect.y - 20, effect.x, effect.y + 20);
      } else {
        const color = effect.weight === 'heavy' ? 0xfff0a6 : 0xfdf4d0;
        const radius = effect.weight === 'heavy' ? 26 : effect.weight === 'medium' ? 21 : 16;
        this.effects.fillStyle(color, alpha * 0.35);
        this.effects.fillCircle(effect.x, effect.y, radius);
        this.effects.lineStyle(effect.weight === 'heavy' ? 4 : 3, color, alpha);
        this.effects.strokeCircle(effect.x, effect.y, radius);
      }
    }
  }

  private drawRingDanger(): void {
    const bandWidth = 26;
    this.effects.fillStyle(0xff5b4a, 0.06);
    this.effects.fillRect(0, 0, bandWidth, ARENA_HEIGHT);
    this.effects.fillRect(ARENA_WIDTH - bandWidth, 0, bandWidth, ARENA_HEIGHT);
    this.effects.fillRect(0, ARENA_HEIGHT - bandWidth, ARENA_WIDTH, bandWidth);

    for (const fighter of [this.state.fighters.p1, this.state.fighters.cpu]) {
      const danger = ringOutDangerFor(fighter);
      if (!danger.active) continue;
      const alpha = this.reducedMotion ? 0.45 : 0.28 + Math.sin(this.state.tick * 0.7) * 0.12;
      this.effects.lineStyle(4, 0xff5b4a, alpha + danger.severity * 0.25);
      this.effects.strokeCircle(fighter.x, fighter.y, Math.max(fighter.width, fighter.height) * (0.72 + danger.severity * 0.16));
      this.effects.fillStyle(0xff5b4a, 0.1 + danger.severity * 0.08);
      if (danger.side === 'left') this.effects.fillRect(0, 0, bandWidth + 18, ARENA_HEIGHT);
      if (danger.side === 'right') this.effects.fillRect(ARENA_WIDTH - bandWidth - 18, 0, bandWidth + 18, ARENA_HEIGHT);
      if (danger.side === 'bottom') this.effects.fillRect(0, ARENA_HEIGHT - bandWidth - 18, ARENA_WIDTH, bandWidth + 18);
    }
  }

  private drawFighters(): void {
    this.fighterUnderlays.clear();
    this.fighterOverlays.clear();
    this.drawFighter(this.state.fighters.p1);
    this.drawFighter(this.state.fighters.cpu);
  }

  private drawFighter(fighter: FighterState): void {
    const spec = FIGHTER_SPECS[fighter.specId];
    const alpha = fighter.invulnTicks > 0 && fighter.invulnTicks % 12 < 6 ? 0.45 : 1;
    const sprite = this.fighterSprites[fighter.id];
    const requestedAnimation = selectFighterAnimation(fighter);
    const animationDecision = stabilizeFighterAnimation(requestedAnimation, this.fighterAnimationDecisions[fighter.id]);
    this.fighterAnimationDecisions[fighter.id] = animationDecision;
    const animation = resolveFighterSpriteAnimation(fighter.specId, animationDecision.animation);
    const animationKey = fighterAnimationKey(fighter.specId, animation);
    const frozen = this.hitstopTicks > 0 ? this.frozenFighters?.[fighter.id] : null;
    const visualX = frozen?.x ?? fighter.x;
    const visualY = frozen?.y ?? fighter.y;
    const visualFacing = frozen?.facing ?? fighter.facing;

    this.drawFighterAura(fighter, visualX, visualY, alpha);
    this.fighterUnderlays.fillStyle(0x050708, 0.4 * alpha);
    this.fighterUnderlays.fillEllipse(visualX, visualY + fighter.height / 2 + 5, fighter.width * 1.25, 10);

    sprite.setVisible(true);
    sprite.setPosition(visualX, visualY + fighter.height / 2 + 7);
    sprite.setAlpha(alpha);
    sprite.setFlipX(visualFacing === -1);
    if (fighter.boosted) {
      sprite.setTint(0xffffff, spec.accentColor, 0xffffff, spec.accentColor);
    } else if (fighter.hitstunTicks > 0) {
      sprite.setTint(0xffc7b8);
    } else {
      sprite.clearTint();
    }
    if (sprite.anims.currentAnim?.key !== animationKey) {
      sprite.play(animationKey, true);
    }

    if (fighter.blockTicks > 0) {
      this.fighterOverlays.lineStyle(4, 0xddeaff, 0.72);
      this.fighterOverlays.strokeCircle(visualX + visualFacing * 11, visualY - 2, 33);
    }

    if (fighter.boosted) {
      this.fighterOverlays.lineStyle(2, spec.accentColor, 0.7);
      this.fighterOverlays.strokeCircle(visualX, visualY, Math.max(fighter.width, fighter.height) * 0.72);
    }
  }

  private drawFighterAura(fighter: FighterState, visualX: number, visualY: number, alpha: number): void {
    const spec = FIGHTER_SPECS[fighter.specId];
    const speedRatio = Phaser.Math.Clamp(Math.abs(fighter.vx) / Math.max(1, spec.dashVelocity), 0, 1);
    const activeMoveAlpha = fighter.activeMove ? 0.12 : 0;
    const boostAlpha = fighter.boosted ? 0.18 : 0;
    const pulse = this.reducedMotion ? 0 : Math.sin(this.state.tick * 0.18 + fighter.x * 0.01) * 0.025;
    const baseAlpha = (0.055 + speedRatio * 0.055 + activeMoveAlpha + boostAlpha + pulse) * alpha;
    const groundY = visualY + fighter.height / 2 + 8;

    this.fighterUnderlays.fillStyle(spec.color, Phaser.Math.Clamp(baseAlpha, 0.04, 0.28));
    this.fighterUnderlays.fillEllipse(visualX, groundY, fighter.width * (2.4 + speedRatio * 1.7), 18 + speedRatio * 8);
    this.fighterUnderlays.lineStyle(fighter.boosted ? 3 : 2, spec.accentColor, Phaser.Math.Clamp(baseAlpha + 0.08, 0.08, 0.42));
    this.fighterUnderlays.strokeEllipse(visualX, groundY - 2, fighter.width * (1.75 + speedRatio), 24 + speedRatio * 10);

    if (!fighter.activeMove && !fighter.boosted) return;
    const radius = Math.max(fighter.width, fighter.height) * (fighter.boosted ? 0.86 : 0.72);
    const side = fighter.facing;
    this.fighterOverlays.lineStyle(2, spec.accentColor, fighter.boosted ? 0.42 : 0.26);
    this.fighterOverlays.lineBetween(visualX - side * radius * 0.18, visualY - radius * 0.8, visualX + side * radius * 0.62, visualY - radius * 0.52);
    this.fighterOverlays.lineBetween(visualX - side * radius * 0.28, visualY + radius * 0.55, visualX + side * radius * 0.68, visualY + radius * 0.28);
  }

  private recordReplayFrame(actions: ActionState): void {
    if (!this.replayLog || this.state.matchPhase === 'finished') return;
    appendReplayFrame(this.replayLog, this.state.tick, actions);
  }

  private persistReplayIfNeeded(): void {
    if (!this.replayLog || this.state.matchPhase === 'finished') return;
    if (this.state.tick - this.lastReplayFlushTick < TICK_RATE) return;
    saveRunningReplay(this.replayLog);
    this.lastReplayFlushTick = this.state.tick;
  }

  private persistCompletedReplayIfNeeded(): void {
    if (!this.replayLog || this.completedReplaySaved || !this.state.result) return;
    saveCompletedReplay(this.replayLog, this.state.result);
    this.completedReplaySaved = true;
    recordOpsEvent({
      matchId: this.state.matchId,
      tick: this.state.tick,
      type: 'match-completed',
      message: `${this.state.result.winner ?? 'nobody'} won by ${this.state.result.reason}.`,
      details: { result: this.state.result },
    });
  }

  private toggleDebugOverlay(): void {
    this.debugVisible = !this.debugVisible;
    setDebugOverlayVisible(this.debugVisible);
    setDebugButtonActive(this.debugVisible);
    updateDebugOverlay(this.state, this.debugVisible);
  }

  private handleStartupCueFeedback(): void {
    for (const fighter of [this.state.fighters.p1, this.state.fighters.cpu]) {
      if (!fighter.activeMove || fighter.activeMove.spawned) continue;
      const move = FIGHTER_SPECS[fighter.specId].moves.find((candidate) => candidate.id === fighter.activeMove?.moveId);
      if (!move) continue;
      const feel = feelForMove(move.id, fighter.activeMove.boosted);
      if (!feel.startupCue) continue;
      const progress = startupTelegraphProgress(fighter.activeMove, move, this.state.tick);
      const cueKey = `${fighter.id}:${move.id}:${fighter.activeMove.startedTick}`;
      if (progress < 0.72 || this.startupCueKeys.has(cueKey)) continue;
      this.startupCueKeys.add(cueKey);
      this.combatAudio.play(feel.startupCue);
    }
  }

  private handleRingDangerFeedback(): void {
    for (const fighter of [this.state.fighters.p1, this.state.fighters.cpu]) {
      const danger = ringOutDangerFor(fighter);
      if (danger.active && !this.ringDangerActive[fighter.id]) {
        this.combatAudio.play('ring-danger');
      }
      this.ringDangerActive[fighter.id] = danger.active;
    }
  }

  private advancePresentationTimers(): void {
    if (this.hitstopTicks > 0) {
      this.hitstopTicks--;
      if (this.hitstopTicks === 0) this.frozenFighters = null;
    }
    this.impactFlashTicks = Math.max(0, this.impactFlashTicks - 1);
  }

  private handleCombatImpactFeedback(): void {
    const { combatImpactSeq, lastCombatImpact } = this.state.runtimeStats;
    if (!lastCombatImpact || combatImpactSeq === this.lastCombatImpactSeq) return;
    this.lastCombatImpactSeq = combatImpactSeq;
    const feedback = impactFeedbackFor(lastCombatImpact, { reducedMotion: this.reducedMotion });
    if (feedback.hitstopTicks > 0) {
      this.hitstopTicks = Math.min(
        MAX_PRESENTATION_HITSTOP_TICKS,
        Math.max(this.hitstopTicks, feedback.hitstopTicks),
      );
      this.frozenFighters = {
        p1: freezeFighterVisual(this.state.fighters.p1),
        cpu: freezeFighterVisual(this.state.fighters.cpu),
      };
    }
    this.impactFlashTicks = Math.max(this.impactFlashTicks, feedback.flashTicks);
    if (feedback.spark === 'hit' || feedback.spark === 'block') {
      this.impactEffects.push({
        x: lastCombatImpact.contactX,
        y: lastCombatImpact.contactY,
        kind: feedback.spark,
        weight: feedback.weight,
        expiresAtTick: this.state.tick + (feedback.spark === 'block' ? 12 : 10),
      });
      if (this.impactEffects.length > 16) this.impactEffects.splice(0, this.impactEffects.length - 16);
    }
    this.combatAudio.play(feedback.soundCue);
    if (feedback.shakeDurationMs > 0 && feedback.shakeIntensity > 0) {
      this.cameras.main.shake(feedback.shakeDurationMs, feedback.shakeIntensity, true);
    }
  }
}

function previewHitbox(fighter: FighterState, move: MoveSpec, boosted: boolean): Rect {
  const extraWidth = boosted && move.boost.stat === 'size' ? move.boost.amount * CELL_SIZE : 0;
  const width = move.hitbox.width + extraWidth;
  const centerX = fighter.x + move.hitbox.offsetX * (fighter.activeMove?.facing ?? fighter.facing);
  const centerY = fighter.y + move.hitbox.offsetY;
  return {
    x: centerX - width / 2,
    y: centerY - move.hitbox.height / 2,
    width,
    height: move.hitbox.height,
  };
}

function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function materialRenderColor(material: MaterialType): number {
  if (material === MaterialType.Water) return 0x3a95ff;
  if (material === MaterialType.Fire) return 0xff8a2a;
  if (material === MaterialType.Lava) return 0xff3216;
  if (material === MaterialType.Ice) return 0xb9f2ff;
  if (material === MaterialType.Steam) return 0xe9f7fa;
  if (material === MaterialType.Smoke) return 0x7a818c;
  if (material === MaterialType.Glass) return 0xa9f2ec;
  return MATERIAL_COLORS[material];
}

function createArenaMotes(): ArenaMote[] {
  const motes: ArenaMote[] = [];
  for (let i = 0; i < 42; i++) {
    const sideTint = i % 3;
    motes.push({
      x: (i * 97) % ARENA_WIDTH,
      y: 104 + ((i * 53) % 610),
      drift: 6 + (i % 7) * 2.4,
      speed: 0.035 + (i % 5) * 0.011,
      radius: 0.7 + (i % 4) * 0.28,
      phase: i * 0.83,
      color: sideTint === 0 ? 0x9ee7ff : sideTint === 1 ? 0xffd166 : 0xb8c6cf,
      alpha: 0.12 + (i % 5) * 0.018,
    });
  }
  return motes;
}

function wrap(value: number, min: number, max: number): number {
  const span = max - min;
  return ((((value - min) % span) + span) % span) + min;
}

function freezeFighterVisual(fighter: FighterState): FighterVisualFreeze {
  return {
    x: fighter.x,
    y: fighter.y,
    facing: fighter.facing,
  };
}

function initialVisualAnimationFor(fighter: FighterState): FighterAnimationDecision['animation'] {
  const selected = selectFighterAnimation(fighter);
  return selected === 'run' || selected === 'jump' ? 'idle' : selected;
}
