/** Builder session: one module Worker, the committed world, at most one candidate. No DOM. */
import {
  createMultiphysicsDemonstration3D,
  createMultiphysicsTimedCup3D,
  readMultiphysicsSnapshot3D,
  multiphysicsInventory3D,
  batteryStoredUnits3D,
  startMultiphysicsWorker3D,
  type MultiphysicsProfiles3D,
  type MultiphysicsSnapshot3D,
  type MultiphysicsEdit3D,
  type MultiphysicsPreviewResult3D,
  type MultiphysicsWorkerClient3D,
  type MultiphysicsWorkerPreview3D,
} from 'state-space-engine/experimental/3d/multiphysics';
export const BUILDER_SCENES = Object.freeze({
  'wax-valve': 'Powered wax valve',
  'rotating-contact': 'Rotating conductor',
  'fluid-switch': 'Fluid moving a conductor',
  'falling-battery': 'Falling, breaking battery',
  'combined-failure': 'Combined failure',
  'timed-cup': 'Buoyant wax in a water cup',
} as const);
export type BuilderSceneId = keyof typeof BUILDER_SCENES;
export const readScene = (value: string | null): BuilderSceneId =>
  value !== null && Object.hasOwn(BUILDER_SCENES, value) ? (value as BuilderSceneId) : 'wax-valve';
export function sceneSnapshot(profiles: MultiphysicsProfiles3D, scene: BuilderSceneId) {
  return scene === 'timed-cup'
    ? createMultiphysicsTimedCup3D(profiles)
    : createMultiphysicsDemonstration3D(profiles, scene);
}
/** Largest accepted save, matching the model caps with generous headroom. */
export const MAX_SAVE_BYTES = 4 * 1024 * 1024;
export const PREVIEW_TICKS = 2;
/** The seven ledger rows shown in compare: stores, mechanical energy and the numerical residual. */
export function ledger(snapshot: MultiphysicsSnapshot3D) {
  const inventory = multiphysicsInventory3D(snapshot),
    sum = (key: 'thermalQ' | 'latentQ' | 'chemicalQ') =>
      snapshot.parcels.reduce((total, p) => total + BigInt(p[key]), 0n);
  return {
    'Thermal (Q)': String(sum('thermalQ')),
    'Latent (Q)': String(sum('latentQ')),
    'Chemical (Q)': String(sum('chemicalQ')),
    'Battery (sub-Q)': snapshot.battery ? String(batteryStoredUnits3D(snapshot.battery)) : '0',
    'Conversion remainders (sub-Q)': String(inventory.conversionRemainderSubQ),
    'Mechanical energy': inventory.mechanicalEnergy.toPrecision(9),
    'Numerical residual': snapshot.accounting.numericalEnergy.toPrecision(6),
  };
}
export type SessionState =
  | { status: 'ready' }
  | { status: 'previewing'; startedAt: number }
  | { status: 'cancelling' }
  | { status: 'preview-ready'; preview: MultiphysicsWorkerPreview3D }
  | { status: 'committing' }
  | { status: 'closed' };
export async function openSession(
  workerUrl: URL,
  profiles: MultiphysicsProfiles3D,
  initial: MultiphysicsSnapshot3D,
) {
  const client: MultiphysicsWorkerClient3D = await startMultiphysicsWorker3D(
    workerUrl,
    profiles,
    initial,
  );
  let committed = (await client.snapshot()).snapshot,
    state: SessionState = { status: 'ready' },
    lastResult: MultiphysicsPreviewResult3D | null = null,
    lastRejection: string | null = null;
  const previewMs: number[] = [],
    cancellationMs: number[] = [];
  const listeners = new Set<() => void>();
  const publish = () => {
    for (const listener of [...listeners]) listener();
  };
  const set = (next: SessionState) => {
    state = next;
    publish();
  };
  return {
    profiles,
    get state() {
      return state;
    },
    get committed() {
      return committed;
    },
    /** Result of the latest validated preview, kept after commit for its tick reports. */
    get lastResult() {
      return lastResult;
    },
    get lastRejection() {
      return lastRejection;
    },
    get latency() {
      return { previewMs: [...previewMs], cancellationMs: [...cancellationMs] };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    /** Starts a two-tick candidate. Rejections are reported, never thrown, and leave the world. */
    async preview(
      edits: readonly MultiphysicsEdit3D[] = [],
    ): Promise<'ready' | 'cancelled' | 'rejected'> {
      if (state.status !== 'ready') throw Error('Discard or commit the current preview first.');
      const startedAt = performance.now();
      lastRejection = null;
      set({ status: 'previewing', startedAt });
      try {
        const preview = await client.preview(edits, PREVIEW_TICKS);
        previewMs.push(performance.now() - startedAt);
        lastResult = preview.result;
        set({ status: 'preview-ready', preview });
        return 'ready';
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          // A concurrent cancel() owns the transition back to ready.
          if ((state as SessionState).status !== 'cancelling') set({ status: 'ready' });
          return 'cancelled';
        }
        lastRejection = error instanceof Error ? error.message : 'Preview rejected.';
        set({ status: 'ready' });
        return 'rejected';
      }
    },
    /** Cancels a running preview or discards a ready one; resolves on the Worker's acknowledgement. */
    async cancel(): Promise<number> {
      if (state.status !== 'previewing' && state.status !== 'preview-ready')
        throw Error('No preview to cancel.');
      const startedAt = performance.now();
      set({ status: 'cancelling' });
      await client.cancel();
      const elapsed = performance.now() - startedAt;
      cancellationMs.push(elapsed);
      set({ status: 'ready' });
      return elapsed;
    },
    async commit() {
      if (state.status !== 'preview-ready') throw Error('No ready preview to commit.');
      const { preview } = state;
      set({ status: 'committing' });
      try {
        const result = await client.commit(preview);
        committed = result.result.snapshot;
        lastResult = result.result;
        return result.result;
      } finally {
        set({ status: 'ready' });
      }
    },
    /** Replaces the live world from a save; the old world stays if the save is rejected. */
    async restore(raw: unknown) {
      if (state.status !== 'ready') throw Error('Restore requires an idle builder.');
      const snapshot = readMultiphysicsSnapshot3D(profiles, raw);
      committed = (await client.restore(snapshot)).snapshot;
      lastResult = null;
      publish();
      return committed;
    },
    save(): string {
      return JSON.stringify(committed);
    },
    close() {
      if (state.status === 'closed') return;
      client.close();
      set({ status: 'closed' });
    },
  };
}
export type BuilderSession = Awaited<ReturnType<typeof openSession>>;
