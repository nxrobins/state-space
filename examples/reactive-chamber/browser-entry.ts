/// <reference types="@webgpu/types" />
import { openChamber, loadChamber, type ChamberClient } from './client.js';
import { CHAMBER, SUPPORT, ICE, type Cell, type ChamberSnapshot } from './scenario.js';
import { MAX_SAVE_BYTES } from './recording.js';
import {
  prepareScene,
  inspectScene,
  pickElementCell,
  orbitCamera,
  sceneData,
  type ChamberScene,
} from './presentation.js';
import { createChamberLifecycle } from './lifecycle.js';
import { openChamberView } from './view.js';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => element<HTMLButtonElement>(id),
  canvas = element<HTMLCanvasElement>('world');
let client: ChamberClient | null = null;
let scene: ChamberScene | null = null,
  displayed: ChamberScene | null = null,
  committed: ChamberSnapshot | null = null;
let selected: Cell = [...SUPPORT],
  showPreview = true,
  yaw = -0.65,
  pitch = 0.42;
let unsubscribe = () => {},
  sceneKey = '';
const lifecycle = createChamberLifecycle({
  openClient: openChamber,
  openHost: () =>
    openChamberView(canvas, {
      onPaint(value) {
        displayed = value;
        updateInspection();
      },
      onError(message) {
        notice(message);
        void lifecycle.stop().catch((error) => notice(errorText(error)));
      },
    }),
});
const errorText = (error: unknown) => (error instanceof Error ? error.message : 'Chamber failed.');
const notice = (text: string) => {
  element('notice').textContent = text;
};
function updateInspection() {
  if (!displayed || !client) return;
  const s = sceneData(displayed).snapshot,
    info = inspectScene(displayed, selected),
    material = client.registry.material(info.material);
  element('inspection').textContent =
    `${material.name} · (${selected.join(', ')}) · energy ${info.energyQ} Q · integrity ${info.integrity}/255`;
  element('view-label').textContent =
    displayed.kind === 'preview' ? 'PREVIEW · NOT COMMITTED' : 'COMMITTED WORLD';
  element('view-label').dataset.identity = info.identity;
  element('tick-label').textContent = `TICK ${displayed.tick}`;
  element('resource').textContent = `${Math.round((s.game.remainingQ / CHAMBER.budgetQ) * 100)}%`;
  element<HTMLProgressElement>('resource-bar').value = s.game.remainingQ / CHAMBER.budgetQ;
  element('events').textContent =
    `Fuel cells burned    ${s.game.burned}\nPhase changes        ${s.game.phaseChanges}\nFalling cell steps   ${s.game.fallen}\nLost footing         ${s.game.lostFooting}\nExternal energy      ${s.accounting.externalQ} Q`;
}
function requestDraw() {
  if (scene) lifecycle.current?.host.present(scene, orbitCamera(yaw, pitch));
}
function refresh() {
  if (!client) return;
  const switching = lifecycle.status !== 'running';
  const state = client.state,
    candidate = state.hasPreview ? client.previewSnapshot() : null;
  if (state.status === 'ready') committed = client.snapshot();
  const preview = showPreview && candidate,
    value = preview || committed;
  const key = JSON.stringify([
    preview ? candidate.branchId : null,
    committed?.revision,
    selected,
    Boolean(preview),
  ]);
  if (value && sceneKey !== key) {
    scene = prepareScene(client.registry, value, selected);
    sceneKey = key;
    requestDraw();
  }
  element('status').textContent = state.uncertain
    ? 'Commit outcome uncertain'
    : state.error
      ? 'Worker stopped'
      : switching
        ? 'Restoring saved chamber…'
        : state.busy
          ? 'Committing…'
          : state.status === 'working'
            ? `Previewing · ${state.progress?.completedTicks ?? 0}/2 ticks`
            : state.hasPreview
              ? 'Preview ready'
              : 'Chamber ready';
  const unavailable =
    switching || state.busy || ['closed', 'failed', 'closing', 'connecting'].includes(state.status);
  for (const id of ['heat', 'cool', 'wait'])
    button(id).disabled = unavailable || (committed?.domains.tick ?? 0) >= CHAMBER.maxTicks;
  button('commit').disabled = unavailable || !state.hasPreview || state.status !== 'ready';
  button('compare').disabled = unavailable || !state.hasPreview;
  button('discard').disabled = unavailable || (state.activeId === null && state.waitingId === null);
  button('save').disabled = switching;
  button('reset').disabled = switching || state.busy;
  button('stop').disabled = switching || state.busy;
  button('compare').textContent = showPreview ? 'Show committed' : 'Show preview';
  if (state.uncertain)
    notice(
      'The worker may have committed before its reply was lost. No retry was sent. Save preserves the last acknowledged state; start a new worker to recover it.',
    );
  else if (state.error) notice(state.error);
}
function bind(next: ChamberClient) {
  unsubscribe();
  client = next;
  committed = next.snapshot();
  sceneKey = '';
  showPreview = true;
  unsubscribe = next.onChange(refresh);
  refresh();
}
function syncLifecycle() {
  const current = lifecycle.current;
  if (current && current.client !== client) bind(current.client);
  if (!current) {
    unsubscribe();
    unsubscribe = () => {};
    client = null;
    scene = displayed = null;
    committed = null;
    sceneKey = '';
    for (const id of [
      'heat',
      'cool',
      'wait',
      'compare',
      'discard',
      'commit',
      'save',
      'reset',
      'stop',
    ])
      button(id).disabled = true;
    element('status').textContent =
      lifecycle.status === 'stopped'
        ? 'Stopped'
        : lifecycle.status === 'starting'
          ? 'Starting…'
          : 'Stopping…';
  }
  element('empty').hidden = current !== null;
  button('start').disabled = lifecycle.status !== 'stopped';
  refresh();
}
lifecycle.subscribe(syncLifecycle);
async function start() {
  notice('');
  await lifecycle.start();
}
const stop = () => lifecycle.stop();
async function preview(kind: 'heat' | 'cool' | 'wait') {
  if (!client) return;
  showPreview = true;
  notice('');
  const result = await client.preview(kind === 'wait' ? { kind } : { kind, cell: [...selected] });
  if (result.status === 'failed') throw Error(result.error ?? 'Preview failed.');
  return result;
}
async function importSave(text: string) {
  if (await lifecycle.replace(() => loadChamber(text)))
    notice('Saved chamber restored. Every recorded boundary matched exactly.');
}
const run = (operation: () => unknown | Promise<unknown>) => {
  void Promise.resolve()
    .then(operation)
    .catch((error) => notice(errorText(error)));
};
button('start').onclick = () => run(start);
button('stop').onclick = () => run(stop);
for (const kind of ['heat', 'cool', 'wait'] as const)
  button(kind).onclick = () => run(() => preview(kind));
button('commit').onclick = () =>
  run(async () => {
    await client?.commit();
    notice('Outcome committed.');
    refresh();
  });
button('discard').onclick = () =>
  run(async () => {
    await client?.cancel();
    notice('Preview discarded. No resource spent.');
    refresh();
  });
button('compare').onclick = () => {
  showPreview = !showPreview;
  refresh();
};
button('select-support').onclick = () => {
  selected = [...SUPPORT];
  refresh();
};
button('select-ice').onclick = () => {
  selected = [...ICE];
  refresh();
};
button('reset').onclick = () =>
  run(async () => {
    if (await lifecycle.replace(() => openChamber())) notice('New chamber.');
  });
button('save').onclick = () => {
  if (!client) return;
  const blob = new Blob([client.exportSave()], { type: 'application/json' }),
    url = URL.createObjectURL(blob),
    link = document.createElement('a');
  link.href = url;
  link.download = `reactive-chamber-tick-${client.snapshot().domains.tick}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
element<HTMLInputElement>('load').onchange = (event) =>
  run(async () => {
    const input = event.target as HTMLInputElement,
      file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (file.size > MAX_SAVE_BYTES) throw Error('Save exceeds the 1 MiB limit.');
    await importSave(await file.text());
  });
let drag: { x: number; y: number; distance: number } | null = null;
canvas.onpointerdown = (event) => {
  drag = { x: event.clientX, y: event.clientY, distance: 0 };
  canvas.setPointerCapture(event.pointerId);
};
canvas.onpointermove = (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x,
    dy = event.clientY - drag.y;
  drag.distance += Math.abs(dx) + Math.abs(dy);
  drag.x = event.clientX;
  drag.y = event.clientY;
  yaw -= dx * 0.008;
  pitch = Math.max(0.08, Math.min(1.25, pitch + dy * 0.008));
  requestDraw();
};
canvas.onpointerup = (event) => {
  if (drag && drag.distance < 4 && displayed) {
    const rect = canvas.getBoundingClientRect(),
      hit = pickElementCell(
        displayed,
        lifecycle.current?.host.displayed?.camera ?? orbitCamera(yaw, pitch),
        event.clientX - rect.left,
        event.clientY - rect.top,
        rect.width,
        rect.height,
        canvas.width,
        canvas.height,
      );
    if (hit) {
      selected = hit;
      refresh();
    }
  }
  drag = null;
};
canvas.onpointercancel = () => {
  drag = null;
};
window.addEventListener(
  'pagehide',
  () => {
    void stop();
  },
  { once: true },
);
export const chamberApp = {
  start,
  stop,
  preview,
  importSave,
  get client() {
    return client;
  },
  get renderer() {
    return lifecycle.current?.host.renderer ?? null;
  },
  get scene() {
    return displayed;
  },
  get camera() {
    return orbitCamera(yaw, pitch);
  },
  async painted() {
    await lifecycle.current?.host.painted();
  },
  orbit(value: number) {
    yaw = value;
    requestDraw();
  },
  get running() {
    return lifecycle.current !== null;
  },
};
Object.assign(window, { chamberApp });
Object.assign(window, {
  macQualification: {
    ready: true,
    run() {
      void import('./verification.js').then((m) => m.verifyChamber(chamberApp));
      return true;
    },
  },
});
