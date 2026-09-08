// Standalone renderer and input client for the supported State Space SDK.
import { createGpuField, createPhysicsState, packVoxel, MAT, DEFAULT_REGISTRY } from '../dist/sdk/state-space.js';
import { MATERIAL_NAMES as MAT_NAMES, MATERIAL_VISUALS as MAT_COLORS } from './materials.generated.js';
import { BITMASK_DEFS, RENDER_SHADER } from './shaders.js';

const GRID_W = 256, GRID_H = 256, GRID_SIZE = GRID_W * GRID_H;
let selectedMat = MAT.SAND, brushSize = 3, paused = false;
let mouseDown = false, mouseButton = 0, mouseX = 0, mouseY = 0;
let pendingPaints = [];

async function init() {
    const stats = document.getElementById('stats');
    stats.textContent = 'Creating the WebGPU field...';
    const world = await createGpuField(GRID_W, GRID_H);
    const cells = new Uint32Array(GRID_SIZE).fill(packVoxel(MAT.AIR));
    for (let y = GRID_H - 20; y < GRID_H; y++) cells.fill(packVoxel(MAT.STONE), y * GRID_W, (y + 1) * GRID_W);
    const state = createPhysicsState(cells, GRID_W, GRID_H, DEFAULT_REGISTRY);
    const initial = { ...world.packedSnapshot(), packedCells: Array.from(state.grid), energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) };
    world.restore(initial);

    // The renderer receives committed public state and owns no simulation passes.
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) { world.close(); throw new Error('No rendering adapter'); }
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('canvas'), context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    function resize() {
        canvas.width = Math.max(1, canvas.parentElement.clientWidth - 180);
        canvas.height = Math.max(1, canvas.parentElement.clientHeight);
    }
    resize(); window.addEventListener('resize', resize);
    context.configure({ device, format, alphaMode: 'opaque' });
    const grid = device.createBuffer({ size: GRID_SIZE * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const layout = device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    ] });
    const module = device.createShaderModule({ code: BITMASK_DEFS + '\n' + RENDER_SHADER });
    const pipeline = await device.createRenderPipelineAsync({ layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint: 'fs_main', targets: [{ format }] }, primitive: { topology: 'triangle-strip' } });
    const group = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: grid } }, { binding: 1, resource: { buffer: params } }] });
    function render() {
        device.queue.writeBuffer(grid, 0, world.grid);
        device.queue.writeBuffer(params, 0, new Uint32Array([GRID_W, GRID_H, selectedMat, 0]));
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
        pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(4); pass.end();
        device.queue.submit([encoder.finish()]);
    }
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
        const rect = canvas.getBoundingClientRect();
        const rx = (cx - rect.left) / rect.width;
        const ry = (cy - rect.top) / rect.height;
        return [Math.floor(rx * GRID_W), Math.floor(ry * GRID_H)];
    }

    canvas.addEventListener('mousedown', (e) => {
        mouseDown = true;
        mouseButton = e.button;
        [mouseX, mouseY] = canvasToGrid(e.clientX, e.clientY);
        paintVoxels(mouseX, mouseY, e.button === 2 ? MAT.AIR : selectedMat, brushSize);
        e.preventDefault();
    });
    canvas.addEventListener('mousemove', (e) => {
        if (!mouseDown) return;
        const [newX, newY] = canvasToGrid(e.clientX, e.clientY);
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
        if (e.code === 'Space') { paused = !paused; e.preventDefault(); }
        if (e.code === 'KeyC') void enqueue(() => { pendingPaints = []; world.restore(initial); });
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

    window.stateSpace = Object.freeze({
        setPaused(value) {
            if (typeof value !== 'boolean') throw new Error('paused must be boolean');
            paused = value;
        },
        step(ticks = 1, options = {}) { return enqueue(async () => { flushPaints(); const reports = await world.step(ticks, options); render(); return reports; }); },
        snapshot() { return enqueue(() => { flushPaints(); return world.packedSnapshot(); }); },
        restore(snapshot) { return enqueue(() => { world.restore(snapshot); pendingPaints = []; render(); }); },
        inspectStructure() { return enqueue(() => { flushPaints(); return world.inspectStructure(); }); },
    });
    let stopped = false;
    window.addEventListener('pagehide', () => {
        stopped = true;
        void enqueue(() => { world.close(); grid.destroy(); params.destroy(); device.destroy(); });
    }, { once: true });
    async function frame() {
        const start = performance.now();
        try {
            await enqueue(async () => {
                flushPaints();
                if (!paused) await world.step();
                render();
                stats.textContent = 'Tick: ' + world.tick + '\n' + (paused ? 'PAUSED' : 'Running') + '\nGrid: ' + GRID_W + 'x' + GRID_H +
                    '\nFrame: ' + (performance.now() - start).toFixed(1) + ' ms';
            });
        } catch { stopped = true; }
        if (!stopped) setTimeout(frame, 16);
    }
    render();
    void frame();
}

init().catch(error => {
    console.error(error);
    document.getElementById('stats').textContent = 'Error: ' + error.message;
});
