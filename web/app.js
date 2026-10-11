// Standalone renderer and input client for the supported State Space SDK.
import { createGpuField, MAT } from '../dist/sdk/state-space.js';
import { MATERIAL_NAMES as MAT_NAMES, MATERIAL_VISUALS as MAT_COLORS } from './materials.generated.js';
import { createMaterialRenderer, canvasCell } from './renderer.js';
import { seedScene } from './demo.js';
import { FrameClock } from './frame-clock.js';

const GRID_W = 256, GRID_H = 256;
let selectedMat = MAT.SAND, brushSize = 3, paused = false;
let mouseDown = false, mouseButton = 0, mouseX = 0, mouseY = 0;
let pendingPaints = [];

async function init() {
    const stats = document.getElementById('stats');
    stats.textContent = 'Creating the WebGPU field...';
    const world = await createGpuField(GRID_W, GRID_H);
    const requestedScene = new URLSearchParams(location.search).get('scene');
    const scene = ['lighting', 'water', 'haze', 'heat'].includes(requestedScene) ? requestedScene : 'bridge';
    seedScene(world, scene);
    const initial = world.packedSnapshot();
    const canvas = document.getElementById('canvas');
    let styled = true, lighting = true, water = true, haze = true, distortion = true;
    if (scene === 'lighting') {
        canvas.setAttribute('aria-label', 'Interactive lava light and shadow gallery');
        document.querySelector('#heading h1').textContent = 'Light finds a way.';
        document.querySelector('#heading p').textContent = 'Lava lights the terrain. Pillars cast shadows. Toggle lighting to compare.';
        document.getElementById('reset-demo').textContent = 'Restart gallery';
    }
    if (scene === 'water') {
        canvas.setAttribute('aria-label', 'Interactive fire and lava reflections over water');
        document.querySelector('#heading h1').textContent = 'Fire on the water.';
        document.querySelector('#heading p').textContent = 'Lava reflects. Ripples bend the riverbed. Toggle water effects to compare.';
        document.getElementById('reset-demo').textContent = 'Restart lagoon';
    }
    if (scene === 'haze') {
        canvas.setAttribute('aria-label', 'Interactive fire-lit smoke and steam chambers');
        document.querySelector('#heading h1').textContent = 'Light through the haze.';
        document.querySelector('#heading p').textContent = 'Fire lights the smoke. Steam catches the glow. Toggle haze to compare.';
        document.getElementById('reset-demo').textContent = 'Restart chambers';
    }
    if (scene === 'heat') {
        canvas.setAttribute('aria-label', 'Interactive lava and fire heat shimmer chambers');
        document.querySelector('#heading h1').textContent = 'The air starts to shimmer.';
        document.querySelector('#heading p').textContent = 'Heat bends the glow and wisps above lava. Toggle shimmer to compare.';
        document.getElementById('reset-demo').textContent = 'Restart heat chambers';
    }
    const clock = new FrameClock();
    function resize() {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
        canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
    }
    resize(); window.addEventListener('resize', resize);
    let renderer;
    try { renderer = await createMaterialRenderer(canvas, GRID_W, GRID_H, world.registry); }
    catch (error) { world.close(); throw error; }
    function render() { renderer.render(world, styled, { lighting, water, haze, distortion }); }
    function paintVoxels(gx, gy, mat, radius) { pendingPaints.push({ gx, gy, mat, radius }); }
    function flushPaints() {
        const paints = pendingPaints; pendingPaints = [];
        for (const { gx, gy, mat, radius } of paints) world.paintCircle(gx, gy, radius, mat);
    }
    // Serialize frame work, edits and inspection across awaited GPU steps.
    let queue = Promise.resolve();
    function enqueue(operation) {
        const result = queue.then(operation);
        queue = result.catch(error => { stats.textContent = 'Error: ' + error.message; console.error(error); });
        return result;
    }
    function canvasToGrid(cx, cy) {
        return canvasCell(canvas, cx, cy, GRID_W, GRID_H);
    }

    canvas.addEventListener('mousedown', (e) => {
        const cell = canvasToGrid(e.clientX, e.clientY);
        if (!cell) return;
        mouseDown = true;
        mouseButton = e.button;
        [mouseX, mouseY] = cell;
        paintVoxels(mouseX, mouseY, e.button === 2 ? MAT.AIR : selectedMat, brushSize);
        e.preventDefault();
    });
    canvas.addEventListener('mousemove', (e) => {
        if (!mouseDown) return;
        const cell = canvasToGrid(e.clientX, e.clientY);
        if (!cell) return;
        const [newX, newY] = cell;
        if (newX !== mouseX || newY !== mouseY) {
            mouseX = newX;
            mouseY = newY;
            paintVoxels(mouseX, mouseY, mouseButton === 2 ? MAT.AIR : selectedMat, brushSize);
        }
    });
    canvas.addEventListener('mouseup', () => { mouseDown = false; });
    canvas.addEventListener('mouseleave', () => { mouseDown = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.addEventListener('keydown', (e) => {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLButtonElement) return;
        if (e.code === 'Space') { paused = !paused; clock.reset(); e.preventDefault(); }
        if (e.code === 'KeyC') void enqueue(() => { pendingPaints = []; world.clear(); clock.reset(); render(); });
        if (e.code === 'KeyB') void setView();
        if (e.code === 'KeyL') void setLighting();
        if (e.code === 'KeyW') void setWater();
        if (e.code === 'KeyH') void setHaze();
        if (e.code === 'KeyD') void setDistortion();
        if (e.code === 'KeyR') void resetBridge();
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9) {
            const matMap = [MAT.STONE, MAT.WATER, MAT.SAND, MAT.FIRE, MAT.WOOD, MAT.OIL, MAT.ICE, MAT.METAL, MAT.LAVA];
            selectedMat = matMap[num - 1];
            updatePalette();
        }
    });

    const brushSlider = document.getElementById('brush-size');
    brushSlider.addEventListener('input', () => {
        brushSize = parseInt(brushSlider.value);
        document.getElementById('brush-val').textContent = brushSize;
    });

    // ── Material palette ──────────────────────────────────────────

    const paletteDiv = document.getElementById('palette');
    const paletteItems = [
        [MAT.STONE, '1'], [MAT.WATER, '2'], [MAT.SAND, '3'],
        [MAT.FIRE, '4'], [MAT.WOOD, '5'], [MAT.OIL, '6'],
        [MAT.ICE, '7'], [MAT.METAL, '8'], [MAT.LAVA, '9'],
        [MAT.STEAM, ''], [MAT.GLASS, ''], [MAT.SMOKE, ''],
        [MAT.OIL_VAPOR, ''], [MAT.MOLTEN_METAL, ''], [MAT.MOLTEN_GLASS, ''],
    ];

    function updatePalette() {
        while (paletteDiv.firstChild) paletteDiv.removeChild(paletteDiv.firstChild);
        for (const [matId, key] of paletteItems) {
            const btn = document.createElement('div');
            btn.className = 'mat-btn' + (matId === selectedMat ? ' selected' : '');

            const swatch = document.createElement('div');
            swatch.className = 'mat-swatch';
            swatch.style.background = MAT_COLORS[matId];
            btn.appendChild(swatch);

            const nameSpan = document.createElement('span');
            nameSpan.className = 'mat-name';
            nameSpan.textContent = MAT_NAMES[matId];
            btn.appendChild(nameSpan);

            if (key) {
                const keySpan = document.createElement('span');
                keySpan.className = 'mat-key';
                keySpan.textContent = key;
                btn.appendChild(keySpan);
            }

            btn.addEventListener('click', () => { selectedMat = matId; updatePalette(); });
            paletteDiv.appendChild(btn);
        }
    }
    updatePalette();

    function setView(value) {
        return enqueue(async () => {
            styled = value === undefined ? !styled : value; render(); await renderer.completed();
            document.getElementById('view-toggle').textContent = styled ? 'B · Material + light' : 'A · Plain materials';
            document.getElementById('view-toggle').setAttribute('aria-pressed', String(styled));
        });
    }
    function setLighting(value) {
        return enqueue(async () => {
            if (value !== undefined && typeof value !== 'boolean') throw new Error('lighting must be boolean');
            lighting = value === undefined ? !lighting : value;
            render(); await renderer.completed();
            document.getElementById('light-toggle').textContent = lighting ? 'Lighting + shadows: on' : 'Lighting + shadows: off';
            document.getElementById('light-toggle').setAttribute('aria-pressed', String(lighting));
        });
    }
    function resetBridge() { return enqueue(() => { pendingPaints = []; world.restore(initial); clock.reset(); render(); }); }
    function setWater(value) {
        return enqueue(async () => {
            if (value !== undefined && typeof value !== 'boolean') throw new Error('water must be boolean');
            water = value === undefined ? !water : value;
            render(); await renderer.completed();
            document.getElementById('water-toggle').textContent = water ? 'Water optics: on' : 'Water optics: off';
            document.getElementById('water-toggle').setAttribute('aria-pressed', String(water));
        });
    }
    function setHaze(value) {
        return enqueue(async () => {
            if (value !== undefined && typeof value !== 'boolean') throw new Error('haze must be boolean');
            haze = value === undefined ? !haze : value;
            render(); await renderer.completed();
            document.getElementById('haze-toggle').textContent = haze ? 'Volumetric haze: on' : 'Volumetric haze: off';
            document.getElementById('haze-toggle').setAttribute('aria-pressed', String(haze));
        });
    }
    function setDistortion(value) {
        return enqueue(async () => {
            if (value !== undefined && typeof value !== 'boolean') throw new Error('distortion must be boolean');
            distortion = value === undefined ? !distortion : value;
            render(); await renderer.completed();
            document.getElementById('distortion-toggle').textContent = distortion ? 'Heat shimmer: on' : 'Heat shimmer: off';
            document.getElementById('distortion-toggle').setAttribute('aria-pressed', String(distortion));
        });
    }
    document.getElementById('view-toggle').addEventListener('click', () => { void setView(); });
    document.getElementById('light-toggle').addEventListener('click', () => { void setLighting(); });
    document.getElementById('water-toggle').addEventListener('click', () => { void setWater(); });
    document.getElementById('haze-toggle').addEventListener('click', () => { void setHaze(); });
    document.getElementById('distortion-toggle').addEventListener('click', () => { void setDistortion(); });
    document.getElementById('reset-demo').addEventListener('click', () => { void resetBridge(); });
    document.getElementById('pause').addEventListener('click', () => { paused = !paused; clock.reset(); });

    window.stateSpace = Object.freeze({
        setPaused(value) {
            if (typeof value !== 'boolean') throw new Error('paused must be boolean');
            paused = value;
            clock.reset();
        },
        setView(mode) { if (!['plain', 'styled'].includes(mode)) throw new Error('Invalid view'); return setView(mode === 'styled'); },
        setLighting,
        setWater,
        setHaze,
        setDistortion,
        resetBridge,
        ready: true,
        rendererInfo: renderer.backendInfo,
        step(ticks = 1, options = {}) { return enqueue(async () => { flushPaints(); const reports = await world.step(ticks, options); render(); await renderer.completed(); return reports; }); },
        snapshot() { return enqueue(() => { flushPaints(); return world.packedSnapshot(); }); },
        restore(snapshot) { return enqueue(() => { world.restore(snapshot); pendingPaints = []; render(); }); },
        inspectStructure() { return enqueue(() => { flushPaints(); return world.inspectStructure(); }); },
    });
    let stopped = false;
    window.addEventListener('pagehide', () => {
        stopped = true;
        void enqueue(() => { world.close(); renderer.close(); });
    }, { once: true });
    async function frame(now) {
        const start = performance.now();
        try {
            await enqueue(async () => {
                flushPaints();
                const ticks = clock.advance(now, paused);
                if (ticks) await world.step(ticks);
                render();
                await renderer.completed();
                stats.textContent = 'Tick: ' + world.tick + '\n' + (paused ? 'PAUSED' : 'Running') + '\nGrid: ' + GRID_W + 'x' + GRID_H +
                    '\nFrame work: ' + (performance.now() - start).toFixed(1) + ' ms' + '\nView: ' + (styled ? 'Material + light' : 'Plain') + '\nPhysics: fixed 60 Hz';
                document.getElementById('pause').textContent = paused ? 'Resume' : 'Pause';
            });
        } catch { stopped = true; }
        if (!stopped) requestAnimationFrame(frame);
    }
    render();
    if (new URLSearchParams(location.search).has('paused')) paused = true;
    requestAnimationFrame(frame);
}

init().catch(error => {
    console.error(error);
    document.getElementById('stats').textContent = 'Error: ' + error.message;
});
