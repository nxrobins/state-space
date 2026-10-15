// Event timestamps and receipt collection are presentation-only. No timing value
// is passed to the deterministic command/controller or used to select ticks.
export class InputLatency {
    #latest = null; #sequence = 0; #clock;
    constructor(clock = () => performance.now()) { this.#clock = clock; }
    capture(event) {
        const handledAt = this.#clock();
        const eventAt = Number.isFinite(event.timeStamp) && event.timeStamp >= 0 && event.timeStamp <= handledAt
            ? event.timeStamp : null;
        this.#latest = { sequence: ++this.#sequence, type: event.type, eventAt, handledAt };
    }
    sample(scripted = false) {
        return { source: scripted ? 'scripted' : 'browser-event', sampledAt: this.#clock(),
            event: scripted || !this.#latest ? null : { ...this.#latest } };
    }
}

export function textIfChanged(element, value) {
    const text = String(value);
    if (element.textContent !== text) element.textContent = text;
}
export function classIfChanged(element, name, enabled) {
    if (element.classList.contains(name) !== enabled) element.classList.toggle(name, enabled);
}

export class FrameLatencyCollector {
    #after = 0; #records = new Map();
    reset(field) {
        this.#records.clear();
        this.#after = Math.max(0, ...field.inspectLatency().records.map(r => r.id));
    }
    capture(field) {
        const snapshot = field.inspectLatency(this.#after);
        let pending;
        for (const r of snapshot.records) {
            this.#records.set(r.id, r);
            if (r.gpu.status === 'pending') pending = Math.min(pending ?? r.id, r.id);
        }
        const last = snapshot.records.at(-1)?.id ?? this.#after;
        this.#after = pending === undefined ? last : pending - 1;
        // 600 measured frames plus bounded warmup; never an unbounded session log.
        if (this.#records.size > 2048) throw new Error('Latency receipt capacity exceeded.');
    }
    async finish(field) {
        await field.settleLatency(); this.capture(field);
        const info = field.inspectLatency(this.#after);
        return { version: 1, enabled: info.enabled, gpuTimingRequested: info.gpuTimingRequested, gpuTimestamps: info.gpuTimestamps,
            scope: 'CPU monotonic timestamps and optional GPU pass durations. Scripted input; no OS scanout or physical input-to-photon measurement. Physics includes planning and certification. GPU telemetry resolves asynchronously; settle runs after measured frames.',
            records: [...this.#records.values()] };
    }
}
