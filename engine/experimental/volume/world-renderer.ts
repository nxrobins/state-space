import { type LatencyProfiler, type Trace } from './latency.js';
/** Persistent per-chunk face lists. Physics owns invalidation, never visibility. */
import { DRAW } from './3d-renderer.js';
import type { makeCavernAppearance } from './cavern-appearance.js';
import type { TerrainCamera, TerrainRenderer, TerrainLightingMode } from './3d-view.js';
import { resolveTerrainStyle } from './terrain-style.js';

export interface ResidentChunkRenderer extends TerrainRenderer {
  validateCamera(camera: TerrainCamera): void;
  encode(
    encoder: GPUCommandEncoder,
    camera: TerrainCamera,
    grid: GPUBuffer,
    gpuCamera: GPUBuffer,
    trace?: Trace,
    presentationTick?: number,
  ): void;
}

export async function makeChunkRenderer(
  device: GPUDevice,
  canvas: HTMLCanvasElement,
  state: () => { grid: GPUBuffer; shape: number[] },
  dirty: GPUBuffer,
  edge: number,
  profiler?: LatencyProfiler,
  tick: () => number = () => 0,
): Promise<ResidentChunkRenderer> {
  const context = canvas.getContext('webgpu');
  if (!context) throw new Error('Cannot create WebGPU canvas.');
  const shape = state().shape,
    count = shape.reduce((a, b) => a * b, 1),
    capacity = edge ** 3 * 6,
    chunks = count / edge ** 3;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const mapping = `
const EDGE=${edge}u;
fn coordinate(i:u32)->vec3u{let n=camera.shape.xyz/EDGE;let k=i/(EDGE*EDGE*EDGE);let l=i%(EDGE*EDGE*EDGE);return vec3u(k%n.x,(k/n.x)%n.y,k/(n.x*n.y))*EDGE+vec3u(l%EDGE,(l/EDGE)%EDGE,l/(EDGE*EDGE));}
fn index(c:vec3u)->u32{let n=camera.shape.xyz/EDGE;let k=c/EDGE;let l=c%EDGE;return (k.x+n.x*(k.y+n.y*k.z))*EDGE*EDGE*EDGE+l.x+EDGE*(l.y+EDGE*l.z);}
fn linear(c:vec3u)->u32{return c.x+camera.shape.x*(c.y+camera.shape.y*c.z);}
`;
  const common = `struct Camera {eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,projection:vec4f,shape:vec4u}
@group(0) @binding(0) var<storage,read> grid:array<u32>;
@group(0) @binding(1) var<storage,read_write> faces:array<u32>;
@group(0) @binding(2) var<storage,read_write> args:array<atomic<u32>>;
@group(0) @binding(3) var<uniform> camera:Camera;
@group(0) @binding(4) var<storage,read_write> dirty:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read_write> rebuild:array<u32>;
@group(0) @binding(6) var<storage,read_write> work:array<u32>;
@group(0) @binding(7) var<storage,read_write> dispatch:array<u32>;
${mapping}
@compute @workgroup_size(1) fn reset(){
 var length=0u;
 for(var k=0u;k<${chunks}u;k++){
  let changed=atomicExchange(&dirty[k],0u);rebuild[k]=changed;
  if(changed!=0u){
   work[length]=k;length++;
   atomicStore(&args[k*5u],6u);atomicStore(&args[k*5u+1u],0u);atomicStore(&args[k*5u+2u],k*6u);atomicStore(&args[k*5u+3u],0u);atomicStore(&args[k*5u+4u],0u);
  }
 }
 dispatch[0]=${Math.ceil(edge ** 3 / 64)}u;dispatch[1]=length;dispatch[2]=1u;
}
@compute @workgroup_size(64) fn mesh(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=EDGE*EDGE*EDGE){return;}let k=work[id.y];let i=k*EDGE*EDGE*EDGE+id.x;
 let m=grid[i]&255u;if(m==0u){return;}let c=vec3i(coordinate(i));
 let normals=array<vec3i,6>(vec3i(-1,0,0),vec3i(1,0,0),vec3i(0,-1,0),vec3i(0,1,0),vec3i(0,0,-1),vec3i(0,0,1));
 for(var f=0u;f<6u;f++){let t=c+normals[f];var exposed=true;
  if(m!=9u&&all(t>=vec3i(0))&&all(t<vec3i(camera.shape.xyz))){let n=grid[index(vec3u(t))]&255u;exposed=n==0u||n==9u;}
  if(exposed){let slot=atomicAdd(&args[k*5u+1u],1u);faces[k*${capacity}u+slot]=i*6u+f;}
 }
}`;
  const drawCode = DRAW.replace('const colors=', mapping + '\nconst colors=')
    .replace('let face=faces[instance];', 'let face=faces[(vertex/6u)*' + capacity + 'u+instance];')
    .replace(
      'let c=vec3f(f32(i%shape.x),f32((i/shape.x)%shape.y),f32(i/(shape.x*shape.y)));',
      'let c=vec3f(coordinate(i));',
    )
    .replace('let uv=uvs[vertex];', 'let uv=uvs[vertex%6u];')
    .replace('if(i==camera.shape.w)', 'if(linear(coordinate(i))==camera.shape.w)');
  async function module(code: string) {
    const m = device.createShaderModule({ code });
    const info = await m.getCompilationInfo();
    const errors = info.messages.filter((m) => m.type === 'error');
    if (errors.length) throw new Error(errors.map((m) => `${m.lineNum}: ${m.message}`).join('\n'));
    return m;
  }
  const meshModule = await module(common),
    drawModule = await module(drawCode);
  const reset = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: meshModule, entryPoint: 'reset' },
  });
  const mesh = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: meshModule, entryPoint: 'mesh' },
  });
  const draw = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: drawModule, entryPoint: 'vertex' },
    fragment: { module: drawModule, entryPoint: 'fragment', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  });
  const buffer = (size: number, usage: number) => device.createBuffer({ size, usage });
  const faces = buffer(count * 24, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC),
    args = buffer(
      chunks * 20,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
    ),
    rebuild = buffer(chunks * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC),
    uniform = buffer(96, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  // Two triangles share corners 0 and 2. Keep the original six-slot vertex
  // indices so both shaders retain their exact UVs and chunk addressing.
  const faceIndices = new Uint16Array(chunks * 6);
  for (let k = 0; k < chunks; k++)
    faceIndices.set(
      [0, 1, 2, 0, 2, 5].map((v) => k * 6 + v),
      k * 6,
    );
  const indices = device.createBuffer({
    label: 'chunk-face-indices',
    size: faceIndices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(indices, 0, faceIndices);
  const work = buffer(chunks * 4, GPUBufferUsage.STORAGE),
    dispatch = buffer(
      12,
      GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC,
    );
  // Invalidation belongs to each cache. Restrict worlds to one terrain renderer.
  device.queue.writeBuffer(dirty, 0, new Uint32Array(chunks).fill(1));
  const resetGroup = device.createBindGroup({
    layout: reset.getBindGroupLayout(0),
    entries: [
      { binding: 2, resource: { buffer: args } },
      { binding: 4, resource: { buffer: dirty } },
      { binding: 5, resource: { buffer: rebuild } },
      { binding: 6, resource: { buffer: work } },
      { binding: 7, resource: { buffer: dispatch } },
    ],
  });
  const bindings = new Map<GPUBuffer, { mesh: GPUBindGroup; draw: GPUBindGroup }>();
  const data = new ArrayBuffer(96),
    f = new Float32Array(data),
    u = new Uint32Array(data),
    near = 0.06,
    far = 160,
    tan = Math.tan(Math.PI / 6);
  const n = shape.map((v) => v / edge),
    radius = (Math.sqrt(3) * edge) / 2,
    centers = new Float64Array(chunks * 3);
  for (let k = 0; k < chunks; k++) {
    centers[k * 3] = ((k % n[0]) + 0.5) * edge;
    centers[k * 3 + 1] = ((Math.floor(k / n[0]) % n[1]) + 0.5) * edge;
    centers[k * 3 + 2] = (Math.floor(k / (n[0] * n[1])) + 0.5) * edge;
  }
  let depth: GPUTexture | undefined,
    width = 0,
    height = 0,
    closed = false;
  let heatDistortion = true;
  let style = resolveTerrainStyle();
  let lightingMode: TerrainLightingMode = 'reference';
  let appearance: 'diagnostic' | 'naturalistic' = 'diagnostic',
    natural: Awaited<ReturnType<typeof makeCavernAppearance>> | undefined;
  function encode(
    encoder: GPUCommandEncoder,
    camera: TerrainCamera,
    grid: GPUBuffer,
    trace?: Trace,
    gpuCamera?: GPUBuffer,
    presentationTick = tick(),
  ) {
    if (closed) throw new Error('Terrain renderer is closed.');
    try {
      const vectors = [camera.eye, camera.right, camera.up, camera.forward].map((a) => {
        if (!a || a.length !== 3) throw new Error('Invalid terrain camera.');
        const v = [a[0], a[1], a[2]];
        if (!v.every(Number.isFinite)) throw new Error('Invalid terrain camera.');
        return v;
      });
      if (
        camera.target !== undefined &&
        (!Number.isSafeInteger(camera.target) || camera.target < 0 || camera.target >= count)
      )
        throw new Error('Invalid target.');
      if (canvas.width < 1 || canvas.height < 1)
        throw new Error('Canvas must have positive dimensions.');
      if (!depth || width !== canvas.width || height !== canvas.height) {
        depth?.destroy();
        width = canvas.width;
        height = canvas.height;
        depth = device.createTexture({
          size: [width, height],
          format: 'depth24plus',
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
      }
      let groups = bindings.get(grid);
      if (!groups) {
        groups = {
          mesh: device.createBindGroup({
            layout: mesh.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: grid } },
              { binding: 1, resource: { buffer: faces } },
              { binding: 2, resource: { buffer: args } },
              { binding: 3, resource: { buffer: uniform } },
              { binding: 6, resource: { buffer: work } },
            ],
          }),
          draw: device.createBindGroup({
            layout: draw.getBindGroupLayout(0),
            entries: [grid, faces, uniform].map((buffer, binding) => ({
              binding,
              resource: { buffer },
            })),
          }),
        };
        bindings.set(grid, groups);
      }
      for (let i = 0; i < 4; i++) f.set(vectors[i], i * 4);
      f.set([(tan * width) / height, tan, far / (far - near), (-near * far) / (far - near)], 16);
      u.set([...shape, camera.target ?? 0xffffffff], 20);
      device.queue.writeBuffer(uniform, 0, data);
      profiler?.mark(trace, gpuCamera ? 'renderPreparedAt' : 'preparedAt');
      if (gpuCamera) {
        encoder.copyBufferToBuffer(gpuCamera, 64, uniform, 0, 16);
        encoder.copyBufferToBuffer(gpuCamera, 80, uniform, 92, 4);
      }
      const compute = encoder.beginComputePass(profiler?.pass(trace, 'mesh'));
      compute.setPipeline(reset);
      compute.setBindGroup(0, resetGroup);
      compute.dispatchWorkgroups(1);
      compute.setPipeline(mesh);
      compute.setBindGroup(0, groups.mesh);
      compute.dispatchWorkgroupsIndirect(dispatch, 0);
      compute.end();
      const output = context!.getCurrentTexture().createView(),
        beauty = appearance === 'naturalistic' ? natural : undefined;
      const prepared = beauty?.prepare(
        encoder,
        grid,
        depth,
        width,
        height,
        presentationTick,
        heatDistortion,
        lightingMode === 'cached',
        profiler,
        trace,
      );
      if (!beauty) natural?.invalidate();
      const pass = encoder.beginRenderPass({
        ...profiler?.pass(trace, 'draw'),
        colorAttachments: [
          {
            view: prepared?.view ?? output,
            clearValue: beauty ? [0.028, 0.045, 0.06, 1] : [0.065, 0.1, 0.15, 1],
            loadOp: 'clear',
            storeOp: 'store',
          },
        ],
        depthStencilAttachment: {
          view: depth.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store',
        },
      });
      pass.setPipeline(prepared?.draw ?? draw);
      pass.setBindGroup(0, prepared?.group ?? groups.draw);
      pass.setIndexBuffer(indices, 'uint16');
      // The controller can depenetrate three voxels and move by <=150/256.
      // Cull around the prior committed eye with a conservative four-voxel
      // margin; the draw uses the same-tick GPU eye copied above.
      const bound = radius + (gpuCamera ? 4 : 0),
        horizontal = (tan * width) / height,
        horizontalRadius = bound * Math.hypot(1, horizontal),
        verticalRadius = bound * Math.hypot(1, tan);
      for (let k = 0; k < chunks; k++) {
        const cx = centers[k * 3] - vectors[0][0],
          cy = centers[k * 3 + 1] - vectors[0][1],
          cz = centers[k * 3 + 2] - vectors[0][2];
        const z = cx * vectors[3][0] + cy * vectors[3][1] + cz * vectors[3][2];
        const x = cx * vectors[1][0] + cy * vectors[1][1] + cz * vectors[1][2],
          y = cx * vectors[2][0] + cy * vectors[2][1] + cz * vectors[2][2];
        // Sphere/frustum test, enlarged plane bounds remain conservative.
        if (
          z + bound < near ||
          z - bound > far ||
          Math.abs(x) > z * horizontal + horizontalRadius ||
          Math.abs(y) > z * tan + verticalRadius
        )
          continue;
        pass.drawIndexedIndirect(args, k * 20);
      }
      pass.end();
      beauty?.finish(encoder, output, profiler, trace);
    } catch (error) {
      natural?.invalidate();
      throw error;
    }
  }
  const renderer: ResidentChunkRenderer = {
    async setStyle(value) {
      if (closed) throw new Error('Terrain renderer is closed.');
      const next = resolveTerrainStyle(value);
      natural?.setStyle(next);
      style = next;
    },
    async inspectStyle() {
      if (closed) throw new Error('Terrain renderer is closed.');
      return resolveTerrainStyle(style);
    },
    async setLightingMode(value) {
      if (closed) throw new Error('Terrain renderer is closed.');
      if (value !== 'reference' && value !== 'cached')
        throw new Error('Invalid terrain lighting mode.');
      await natural?.prepareLighting(value === 'cached');
      if (value !== lightingMode) natural?.invalidate();
      lightingMode = value;
    },
    async setHeatDistortion(value) {
      if (closed) throw new Error('Terrain renderer is closed.');
      if (typeof value !== 'boolean') throw new Error('Heat distortion must be boolean.');
      heatDistortion = value;
    },
    async setAppearance(value) {
      if (closed) throw new Error('Terrain renderer is closed.');
      if (value !== 'diagnostic' && value !== 'naturalistic')
        throw new Error('Invalid terrain appearance.');
      if (value === 'naturalistic' && !natural) {
        const { makeCavernAppearance } = await import('./cavern-appearance.js');
        natural = await makeCavernAppearance(
          device,
          format,
          shape,
          edge,
          capacity,
          faces,
          uniform,
          rebuild,
        );
        natural.setStyle(style);
      }
      if (value === 'naturalistic') await natural!.prepareLighting(lightingMode === 'cached');
      appearance = value;
    },
    validateCamera(camera) {
      if (closed) throw new Error('Terrain renderer is closed.');
      for (const a of [camera.eye, camera.right, camera.up, camera.forward])
        if (!a || a.length !== 3 || ![a[0], a[1], a[2]].every(Number.isFinite))
          throw new Error('Invalid terrain camera.');
      if (
        camera.target !== undefined &&
        (!Number.isSafeInteger(camera.target) || camera.target < 0 || camera.target >= count)
      )
        throw new Error('Invalid target.');
      if (canvas.width < 1 || canvas.height < 1)
        throw new Error('Canvas must have positive dimensions.');
    },
    encode(encoder, camera, grid, gpuCamera, trace, presentationTick) {
      encode(encoder, camera, grid, trace, gpuCamera, presentationTick);
    },
    async render(camera: TerrainCamera) {
      renderer.validateCamera(camera);
      const trace = profiler?.begin('render', tick());
      device.pushErrorScope('validation');
      const encoder = device.createCommandEncoder();
      encode(encoder, camera, state().grid, trace);
      profiler?.resolve(encoder, trace);
      profiler?.mark(trace, 'encodedAt');
      device.queue.submit([encoder.finish()]);
      profiler?.submitted(trace);
      const results = await Promise.allSettled([
        device.popErrorScope(),
        device.queue.onSubmittedWorkDone().then(() => profiler?.mark(trace, 'queueCompletedAt')),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') throw r.reason;
        if (r.value) throw new Error((r.value as GPUError).message);
      }
      profiler?.mark(trace, 'completedAt');
    },
    async inspectMesh() {
      if (closed) throw new Error('Terrain renderer is closed.');
      const meshBytes = chunks * 24 + count * 24,
        bytes = meshBytes + 12,
        read = buffer(bytes, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ),
        e = device.createCommandEncoder();
      e.copyBufferToBuffer(args, 0, read, 0, chunks * 20);
      e.copyBufferToBuffer(rebuild, 0, read, chunks * 20, chunks * 4);
      e.copyBufferToBuffer(faces, 0, read, chunks * 24, count * 24);
      e.copyBufferToBuffer(dispatch, 0, read, meshBytes, 12);
      device.queue.submit([e.finish()]);
      try {
        await read.mapAsync(GPUMapMode.READ);
        const words = new Uint32Array(read.getMappedRange()),
          result: number[][] = [];
        for (let k = 0; k < chunks; k++)
          result.push(
            Array.from(
              words.subarray(
                chunks * 6 + k * capacity,
                chunks * 6 + k * capacity + words[k * 5 + 1],
              ),
            ).sort((a, b) => a - b),
          );
        return {
          faces: result,
          rebuilt: Array.from(words.subarray(chunks * 5, chunks * 6)),
          meshDispatch: Array.from(words.subarray(meshBytes / 4, meshBytes / 4 + 3)),
        };
      } finally {
        if (read.mapState === 'mapped') read.unmap();
        read.destroy();
      }
    },
    close() {
      if (closed) return;
      closed = true;
      natural?.close();
      depth?.destroy();
      faces.destroy();
      args.destroy();
      indices.destroy();
      rebuild.destroy();
      uniform.destroy();
      work.destroy();
      dispatch.destroy();
      context.unconfigure();
      bindings.clear();
    },
  };
  return renderer;
}
