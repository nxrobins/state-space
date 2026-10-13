import { createGpuField } from '../../dist/sdk/state-space.js';
import { createMaterialRenderer, canvasCell } from '../../web/renderer.js?spillway=1';
import { FrameClock } from '../../web/frame-clock.js';
import { createFramePump } from '../../web/frame-pump.js';
import { distribution, pacingMetrics } from '../../web/frame-benchmark.js';
import { ReferenceGame, MAX_TICKS, Q } from './game.js';
import { digest, recording, readRecording } from './replay.js';
import { gameSprites } from './view.js';

const $ = id => document.getElementById(id);
const labels = { 'terrain-cut': 'Terrain cut', 'heat-applied': 'Heat applied', 'bridge-collapsed': 'Bridge collapsed',
    'water-entered': 'Entered water', 'water-left': 'Left water', 'relay-recovered': 'Relay recovered',
    jumped: 'Jumped', swam: 'Swimming', landed: 'Landed', blocked: 'Terrain blocked movement', burned: 'Heat damage', crushed: 'Crushed by terrain', lost: 'Suit depleted' };

async function init() {
    const field = await createGpuField(256, 256), canvas = $('canvas');
    let game, renderer;
    try { game = new ReferenceGame(field); renderer = await createMaterialRenderer(canvas, 256, 256, field.registry); }
    catch (error) { field.close(); throw error; }
    const clock = new FrameClock(), keys = new Set();
    let paused = true, aim = null, replay = null, benchmark = null, busy = false, pump;
    let queue = Promise.resolve(), dirty = true, lastEvents = -1, lastHud = -1, workMs = 0;
    let replayText = 'Your run starts when you press Play.', receiptUrl;
    function enqueue(operation) {
        const result = queue.then(operation);
        queue = result.catch(fail);
        return result;
    }
    function fail(error) {
        paused = true; clock.reset(); $('status').textContent = error.message; $('replay-status').textContent = error.message;
        if (benchmark) { const { reject } = benchmark; benchmark = null; reject(error); }
        console.error(error);
    }
    function resize() {
        if (benchmark) return;
        const scale = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale)); canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale)); dirty = true;
    }
    resize(); window.addEventListener('resize', resize);
    function clearInput() { keys.clear(); aim = null; }
    window.addEventListener('blur', clearInput);
    document.addEventListener('visibilitychange', () => { clearInput(); clock.reset(); });
    function setPaused(value) { paused = value; clock.reset(); dirty = true; }
    function updateHud(force = false) {
        if (force || game.field.tick - lastHud >= 6 || paused) {
            lastHud = game.field.tick;
            $('health').textContent = `SUIT ${game.player.health}${game.player.wet ? ' · IN WATER' : ''}`;
            $('tick').textContent = 'TICK ' + String(field.tick).padStart(4, '0');
            $('frame').textContent = workMs ? `${workMs.toFixed(1)} MS · ALL EFFECTS` : 'ALL EFFECTS ON';
            $('mode').textContent = benchmark ? `BENCHMARK / ${benchmark.kind.toUpperCase()}` : replay ? 'REPLAY' : paused ? 'PAUSED' : 'LIVE / RECORDING';
            $('play').textContent = paused ? (field.tick ? 'Continue run' : 'Play Spillway') : 'Pause';
            $('replay-status').textContent = replayText;
            $('outcome').hidden = game.status === 'playing';
            $('outcome').textContent = game.status === 'won' ? 'Relay recovered. Your route worked.' : 'Run ended. Restart to try another route.';
        }
        if (lastEvents !== game.events.length) {
            lastEvents = game.events.length;
            $('events').replaceChildren(...game.events.slice(-6).reverse().map(event => {
                const li = document.createElement('li'), tick = document.createElement('span');
                tick.textContent = String(event.tick).padStart(4, '0'); li.append(tick, labels[event.type] ?? event.type); return li;
            }));
        }
    }
    function render() { renderer.render(field, true, { sprites: gameSprites(game, aim) }); dirty = false; }
    function input() {
        return { move: Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')),
            jump: keys.has('Space') || keys.has('ArrowUp'), tool: keys.has('KeyE') ? 'cut' : keys.has('KeyF') ? 'heat' : 'none', target: aim };
    }
    function pilot(kind) {
        const x = game.player.x / Q;
        if (kind === 'collapse' && x >= 115 && x < 124 && field.tick < 180) return { move: 0, tool: 'heat', target: [128, 180] };
        if (x > 172 && game.player.y / Q > 172) return { move: 1, tool: 'cut', target: [Math.floor(x + 3), Math.floor(game.player.y / Q) - 3],
            jump: game.player.wet || (game.player.grounded && !game.player.jumpHeld) };
        return { move: 1, tool: 'cut', jump: game.player.wet || (game.player.blocked && !game.player.jumpHeld) };
    }
    async function nextTick() {
        if (field.tick >= MAX_TICKS) { setPaused(true); replayText = 'Two-minute recording limit reached. Export or restart this run.'; return; }
        const command = benchmark ? pilot(benchmark.kind) : replay ? replay.commands[field.tick] : input();
        if (command) await game.step(command);
        if (replay && field.tick === replay.endTick) {
            const actual = await digest(game.snapshot()), exact = actual === replay.expected;
            replayText = exact ? `Exact replay verified · ${field.tick} ticks · world, character and events match.` : 'Replay mismatch: this run did not reproduce the recorded state.';
            window.spillway.lastReplay = { exact, expected: replay.expected, actual, ticks: field.tick };
            replay = null; setPaused(true);
        }
    }
    async function frame(now, interval) {
        await enqueue(async () => {
            const started = performance.now();
            if (benchmark && benchmark.frames === 0) clock.advance(now - 1000 / 60);
            const ticks = clock.advance(now, paused, interval);
            for (let i = 0; i < ticks && !paused; i++) await nextTick();
            const gameDone = performance.now();
            if (ticks || dirty) { updateHud(); render(); await renderer.completed(); }
            const finished = performance.now(); workMs = finished - started;
            if (benchmark && ticks) {
                const b = benchmark;
                if (b.frames < 60) b.warmupRows.push({ tick: field.tick, ticks, workMs, gameAndPhysicsMs: gameDone - started,
                    renderingMs: finished - gameDone, completionDelayMs: finished - now });
                if (b.frames >= 60) {
                    b.startStatistics ??= pump.statistics();
                    b.rows.push({ tick: field.tick, callback: now, started, completed: finished, ticks, workMs,
                        physicsMs: gameDone - started, renderingMs: finished - gameDone, completionDelayMs: finished - now,
                        intervalMs: b.previous === undefined ? null : now - b.previous }); b.previous = now;
                }
                if (++b.frames === 660) {
                    setPaused(true); benchmark = null;
                    b.resolve({ rows: b.rows, warmupRows: b.warmupRows, coalesced: pump.statistics().coalesced - b.startStatistics.coalesced });
                }
            }
        });
    }
    function controls(disabled) {
        for (const id of ['play', 'restart', 'step', 'replay', 'export', 'import', 'benchmark']) $(id).disabled = disabled;
    }
    async function restart() {
        setPaused(true); clearInput(); replay = null;
        await enqueue(async () => { game.reset(); replayText = 'New run. All world and character state restored.'; lastEvents = -1; updateHud(true); render(); await renderer.completed(); });
    }
    async function playRecording(value) {
        if (busy) throw new Error('Wait for the benchmark to finish');
        setPaused(true); clearInput();
        await enqueue(async () => {
            const valid = await readRecording(value, game.initial);
            game.reset(); replay = valid; replayText = `Replaying ${valid.endTick} recorded ticks…`; lastEvents = -1;
            if (!valid.endTick) {
                const actual = await digest(game.snapshot()); window.spillway.lastReplay = { exact: actual === valid.expected, actual, expected: valid.expected, ticks: 0 };
                replayText = actual === valid.expected ? 'Exact empty replay verified.' : 'Replay mismatch.'; replay = null;
            } else setPaused(false);
            updateHud(true); render(); await renderer.completed();
        });
    }
    async function exportRun() {
        setPaused(true);
        return enqueue(() => recording(game));
    }
    function download(value, name) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
        const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function cpuReplay(record) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(new URL('./replay-worker.js', import.meta.url), { type: 'module' });
            worker.onmessage = ({ data }) => { worker.terminate(); data.error ? reject(new Error(data.error)) : resolve(data.result); };
            worker.onerror = error => { worker.terminate(); reject(new Error(error.message)); };
            worker.postMessage(record);
        });
    }
    async function runBenchmark() {
        if (busy) throw new Error('Benchmark already running');
        busy = true; controls(true); setPaused(true); clearInput(); replay = null;
        const results = [], startedAt = new Date().toISOString();
        try {
            for (const kind of ['crossing', 'collapse']) {
                await enqueue(async () => { game.reset(); canvas.width = 1920; canvas.height = 1080; lastEvents = -1; updateHud(true); render(); await renderer.completed(); });
                $('status').textContent = `${kind}: 60 warmup + 600 measured display-paced frames, all effects on.`;
                const { rows, warmupRows, coalesced } = await new Promise((resolve, reject) => {
                    benchmark = { kind, frames: 0, rows: [], warmupRows: [], resolve, reject }; setPaused(false);
                });
                const record = await enqueue(() => recording(game));
                $('status').textContent = `${kind}: comparing the recorded run with the independent CPU physics backend…`;
                const cpu = await cpuReplay(record);
                const result = { kind, grid: [256, 256], output: [1920, 1080], allEffects: true, warmupFrames: 60,
                    ...pacingMetrics(rows, coalesced), frameMs: distribution(rows.map(r => r.workMs)),
                    gameAndPhysicsMs: distribution(rows.map(r => r.physicsMs)), renderingMs: distribution(rows.map(r => r.renderingMs)),
                    completionDelayMs: distribution(rows.map(r => r.completionDelayMs)), rows, cpuReplay: cpu,
                    warmupRows, startupFrameMs: distribution(warmupRows.map(r => r.workMs)),
                    gpuDriftQ: String(field.energyBalance().driftQ), endTick: field.tick, replay: record };
                results.push(result);
            }
            const receipt = { version: 1, startedAt, finishedAt: new Date().toISOString(), backend: field.backendInfo,
                renderer: renderer.backendInfo, userAgent: navigator.userAgent, rows: results,
                locked60: results.every(r => r.locked60), exactReplay: results.every(r => r.cpuReplay.exact && r.cpuReplay.driftQ === '0' && r.gpuDriftQ === '0'),
                scope: 'Live game loop: input, edits, shared physics, swept character collision, gameplay events, recording, HUD updates, all material effects and actor sprites through GPU completion. 600 frames per route after 60 warmup callbacks. Startup, replay hashing, CPU reference and OS scanout excluded.' };
            window.spillway.benchmarkResult = receipt;
            if (receiptUrl) URL.revokeObjectURL(receiptUrl);
            receiptUrl = URL.createObjectURL(new Blob([JSON.stringify(receipt)], { type: 'application/json' }));
            $('receipt').href = receiptUrl; $('receipt').download = 'spillway-benchmark.json'; $('receipt').hidden = false;
            $('status').textContent = `Benchmark: ${receipt.locked60 ? '60 Hz gate passed' : '60 Hz gate missed'} · CPU replay ${receipt.exactReplay ? 'exact' : 'mismatch'}. Download raw evidence below.`;
            return receipt;
        } finally { benchmark = null; busy = false; controls(false); setPaused(true); resize(); updateHud(true); }
    }
    $('play').onclick = () => { setPaused(!paused); clearInput(); canvas.focus(); };
    $('restart').onclick = () => void restart();
    $('step').onclick = () => { setPaused(true); void enqueue(async () => { await nextTick(); updateHud(true); render(); await renderer.completed(); }); };
    $('replay').onclick = () => { void exportRun().then(playRecording).catch(fail); };
    $('export').onclick = () => { void exportRun().then(value => download(value, 'spillway-replay.json')).catch(fail); };
    $('import').onchange = async event => {
        const file = event.target.files[0]; if (!file) return;
        try { if (file.size > 8 * 1024 * 1024) throw new Error('Replay exceeds 8 MiB'); await playRecording(JSON.parse(await file.text())); }
        catch (error) { $('replay-status').textContent = 'Import rejected: ' + error.message; }
        finally { event.target.value = ''; }
    };
    $('benchmark').onclick = () => { void runBenchmark().catch(fail); };
    document.addEventListener('keydown', event => {
        if (busy || event.target.closest('button,input,a')) return;
        if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'KeyA', 'KeyD', 'KeyE', 'KeyF', 'KeyP', 'Period'].includes(event.code)) event.preventDefault();
        if (event.code === 'KeyP' && !event.repeat) setPaused(!paused);
        else if (event.code === 'Period' && !event.repeat) $('step').click();
        else keys.add(event.code);
    });
    document.addEventListener('keyup', event => keys.delete(event.code));
    canvas.addEventListener('pointermove', event => { if (!busy) { aim = canvasCell(canvas, event.clientX, event.clientY, 256, 256); dirty = true; } });
    canvas.addEventListener('pointerleave', () => { aim = null; dirty = true; });
    canvas.addEventListener('pointerdown', () => canvas.focus());
    for (const button of document.querySelectorAll('[data-hold]')) {
        button.onpointerdown = event => { if (busy) return; event.preventDefault(); button.setPointerCapture(event.pointerId); keys.add(button.dataset.hold); };
        button.onpointerup = button.onpointercancel = () => keys.delete(button.dataset.hold);
    }
    // Developer integration surface. Operations serialize with the same live loop.
    window.spillway = {
        ready: true, setPaused, restart, exportRun, playRecording, runBenchmark,
        snapshot: () => enqueue(() => game.snapshot()),
        step: commands => { if (busy) throw new Error('Benchmark is running'); setPaused(true); return enqueue(async () => {
            for (const command of commands) await game.step(command);
            updateHud(true); render(); await renderer.completed(); return game.snapshot();
        }); },
        lastReplay: null, benchmarkResult: null,
    };
    controls(false); updateHud(true); render(); await renderer.completed();
    $('status').textContent = 'WebGPU ready · 23 shared physics passes · fixed 60 ticks/second · finite material world';
    pump = createFramePump(frame, { onError: fail });
    window.addEventListener('pagehide', () => { pump.stop(); void enqueue(() => { field.close(); renderer.close(); }); if (receiptUrl) URL.revokeObjectURL(receiptUrl); }, { once: true });
}
init().catch(error => { $('status').textContent = 'Unable to start: ' + error.message; console.error(error); });
