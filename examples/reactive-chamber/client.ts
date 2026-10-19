/** Browser controller. Latest intent only; all published state follows a worker acknowledgement. */
import {createReactiveMaterialRegistry3D, createReactiveWorkerClient3D, reactiveBrowserWorkerTransport3D,
  type ReactiveWorkerTransport3D, type ReactiveWorkerTicket3D, type ReactiveSessionPreview3D} from 'state-space-engine/experimental/3d/reactive-materials';
import {CHAMBER, CHAMBER_WORLD, CHAMBER_RULES, compileCommand, readCommand, type ChamberGame, type ChamberCommand} from './scenario.js';
import {SAVE_FORMAT, canonical, parseSave, stateHash, verifyRecording, type ChamberStep} from './recording.js';
export type ClientOptions = {workerUrl?: URL; timeoutMs?: number; wrapTransport?: (transport: ReactiveWorkerTransport3D) => ReactiveWorkerTransport3D};
export async function openChamber(options: ClientOptions = {}) {
  const registry = await createReactiveMaterialRegistry3D(), worker = new Worker(options.workerUrl ?? new URL('./worker.js', import.meta.url), {type: 'module'});
  let cleanup = () => worker.terminate();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {cleanup(); reject(Error('Chamber worker startup timed out.'));}, 10000);
      const fail = () => {cleanup(); reject(Error('Chamber worker startup failed.'));};
      const message = (event: MessageEvent) => {
        cleanup(); if (event.data?.kind === 'chamber-ready' && event.data.catalogHash === registry.hash) resolve();
        else reject(Error(event.data?.error ?? 'Chamber worker catalog differs.'));
      };
      function cleanup() {clearTimeout(timer); worker.removeEventListener('message', message); worker.removeEventListener('error', fail); worker.removeEventListener('messageerror', fail);}
      worker.addEventListener('message', message); worker.addEventListener('error', fail); worker.addEventListener('messageerror', fail);
    });
    // MessageChannel yields a browser task without the nested setTimeout minimum delay.
    const tasks = new MessageChannel(), pending = new Map<number, () => void>(); let taskSerial = 0;
    cleanup = () => {tasks.port1.close(); tasks.port2.close(); pending.clear(); worker.terminate();};
    tasks.port1.onmessage = (e: MessageEvent<number>) => {const task = pending.get(e.data); pending.delete(e.data); task?.();};
    const listeners = new Set<() => void>(), notify = () => {for (const fn of listeners) fn();};
    const base = options.wrapTransport?.(reactiveBrowserWorkerTransport3D(worker)) ?? reactiveBrowserWorkerTransport3D(worker);
    const transport: ReactiveWorkerTransport3D = {send: value => base.send(value), close() {tasks.port1.close(); tasks.port2.close(); pending.clear(); try {base.close();} finally {worker.terminate();}},
      subscribe(receive, failed) {return base.subscribe(value => {receive(value); queueMicrotask(notify);}, error => {failed(error); queueMicrotask(notify);});}};
    const client = createReactiveWorkerClient3D<ChamberGame>(transport, registry, {channel: 'chamber', worldId: CHAMBER_WORLD, gameRulesVersion: CHAMBER_RULES,
      timeoutMs: options.timeoutMs ?? 10000, schedule(task) {const id = ++taskSerial; pending.set(id, task); tasks.port2.postMessage(id); return () => {pending.delete(id);};}});
    try {await client.ready;} catch (error) {transport.close(); throw error;}
    const initial = client.snapshot(), steps: ChamberStep[] = [];
    let ticket: ReactiveWorkerTicket3D<ChamberGame> | null = null, command: ChamberCommand | null = null;
    let candidate: ReactiveSessionPreview3D<ChamberGame> | null = null, busy = false, closed = false, closing: Promise<void> | null = null;
    const metrics = {previewsMs: [] as number[], cancellationsMs: [] as number[]};
    const idle = () => new Promise<void>((resolve, reject) => {
      const check = () => {
        const state = client.state;
        if (state.status === 'failed' || state.status === 'closed') {listeners.delete(check); reject(Error(state.error ?? 'Worker closed.'));}
        else if (state.status === 'ready') {listeners.delete(check); resolve();}
      }; listeners.add(check); check();
    });
    const result = {
      registry, get initial() {return structuredClone(initial);}, get metrics() {return structuredClone(metrics);},
      get state() {return {...client.state, busy, hasPreview: candidate !== null};},
      snapshot: () => client.snapshot(),
      previewSnapshot: () => candidate ? structuredClone(candidate) : null,
      onChange(fn: () => void) {listeners.add(fn); return () => {listeners.delete(fn);};},
      async preview(raw: unknown) {
        if (busy || closed || steps.length >= CHAMBER.maxCommands) throw Error('Chamber is busy, closed, or at its command limit.');
        const owned = readCommand(raw), start = performance.now(), commands = compileCommand(registry, client.snapshot(), owned);
        const next = client.request(commands, {horizonTicks: CHAMBER.horizon, motion: {maxEntries: 65536}, maxSlices: CHAMBER.maxSlices});
        ticket = next; command = owned; candidate = null; notify();
        const outcome = await next.result;
        if (ticket === next) {
          if (outcome.status === 'ready') {candidate = outcome.preview; metrics.previewsMs.push(performance.now() - start); if (metrics.previewsMs.length > 128) metrics.previewsMs.shift();}
          else {ticket = null; command = null;}
          notify();
        }
        return outcome;
      },
      async cancel() {
        if (busy) throw Error('A commit is already in flight.');
        const start = performance.now(); ticket?.cancel(); ticket = null; command = null; candidate = null; notify();
        await idle(); metrics.cancellationsMs.push(performance.now() - start); if (metrics.cancellationsMs.length > 128) metrics.cancellationsMs.shift(); notify();
      },
      async commit() {
        if (busy || !ticket || !candidate || !command) throw Error('Preview a command before committing.');
        busy = true; const selected = ticket, owned = command, expected = {...candidate.state, revision: candidate.base.revision + 1}; notify();
        try {
          // Hash before mutating: an acknowledged commit can always be recorded synchronously.
          const sha256 = await stateHash(expected), out = await client.commit(selected);
          steps.push({command: owned, sha256}); ticket = null; command = null; candidate = null; return out.snapshot;
        } finally {busy = false; notify();}
      },
      exportSave() {return JSON.stringify({format: SAVE_FORMAT, catalog: registry.toCatalog(), initial, snapshot: client.snapshot(), steps});},
      close() {if (closing) return closing; closed = true; ticket = null; candidate = null;
        closing = client.close().finally(() => {listeners.clear(); transport.close();}); return closing;},
    };
    return result;
  } catch (error) {cleanup(); throw error;}
}
export type ChamberClient = Awaited<ReturnType<typeof openChamber>>;
/** Replays into a fresh private Worker; caller swaps it in only after exact verification. */
export async function loadChamber(text: string, options: ClientOptions = {}): Promise<ChamberClient> {
  const client = await openChamber(options), timer = setTimeout(() => {void client.close().catch(() => {});}, 60000);
  try {
    const save = parseSave(client.registry, text, client.initial);
    await verifyRecording(save, async command => {
      const outcome = await client.preview(command); if (outcome.status !== 'ready') throw Error(outcome.error ?? 'Replay failed.');
      return client.commit();
    });
    if (canonical(client.snapshot()) !== canonical(save.snapshot)) throw Error('Worker restore differs from saved state.');
    return client;
  } catch (error) {await client.close().catch(() => {}); throw error;} finally {clearTimeout(timer);}
}
