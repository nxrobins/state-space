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
    dirty = false,
    closed = false,
    error: string | null = null;
  const schedule = () => {
    if (closed || error || !dirty || scheduled !== undefined || flight) return;
    scheduled = options.requestFrame(() => {
      scheduled = undefined;
      dirty = false;
      if (closed || error) return;
      flight = Promise.resolve()
        .then(async () => {
          await options.guard();
          if (!closed) await options.draw();
        })
        .catch((e) => {
          error = e instanceof Error ? e.message : 'Frame failed.';
          dirty = false;
          try {
            options.onError(error);
          } catch {
            /* Preserve original rendering error. */
          }
        })
        .finally(() => {
          flight = undefined;
          schedule();
        });
    });
  };
  return Object.freeze({
    invalidate() {
      if (!closed && !error) {
        dirty = true;
        schedule();
      }
    },
    state: () => ({ scheduled: scheduled !== undefined, inFlight: !!flight, dirty, closed, error }),
    async settled() {
      await flight;
    },
    async close() {
      closed = true;
      dirty = false;
      if (scheduled !== undefined) {
        options.cancelFrame(scheduled);
        scheduled = undefined;
      }
      await flight;
    },
  });
}
