import { MATCH_TICKS, TICK_RATE } from '../game/simulation/constants';
import { FIGHTER_SPECS } from '../game/simulation/fighters';
import type { ActionState, BattleState, FighterId, FighterSpecId, FighterState } from '../game/simulation/types';

export interface HudControlHandlers {
  onSelect: (specId: FighterSpecId) => void;
  onRestart: () => void;
  onOpenSelect?: () => void;
  onToggleDebug: () => void;
  onDismissRecovery: () => void;
  onTouchAction?: (action: keyof ActionState, pressed: boolean) => void;
}

const TOUCH_ACTION_KEYS = [
  'left',
  'right',
  'up',
  'down',
  'dash',
  'block',
  'shield',
  'basic',
  'attack',
  'special1',
  'special2',
  'special3',
  'special',
  'grab',
] as const;

type TouchActionKey = (typeof TOUCH_ACTION_KEYS)[number];

const TOUCH_HINT_WINDOW_TICKS = TICK_RATE * 10;
const THREAT_TELEGRAPH_WINDOW_TICKS = 18;
const THREAT_IMMINENT_TICKS = 4;

interface TouchHintState {
  enabled: boolean;
  dismissed: boolean;
  firstShownTick: number | null;
  actionUsed: boolean;
}

const touchHintState: TouchHintState = {
  enabled: false,
  dismissed: false,
  firstShownTick: null,
  actionUsed: false,
};

export interface TouchCapabilitySource {
  matchMedia?: (query: string) => { matches: boolean };
  navigator?: { maxTouchPoints?: number };
}

export function bindHudControls(handlers: HudControlHandlers): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-fighter]')) {
    button.addEventListener('click', () => {
      const specId = button.dataset.fighter as FighterSpecId | undefined;
      if (specId) handlers.onSelect(specId);
    });
  }
  document.getElementById('restart-match')?.addEventListener('click', handlers.onRestart);
  document.getElementById('result-rematch')?.addEventListener('click', handlers.onRestart);
  document.getElementById('result-change-fighter')?.addEventListener('click', () => handlers.onOpenSelect?.());
  document.getElementById('debug-toggle')?.addEventListener('click', handlers.onToggleDebug);
  document.getElementById('recovery-new')?.addEventListener('click', handlers.onRestart);
  document.getElementById('recovery-dismiss')?.addEventListener('click', handlers.onDismissRecovery);
  document.getElementById('help-toggle')?.addEventListener('click', toggleHelpDrawer);
  document.getElementById('touch-hint-dismiss')?.addEventListener('click', () => {
    touchHintState.dismissed = true;
    renderTouchHint(0);
  });
  bindTouchControls(handlers);
}

export function shouldEnableTouchControls(source: TouchCapabilitySource): boolean {
  const coarsePointer = source.matchMedia?.('(pointer: coarse)').matches ?? false;
  const maxTouchPoints = source.navigator?.maxTouchPoints ?? 0;
  return coarsePointer || maxTouchPoints > 0;
}

export function resolveTouchAction(value: string | undefined): TouchActionKey | null {
  if (!value) return null;
  return TOUCH_ACTION_KEYS.includes(value as TouchActionKey) ? (value as TouchActionKey) : null;
}

export function updateHud(state: BattleState): void {
  updateFighterHud('p1', state.fighters.p1, state.fighters.cpu, state.tick);
  updateFighterHud('cpu', state.fighters.cpu, state.fighters.p1, state.tick);
  updateFighterSelectCards(state.fighters.p1.specId);
  const timer = document.getElementById('timer');
  if (timer) timer.textContent = formatTimer(state.matchPhase === 'suddenDeath' ? 0 : state.timerTicks);

  const status = document.getElementById('status');
  if (status) {
    if (state.result) {
      status.textContent = `${labelForWinner(state.result.winner)} wins by ${state.result.reason}. Press R to restart.`;
    } else if (state.matchPhase === 'suddenDeath') {
      status.textContent = 'Sudden death: first hit wins.';
    } else {
      const lastEvent = state.eventLog[state.eventLog.length - 1];
      status.textContent = lastEvent ? lastEvent.message : 'Bend nearby materials to discount and strengthen specials.';
    }
  }
  setResultOverlayVisible(Boolean(state.result), state);
  renderTouchHint(state.tick);
}

export function setCharacterSelectVisible(visible: boolean): void {
  const overlay = document.getElementById('fighter-select');
  if (overlay) overlay.hidden = !visible;
  setAppModeClass('screen-mode-select', visible);
}

export function setVersusIntroVisible(visible: boolean, state: BattleState, ticksRemaining = 0): void {
  const overlay = document.getElementById('versus-overlay');
  if (!overlay) return;
  overlay.hidden = !visible;
  setAppModeClass('screen-mode-versus', visible);
  if (!visible) return;

  const p1Spec = FIGHTER_SPECS[state.fighters.p1.specId];
  const cpuSpec = FIGHTER_SPECS[state.fighters.cpu.specId];
  setImage('vs-p1-portrait', p1Spec.portraitUrl);
  setImage('vs-cpu-portrait', cpuSpec.portraitUrl);
  setText('vs-p1-name', p1Spec.name);
  setText('vs-cpu-name', cpuSpec.name);
  setText('vs-p1-style', p1Spec.styleName);
  setText('vs-cpu-style', cpuSpec.styleName);

  const count = Math.max(0, Math.ceil(ticksRemaining / TICK_RATE));
  setText('versus-count', count > 0 ? String(count) : 'BEND');
}

export function setResultOverlayVisible(visible: boolean, state: BattleState): void {
  const overlay = document.getElementById('result-overlay');
  if (!overlay) return;
  overlay.hidden = !visible;
  setAppModeClass('screen-mode-result', visible);
  if (!visible || !state.result) return;

  const winnerId = state.result.winner;
  const winner = winnerId ? state.fighters[winnerId] : null;
  const winnerSpec = winner ? FIGHTER_SPECS[winner.specId] : FIGHTER_SPECS[state.fighters.p1.specId];
  setImage('result-portrait', winnerSpec.portraitUrl);
  setText('result-reason', `${state.result.reason.toUpperCase()} / ${state.matchId}`);
  setText('result-title', winner ? `${winnerSpec.name} Wins` : 'No Winner');
  setText(
    'result-summary',
    `Stocks ${state.result.finalStocks.p1}-${state.result.finalStocks.cpu} / Health ${Math.ceil(state.result.finalHealth.p1)}-${Math.ceil(state.result.finalHealth.cpu)}`,
  );
}

function setAppModeClass(className: string, active: boolean): void {
  document.getElementById('app')?.classList.toggle(className, active);
}

export function setRecoveryNoticeVisible(visible: boolean): void {
  const banner = document.getElementById('recovery-banner');
  if (banner) banner.hidden = !visible;
}

export function setDebugButtonActive(active: boolean): void {
  const button = document.getElementById('debug-toggle');
  if (!button) return;
  button.setAttribute('aria-pressed', String(active));
}

function bindTouchControls(handlers: HudControlHandlers): void {
  const root = document.getElementById('touch-controls');
  if (!root) return;
  const enabled = shouldEnableTouchControls(window);
  touchHintState.enabled = enabled;
  touchHintState.firstShownTick = null;
  touchHintState.dismissed = false;
  touchHintState.actionUsed = false;
  root.hidden = !enabled;
  root.dataset.active = String(enabled);
  document.getElementById('app')?.classList.toggle('touch-controls-active', enabled);
  renderTouchHint(0);
  if (!enabled || !handlers.onTouchAction) return;

  const pressedByButton = new Map<HTMLButtonElement, TouchActionKey>();

  const setPressed = (button: HTMLButtonElement, action: TouchActionKey, pressed: boolean): void => {
    const hasAction = pressedByButton.get(button) === action;
    if (pressed) {
      if (hasAction) return;
      pressedByButton.set(button, action);
      handlers.onTouchAction?.(action, true);
      touchHintState.actionUsed = true;
      renderTouchHint(0);
      button.setAttribute('aria-pressed', 'true');
      return;
    }
    if (!hasAction) return;
    pressedByButton.delete(button);
    handlers.onTouchAction?.(action, false);
    button.setAttribute('aria-pressed', 'false');
  };

  const releaseAll = (): void => {
    for (const [button, action] of pressedByButton.entries()) {
      handlers.onTouchAction?.(action, false);
      button.setAttribute('aria-pressed', 'false');
    }
    pressedByButton.clear();
  };

  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-touch-action]')) {
    const action = resolveTouchAction(button.dataset.touchAction);
    if (!action) continue;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      setPressed(button, action, true);
    });
    button.addEventListener('pointerup', (event) => {
      event.preventDefault();
      setPressed(button, action, false);
    });
    button.addEventListener('pointercancel', () => setPressed(button, action, false));
    button.addEventListener('lostpointercapture', () => setPressed(button, action, false));
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });
}

export function shouldShowTouchHint(
  state: Pick<TouchHintState, 'enabled' | 'dismissed' | 'firstShownTick' | 'actionUsed'>,
  tick: number,
  windowTicks = TOUCH_HINT_WINDOW_TICKS,
): boolean {
  if (!state.enabled || state.dismissed || state.actionUsed) return false;
  if (state.firstShownTick === null) return true;
  return tick - state.firstShownTick <= windowTicks;
}

function renderTouchHint(tick: number): void {
  const panel = document.getElementById('touch-hint');
  if (!panel) return;
  if (touchHintState.firstShownTick === null && touchHintState.enabled) {
    touchHintState.firstShownTick = tick;
  }
  panel.hidden = !shouldShowTouchHint(touchHintState, tick);
}

function updateFighterHud(id: FighterId, fighter: FighterState, opponent: FighterState, tick: number): void {
  const prefix = id === 'p1' ? 'p1' : 'cpu';
  const spec = FIGHTER_SPECS[fighter.specId];
  setText(`${prefix}-name`, id === 'p1' ? spec.name : `${spec.name} CPU`);
  setText(`${prefix}-style`, spec.styleName);
  setImage(`${prefix}-portrait`, spec.portraitUrl);
  setText(`${prefix}-stocks`, `Stocks ${fighter.stocks}`);
  setText(`${prefix}-boost`, fighter.boosted ? 'Boost ready' : `Shield ${Math.ceil(fighter.shieldPoints)}`);
  setFighterState(`${prefix}-state`, fighter, opponent, tick);
  setBar(`${prefix}-health`, fighter.health, isRecentlyDamaged(fighter, tick));
  setBar(`${prefix}-meter`, fighter.meter);
}

function updateFighterSelectCards(selectedSpecId: FighterSpecId): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>('.fighter-select-card[data-fighter]')) {
    const active = button.dataset.fighter === selectedSpecId;
    button.classList.toggle('fighter-select-card--active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setImage(id: string, src: string): void {
  const el = document.getElementById(id);
  if (el instanceof HTMLImageElement && el.getAttribute('src') !== src) el.src = src;
}

function setBar(id: string, value: number, damaged = false): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.width = `${Math.max(0, Math.min(100, value))}%`;
  el.classList.toggle('bar-fill--damaged', damaged);
}

function setFighterState(id: string, fighter: FighterState, opponent: FighterState, tick: number): void {
  const chip = document.getElementById(id);
  if (!chip) return;
  const baseSummary = fighterStateSummary(fighter, tick);
  const threatSummary = incomingThreatSummary(opponent, tick);
  if (threatSummary && shouldShowThreatCue(baseSummary)) {
    chip.textContent = `Threat ${threatSummary.framesUntilActive}f`;
    chip.setAttribute('data-tone', threatSummary.tone);
    return;
  }
  chip.textContent = baseSummary.label;
  chip.setAttribute('data-tone', baseSummary.tone);
}

function formatTimer(ticks: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ticks / TICK_RATE));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (ticks <= 0 && ticks !== MATCH_TICKS) return '0:00';
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function labelForWinner(winner: FighterId | null): string {
  if (winner === 'p1') return 'Player';
  if (winner === 'cpu') return 'CPU';
  return 'No one';
}

function toggleHelpDrawer(): void {
  const drawer = document.getElementById('help-drawer');
  const button = document.getElementById('help-toggle');
  if (!drawer || !button) return;
  const nextHidden = !drawer.hidden;
  drawer.hidden = nextHidden;
  button.setAttribute('aria-expanded', String(!nextHidden));
}

type FighterStateTone = 'neutral' | 'boost' | 'warning' | 'danger';

export interface FighterStateSummary {
  label: string;
  tone: FighterStateTone;
}

export interface IncomingThreatSummary {
  framesUntilActive: number;
  tone: Extract<FighterStateTone, 'warning' | 'danger'>;
}

export const DAMAGE_FLASH_TICKS = 16;

export function isRecentlyDamaged(fighter: FighterState, tick: number, windowTicks = DAMAGE_FLASH_TICKS): boolean {
  return fighter.lastDamageTakenTick >= 0 && tick - fighter.lastDamageTakenTick <= windowTicks;
}

export function fighterStateSummary(fighter: FighterState, tick = 0): FighterStateSummary {
  if (fighter.invulnTicks > 0) return { label: `Invuln ${fighter.invulnTicks}`, tone: 'boost' };
  if (fighter.hitstunTicks > 0) return { label: `Hitstun ${fighter.hitstunTicks}`, tone: 'danger' };
  if (fighter.shieldStunTicks > 0) return { label: `Shield break ${fighter.shieldStunTicks}`, tone: 'danger' };
  if (fighter.landingLagTicks > 0) return { label: `Landing ${fighter.landingLagTicks}`, tone: 'warning' };
  if (fighter.blockTicks > 0) return { label: 'Shielding', tone: 'warning' };
  const moveSummary = activeMoveSummary(fighter, tick);
  if (moveSummary) return moveSummary;
  if (fighter.slowTicks > 0) return { label: 'Slowed', tone: 'warning' };
  if (fighter.boosted) return { label: 'Boosted', tone: 'boost' };
  return { label: 'Neutral', tone: 'neutral' };
}

function activeMoveSummary(fighter: FighterState, tick: number): FighterStateSummary | null {
  const activeMove = fighter.activeMove;
  if (!activeMove) return null;

  const move = FIGHTER_SPECS[fighter.specId].moves.find((candidate) => candidate.id === activeMove.moveId);
  if (!move) return { label: 'Attacking', tone: 'warning' };

  const elapsedTicks = Math.max(0, tick - activeMove.startedTick);
  const startupEnd = move.startupTicks;
  const activeEnd = startupEnd + move.activeTicks;
  const recoveryEnd = activeEnd + move.recoveryTicks;

  if (elapsedTicks < startupEnd) {
    return { label: `Startup ${startupEnd - elapsedTicks}f`, tone: 'warning' };
  }
  if (elapsedTicks < activeEnd) {
    return { label: `Active ${activeEnd - elapsedTicks}f`, tone: 'danger' };
  }
  if (elapsedTicks < recoveryEnd) {
    return { label: `Recover ${recoveryEnd - elapsedTicks}f`, tone: 'neutral' };
  }
  return { label: 'Attacking', tone: 'warning' };
}

function shouldShowThreatCue(summary: FighterStateSummary): boolean {
  if (summary.tone === 'danger') return false;
  return summary.label === 'Neutral' || summary.label === 'Boosted' || summary.label.startsWith('Recover ');
}

export function incomingThreatSummary(
  attacker: FighterState,
  tick: number,
  windowTicks = THREAT_TELEGRAPH_WINDOW_TICKS,
): IncomingThreatSummary | null {
  const activeMove = attacker.activeMove;
  if (!activeMove) return null;

  const move = FIGHTER_SPECS[attacker.specId].moves.find((candidate) => candidate.id === activeMove.moveId);
  if (!move || move.startupTicks <= 0) return null;

  const elapsedTicks = Math.max(0, tick - activeMove.startedTick);
  if (elapsedTicks >= move.startupTicks) return null;

  const framesUntilActive = move.startupTicks - elapsedTicks;
  if (framesUntilActive > windowTicks) return null;
  return {
    framesUntilActive,
    tone: framesUntilActive <= THREAT_IMMINENT_TICKS ? 'danger' : 'warning',
  };
}
