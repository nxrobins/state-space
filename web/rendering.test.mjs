import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FrameClock } from './frame-clock.js';
import { createFramePump, waitForDisplayBoundary } from './frame-pump.js';
import { pacingMetrics } from './frame-benchmark.js';
import { canvasCell } from './renderer.js';

test('setup hands off across a display boundary before measured work starts', async () => {
    const callbacks=[];let ready=false;
    const pending=waitForDisplayBoundary(cb=>callbacks.push(cb)).then(()=>{ready=true;});
    assert.equal(callbacks.length,1);
    callbacks.shift()(100);await Promise.resolve();assert.equal(ready,false);
    assert.equal(callbacks.length,1);
    callbacks.shift()(117);await pending;assert.equal(ready,true);
    assert.equal(callbacks.length,0);
});

test('display scheduling keeps 60 ticks per second without an unbounded backlog', async () => {
    for (const hz of [30, 60, 144]) {
        const clock = new FrameClock();
        let ticks = 0;
        for (let i = 0; i <= hz; i++) ticks += clock.advance(i * 1000 / hz);
        assert.equal(ticks, 60);
    }
    // Ordinary frame jitter loses no simulated time.
    const jitter = new FrameClock();
    let now = 0, jittered = jitter.advance(now);
    for (let i = 0; i < 60; i++) { now += i % 2 ? 1000 / 30 - 10 : 10; jittered += jitter.advance(now); }
    assert.equal(jittered, 60);
    // A stall (for example a hidden tab) runs at most one catch-up frame, then
    // returns to real time instead of fast-forwarding through the backlog.
    const clock = new FrameClock();
    clock.advance(0);
    assert.equal(clock.advance(60000), 4);
    let after = 0;
    for (let i = 1; i <= 60; i++) after += clock.advance(60000 + i * 1000 / 60);
    assert(after >= 60 && after <= 61, `expected real-time ticks after a stall, got ${after}`);
    // A device that needs 20 ms per tick runs slower than real time. When it becomes
    // fast again, the world continues at real time instead of repaying ~50 s of debt.
    const slow = new FrameClock();
    let t = 0, resumed = 0;
    slow.advance(t);
    for (let i = 0; i < 600; i++) t += Math.max(1000 / 60, slow.advance(t) * 20 + 3);
    for (let i = 0; i < 60; i++) { resumed += slow.advance(t); t += 1000 / 60; }
    assert(resumed <= 66, `slow device repaid a backlog: ${resumed} ticks in one second`);
    assert.equal(clock.advance(70000, true), 0);
    assert.equal(clock.advance(70000 + 1000 / 60), 1);
});

test('rounded display timestamps do not alternate zero and double physics ticks', async () => {
    const clock = new FrameClock(); clock.advance(0);
    for (let i = 1; i <= 600; i++) assert.equal(clock.advance(Math.round(i * 1000 / 60 * 10) / 10), 1);
});

test('missed callbacks do not start a continuing multi-tick catch-up loop', async () => {
    for (const hz of [30, 60, 144]) {
        const clock = new FrameClock(), interval = 1000 / hz;
        clock.advance(0);
        clock.advance(10000, false, interval);
        let ticks = 0;
        for (let i = 1; i <= hz; i++) ticks += clock.advance(10000 + i * interval, false, interval);
        assert.equal(ticks, 60);
    }
    const clock = new FrameClock(); clock.advance(0);
    assert.equal(clock.advance(1000, false, 1000 / 60), 1);
    for (let i = 1; i <= 600; i++) assert.equal(clock.advance(1000 + i * 1000 / 60, false, 1000 / 60), 1);
});

test('display callbacks stay armed across GPU waits with one bounded pending frame', async () => {
    const callbacks = new Map(); let sequence = 0, release;
    const seen = [], errors = [];
    const pump = createFramePump(async now => {
        seen.push(now);
        await new Promise(resolve => { release = resolve; });
    }, { requestFrame: cb => { callbacks.set(++sequence, cb); return sequence; },
        cancelFrame: id => callbacks.delete(id), onError: error => errors.push(error) });
    function fire(now) {
        const [id, cb] = callbacks.entries().next().value;
        callbacks.delete(id); cb(now);
        assert.equal(callbacks.size, 1, 'next callback must be armed before GPU completion');
    }
    fire(0); fire(17); fire(34);
    assert.deepEqual(seen, [0], 'GPU operations must never overlap');
    release(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, [0, 34], 'only the newest pending timestamp is retained');
    assert.deepEqual(pump.statistics(), { callbacks: 3, coalesced: 1 });
    pump.stop(); release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(callbacks.size, 0); assert.deepEqual(errors, []);
});

test('a failed GPU frame cancels future callbacks and reports the error once', async () => {
    const callbacks = new Map(), errors = []; let sequence = 0;
    createFramePump(async () => { throw new Error('GPU failure'); }, {
        requestFrame: cb => { callbacks.set(++sequence, cb); return sequence; },
        cancelFrame: id => callbacks.delete(id), onError: error => errors.push(error.message),
    });
    const [id, cb] = callbacks.entries().next().value; callbacks.delete(id); cb(0);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(callbacks.size, 0); assert.deepEqual(errors, ['GPU failure']);
});

test('60 Hz acceptance rejects deadline misses, lost callbacks, and slowed physics despite average cadence', async () => {
    const rows = Array.from({ length: 600 }, (_, i) => ({ callback: i * 1000 / 60, completed: i * 1000 / 60 + 10,
        ticks: 1, completionDelayMs: 10, intervalMs: i ? 1000 / 60 : null }));
    assert.equal(pacingMetrics(rows, 0).locked60, true);
    assert.equal(pacingMetrics(rows.slice(0, 120), 0).locked60, false, 'two-second evidence is insufficient');
    assert.equal(pacingMetrics(rows, 1).locked60, false);
    for (const change of [{ completionDelayMs: 17 }, { intervalMs: 1000 / 30 }, { ticks: 0 }]) {
        const faulty = rows.map(row => ({ ...row })); Object.assign(faulty[300], change);
        assert.equal(pacingMetrics(faulty, 0).locked60, false, JSON.stringify(change));
    }
});

test('picking matches square letterboxing, including high DPI CSS coordinates', async () => {
    const canvas = { getBoundingClientRect: () => ({ left: 10, top: 20, width: 800, height: 400 }) };
    assert.equal(canvasCell(canvas, 100, 200, 256, 256), null);
    assert.deepEqual(canvasCell(canvas, 210, 20, 256, 256), [0, 0]);
    assert.deepEqual(canvasCell(canvas, 609, 419, 256, 256), [255, 255]);
    assert.equal(canvasCell(canvas, 610, 420, 256, 256), null);
});

test('slow viewing schedules fewer exact ticks without skipping or accumulating time debt', async () => {
    for (const rate of [0.1, 0.25, 1]) {
        const clock = new FrameClock(); clock.advance(0);
        let ticks = 0;
        for (let i = 1; i <= 600; i++) ticks += clock.advance(i * 1000 / 60 * rate, false, 1000 / 60 * rate);
        assert.equal(ticks, 600 * rate);
        clock.reset(); assert.equal(clock.advance(10000), 0);
    }
});


test('latency events remain isolated and scripted routes never claim human input latency', async () => {
    const {InputLatency, FrameLatencyCollector, textIfChanged, classIfChanged} = await import('./frame-latency.js');
    let now = 10; const input = new InputLatency(() => now);
    input.capture({type:'keydown',timeStamp:8}); now=12;
    const a=input.sample(); a.event.handledAt=-1;
    assert.equal(input.sample().event.handledAt,10);
    assert.equal(input.sample(true).event,null);
    assert.equal(input.sample(true).source,'scripted');
    input.capture({type:'pointermove',timeStamp:1e15}); assert.equal(input.sample().event.eventAt,null);
    let writes=0,text='ready',toggles=0;
    const element={get textContent(){return text;},set textContent(v){text=v;writes++;},classList:{contains:()=>true,toggle:()=>toggles++}};
    textIfChanged(element,'ready');textIfChanged(element,'go');classIfChanged(element,'done',true);
    assert.equal(writes,1);assert.equal(toggles,0);
    let records=[],settled=0;
    const field={inspectLatency:after=>({enabled:true,gpuTimestamps:true,records:structuredClone(records.filter(r=>r.id>(after??0)))}),settleLatency:async()=>{settled++;records[0].gpu.status='complete';}};
    const collector=new FrameLatencyCollector();collector.reset(field);
    records=[{id:1,gpu:{status:'pending'}},{id:2,gpu:{status:'complete'}}];collector.capture(field);
    const receipt=await collector.finish(field);
    assert.equal(settled,1);assert.equal(receipt.records.length,2);assert.equal(receipt.records[0].gpu.status,'complete');
});
