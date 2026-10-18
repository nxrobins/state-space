/** Mock GPU API contracts only. Native WGSL, pixels, physical ticks and replay are held. */
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createTacticalRenderer3D, prepareTacticalScene3D, projectTacticalPoint3D, TACTICAL_CAMERA_WGSL_3D, type TacticalCamera3D, type TacticalDecoration3D, type TacticalRenderTargets3D } from './tactical-renderer.js';
import { cameraData, sceneData } from './tactical-presentation.js';
import { TACTICAL_BOXES, TACTICAL_TERRAIN, TACTICAL_MESH } from './tactical-render-shaders.js';
import { MESH } from './3d-renderer.js';
import { createSlabController } from '../../examples/tactical-slab/controller.js';
import { createSlabSession, inspectSlab } from '../../examples/tactical-slab/scenario.js';
import { prepareSlabScene } from '../../examples/tactical-slab/presentation.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import * as mechanics from './structural-mechanics.js';

const guards = [vi.spyOn(mechanics, 'solveStructure3D'), ...(['step', 'stepWithMotion', 'stepWithMotionPaths', 'inspectStructure'] as const).map(k => vi.spyOn(CpuStructuralWorld3D.prototype, k))];
for (const guard of guards) guard.mockImplementation(() => {throw Error('Physical runtime remains held.');});
afterAll(() => {for (const guard of guards) {expect(guard).not.toHaveBeenCalled(); guard.mockRestore();}});
beforeEach(() => {
  vi.stubGlobal('GPUBufferUsage', {UNIFORM: 1, COPY_DST: 2, STORAGE: 4, INDIRECT: 8});
  vi.stubGlobal('GPUTextureUsage', {RENDER_ATTACHMENT: 16}); vi.stubGlobal('GPUShaderStage', {VERTEX: 1});
});
afterEach(() => {vi.unstubAllGlobals();});
const camera: TacticalCamera3D = {eye: [4, 4, -4], right: [1, 0, 0], up: [0, -1, 0], forward: [0, 0, 1], fovY: Math.PI / 3, near: 0.1, far: 100};
const formats = {colorFormat: 'rgba8unorm', depthFormat: 'depth24plus'} as const;
function deferred<T>() {let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => {resolve = a; reject = b;}); return {promise, resolve, reject};}
function fixture() {const session = createSlabSession(), snapshot = session.snapshot(); return {session, snapshot, scene: prepareSlabScene(snapshot, inspectSlab(snapshot, session.queries()))};}
function mock() {
  const events: string[] = [], buffers: {label: string; size: number; usage: number; destroy: ReturnType<typeof vi.fn>}[] = [], writes: {buffer: GPUBuffer; bytes: Uint8Array}[] = [];
  const lost = deferred<GPUDeviceLostInfo>();
  const queue = {writeBuffer: vi.fn((buffer: GPUBuffer, _offset: number, data: ArrayBuffer | ArrayBufferView) => {
    writes.push({buffer, bytes: (ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data)).slice()});
  }), submit: vi.fn(), onSubmittedWorkDone: vi.fn(() => Promise.resolve())};
  const pass = {setPipeline: vi.fn((p: {label: string}) => events.push(p.label)), setBindGroup: vi.fn(), draw: vi.fn(), drawIndirect: vi.fn(), end: vi.fn()};
  const compute = {setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups: vi.fn(), end: vi.fn()};
  const encoder = {beginRenderPass: vi.fn(() => pass), beginComputePass: vi.fn(() => compute), finish: vi.fn(() => ({}))};
  const raw = {queue, lost: lost.promise, limits: {maxBufferSize: 2 ** 28, maxStorageBufferBindingSize: 2 ** 27, maxComputeWorkgroupsPerDimension: 65535},
    createBuffer: vi.fn((d: {label: string; size: number; usage: number}) => {const b = {...d, destroy: vi.fn()}; buffers.push(b); return b;}),
    createShaderModule: vi.fn(() => ({getCompilationInfo: async () => ({messages: [] as {type: string; message: string}[]})})),
    createBindGroupLayout: vi.fn((d: GPUBindGroupLayoutDescriptor) => ({descriptor: d})), createPipelineLayout: vi.fn((d: GPUPipelineLayoutDescriptor) => ({descriptor: d})),
    createComputePipelineAsync: vi.fn(async () => ({getBindGroupLayout: () => ({})})), createRenderPipelineAsync: vi.fn(async (d: GPURenderPipelineDescriptor) => d), createBindGroup: vi.fn((d: GPUBindGroupDescriptor) => d),
    createCommandEncoder: vi.fn(() => encoder), pushErrorScope: vi.fn(), popErrorScope: vi.fn(async (): Promise<{message: string} | null> => null), destroy: vi.fn(),
  };
  function texture(format: string) {return {format, width: 1280, height: 720, dimension: '2d', depthOrArrayLayers: 1, mipLevelCount: 1, sampleCount: 1, usage: 16, createView: vi.fn(() => ({})), destroy: vi.fn()};}
  const textures = {color: texture('rgba8unorm'), depth: texture('depth24plus')};
  return {raw, device: raw as unknown as GPUDevice, targets: textures as unknown as TacticalRenderTargets3D, textures, buffers, writes, queue, pass, compute, encoder, events, lost};
}
const box: TacticalDecoration3D = {id: 'unit', box: {minQ: [1024, 1024, 1024], maxQ: [2048, 2048, 2048]}, color: [1, 0.5, 0.25, 1]};

describe('isolated tactical presentation', () => {
  test('prepares only private render coordinates without changing the full snapshot', () => {
    const {snapshot, scene} = fixture(), before = structuredClone(snapshot); expect(scene.shape).toEqual([8, 8, 8]); expect(scene.actors).toBe(2); expect(scene.overlays).toBe(4);
    expect(snapshot).toEqual(before); expect(scene.stamp.kind).toBe('committed'); expect(Object.isFrozen(scene)).toBe(true); expect(Object.keys(scene)).not.toContain('grid');
    snapshot.terrain.packedCells.fill(0); snapshot.game.units[0].body.minQ[0] = 0;
    expect(sceneData(scene).grid).toEqual(Uint32Array.from(before.terrain.packedCells)); expect(sceneData(scene).actors[0]).toBe(2.25);
  });
  test('validates energy and structure before accepting a snapshot', () => {
    const {snapshot} = fixture(); snapshot.terrain.packedCells[0] = 0xffffffff; expect(() => prepareTacticalScene3D(snapshot)).toThrow();
  });
  test('rejects accessors without invoking them', () => {
    const {snapshot} = fixture(), spy = vi.fn(); Object.defineProperty(snapshot, 'game', {enumerable: true, get: spy});
    expect(() => prepareTacticalScene3D(snapshot)).toThrow(); expect(spy).not.toHaveBeenCalled();
  });
  test('prepares a completed preview with its full candidate identity', async () => {
    const controller = createSlabController(); try {const ticket = controller.request({kind: 'lift'}, 0), result = await ticket.result;
      if (result.status !== 'ready') throw Error(result.status);
      const scene = prepareSlabScene(result.preview, await controller.inspectPreview(ticket));
      expect(scene.stamp).toMatchObject({kind: 'preview', ...result.preview.preview}); expect(sceneData(scene).actors[1]).toBe(2.25);
      expect(controller.snapshot().revision).toBe(0);
    } finally {await controller.close();}
  });
  test('rejects incomplete preview horizons and changed rule identities', async () => {
    const controller = createSlabController(); try {const result = await controller.request({kind: 'lift'}, 0).result; if (result.status !== 'ready') throw Error(result.status);
      for (const mutate of [(p: typeof result.preview) => {p.preview.horizonTicks = 1;}, (p: typeof result.preview) => {p.preview.base = {...p.preview.base, materialCatalogHash: 'bad'};}, (p: typeof result.preview) => {p.preview.operation = 0;}]) {
        const p = structuredClone(result.preview); mutate(p); expect(() => prepareTacticalScene3D(p)).toThrow();
      }
    } finally {await controller.close();}
  });
  test('rejects old committed observations and preview observations on committed state', async () => {
    const controller = createSlabController(); try {const old = controller.inspect(), ticket = controller.request({kind: 'lift'}, 0), result = await ticket.result;
      if (result.status !== 'ready') throw Error(result.status); const observation = await controller.inspectPreview(ticket), committed = controller.commit(ticket).snapshot;
      expect(() => prepareSlabScene(committed, old)).toThrow(/different physical state/); expect(() => prepareSlabScene(committed, observation)).toThrow();
    } finally {await controller.close();}
  });
  test('requires complete decoration stamps including geometry domain', () => {
    const {snapshot, scene} = fixture(); expect(() => prepareTacticalScene3D(snapshot, {stamp: {...scene.stamp, domain: 'subset'}, actors: [], overlays: []})).toThrow();
  });
  test('copies decoration positions and colors into world units', () => {
    const {snapshot, scene} = fixture(), actor = structuredClone(box), prepared = prepareTacticalScene3D(snapshot, {stamp: scene.stamp, actors: [actor], overlays: []});
    (actor.box.minQ as unknown as number[])[0] = 0; (actor.color as unknown as number[])[0] = 0;
    expect(Array.from(sceneData(prepared).actors)).toEqual([1, 1, 1, 0, 1, 1, 1, 0, 1, 0.5, 0.25, 1]);
  });
  test('rejects duplicate ids and over-budget decoration lists', () => {
    const {snapshot, scene} = fixture();
    for (const actors of [[box, box], Array.from({length: 65}, (_, i) => ({...box, id: String(i)}))]) expect(() => prepareTacticalScene3D(snapshot, {stamp: scene.stamp, actors, overlays: []})).toThrow();
    expect(() => prepareTacticalScene3D(snapshot, {stamp: scene.stamp, actors: [], overlays: Array.from({length: 257}, (_, i) => ({...box, id: String(i)}))})).toThrow();
  });
  test('rejects fractional outside inverted and translucent actor boxes', () => {
    const {snapshot, scene} = fixture();
    for (const actor of [{...box, box: {minQ: [0.5, 0, 0], maxQ: [1, 1, 1]}}, {...box, box: {minQ: [0, 0, 0], maxQ: [9000, 1, 1]}}, {...box, box: {minQ: [1, 1, 1], maxQ: [1, 2, 2]}}, {...box, color: [1, 1, 1, 0.5]}]) {
      expect(() => prepareTacticalScene3D(snapshot, {stamp: scene.stamp, actors: [actor as unknown as TacticalDecoration3D], overlays: []})).toThrow();
    }
  });
  test('rejects sparse arrays and array accessors', () => {
    const {snapshot, scene} = fixture(), actors = [box], spy = vi.fn(); Object.defineProperty(actors, '0', {get: spy, enumerable: true});
    expect(() => prepareTacticalScene3D(snapshot, {stamp: scene.stamp, actors, overlays: []})).toThrow(); expect(spy).not.toHaveBeenCalled();
    expect(() => prepareTacticalScene3D(snapshot, {stamp: scene.stamp, actors: new Array(1), overlays: []})).toThrow();
  });
  test('projects shared world coordinates with positive Y downward and zero-to-one depth', () => {
    const center = projectTacticalPoint3D(camera, [4096, 4096, 0], 1280, 720)!;
    expect(center.x).toBe(640); expect(center.y).toBe(360); expect(center.visible).toBe(true);
    expect(projectTacticalPoint3D(camera, [4096, 5120, 0], 1280, 720)!.y).toBeGreaterThan(center.y);
    expect(projectTacticalPoint3D(camera, [4096, 4096, -5120], 1280, 720)).toBeNull();
    const uniform = new Float32Array(cameraData(camera, 1280, 720, [8, 8, 8])); expect(center.depth).toBe(uniform[18] + uniform[19] / 4);
  });
  test('rejects invalid camera bases and projection ranges', () => {
    for (const bad of [{...camera, eye: [NaN, 0, 0]}, {...camera, up: camera.right}, {...camera, forward: [0, 0, 2]}, {...camera, near: 0}, {...camera, far: camera.near}, {...camera, fovY: Infinity}]) expect(() => projectTacticalPoint3D(bad as TacticalCamera3D, [0, 0, 0], 10, 10)).toThrow();
  });
  test('uses the shared camera shader in both drawing pipelines and unchanged mesh rules', () => {
    expect(TACTICAL_TERRAIN).toContain(TACTICAL_CAMERA_WGSL_3D); expect(TACTICAL_BOXES).toContain(TACTICAL_CAMERA_WGSL_3D);
    expect(TACTICAL_TERRAIN).toContain('out.position=projectWorld(c+local)'); expect(TACTICAL_MESH).toBe(MESH);
  });
});

describe('single-flight mock GPU composition', () => {
  test('binds common camera depth and opaque actors before depth-tested overlays', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture();
    await r.render(scene, camera, m.targets, c => {expect(c.cameraLayout).toBe(r.cameraLayout); expect(c.stamp).toEqual(scene.stamp); m.events.push('host');});
    expect(m.events).toEqual(['tactical terrain', 'tactical actors', 'host', 'tactical overlays']);
    const descriptions = m.raw.createRenderPipelineAsync.mock.calls.map(c => c[0]);
    expect(descriptions.map(d => d.depthStencil)).toEqual([{format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less'}, {format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less'}, {format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal'}]);
    expect(m.queue.submit).toHaveBeenCalledTimes(1); expect(m.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1); expect(r.state().lastCompleted).toEqual(scene.stamp);
    await r.close();
  });
  test('camera-only frames reuse grid mesh instances and indirect arguments', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture(); await r.render(scene, camera, m.targets);
    const before = m.writes.length; await r.render(scene, {...camera, eye: [3, 4, -4]}, m.targets);
    expect(m.compute.dispatchWorkgroups).toHaveBeenCalledTimes(1); expect(m.writes.slice(before).map(w => w.buffer.label)).toEqual(['tactical camera']); await r.close();
  });
  test('new prepared identity rebuilds even when its revision is identical', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), f = fixture(); await r.render(f.scene, camera, m.targets);
    await r.render(prepareTacticalScene3D(f.snapshot), camera, m.targets); expect(m.compute.dispatchWorkgroups).toHaveBeenCalledTimes(2); expect(m.buffers).toHaveLength(6); await r.close();
  });
  test('rejects a second frame until completion without writes or backlog', async () => {
    const m = mock(), done = deferred<void>(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture(); m.queue.onSubmittedWorkDone.mockReturnValue(done.promise);
    const pending = r.render(scene, camera, m.targets); expect(r.state().status).toBe('working'); await Promise.resolve();
    const writes = m.writes.length; await expect(r.render(scene, camera, m.targets)).rejects.toThrow(/outstanding/); expect(m.writes).toHaveLength(writes); expect(r.state().lastCompleted).toBeNull();
    done.resolve(); await pending; expect(r.state().status).toBe('ready'); await r.close();
  });
  test('rejects reentrant frame submission from the host callback', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture(); let rejected: Promise<unknown> | undefined;
    await r.render(scene, camera, m.targets, () => {rejected = expect(r.render(scene, camera, m.targets)).rejects.toThrow(/outstanding/);}); await rejected;
    expect(m.queue.submit).toHaveBeenCalledTimes(1); await r.close();
  });
  test('rejects bad targets before writes and stays usable', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture();
    const valid = {...m.textures.depth};
    for (const change of [{width: 640}, {format: 'depth32float'}, {sampleCount: 4}, {mipLevelCount: 2}, {usage: 0}, {depthOrArrayLayers: 2}, {height: 0}]) {
      Object.assign(m.textures.depth, change); await expect(r.render(scene, camera, m.targets)).rejects.toThrow(); Object.assign(m.textures.depth, valid);
    }
    expect(m.writes).toHaveLength(0); expect(m.queue.submit).not.toHaveBeenCalled(); expect(r.state().status).toBe('ready'); await r.render(scene, camera, m.targets); await r.close();
  });
  test('rejects fabricated scenes invalid cameras and device budget excess before work', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture();
    await expect(r.render({...scene}, camera, m.targets)).rejects.toThrow(/prepared/); await expect(r.render(scene, {...camera, near: 0}, m.targets)).rejects.toThrow();
    m.raw.limits.maxComputeWorkgroupsPerDimension = 1; await expect(r.render(scene, camera, m.targets)).rejects.toThrow(/device limits/);
    expect(m.writes).toHaveLength(0); expect(r.state().status).toBe('ready'); await r.close();
  });
  test('captures target references and camera bytes before deferring encoding', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture(), targets = {...m.targets}, view = structuredClone(camera);
    const pending = r.render(scene, view, targets); targets.depth = targets.color; (view.eye as unknown as number[])[0] = 100;
    await pending; expect(m.textures.depth.createView).toHaveBeenCalledTimes(1); expect(new Float32Array(m.writes[0].bytes.buffer)[0]).toBe(4); await r.close();
  });
  test('retains the last completed stamp on callback failure and drains queued writes', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture(); await r.render(scene, camera, m.targets);
    await expect(r.render(scene, camera, m.targets, () => {throw Error('host failed');})).rejects.toThrow(/host failed/);
    expect(r.state()).toEqual({status: 'failed', error: 'host failed', lastCompleted: scene.stamp}); expect(m.queue.submit).toHaveBeenCalledTimes(1); expect(m.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(2);
    await expect(r.render(scene, camera, m.targets)).rejects.toThrow(/host failed/); await r.close();
  });
  test('rejects asynchronous host drawing without an unhandled rejection', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture();
    await expect(r.render(scene, camera, m.targets, async () => {throw Error('async');})).rejects.toThrow(/synchronously/); expect(m.queue.submit).not.toHaveBeenCalled(); await r.close();
  });
  test('treats even an undefined thrown value as a frame failure', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture();
    await expect(r.render(scene, camera, m.targets, () => {throw undefined;})).rejects.toThrow(); expect(r.state().status).toBe('failed'); await r.close();
  });
  test('observes GPU validation errors after the single completion boundary', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture(); m.raw.popErrorScope.mockResolvedValueOnce({message: 'validation failure'});
    await expect(r.render(scene, camera, m.targets)).rejects.toThrow(/validation failure/); expect(m.queue.onSubmittedWorkDone).toHaveBeenCalledTimes(1); expect(r.state().lastCompleted).toBeNull(); await r.close();
  });
  test('waits for completion even when the error-scope promise rejects', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture(), done = deferred<void>(); m.raw.popErrorScope.mockRejectedValueOnce(Error('scope failed')); m.queue.onSubmittedWorkDone.mockReturnValue(done.promise);
    const pending = r.render(scene, camera, m.targets), checked = expect(pending).rejects.toThrow(/scope failed/); const closed = r.close(); await Promise.resolve();
    expect(m.buffers.some(b => b.destroy.mock.calls.length)).toBe(false); done.resolve(); await checked; await closed; expect(m.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
  });
  test('fails closed on a completion rejection without a reason', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture(); m.queue.onSubmittedWorkDone.mockRejectedValueOnce(undefined);
    await expect(r.render(scene, camera, m.targets)).rejects.toThrow(/rendering failed/); expect(r.state().status).toBe('failed'); expect(r.state().lastCompleted).toBeNull(); await r.close();
  });
  test('closes only after pending work completes and never destroys caller resources', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture(), done = deferred<void>(); m.queue.onSubmittedWorkDone.mockReturnValue(done.promise);
    const pending = r.render(scene, camera, m.targets), closed = r.close(); expect(r.state().status).toBe('closing'); await expect(r.render(scene, camera, m.targets)).rejects.toThrow(/closing/);
    expect(m.buffers.some(b => b.destroy.mock.calls.length)).toBe(false); done.resolve(); await pending; await closed; await r.close();
    expect(m.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true); expect(m.textures.color.destroy).not.toHaveBeenCalled(); expect(m.textures.depth.destroy).not.toHaveBeenCalled(); expect(m.raw.destroy).not.toHaveBeenCalled(); expect(r.state().status).toBe('closed');
  });
  test('device loss stops idle rendering without changing its completed identity', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture(); await r.render(scene, camera, m.targets);
    m.lost.resolve({message: 'gone', reason: 'destroyed'} as GPUDeviceLostInfo); await Promise.resolve(); await expect(r.render(scene, camera, m.targets)).rejects.toThrow(/Device lost/); expect(r.state().lastCompleted).toEqual(scene.stamp); await r.close();
  });
  test('partial cache allocation failure releases temporary buffers then faults', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), {scene} = fixture(), original = m.raw.createBuffer.getMockImplementation()!;
    m.raw.createBuffer.mockImplementation(d => {if (d.label === 'tactical faces') throw Error('allocation failed'); return original(d);});
    await expect(r.render(scene, camera, m.targets)).rejects.toThrow(/allocation failed/); expect(m.buffers.find(b => b.label === 'tactical grid')!.destroy).toHaveBeenCalledTimes(1);
    await r.close(); expect(m.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
  });
  test('shader compilation failure balances the setup error scope', async () => {
    const m = mock(); m.raw.createShaderModule.mockReturnValue({getCompilationInfo: async () => ({messages: [{type: 'error', message: 'bad shader'}]})});
    await expect(createTacticalRenderer3D(m.device, formats)).rejects.toThrow(/bad shader/); expect(m.raw.popErrorScope).toHaveBeenCalledTimes(1); expect(m.buffers).toHaveLength(0);
  });
  test('setup validation failure frees all allocated caches', async () => {
    const m = mock(); m.raw.popErrorScope.mockResolvedValueOnce({message: 'setup failed'}); await expect(createTacticalRenderer3D(m.device, formats)).rejects.toThrow(/setup failed/);
    expect(m.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true); expect(m.raw.popErrorScope).toHaveBeenCalledTimes(1);
  });
  test('camera drawing and presentation disposal cannot alter authoritative state', async () => {
    const m = mock(), r = await createTacticalRenderer3D(m.device, formats), f = fixture(), before = f.session.snapshot();
    await r.render(f.scene, camera, m.targets); await r.render(f.scene, {...camera, eye: [1, 2, 3]}, m.targets); await r.close(); expect(f.session.snapshot()).toEqual(before);
  });
});
