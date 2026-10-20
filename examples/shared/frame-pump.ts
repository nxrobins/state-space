/** One outstanding draw, latest invalidation only; callers supply scheduling and guards. */
export function createFramePump(options: {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  guard: () => Promise<void>;
  draw: () => Promise<unknown>;
  onError: (error: string) => void;
}) {
  let scheduled: number | undefined,
    flight: Promise<void> | undefined,
    closed = false,
    error: string | null = null;
  let pending: { promise: Promise<void>; resolve: () => void } | undefined;
  const cancelPending = () => {
    pending?.resolve();
    pending = undefined;
  };
  const schedule = () => {
    if (closed || error || !pending || scheduled !== undefined || flight) return;
    scheduled = options.requestFrame(() => {
      scheduled = undefined;
      const completion = pending!;
      pending = undefined;
      if (closed || error) return;
      flight = Promise.resolve()
        .then(async () => {
          await options.guard();
          if (!closed) await options.draw();
        })
        .catch((e) => {
          error = e instanceof Error && e.message ? e.message : 'Frame failed.';
          cancelPending();
          try {
            options.onError(error);
          } catch {
            /* Preserve original rendering error. */
          }
        })
        .finally(() => {
          flight = undefined;
          completion.resolve();
          schedule();
        });
    });
  };
  return Object.freeze({
    invalidate() {
      if (!closed && !error) {
        if (!pending) {
          let resolve!: () => void;
          const promise = new Promise<void>((done) => {
            resolve = done;
          });
          pending = { promise, resolve };
        }
        schedule();
      }
    },
    state: () => ({
      scheduled: scheduled !== undefined,
      inFlight: !!flight,
      dirty: !!pending,
      closed,
      error,
    }),
    /** Wait for the latest requested frame at this call, including a queued successor. */
    async settled() {
      await (pending?.promise ?? flight);
      if (error) throw Error(error);
      if (closed) throw Error('Frame pump closed.');
    },
    async close() {
      closed = true;
      cancelPending();
      if (scheduled !== undefined) {
        options.cancelFrame(scheduled);
        scheduled = undefined;
      }
      await flight;
    },
  });
}
