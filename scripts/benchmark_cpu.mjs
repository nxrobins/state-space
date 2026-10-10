/** Complete public CPU ticks, with setup/inspection outside the timed region. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: {
  sdk: { type: 'string', default: 'dist/sdk/state-space.js' },
  report: { type: 'string', default: 'dist/performance/cpu.json' },
  compare: { type: 'string' },
  shapes: { type: 'string', default: '72x48,160x90,256x256' },
  warmups: { type: 'string', default: '2' },
  samples: { type: 'string', default: '7' },
  ticks: { type: 'string', default: '4' },
} });
const positive = (value, name) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${name} must be a positive integer.`);
  return number;
};
const warmups = positive(values.warmups, 'warmups');
const samples = positive(values.samples, 'samples');
const ticks = positive(values.ticks, 'ticks');
const shapes = values.shapes.split(',').map(shape => {
  if (!/^\d+x\d+$/.test(shape)) throw new Error(`Invalid shape: ${shape}`);
  const [width, height] = shape.split('x').map(value => positive(value, 'dimension'));
  if (width < 8 || height < 8) throw new Error('Benchmark scenes require at least 8x8 cells.');
  return [width, height];
});
const sdkPath = resolve(root, values.sdk);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bundleHash = hash(readFileSync(sdkPath));
const benchmarkPath = fileURLToPath(import.meta.url);
const benchmarkHash = hash(readFileSync(benchmarkPath));
const environment = { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCpus: cpus().length };
const { createStateSpaceField, createPhysicsState, DEFAULT_REGISTRY, MAT, packVoxel } = await import(pathToFileURL(sdkPath).href);
const config = { warmups, samples, ticks, shapes, startTick: 17, inspect: false };
const baseline = values.compare ? JSON.parse(readFileSync(resolve(root, values.compare), 'utf8')) : undefined;
if (baseline && JSON.stringify(baseline.config) !== JSON.stringify(config)) throw new Error('Comparison benchmark configuration differs.');
if (baseline && (baseline.benchmarkHash !== benchmarkHash || JSON.stringify(baseline.environment) !== JSON.stringify(environment))) {
  throw new Error('Comparison requires the same benchmark source, CPU and runtime.');
}

function scene(workload, width, height) {
  const grid = new Uint32Array(width * height).fill(packVoxel(MAT.AIR));
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let material = MAT.AIR, thermal;
    if (workload !== 'empty' && y === height - 1) material = MAT.STONE;
    else if (workload === 'flow' && y > 1 && y < Math.floor(height * 2 / 3) && x > 1 && x < width - 2) {
      material = [MAT.SAND, MAT.WATER, MAT.OIL, MAT.SMOKE][(x * 13 + y * 7) % 4];
      thermal = material === MAT.SMOKE ? 180 : 20;
    } else if (workload === 'supported' && x >= Math.floor(width / 4) && x < Math.floor(width * 3 / 4) && y >= Math.floor(height / 3)) {
      material = MAT.METAL;
    } else if (workload === 'collapse' && x > 1 && x < width - 2 && y >= Math.floor(height / 3) && y < Math.floor(height / 3) + 3) {
      material = MAT.METAL;
    } else if (workload === 'coupled' && x > 1 && x < width - 2 && y > 1 && y < height - 2) {
      material = [MAT.WOOD, MAT.AIR, MAT.METAL, MAT.WATER, MAT.ICE, MAT.FIRE][(x * 13 + y * 7) % 6];
      thermal = [MAT.WOOD, MAT.METAL, MAT.FIRE].includes(material) ? 255 : 20;
    }
    grid[y * width + x] = packVoxel(material, thermal);
  }
  return createPhysicsState(grid, width, height, DEFAULT_REGISTRY);
}

const rows = [];
for (const [width, height] of shapes) for (const workload of ['empty', 'flow', 'supported', 'collapse', 'coupled']) {
  const state = scene(workload, width, height);
  const field = createStateSpaceField(width, height);
  const initial = { ...field.packedSnapshot(), tick: config.startTick,
    packedCells: Array.from(state.grid), energyQ: Array.from(state.energyQ), structure: Array.from(state.structure) };
  const initialHash = hash(JSON.stringify(initial));
  field.restore(initial);
  const totalQ = field.energyBalance().currentQ;
  const durations = [];
  let finalHash;
  for (let sample = -warmups; sample < samples; sample += 1) {
    field.restore(initial);
    const start = performance.now();
    field.step(ticks);
    const elapsed = (performance.now() - start) / ticks;
    // Hash all state coordinates and the absolute tick, outside the timed step.
    const digest = hash(JSON.stringify(field.packedSnapshot()));
    if (finalHash && finalHash !== digest) throw new Error(`${workload} ${width}x${height}: nondeterministic result.`);
    finalHash = digest;
    if (field.energyBalance().currentQ !== totalQ || field.energyBalance().driftQ !== 0n) throw new Error('Energy accounting drift.');
    if (sample >= 0) durations.push(elapsed);
  }
  field.close();
  const sorted = durations.toSorted((a, b) => a - b);
  const medianMs = sorted[Math.floor(sorted.length / 2)];
  const row = { workload, width, height, cells: width * height, initialHash, finalHash,
    samplesMsPerTick: durations, minMs: sorted[0], medianMs, p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1), cellTicksPerSecond: width * height * 1000 / medianMs };
  if (baseline) {
    const previous = baseline.rows.find(value => value.workload === workload && value.width === width && value.height === height);
    if (!previous || previous.initialHash !== initialHash || previous.finalHash !== finalHash) throw new Error(`Complete state differs from baseline for ${workload} ${width}x${height}.`);
    row.speedup = previous.medianMs / medianMs;
  }
  rows.push(row);
  process.stdout.write(`${width}x${height} ${workload}: ${medianMs.toFixed(2)} ms/tick${row.speedup ? ` (${row.speedup.toFixed(2)}x)` : ''}\n`);
}
if (hash(readFileSync(sdkPath)) !== bundleHash) throw new Error('SDK changed during benchmark.');
if (hash(readFileSync(benchmarkPath)) !== benchmarkHash) throw new Error('Benchmark source changed during execution.');
const report = { reportVersion: 1, recordedAt: new Date().toISOString(),
  environment,
  gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  bundleHash, benchmarkHash, config,
  scope: 'Synchronous public CPU field.step, including planning, allocations and committed-state validation; excludes setup, snapshots, inspection, rendering and GPU work.',
  ...(baseline ? { baselineBundleHash: baseline.bundleHash, completeStatesMatchBaseline: true } : {}), rows };
const reportPath = resolve(root, values.report);
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`Report: ${reportPath}\n`);
