import { MAT, MATERIALS_3D } from '../../dist/sdk/state-space-3d.js';

const shader = `
struct Camera { eye: vec4f, right: vec4f, up: vec4f, forward: vec4f, projection: vec4f }
@group(0) @binding(0) var<uniform> camera: Camera;
struct Vertex { @location(0) position: vec3f, @location(1) normal: vec3f, @location(2) color: vec3f }
struct Output { @builtin(position) position: vec4f, @location(0) color: vec3f }
@vertex fn vertex(v: Vertex) -> Output {
  let p = v.position - camera.eye.xyz;
  let z = dot(p, camera.forward.xyz);
  var out: Output;
  out.position = vec4f(dot(p, camera.right.xyz) / camera.projection.x,
    dot(p, camera.up.xyz) / camera.projection.y, camera.projection.z * z + camera.projection.w, z);
  let light = 0.32 + 0.68 * max(0.0, dot(v.normal, normalize(vec3f(0.4, 0.85, 0.3))));
  out.color = v.color * light;
  return out;
}
@fragment fn fragment(v: Output) -> @location(0) vec4f { return vec4f(v.color, 1); }
`;
const palette = new Map(MATERIALS_3D.map(m => [m.id, [1, 3, 5].map(offset => parseInt(m.color.slice(offset, offset + 2), 16) / 255)]));
const faces = [
  [[-1, 0, 0], [[0,0,0],[0,0,1],[0,1,1],[0,1,0]]],
  [[1, 0, 0], [[1,0,1],[1,0,0],[1,1,0],[1,1,1]]],
  [[0, -1, 0], [[0,0,1],[0,0,0],[1,0,0],[1,0,1]]],
  [[0, 1, 0], [[0,1,0],[0,1,1],[1,1,1],[1,1,0]]],
  [[0, 0, -1], [[1,0,0],[0,0,0],[0,1,0],[1,1,0]]],
  [[0, 0, 1], [[0,0,1],[1,0,1],[1,1,1],[0,1,1]]],
];
const normalize = a => { const n = Math.hypot(...a); return a.map(v => v / n); };
const cross = (a, b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];

export async function createVolumeRenderer(canvas, onError) {
  if (!navigator.gpu) throw new Error('This viewer needs a browser with WebGPU. The CPU SDK also runs in Node.');
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter available.');
  const device = await adapter.requestDevice();
  device.addEventListener('uncapturederror', event => onError(event.error));
  device.lost.then(info => { if (info.reason !== 'destroyed') onError(new Error(`GPU device lost: ${info.message}`)); });
  const context = canvas.getContext('webgpu'), format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  const module = device.createShaderModule({ code: shader });
  const diagnostics = await module.getCompilationInfo();
  const errors = diagnostics.messages.filter(m => m.type === 'error');
  if (errors.length) throw new Error(errors.map(e => e.message).join('\n'));
  const pipeline = await device.createRenderPipelineAsync({ layout: 'auto', vertex: { module, entryPoint: 'vertex', buffers: [{ arrayStride: 36,
    attributes: [0, 1, 2].map(i => ({ shaderLocation: i, offset: i * 12, format: 'float32x3' })) }] },
    fragment: { module, entryPoint: 'fragment', targets: [{ format }] }, primitive: { topology: 'triangle-list' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' } });
  const uniform = device.createBuffer({ size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniform } }] });
  let vertexBuffer, capacity = 0, vertices = 0, depth, depthWidth, depthHeight, geometry = '', extent = 32;
  const camera = { yaw: .72, pitch: .55, radius: 73 };
  let drag;
  canvas.addEventListener('pointerdown', event => { if (event.button !== 0) return; drag = [event.clientX, event.clientY]; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    camera.yaw -= (event.clientX - drag[0]) * .006;
    camera.pitch = Math.max(-1.35, Math.min(1.35, camera.pitch + (event.clientY - drag[1]) * .006));
    drag = [event.clientX, event.clientY];
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', event => { event.preventDefault(); camera.radius = Math.max(extent * .2, Math.min(extent * 8, camera.radius * Math.exp(event.deltaY * .001))); }, { passive: false });

  function update(state, { temperature = false, steam = true, cut = state.depth } = {}) {
    const { width: w, height: h, depth: d, grid } = state;
    const key = `${w}:${h}:${d}`;
    if (key !== geometry) { geometry = key; extent = Math.max(w,h,d); camera.radius = extent * 73 / 32; }
    const data = [];
    const opaque = (x, y, z) => {
      if (x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d || z >= cut) return false;
      const m = grid[x + w * (y + h * z)] & 255;
      return m !== MAT.AIR && m !== MAT.STEAM;
    };
    for (let z = 0; z < Math.min(d, cut); z++) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const value = grid[x + w * (y + h * z)], m = value & 255;
      if (m === MAT.AIR || (m === MAT.STEAM && !steam)) continue;
      const t = ((value >>> 8) & 255) / 255;
      const color = temperature ? [Math.min(1, t * 2), .15 + .55 * Math.sin(t * Math.PI), 1 - t] : palette.get(m);
      const marker = m === MAT.STEAM, scale = marker ? .22 : 1, inset = (1 - scale) / 2;
      for (const [normal, corners] of faces) {
        if (!marker && opaque(x + normal[0], y + normal[1], z + normal[2])) continue;
        for (const corner of [0, 1, 2, 0, 2, 3]) {
          const c = corners[corner];
          data.push(x + inset + c[0] * scale - w / 2, h / 2 - y - inset - c[1] * scale, z + inset + c[2] * scale - d / 2,
            normal[0], -normal[1], normal[2], ...color);
        }
      }
    }
    vertices = data.length / 9;
    const values = new Float32Array(data);
    if (values.byteLength > capacity || !vertexBuffer) {
      vertexBuffer?.destroy(); capacity = Math.max(36, values.byteLength);
      vertexBuffer = device.createBuffer({ size: capacity, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    }
    if (values.byteLength) device.queue.writeBuffer(vertexBuffer, 0, values);
    return { vertices, meshBytes: values.byteLength };
  }
  async function render() {
    if (!depth || depthWidth !== canvas.width || depthHeight !== canvas.height) {
      depth?.destroy(); depthWidth = canvas.width; depthHeight = canvas.height;
      depth = device.createTexture({ size: [canvas.width, canvas.height], format: 'depth24plus', usage: GPUTextureUsage.RENDER_ATTACHMENT });
    }
    const { yaw, pitch, radius } = camera;
    const eye = [radius * Math.cos(pitch) * Math.sin(yaw), radius * Math.sin(pitch), radius * Math.cos(pitch) * Math.cos(yaw)];
    const forward = normalize(eye.map(v => -v)), right = normalize(cross(forward, [0, 1, 0])), up = cross(right, forward);
    const tangent = Math.tan(Math.PI / 7);
    const near = .1, far = Math.max(200, extent * 20);
    device.queue.writeBuffer(uniform, 0, new Float32Array([...eye, 0, ...right, 0, ...up, 0, ...forward, 0,
      tangent * canvas.width / canvas.height, tangent, far / (far - near), -near * far / (far - near)]));
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: [.025, .035, .055, 1], loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
    pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
    if (vertices) { pass.setVertexBuffer(0, vertexBuffer); pass.draw(vertices); }
    pass.end(); device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
  }
  return { update, render, camera, backendInfo: { ...adapter.info.toJSON?.(), vendor: adapter.info.vendor, architecture: adapter.info.architecture,
    device: adapter.info.device, description: adapter.info.description, isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null },
    close() { depth?.destroy(); vertexBuffer?.destroy(); uniform.destroy(); device.destroy(); } };
}
