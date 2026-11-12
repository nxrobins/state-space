/** Builder page: controls, inspection and presentation. Physics lives only in the Worker. */
import {
  createMultiphysicsProfiles3D,
  parcelTemperature3D,
  type MultiphysicsEdit3D,
  type MultiphysicsProfiles3D,
  type MultiphysicsSnapshot3D,
  type ThermalParcel3D,
} from 'state-space-engine/experimental/3d/multiphysics';
import {
  BUILDER_SCENES,
  MAX_SAVE_BYTES,
  readScene,
  sceneSnapshot,
  ledger,
  openSession,
  type BuilderSceneId,
  type BuilderSession,
} from './session.js';
import { prepareScene, orbitCamera, type BuilderScene } from './presentation.js';
import { openBuilderView, type BuilderView } from './view.js';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const button = (id: string) => element<HTMLButtonElement>(id);
const canvas = element<HTMLCanvasElement>('world');
const workerUrl = new URL('./worker.js', import.meta.url);
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));
let profiles: MultiphysicsProfiles3D,
  view: BuilderView | null = null,
  session: BuilderSession | null = null,
  scene: BuilderSceneId = readScene(new URL(location.href).searchParams.get('scene')),
  selected: string | null = null,
  showPreview = true,
  current: BuilderScene | null = null,
  sceneKey = '',
  yaw = -0.7,
  pitch = 0.38,
  zoom = 1,
  switching = false,
  generation = 0;
const notice = (text: string, rejected = false) => {
  const target = element('notice');
  target.textContent = text;
  target.classList.toggle('rejected', rejected);
};
const previewSnapshot = (): MultiphysicsSnapshot3D | null =>
  session?.state.status === 'preview-ready' ? session.state.preview.result.snapshot : null;
function displayedSnapshot() {
  const candidate = previewSnapshot();
  return showPreview && candidate ? candidate : (session?.committed ?? null);
}
function draw() {
  if (current && view) view.present(current, orbitCamera(yaw, pitch, zoom, current.bounds));
}
function rebuildScene() {
  if (!session) return;
  const snapshot = displayedSnapshot()!,
    candidate = snapshot !== session.committed,
    report = candidate
      ? ((session.state.status === 'preview-ready'
          ? session.state.preview.result.ticks.at(-1)
          : null) ?? null)
      : (session.lastResult?.ticks.at(-1) ?? null);
  const overlays = {
    bonds: element<HTMLInputElement>('bonds').checked,
    circuit: element<HTMLInputElement>('circuit').checked,
  };
  const key = JSON.stringify([
    generation,
    candidate,
    snapshot.tick,
    session.committed.tick,
    selected,
    overlays,
    report ? 1 : 0,
  ]);
  if (current && key === sceneKey) return;
  sceneKey = key;
  current = prepareScene(
    profiles,
    snapshot,
    report,
    selected,
    overlays,
    candidate ? 'preview' : 'committed',
  );
  element('view-label').textContent = candidate ? 'PREVIEW · NOT COMMITTED' : 'COMMITTED WORLD';
  element('tick-label').textContent = `TICK ${snapshot.tick}`;
  draw();
}
function describe(parcel: ThermalParcel3D, snapshot: MultiphysicsSnapshot3D) {
  const profile = profiles.byName[parcel.material],
    fixed = (v: readonly number[]) => `[${v.map((x) => x.toFixed(3)).join(', ')}]`;
  return [
    `${parcel.id} · ${parcel.material} (${profile.phase})${snapshot.anchors.includes(parcel.id) ? ' · anchored' : ''}`,
    `owner      ${parcel.owner}`,
    `mass       ${parcel.mass.toPrecision(6)}`,
    `temp       ${parcelTemperature3D(profiles, parcel).toFixed(2)}`,
    `center     ${fixed(parcel.center)}`,
    `velocity   ${fixed(parcel.velocity)}`,
    `half       ${fixed(parcel.halfExtents)}`,
    `stores Q   thermal ${parcel.thermalQ} · latent ${parcel.latentQ} · chemical ${parcel.chemicalQ}`,
  ].join('\n');
}
function editTemplate(kind: string): MultiphysicsEdit3D[] {
  const snapshot = session!.committed,
    parcel = snapshot.parcels.find((p) => p.id === selected) ?? snapshot.parcels[0],
    other = snapshot.parcels.find((p) => p.id !== parcel.id)!,
    bond = snapshot.bonds.find((b) => b.a === parcel.id || b.b === parcel.id) ?? snapshot.bonds[0];
  switch (kind) {
    case 'place':
      return [
        {
          kind: 'place',
          parcel: {
            id: `placed-${snapshot.tick}`,
            material: 'water',
            owner: 'authored',
            center: [parcel.center[0], parcel.center[1] + 2, parcel.center[2]],
          },
        },
      ];
    case 'remove':
      return [{ kind: 'remove', ids: [parcel.id] }];
    case 'transform':
      return [
        {
          kind: 'transform',
          ids: [parcel.id],
          translation: [0, 0.25, 0],
          rotation: [0, 0, Math.sin(Math.PI / 16), Math.cos(Math.PI / 16)],
          pivot: [...parcel.center],
        },
      ];
    case 'anchor':
      return [{ kind: 'anchor', id: parcel.id, anchored: !snapshot.anchors.includes(parcel.id) }];
    case 'bond':
      return [{ kind: 'bond', a: parcel.id, b: other.id, strength: 1000 }];
    case 'cut':
      return bond ? [{ kind: 'cut', a: bond.a, b: bond.b }] : [];
    case 'battery':
      return [{ kind: 'battery', battery: snapshot.battery }];
    default:
      return [{ kind: 'heat', id: parcel.id, energyQ: 2048 }];
  }
}
function fillEdit() {
  if (!session) return;
  element<HTMLTextAreaElement>('edit').value = JSON.stringify(
    editTemplate(element<HTMLSelectElement>('edit-kind').value),
    null,
    1,
  );
}
function renderLedger() {
  if (!session) return;
  const before = ledger(session.committed),
    candidate = previewSnapshot(),
    after = candidate ? ledger(candidate) : null;
  const rows = Object.entries(before).map(([name, value]) => {
    const next = after ? after[name as keyof typeof after] : '—';
    return `<tr><td>${name}</td><td>${value}</td><td class="${after && next !== value ? 'changed' : ''}">${next}</td></tr>`;
  });
  element('ledger').innerHTML =
    `<tr><th></th><th>Committed</th><th>Preview</th></tr>${rows.join('')}`;
  const receipt =
    session.state.status === 'preview-ready' ? session.state.preview.result.edits : null;
  element('receipt').textContent = receipt
    ? `Edit receipt\n  stored    ${receipt.storedSubQ} sub-Q\n  mechanical ${receipt.mechanicalEnergy.toPrecision(6)}\n  mass      ${receipt.mass.toPrecision(6)}\n  momentum  [${receipt.linearMomentum.map((v) => v.toPrecision(4)).join(', ')}]\n  angular   [${receipt.angularMomentum.map((v) => v.toPrecision(4)).join(', ')}]`
    : '';
}
function refresh() {
  if (!session) return;
  const state = session.state.status,
    idle = state === 'ready' && !switching;
  const snapshot = displayedSnapshot()!;
  const select = element<HTMLSelectElement>('parcel'),
    ids = snapshot.parcels.map((p) => p.id);
  if (select.dataset.ids !== ids.join('|')) {
    select.innerHTML = ids.map((id) => `<option>${id}</option>`).join('');
    select.dataset.ids = ids.join('|');
  }
  if (!selected || !ids.includes(selected)) selected = ids[0] ?? null;
  select.value = selected ?? '';
  const parcel = snapshot.parcels.find((p) => p.id === selected);
  element('inspection').textContent = parcel ? describe(parcel, snapshot) : '';
  element('status').textContent = switching
    ? 'Loading…'
    : state === 'previewing'
      ? 'Previewing 2 ticks…'
      : state === 'cancelling'
        ? 'Cancelling…'
        : state === 'committing'
          ? 'Committing…'
          : state === 'preview-ready'
            ? 'Preview ready · compare, commit or cancel'
            : `Ready · tick ${session.committed.tick}`;
  button('preview').disabled = !idle;
  button('preview-edit').disabled = !idle;
  button('commit').disabled = state !== 'preview-ready';
  button('cancel').disabled = state !== 'previewing' && state !== 'preview-ready';
  button('compare').disabled = state !== 'preview-ready';
  button('compare').textContent = showPreview ? 'Show committed' : 'Show preview';
  button('save').disabled = !idle;
  element<HTMLInputElement>('load').disabled = !idle;
  element<HTMLSelectElement>('scene').disabled = !idle;
  renderLedger();
  rebuildScene();
}
async function loadScene(next: BuilderSceneId, snapshot?: MultiphysicsSnapshot3D) {
  switching = true;
  refresh();
  try {
    const opened = await openSession(
      workerUrl,
      profiles,
      snapshot ?? sceneSnapshot(profiles, next),
    );
    session?.close();
    session = opened;
    generation++;
    scene = next;
    selected = null;
    showPreview = true;
    sceneKey = '';
    session.subscribe(refresh);
    element<HTMLSelectElement>('scene').value = scene;
    notice('');
  } finally {
    switching = false;
    refresh();
    fillEdit();
  }
}
async function runPreview(edits: MultiphysicsEdit3D[]) {
  if (!session) return;
  showPreview = true;
  const outcome = await session.preview(edits);
  if (outcome === 'rejected')
    notice(`Rejected: ${session.lastRejection}. The committed world is unchanged.`, true);
  else if (outcome === 'ready') notice('');
}
function readEdits(): MultiphysicsEdit3D[] | null {
  try {
    const value = JSON.parse(element<HTMLTextAreaElement>('edit').value);
    return Array.isArray(value) ? value : [value];
  } catch (error) {
    notice(`Edit is not valid JSON: ${errorText(error)}`, true);
    return null;
  }
}
const guard = (action: () => Promise<unknown>) => () =>
  void action().catch((error) => notice(errorText(error), true));
function bindControls() {
  element<HTMLSelectElement>('scene').innerHTML = Object.entries(BUILDER_SCENES)
    .map(([id, name]) => `<option value="${id}">${name}</option>`)
    .join('');
  element<HTMLSelectElement>('scene').addEventListener(
    'change',
    guard(() => loadScene(readScene(element<HTMLSelectElement>('scene').value))),
  );
  element<HTMLSelectElement>('parcel').addEventListener('change', () => {
    selected = element<HTMLSelectElement>('parcel').value;
    refresh();
    fillEdit();
  });
  element('edit-kind').addEventListener('change', fillEdit);
  for (const id of ['bonds', 'circuit']) element(id).addEventListener('change', refresh);
  button('preview').addEventListener(
    'click',
    guard(() => runPreview([])),
  );
  button('preview-edit').addEventListener(
    'click',
    guard(async () => {
      const edits = readEdits();
      if (edits) await runPreview(edits);
    }),
  );
  button('commit').addEventListener(
    'click',
    guard(() => session!.commit()),
  );
  button('cancel').addEventListener(
    'click',
    guard(() => session!.cancel()),
  );
  button('compare').addEventListener('click', () => {
    showPreview = !showPreview;
    refresh();
  });
  button('save').addEventListener('click', () => {
    const blob = new Blob([session!.save()], { type: 'application/json' }),
      link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `multiphysics-${scene}-tick-${session!.committed.tick}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
  element<HTMLInputElement>('load').addEventListener(
    'change',
    guard(async () => {
      const file = element<HTMLInputElement>('load').files?.[0];
      element<HTMLInputElement>('load').value = '';
      if (!file) return;
      if (file.size > MAX_SAVE_BYTES) throw Error('Save file is too large.');
      await builderApp.load(await file.text());
    }),
  );
  let drag: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    yaw -= (event.clientX - drag.x) * 0.008;
    pitch += (event.clientY - drag.y) * 0.008;
    drag = { x: event.clientX, y: event.clientY };
    draw();
  });
  canvas.addEventListener('pointerup', () => (drag = null));
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      zoom = Math.max(0.25, Math.min(4, zoom * Math.exp(-event.deltaY * 0.001)));
      draw();
    },
    { passive: false },
  );
}
export const builderApp = {
  get session() {
    return session;
  },
  get view() {
    return view;
  },
  get scene() {
    return scene;
  },
  get profiles() {
    return profiles;
  },
  /** Presentation only: the camera never advances or reads simulation state. */
  orbit(nextYaw: number) {
    yaw = nextYaw;
    draw();
  },
  loadScene,
  runPreview,
  readEdits,
  setEdit(edits: MultiphysicsEdit3D[]) {
    element<HTMLTextAreaElement>('edit').value = JSON.stringify(edits);
  },
  /** Restores a save in a fresh Worker; the current world stays if the save is rejected. */
  async load(text: string) {
    if (text.length > MAX_SAVE_BYTES) throw Error('Save file is too large.');
    const parsed = JSON.parse(text);
    if (!session || session.state.status !== 'ready') throw Error('Load requires an idle builder.');
    await loadScene(scene, parsed);
  },
  painted: () => view?.painted() ?? Promise.resolve(),
};
async function start() {
  try {
    bindControls();
    profiles = await createMultiphysicsProfiles3D();
    view = await openBuilderView(canvas, {
      onPaint() {},
      onError: (message) => notice(message, true),
    });
    await loadScene(scene);
  } catch (error) {
    notice(errorText(error), true);
    element('status').textContent = 'Unavailable';
  }
}
const ready = start();
Object.assign(window, {
  builderApp,
  macQualification: {
    ready: true,
    run(stage: string) {
      void ready.then(() =>
        import('./verification.js').then((m) => m.verifyBuilder(builderApp, stage)),
      );
      return true;
    },
  },
});
