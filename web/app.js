// State Space — WebGPU Cellular Automata Engine
// Phase 3a+3b: Renderer + Input Bridge

import { BITMASK_DEFS, LOCKED_1A, GRAVITY_SHADER, THERMAL_SHADER,
         PHASE_SHADER, COMBUSTION_SHADER, RENDER_SHADER } from './shaders.js';

const GRID_W = 256;
const GRID_H = 256;
const GRID_SIZE = GRID_W * GRID_H;

// Material IDs (must match schema.py)
const MAT = {
    AIR: 0, STONE: 1, WATER: 2, SAND: 3, FIRE: 4, METAL: 5,
    OIL: 6, WOOD: 7, ICE: 8, STEAM: 9, LAVA: 10, GLASS: 11,
    PLAYER: 12, ASH: 13, SMOKE: 14,
};

const MAT_NAMES = [
    'air','stone','water','sand','fire','metal',
    'oil','wood','ice','steam','lava','glass',
    'player','ash','smoke'
];

const MAT_COLORS = [
    '#0d0d14','#808080','#2659cc','#c2b280','#ff6610','#b3b8bf',
    '#331f0d','#8c5926','#bfe6f2','#d9d9e6','#ff4d00','#b3d9e6',
    '#33cc66','#4d4740','#66666b'
];

// Phase states
const PHASE = { SOLID:0, POWDER:1, LIQUID:2, VISCOUS:3, GAS:4, PLASMA:5, FROZEN:6, MOLTEN:7, BURNING:8 };

// Default phase per material
// Phase determines gravity behavior:
// POWDER/LIQUID/VISCOUS/GAS = movable (participates in gravity/buoyancy)
// SOLID/FROZEN = structural (stays in place)
// Fire=GAS (rises via buoyancy), Lava=VISCOUS (flows downhill like heavy fluid)
const MAT_PHASE = [
    PHASE.GAS, PHASE.SOLID, PHASE.LIQUID, PHASE.POWDER, PHASE.GAS, PHASE.SOLID,
    PHASE.VISCOUS, PHASE.SOLID, PHASE.FROZEN, PHASE.GAS, PHASE.VISCOUS, PHASE.SOLID,
    PHASE.SOLID, PHASE.POWDER, PHASE.GAS  // ash=POWDER (falls, exposes fresh wood)
];

// Default thermal per material (for placement)
// Thermal values: fire/lava must be high enough to ignite/melt neighbors
// Fire=255 (max, persistent heat source), Lava=250, Ice=5 (cold)
const MAT_THERMAL = [20,20,25,20,255,20,22,20,5,120,250,20,20,30,40];

// ── State ──────────────────────────────────────────────────────────

let selectedMat = MAT.SAND;
let brushSize = 3;
let paused = false;
let mouseDown = false;
let mouseButton = 0;
let mouseX = 0, mouseY = 0;
let tickCount = 0;
let lastFrameTime = 0;
let fps = 0;

// ── Cold Table (must match schema.py EXACTLY) ─────────────────────

const COLD_STRIDE = 24;

function buildColdTable() {
    const buf = new Uint32Array(256 * COLD_STRIDE);
    const materials = [
        [MAT.AIR,      1,   5,   0,   0,   0,   0,  255, 0,   0,   0,   0,   0,   0,   0,   0,   0,   0,  0,   0],
        [MAT.STONE,  200,  30, 220, 255,   0,   0,    0, 0, 210,   0,  30,   0, MAT.LAVA,0,  0,   0,   0,  0,   0],
        [MAT.WATER,  100,  60,   0, 100,   0,   0,    0, 0,  25,  90,   0,  40,   0, MAT.STEAM,MAT.ICE,0, 0,  0,   0],
        [MAT.SAND,   180,  20, 200, 255,   0,   0,  150, 0,   0,   0,  25,   0, MAT.GLASS,0, 0,   0,   0,  0,   0],
        [MAT.FIRE,     0, 255,   0,   0,   0, 255,  255, 0,   0,   0,   0,   0,   0,   0,   0,   0,   0,  0,   0],
        [MAT.METAL,  220, 200, 230, 255,   0,   0,    0, 0, 220,   0,  35,   0, MAT.LAVA,0,  0,   0,   0,  0,   0],
        [MAT.OIL,     90,  10,   0,  80, 120, 200,    0, 0,   0,  70,   0,  30,   0, MAT.STEAM,0, 0, 150,MAT.SMOKE,MAT.FIRE],
        [MAT.WOOD,   120,  15,   0,   0, 180, 150,   30, 0,   0,   0,   0,   0,   0,   0,   0,   0,  80,MAT.ASH,MAT.FIRE],
        [MAT.ICE,    100,  40,  30, 100,   0,   0,    0, 0,   0,   0,  15,   0, MAT.WATER,0, 0,   0,   0,  0,   0],
        [MAT.STEAM,    5,  50,   0,   0,   0,   0,  255, 0,   0,  90,   0,   0,   0,   0,   0, MAT.WATER, 0,0,  0],
        [MAT.LAVA,   210, 150,   0, 255,   0,  50,    0, 0, 210,   0,   0,   0,   0,   0, MAT.STONE,0,  0,  0,   0],
        [MAT.GLASS,  170,  25, 240, 255,   0,   0,    0, 0, 235,   0,  30,   0, MAT.LAVA,0,  0,   0,   0,  0,   0],
        [MAT.PLAYER, 100,  30,   0,   0,   0,   0,    0, 0,   0,   0,   0,   0,   0,   0,   0,   0,   0,  0,   0],
        [MAT.ASH,    150,  10,   0,   0,   0,   0,  100, 0,   0,   0,   0,   0,   0,   0,   0,   0,   0,  0,   0],
        [MAT.SMOKE,    3,  30,   0,   0,   0,   0,  255, 0,   0,   0,   0,   0,   0,   0,   0,   0,   0,  0,   0],
    ];
    for (const [id, ...props] of materials) {
        const base = id * COLD_STRIDE;
        for (let i = 0; i < props.length && i < COLD_STRIDE; i++) {
            buf[base + i] = props[i];
        }
    }
    return buf;
}

// ── Voxel packing ─────────────────────────────────────────────────

function packVoxel(mat, thermal, kx, ky, phase, flags) {
    return (mat & 0xFF)
        | ((thermal & 0xFF) << 8)
        | ((kx & 0xF) << 16)
        | ((ky & 0xF) << 20)
        | ((phase & 0xF) << 24)
        | ((flags & 0xF) << 28);
}

// ── WebGPU Init ───────────────────────────────────────────────────

async function init() {
    const log = (msg) => { console.log('[SS] ' + msg); document.getElementById('stats').textContent = msg; };

    if (!navigator.gpu) { log('WebGPU not supported'); return; }
    log('Requesting adapter...');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) { log('No GPU adapter'); return; }
    log('Requesting device...');
    const device = await adapter.requestDevice();
    log('Device ready');
    const canvas = document.getElementById('canvas');
    const ctx = canvas.getContext('webgpu');

    function resize() {
        const container = canvas.parentElement;
        canvas.width = container.clientWidth - 180;
        canvas.height = container.clientHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const format = navigator.gpu.getPreferredCanvasFormat();
    ctx.configure({ device, format, alphaMode: 'opaque' });

    // ── Create buffers ────────────────────────────────────────────

    const initialGrid = new Uint32Array(GRID_SIZE);
    const airVoxel = packVoxel(MAT.AIR, 20, 0, 0, PHASE.GAS, 0);
    initialGrid.fill(airVoxel);

    // Stone floor
    for (let x = 0; x < GRID_W; x++) {
        for (let y = GRID_H - 20; y < GRID_H; y++) {
            initialGrid[y * GRID_W + x] = packVoxel(MAT.STONE, 20, 0, 0, PHASE.SOLID, 0);
        }
    }

    const gridA = device.createBuffer({
        size: GRID_SIZE * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    const gridB = device.createBuffer({
        size: GRID_SIZE * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(gridA, 0, initialGrid);

    const coldTable = buildColdTable();
    const coldBuf = device.createBuffer({
        size: coldTable.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(coldBuf, 0, coldTable);

    const paramBuf = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(paramBuf, 0, new Uint32Array([GRID_W, GRID_H, selectedMat, 0]));

    // ── Shaders (bundled, no fetch needed) ──────────────────────
    log('Preparing shaders...');
    // Dispatch order matches the core CompositionEngine.
    const kernelSpecs = [
        { source: BITMASK_DEFS + '\n' + LOCKED_1A + '\n' + GRAVITY_SHADER, constants: { GRAVITY_PHASE: 0 } },
        { source: BITMASK_DEFS + '\n' + LOCKED_1A + '\n' + GRAVITY_SHADER, constants: { GRAVITY_PHASE: 1 } },
        { source: BITMASK_DEFS + '\n' + LOCKED_1A + '\n' + THERMAL_SHADER },
        { source: BITMASK_DEFS + '\n' + LOCKED_1A + '\n' + PHASE_SHADER },
        { source: BITMASK_DEFS + '\n' + LOCKED_1A + '\n' + COMBUSTION_SHADER },
    ];
    const renderWGSL = RENDER_SHADER;

    // ── Create compute pipelines ──────────────────────────────────

    const computeBGL = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
            { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        ],
    });
    const computePL = device.createPipelineLayout({ bindGroupLayouts: [computeBGL] });

    log('Creating compute pipelines...');
    const computePipelines = kernelSpecs.map((spec) => {
        const module = device.createShaderModule({ code: spec.source });
        return device.createComputePipeline({
            layout: computePL,
            compute: { module, entryPoint: 'tick', constants: spec.constants || {} },
        });
    });

    const computeBG_AB = device.createBindGroup({
        layout: computeBGL,
        entries: [
            { binding: 0, resource: { buffer: gridA } },
            { binding: 1, resource: { buffer: gridB } },
            { binding: 2, resource: { buffer: coldBuf } },
        ],
    });
    const computeBG_BA = device.createBindGroup({
        layout: computeBGL,
        entries: [
            { binding: 0, resource: { buffer: gridB } },
            { binding: 1, resource: { buffer: gridA } },
            { binding: 2, resource: { buffer: coldBuf } },
        ],
    });

    // ── Create render pipeline ────────────────────────────────────

    const renderBGL = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        ],
    });
    const renderPL = device.createPipelineLayout({ bindGroupLayouts: [renderBGL] });
    log('Creating render pipeline...');
    const renderModule = device.createShaderModule({ code: renderWGSL });
    const renderPipeline = device.createRenderPipeline({
        layout: renderPL,
        vertex: { module: renderModule, entryPoint: 'vs_main' },
        fragment: {
            module: renderModule, entryPoint: 'fs_main',
            targets: [{ format }],
        },
        primitive: { topology: 'triangle-strip' },
    });

    const renderBG_A = device.createBindGroup({
        layout: renderBGL,
        entries: [
            { binding: 0, resource: { buffer: gridA } },
            { binding: 1, resource: { buffer: paramBuf } },
        ],
    });
    const renderBG_B = device.createBindGroup({
        layout: renderBGL,
        entries: [
            { binding: 0, resource: { buffer: gridB } },
            { binding: 1, resource: { buffer: paramBuf } },
        ],
    });

    // ── Input handling ────────────────────────────────────────────

    let currentIsA = true;

    // Pending paint operations batched per frame
    let pendingPaints = [];

    function paintVoxels(gx, gy, mat, radius) {
        pendingPaints.push({ gx, gy, mat, radius });
    }

    function flushPaints() {
        if (pendingPaints.length === 0) return;
        // Batch all paints into a single row-based writeBuffer strategy
        // Group by row for efficient writes
        const targetBuf = currentIsA ? gridA : gridB;
        const rowMap = new Map();  // y -> Map(x -> voxel)

        for (const { gx, gy, mat, radius } of pendingPaints) {
            const phase = MAT_PHASE[mat] || 0;
            const thermal = MAT_THERMAL[mat] || 20;
            const voxel = packVoxel(mat, thermal, 0, 0, phase, 0);
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    if (dx*dx + dy*dy > radius*radius) continue;
                    const x = gx + dx;
                    const y = gy + dy;
                    if (x < 0 || x >= GRID_W || y < 0 || y >= GRID_H) continue;
                    if (!rowMap.has(y)) rowMap.set(y, new Map());
                    rowMap.get(y).set(x, voxel);
                }
            }
        }
        pendingPaints = [];

        // Write individual voxels (one writeBuffer per voxel, but batched per frame)
        const singleVoxel = new Uint32Array(1);
        for (const [y, cols] of rowMap) {
            for (const [x, voxel] of cols) {
                singleVoxel[0] = voxel;
                device.queue.writeBuffer(targetBuf, (y * GRID_W + x) * 4, singleVoxel);
            }
        }
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
        if (e.code === 'KeyC') {
            const clearGrid = new Uint32Array(GRID_SIZE);
            clearGrid.fill(airVoxel);
            for (let x = 0; x < GRID_W; x++) {
                for (let y = GRID_H - 20; y < GRID_H; y++) {
                    clearGrid[y * GRID_W + x] = packVoxel(MAT.STONE, 20, 0, 0, PHASE.SOLID, 0);
                }
            }
            device.queue.writeBuffer(gridA, 0, clearGrid);
            currentIsA = true;
            tickCount = 0;
        }
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

    // ── Main loop ─────────────────────────────────────────────────

    const wgX = Math.ceil(GRID_W / 16);
    const wgY = Math.ceil(GRID_H / 16);

    log('Starting main loop');
    function frame(time) {
      try {
        if (!time) time = performance.now();
        const dt = time - lastFrameTime;
        lastFrameTime = time;
        fps = dt > 0 ? 1000 / dt : 0;

        // Flush batched paint operations before compute
        flushPaints();

        if (!paused) {
            const encoder = device.createCommandEncoder();
            for (let i = 0; i < computePipelines.length; i++) {
                const bg = currentIsA ? computeBG_AB : computeBG_BA;
                const pass = encoder.beginComputePass();
                pass.setPipeline(computePipelines[i]);
                pass.setBindGroup(0, bg);
                pass.dispatchWorkgroups(wgX, wgY);
                pass.end();
                currentIsA = !currentIsA;
            }
            device.queue.submit([encoder.finish()]);
            tickCount++;
        }

        {
            const encoder = device.createCommandEncoder();
            const pass = encoder.beginRenderPass({
                colorAttachments: [{
                    view: ctx.getCurrentTexture().createView(),
                    loadOp: 'clear', storeOp: 'store',
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                }],
            });
            pass.setPipeline(renderPipeline);
            pass.setBindGroup(0, currentIsA ? renderBG_A : renderBG_B);
            pass.draw(4);
            pass.end();
            device.queue.submit([encoder.finish()]);
        }

        document.getElementById('stats').textContent =
            'FPS: ' + fps.toFixed(0) + '\nTick: ' + tickCount + '\n' + (paused ? 'PAUSED' : 'Running') + '\nGrid: ' + GRID_W + 'x' + GRID_H;

        setTimeout(frame, 16);
      } catch(e) {
        document.getElementById('stats').textContent = 'FRAME ERROR: ' + e.message;
        console.error('Frame error:', e);
      }
    }

    log('Scheduling first frame...');
    setTimeout(() => { log('Frame timer fired!'); frame(); }, 0);
    log('Init complete, waiting for first frame');
}

init().catch(e => {
    console.error(e);
    document.getElementById('stats').textContent = 'Error: ' + e.message;
});
