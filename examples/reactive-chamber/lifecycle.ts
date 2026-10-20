/** Owns application resources and replacement races, independently of DOM or GPU APIs. */
/** Resources cache their disposal promise; repeated close calls share completion or failure. */
export type Closable = { close(): Promise<void> };
export type LifecycleClient = Closable & { readonly state: { readonly busy: boolean } };
type Resources<C, H> = { client: C; host: H };
type State<C, H> =
  | { status: 'stopped' | 'starting' | 'stopping' }
  | ({ status: 'running' | 'replacing' } & Resources<C, H>);

export function createChamberLifecycle<C extends LifecycleClient, H extends Closable>(options: {
  openHost(): Promise<H>;
  openClient(): Promise<C>;
}) {
  let state: State<C, H> = { status: 'stopped' },
    generation = 0;
  let operation: Promise<unknown> | null = null,
    stopping: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const publish = () =>
    queueMicrotask(() => {
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) {
          try {
            listener();
          } catch {
            /* Observers do not own cleanup. */
          }
        }
      }
    });
  const releaseClient = async (client: C | null): Promise<void> => {
    try {
      await client?.close();
    } catch {
      /* A failed client must not prevent host cleanup. */
    }
  };
  return {
    get status() {
      return state.status;
    },
    get current(): Readonly<Resources<C, H>> | null {
      return 'client' in state ? { client: state.client, host: state.host } : null;
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start(): Promise<void> {
      if (state.status !== 'stopped') return Promise.resolve();
      const ownedGeneration = ++generation;
      state = { status: 'starting' };
      const starting = (async () => {
        let host: H | null = null,
          client: C | null = null;
        try {
          host = await options.openHost();
          if (ownedGeneration !== generation) return;
          client = await options.openClient();
          if (ownedGeneration !== generation) return;
          state = { status: 'running', host, client };
          host = null;
          client = null;
          publish();
        } finally {
          try {
            await releaseClient(client);
            await host?.close();
          } finally {
            if (ownedGeneration === generation && state.status === 'starting') {
              state = { status: 'stopped' };
              publish();
            }
          }
        }
      })();
      operation = starting;
      publish();
      return starting;
    },
    replace(create: () => Promise<C>): Promise<boolean> {
      if (state.status !== 'running' || state.client.state.busy)
        return Promise.reject(Error('Chamber is unavailable.'));
      const previous = state,
        ownedGeneration = ++generation;
      state = { ...previous, status: 'replacing' };
      const replacing = (async () => {
        let candidate: C | null = null;
        try {
          candidate = await create();
          if (ownedGeneration !== generation) return false;
          await releaseClient(previous.client);
          if (ownedGeneration !== generation) return false;
          state = { status: 'running', host: previous.host, client: candidate };
          candidate = null;
          publish();
          return true;
        } finally {
          await releaseClient(candidate);
          if (ownedGeneration === generation && state.status === 'replacing') {
            state = previous;
            publish();
          }
        }
      })();
      operation = replacing;
      publish();
      return replacing;
    },
    stop(): Promise<void> {
      if (stopping) return stopping;
      if (state.status === 'stopped') return Promise.resolve();
      const previous = state,
        pending = operation;
      generation++;
      state = { status: 'stopping' };
      stopping = (async () => {
        // Drain pending startup/replacement before allowing another host to use the canvas.
        try {
          await pending;
        } catch {
          /* The operation reports its own failure. */
        }
        if ('client' in previous) {
          try {
            await releaseClient(previous.client);
          } finally {
            await previous.host.close();
          }
        }
      })().finally(() => {
        state = { status: 'stopped' };
        operation = null;
        stopping = null;
        publish();
      });
      publish();
      return stopping;
    },
  };
}
