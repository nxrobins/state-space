// Display time requests exact fixed ticks; it never changes their physical rules.
export class FrameClock {
    #last; #accumulator = 0;
    advance(now, paused = false) {
        if (!Number.isFinite(now)) throw new Error('Invalid frame time');
        if (this.#last === undefined || paused) { this.#last = now; this.#accumulator = 0; return 0; }
        this.#accumulator += Math.max(0, now - this.#last);
        this.#last = now;
        const ticks = Math.min(4, Math.floor((this.#accumulator + 1e-7) / (1000 / 60)));
        this.#accumulator -= ticks * (1000 / 60);
        // Retain backlog: a slow device cannot skip physics ticks.
        return ticks;
    }
    reset() { this.#last = undefined; this.#accumulator = 0; }
}
