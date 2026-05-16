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
import { FIGHTER_SPECS } from '../../game/simulation/fighters';
import { consumeDirtyMaterialIndices } from '../../game/simulation/grid';
import { createBattleState, EMPTY_ACTIONS, stepBattle } from '../../game/simulation/battle';
import { emptyActions } from '../../game/input/actions';
import { KEY_BINDINGS } from '../../game/input/bindings';
import { bindHudControls, setDebugButtonActive, setRecoveryNoticeVisible, updateHud } from '../../ui/hud';
import { installGlobalOpsHandlers, recordOpsEvent, syncRuntimeStats } from '../../game/ops';
import { appendReplayFrame, createReplayLog, replayBattle } from '../../game/replay';
import { clearRunningReplay, loadRunningReplay, saveCompletedReplay, saveRunningReplay } from '../../game/replayStorage';
import { setDebugOverlayVisible, updateDebugOverlay } from '../../ui/debugOverlay';
import type { ActionState, BattleState, FighterSpecId, FighterState, MoveSpec, Rect, ReplayLog } from '../../game/simulation/types';

const STEP_MS = 1000 / TICK_RATE;
const MAX_SIM_STEPS_PER_FRAME = 4;

export class BattleScene extends Phaser.Scene {
  private state: BattleState = createBattleState('water');
  private selectedSpec: FighterSpecId = 'water';
  private accumulator = 0;
  private backdrop!: Phaser.GameObjects.Graphics;
  private materialTexture!: Phaser.Textures.CanvasTexture;
  private materialCtx!: CanvasRenderingContext2D;
  private materialImage!: Phaser.GameObjects.Image;
  private fighters!: Phaser.GameObjects.Graphics;
  private effects!: Phaser.GameObjects.Graphics;
  private keys!: Record<keyof typeof KEY_BINDINGS, Phaser.Input.Keyboard.Key>;
  private replayLog: ReplayLog | null = null;
  private lastReplayFlushTick = 0;
  private completedReplaySaved = false;
  private debugVisible = false;
  private touchActions: ActionState = emptyActions();
  private hitstopTicks = 0;
  private impactFlashTicks = 0;
  private lastCombatImpactSeq = 0;

  constructor() {
    super('BattleScene');
  }

  create(): void {
    this.cameras.main.setBounds(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.cameras.main.setBackgroundColor(0x171a1e);
    this.backdrop = this.add.graphics();
    this.drawStaticBackdrop();
    this.createMaterialLayer();
    this.fighters = this.add.graphics();
    this.effects = this.add.graphics();
    this.keys = this.input.keyboard!.addKeys(KEY_BINDINGS) as Record<keyof typeof KEY_BINDINGS, Phaser.Input.Keyboard.Key>;

    bindHudControls({
      onSelect: (specId) => {
        clearRunningReplay();
        this.startMatch(specId);
      },
      onRestart: () => {
        clearRunningReplay();
        this.startMatch(this.selectedSpec);
      },
      onToggleDebug: () => this.toggleDebugOverlay(),
      onDismissRecovery: () => setRecoveryNoticeVisible(false),
      onTouchAction: (action, pressed) => {
        this.touchActions[action] = pressed;
      },
    });
    installGlobalOpsHandlers(() => this.state);
    this.debugVisible = new URLSearchParams(window.location.search).get('debug') === '1';
    setDebugOverlayVisible(this.debugVisible);
    setDebugButtonActive(this.debugVisible);
    if (!this.recoverRunningMatch()) {
      this.startMatch(this.selectedSpec);
    }
  }

  update(_time: number, delta: number): void {
    if (Phaser.Input.Keyboard.JustDown(this.keys.restart)) {
      clearRunningReplay();
      this.startMatch(this.selectedSpec);
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.debug)) {
      this.toggleDebugOverlay();
    }

    if (this.hitstopTicks > 0) {
      this.hitstopTicks--;
      this.impactFlashTicks = Math.max(0, this.impactFlashTicks - 1);
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

    syncRuntimeStats(this.state, { frameMs: delta, simSteps });
    this.impactFlashTicks = Math.max(0, this.impactFlashTicks - 1);
    this.renderState();
    updateHud(this.state);
    updateDebugOverlay(this.state, this.debugVisible);
    this.persistCompletedReplayIfNeeded();
  }

  private startMatch(specId: FighterSpecId): void {
    this.selectedSpec = specId;
    this.state = createBattleState(specId);
    this.replayLog = createReplayLog(specId, this.state.initialSeed, this.state.matchId);
    this.lastReplayFlushTick = 0;
    this.completedReplaySaved = false;
    this.accumulator = 0;
    this.touchActions = emptyActions();
    this.hitstopTicks = 0;
    this.impactFlashTicks = 0;
    this.lastCombatImpactSeq = this.state.runtimeStats.combatImpactSeq;
    this.resetMaterialLayer();
    setRecoveryNoticeVisible(false);
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
    this.lastReplayFlushTick = recovered.tick;
    this.completedReplaySaved = false;
    this.accumulator = 0;
    this.touchActions = emptyActions();
    this.hitstopTicks = 0;
    this.impactFlashTicks = 0;
    this.lastCombatImpactSeq = this.state.runtimeStats.combatImpactSeq;
    this.resetMaterialLayer();
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

  private readActions(): ActionState {
    const actions = emptyActions();
    actions.left = this.keys.left.isDown || this.touchActions.left;
    actions.right = this.keys.right.isDown || this.touchActions.right;
    actions.up = this.keys.up.isDown || this.keys.jumpAlt.isDown || this.touchActions.up;
    actions.down = this.keys.down.isDown || this.touchActions.down;
    actions.dash = this.keys.dash.isDown || this.touchActions.dash;
    actions.block = this.keys.block.isDown || this.touchActions.block;
    actions.basic = this.keys.basic.isDown || this.touchActions.basic;
    actions.special1 = this.keys.special1.isDown || this.touchActions.special1;
    actions.special2 = this.keys.special2.isDown || this.touchActions.special2;
    actions.special3 = this.keys.special3.isDown || this.touchActions.special3;
    return actions;
  }

  private renderState(): void {
    this.flushDirtyMaterials();
    this.drawEffects();
    this.drawFighters();
  }

  private drawStaticBackdrop(): void {
    this.backdrop.clear();
    this.backdrop.fillStyle(0x171a1e, 1);
    this.backdrop.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.backdrop.fillStyle(0x202833, 1);
    this.backdrop.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    this.backdrop.lineStyle(1, 0x34404a, 0.35);
    for (let x = 0; x <= ARENA_WIDTH; x += 80) this.backdrop.lineBetween(x, 0, x, ARENA_HEIGHT);
    for (let y = 0; y <= ARENA_HEIGHT; y += 80) this.backdrop.lineBetween(0, y, ARENA_WIDTH, y);
    this.backdrop.fillStyle(0x11161b, 0.85);
    this.backdrop.fillRect(0, 650, ARENA_WIDTH, 70);
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
      this.materialCtx.globalAlpha = cell.expiresAtTick === null ? 0.95 : 0.86;
      this.materialCtx.fillStyle = colorToCss(MATERIAL_COLORS[cell.material]);
      this.materialCtx.fillRect(x, y, 1, 1);
    }
    this.materialCtx.globalAlpha = 1;
    this.materialTexture.refresh();
    syncRuntimeStats(this.state, { dirtyCells: dirty.length });
  }

  private drawEffects(): void {
    this.effects.clear();
    for (const hitbox of this.state.activeHitboxes) {
      const ownerColor = hitbox.ownerId === 'p1' ? 0xffffff : 0xff4d6d;
      this.effects.fillStyle(ownerColor, 0.16);
      this.effects.fillRect(hitbox.rect.x, hitbox.rect.y, hitbox.rect.width, hitbox.rect.height);
      this.effects.lineStyle(2, ownerColor, 0.55);
      this.effects.strokeRect(hitbox.rect.x, hitbox.rect.y, hitbox.rect.width, hitbox.rect.height);
    }

    this.drawMoveTelegraph(this.state.fighters.p1);
    this.drawMoveTelegraph(this.state.fighters.cpu);

    if (this.impactFlashTicks > 0) {
      const alpha = Phaser.Math.Clamp(0.05 + this.impactFlashTicks * 0.03, 0.05, 0.22);
      this.effects.fillStyle(0xfdf4d0, alpha);
      this.effects.fillRect(0, 0, ARENA_WIDTH, ARENA_HEIGHT);
    }
  }

  private drawMoveTelegraph(fighter: FighterState): void {
    if (!fighter.activeMove || fighter.activeMove.spawned) return;
    const spec = FIGHTER_SPECS[fighter.specId].moves.find((move) => move.id === fighter.activeMove?.moveId);
    if (!spec) return;
    const rect = previewHitbox(fighter, spec, fighter.activeMove.boosted);
    const progress = Phaser.Math.Clamp((this.state.tick - fighter.activeMove.startedTick) / Math.max(1, spec.startupTicks), 0, 1);
    this.effects.lineStyle(2, FIGHTER_SPECS[fighter.specId].accentColor, 0.35 + progress * 0.45);
    this.effects.strokeRect(rect.x, rect.y, rect.width, rect.height);
  }

  private drawFighters(): void {
    this.fighters.clear();
    this.drawFighter(this.state.fighters.p1);
    this.drawFighter(this.state.fighters.cpu);
  }

  private drawFighter(fighter: FighterState): void {
    const spec = FIGHTER_SPECS[fighter.specId];
    const alpha = fighter.invulnTicks > 0 && fighter.invulnTicks % 12 < 6 ? 0.45 : 1;
    const left = fighter.x - fighter.width / 2;
    const top = fighter.y - fighter.height / 2;

    this.fighters.fillStyle(0x050708, 0.4 * alpha);
    this.fighters.fillEllipse(fighter.x, fighter.y + fighter.height / 2 + 5, fighter.width * 1.2, 10);
    this.fighters.fillStyle(spec.color, alpha);
    this.fighters.fillRoundedRect(left, top + 14, fighter.width, fighter.height - 14, 6);
    this.fighters.fillStyle(spec.accentColor, alpha);
    this.fighters.fillCircle(fighter.x, top + 12, fighter.width * 0.42);
    this.fighters.lineStyle(3, spec.accentColor, alpha);
    this.fighters.lineBetween(fighter.x, fighter.y - 6, fighter.x + fighter.facing * 24, fighter.y - 12);

    if (fighter.blockTicks > 0) {
      this.fighters.lineStyle(4, 0xddeaff, 0.72);
      this.fighters.strokeCircle(fighter.x + fighter.facing * 11, fighter.y - 2, 33);
    }

    if (fighter.boosted) {
      this.fighters.lineStyle(2, spec.accentColor, 0.7);
      this.fighters.strokeCircle(fighter.x, fighter.y, Math.max(fighter.width, fighter.height) * 0.72);
    }
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

  private handleCombatImpactFeedback(): void {
    const { combatImpactSeq, lastCombatImpact } = this.state.runtimeStats;
    if (!lastCombatImpact || combatImpactSeq === this.lastCombatImpactSeq) return;
    this.lastCombatImpactSeq = combatImpactSeq;
    const freezeTicks = impactFreezeTicks(lastCombatImpact.damage, lastCombatImpact.blocked);
    this.hitstopTicks = Math.max(this.hitstopTicks, freezeTicks);
    this.impactFlashTicks = Math.max(this.impactFlashTicks, freezeTicks + 2);

    const duration = lastCombatImpact.blocked
      ? 35
      : Phaser.Math.Clamp(52 + lastCombatImpact.damage * 7, 52, 130);
    const intensity = lastCombatImpact.blocked
      ? 0.0012
      : Phaser.Math.Clamp(0.0018 + lastCombatImpact.damage * 0.00014, 0.0018, 0.0042);
    this.cameras.main.shake(duration, intensity, true);
  }
}

function previewHitbox(fighter: FighterState, move: MoveSpec, boosted: boolean): Rect {
  const extraWidth = boosted && move.boost.stat === 'size' ? move.boost.amount * CELL_SIZE : 0;
  const width = move.hitbox.width + extraWidth;
  const centerX = fighter.x + move.hitbox.offsetX * fighter.facing;
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

function impactFreezeTicks(damage: number, blocked: boolean): number {
  if (blocked) return 1;
  if (damage >= 17) return 4;
  if (damage >= 10) return 3;
  return 2;
}
