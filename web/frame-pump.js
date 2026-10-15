// Arm the next display callback before asynchronous GPU work. Keep at most one
// pending timestamp and serialize work; a slow frame never grows a promise queue.
// Setup can finish during a callback whose display timestamp is already old.
// Cross a display boundary before arming a new measured loop; no ticks run here.
export function waitForDisplayBoundary(requestFrame = requestAnimationFrame) {
    return new Promise(resolve => requestFrame(() => requestFrame(() => resolve())));
}

export function createFramePump(onFrame, {
    requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame, onError = console.error,
} = {}) {
    let handle, pending, previousCallback, running = false, stopped = false, callbacks = 0, coalesced = 0;
    async function drain() {
        running = true;
        try {
            while (!stopped && pending !== undefined) {
                const { now, interval } = pending; pending = undefined;
                await onFrame(now, interval);
            }
        } catch (error) { stop(); onError(error); }
        finally { running = false; }
    }
    function arm() {
        handle = requestFrame(now => {
            if (stopped) return;
            arm();
            callbacks++;
            if (pending !== undefined) coalesced++;
            // This interval comes from every display callback, including those
            // observed while GPU work was pending. It is not accumulated debt.
            pending = { now, interval: previousCallback === undefined ? undefined : now - previousCallback };
            previousCallback = now;
            if (!running) void drain();
        });
    }
    function stop() {
        stopped = true; pending = undefined;
        if (handle !== undefined) cancelFrame(handle);
    }
    arm();
    return { stop, statistics: () => ({ callbacks, coalesced }) };
}
