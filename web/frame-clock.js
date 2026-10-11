// Display time requests exact fixed ticks; it never changes their physical rules.
const TICK_MS = 1000 / 60, MAX_TICKS_PER_FRAME = 4;

export class FrameClock {
    #last; #accumulator = 0;
    advance(now, paused = false) {
        if (!Number.isFinite(now)) throw new Error('Invalid frame time');
        if (this.#last === undefined || paused) { this.#last = now; this.#accumulator = 0; return 0; }
        this.#accumulator += Math.max(0, now - this.#last);
        this.#last = now;
        const ticks = Math.min(MAX_TICKS_PER_FRAME, Math.floor((this.#accumulator + 1e-7) / TICK_MS));
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
