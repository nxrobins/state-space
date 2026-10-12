// Display time requests exact fixed ticks; it never changes their physical rules.
const TICK_MS = 1000 / 60, MAX_TICKS_PER_FRAME = 4, DISPLAY_JITTER_MS = 0.5;

export class FrameClock {
    #last; #accumulator = 0;
    advance(now, paused = false, displayInterval) {
        if (!Number.isFinite(now)) throw new Error('Invalid frame time');
        if (displayInterval !== undefined && (!Number.isFinite(displayInterval) || displayInterval <= 0)) throw new Error('Invalid display interval');
        if (this.#last === undefined || paused) { this.#last = now; this.#accumulator = 0; return 0; }
        const elapsed = Math.max(0, now - this.#last);
        // A missed callback is unserved wall time. Repaying it with extra physics
        // can make the next frame miss too. Preserve ordinary 30/60/144 Hz timing
        // while dropping elapsed callbacks that the pump could not serve.
        this.#accumulator += displayInterval === undefined ? elapsed : Math.min(elapsed, displayInterval);
        this.#last = now;
        // rAF timestamps can land a fraction of a millisecond before a nominal
        // deadline. Carry that small phase lead instead of alternating 0/2 ticks.
        const ticks = Math.min(MAX_TICKS_PER_FRAME, Math.max(0, Math.floor((this.#accumulator + DISPLAY_JITTER_MS) / TICK_MS)));
        this.#accumulator -= ticks * TICK_MS;
        // Drop wall-clock time that this device could not simulate (a hidden tab,
        // a stall or a slow device). No tick is skipped or changed: the field always
        // runs the next absolute tick, so the world only runs slower than real time
        // instead of fast-forwarding later to repay an unbounded backlog.
        this.#accumulator = Math.min(this.#accumulator, TICK_MS);
        return ticks;
    }
    reset() { this.#last = undefined; this.#accumulator = 0; }
}
