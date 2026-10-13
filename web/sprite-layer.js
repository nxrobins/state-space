// Small optional game overlay, submitted on the material renderer's GPU queue.
// Sprites use field coordinates and never enter authoritative material state.
export function createSpriteLayer(device, format) {
    const data = new Float32Array(64 * 8), viewport = new Float32Array(4);
    const buffer = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    const dimensions = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const module = device.createShaderModule({ code: `
struct Sprite { bounds: vec4f, color: vec4f }
@group(0) @binding(0) var<storage, read> sprites: array<Sprite>;
@group(0) @binding(1) var<uniform> sizes: vec4f;
struct Vertex { @builtin(position) position: vec4f, @location(0) color: vec4f }
@vertex fn vs(@builtin(vertex_index) index: u32, @builtin(instance_index) instance: u32) -> Vertex {
    let corners = array<vec2f, 6>(vec2f(0,0), vec2f(1,0), vec2f(0,1), vec2f(0,1), vec2f(1,0), vec2f(1,1));
    let sprite = sprites[instance];
    let scale = min(sizes.z / sizes.x, sizes.w / sizes.y);
    let pixel = (sizes.zw - sizes.xy * scale) * 0.5 + (sprite.bounds.xy + corners[index] * sprite.bounds.zw) * scale;
    return Vertex(vec4f(pixel.x / sizes.z * 2.0 - 1.0, 1.0 - pixel.y / sizes.w * 2.0, 0, 1), sprite.color);
}
@fragment fn fs(vertex: Vertex) -> @location(0) vec4f { return vertex.color; }
` });
    const pipeline = device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format, blend: {
            color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' },
            alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' },
        } }] }, primitive: { topology: 'triangle-list' } });
    const group = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer } }, { binding: 1, resource: { buffer: dimensions } },
    ] });
    return {
        draw(encoder, view, sprites, width, height, outputWidth, outputHeight) {
            if (!Array.isArray(sprites) || sprites.length > 64) throw new Error('At most 64 rectangle sprites are supported');
            if (!sprites.length) return;
            for (let i = 0; i < sprites.length; i++) {
                const sprite = sprites[i];
                if (!Array.isArray(sprite) || sprite.length !== 8 || !sprite.every(Number.isFinite) || sprite[2] < 0 || sprite[3] < 0) throw new Error('Invalid sprite');
                data.set(sprite, i * 8);
            }
            viewport.set([width, height, outputWidth, outputHeight]);
            device.queue.writeBuffer(buffer, 0, data, 0, sprites.length * 8);
            device.queue.writeBuffer(dimensions, 0, viewport);
            const pass = encoder.beginRenderPass({ colorAttachments: [{ view, loadOp: 'load', storeOp: 'store' }] });
            pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.draw(6, sprites.length); pass.end();
        },
        close() { buffer.destroy(); dimensions.destroy(); },
    };
}
