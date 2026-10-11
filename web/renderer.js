// Built-in WebGPU presentation. Physical coordinates are always read-only.
import { RENDER_SHADER } from './shaders.js';

export function canvasCell(canvas, clientX, clientY, width, height) {
    const box = canvas.getBoundingClientRect();
    const scale = Math.min(box.width / width, box.height / height);
    const x = Math.floor((clientX - box.left - (box.width - width * scale) / 2) / scale);
    const y = Math.floor((clientY - box.top - (box.height - height * scale) / 2) / scale);
    return x < 0 || y < 0 || x >= width || y >= height ? null : [x, y];
}

export async function createMaterialRenderer(canvas, width, height, registry) {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No rendering adapter');
    const device = await adapter.requestDevice();
    const owned = [];
    try {
        const context = canvas.getContext('webgpu');
        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({ device, format, alphaMode: 'opaque' });
        const module = device.createShaderModule({ code: RENDER_SHADER });
        const messages = await module.getCompilationInfo();
        const errors = messages.messages.filter(message => message.type === 'error');
        if (errors.length) throw new Error(errors.map(message => message.message).join('\n'));
        const stateLayout = device.createBindGroupLayout({ entries: [0, 1, 2, 3, 4, 5].map(binding => ({ binding,
            visibility: GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE, buffer: { type: binding === 5 ? 'uniform' : 'read-only-storage' } })) });
        const textureLayout = device.createBindGroupLayout({ entries: [
            { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            ...[3, 4, 5].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: {} })),
            { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'uint' } },
            ...[7, 8].map(binding => ({ binding, visibility: GPUShaderStage.FRAGMENT, texture: {} })),
        ] });
        const emptyLayout = device.createBindGroupLayout({ entries: [] });
        const spanLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: 'write-only', format: 'rgba32uint' } }] });
        const spansPipeline = await device.createComputePipelineAsync({
            layout: device.createPipelineLayout({ bindGroupLayouts: [stateLayout, emptyLayout, spanLayout] }),
            compute: { module, entryPoint: 'cs_water_spans' },
        });
        const emptyGroup = device.createBindGroup({ layout: emptyLayout, entries: [] });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [stateLayout, textureLayout] });
        const pipeline = (entryPoint, targets) => device.createRenderPipelineAsync({ layout,
            vertex: { module, entryPoint: 'vs_main' }, fragment: { module, entryPoint, targets: targets.map(format => ({ format })) },
            primitive: { topology: 'triangle-list' } });
        const [materialPipeline, bloomPipeline, presentPipeline, sourcesPipeline, lightingPipeline, opticsPipeline, densityPipeline, hazePipeline] = await Promise.all([
            pipeline('fs_material', ['rgba16float', 'rgba16float']), pipeline('fs_bloom', ['rgba16float']), pipeline('fs_present', [format]),
            pipeline('fs_sources', ['rgba16float', 'rgba16float', 'rgba16float']), pipeline('fs_lighting', ['rgba16float']),
            pipeline('fs_optics', ['rgba16float', 'rgba16float']),
            pipeline('fs_density', ['rgba16float']), pipeline('fs_haze', ['rgba16float']),
        ]);
        const buffer = (size, uniform = false) => {
            const result = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | (uniform ? GPUBufferUsage.UNIFORM : GPUBufferUsage.STORAGE) });
            owned.push(result); return result;
        };
        const coordinates = [buffer(width * height * 4), buffer(width * height * 4), buffer(width * height * 4)];
        const cold = buffer(registry.coldTable().byteLength), palette = buffer(256 * 16);
        device.queue.writeBuffer(cold, 0, registry.coldTable());
        const colors = new Float32Array(256 * 4);
        for (const id of registry.materialIds) {
            const hex = registry.material(id).color;
            for (let channel = 0; channel < 3; channel++) colors[id * 4 + channel] = parseInt(hex.slice(1 + channel * 2, 3 + channel * 2), 16) / 255;
            colors[id * 4 + 3] = 1;
        }
        device.queue.writeBuffer(palette, 0, colors);
        // Separate uniforms prevent later writes from changing earlier passes.
        const uniforms = Array.from({ length: 3 }, () => buffer(32, true));
        const groups = uniforms.map(uniform => device.createBindGroup({ layout: stateLayout,
            entries: [...coordinates, cold, palette, uniform].map((buffer, binding) => ({ binding, resource: { buffer } })) }));
        const texture = (w, h, format = 'rgba16float') => {
            const result = device.createTexture({ size: [w, h], format, usage: GPUTextureUsage.TEXTURE_BINDING |
                (format === 'rgba32uint' ? GPUTextureUsage.STORAGE_BINDING : GPUTextureUsage.RENDER_ATTACHMENT) });
            owned.push(result); return result;
        };
        // Two pixels per cell for materials; bloom at half a pixel per cell.
        const scene = texture(width * 2, height * 2), emission = texture(width * 2, height * 2);
        const waterScene = texture(width * 2, height * 2), waterEmission = texture(width * 2, height * 2);
        const geometry = texture(width, height, 'rgba32uint');
        const spanGroup = device.createBindGroup({ layout: spanLayout, entries: [{ binding: 0, resource: geometry.createView() }] });
        const blurA = texture(Math.ceil(width / 2), Math.ceil(height / 2)), blurB = texture(Math.ceil(width / 2), Math.ceil(height / 2));
        const lightTiles = texture(Math.ceil(width / 16), Math.ceil(height / 16));
        const positionsA = texture(Math.ceil(width / 16), Math.ceil(height / 16)), positionsB = texture(Math.ceil(width / 16), Math.ceil(height / 16));
        const illumination = texture(width, height), dummy = texture(1, 1);
        const hazeDensity = texture(width, height), hazeVolume = texture(width * 2, height * 2);
        const sampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
        const textures = (source, glow, a = dummy, b = dummy, light = dummy, { density = dummy, volume = dummy } = {}) => device.createBindGroup({ layout: textureLayout, entries: [
            { binding: 0, resource: source.createView() }, { binding: 1, resource: glow.createView() }, { binding: 2, resource: sampler },
            { binding: 3, resource: a.createView() }, { binding: 4, resource: b.createView() }, { binding: 5, resource: light.createView() },
            { binding: 6, resource: geometry.createView() },
            { binding: 7, resource: density.createView() }, { binding: 8, resource: volume.createView() },
        ] });
        const materialTextures = textures(dummy, dummy);
        const bloomSource = textures(emission, emission), bloomIntermediate = textures(blurA, blurA);
        const opticsSource = textures(scene, emission, dummy, dummy, illumination, { volume: hazeVolume });
        const waterBloom = textures(waterEmission, waterEmission), composite = textures(waterScene, blurB), plainComposite = textures(scene, blurB);
        const lightingSources = textures(lightTiles, emission, positionsA, positionsB, dummy, { density: hazeDensity });
        const hazeSources = textures(dummy, dummy, dummy, dummy, illumination, { density: hazeDensity });
        const view = texture => ({ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] });
        let closed = false, lost, validation;
        void device.lost.then(info => { lost = info.message || info.reason; });
        device.addEventListener('uncapturederror', event => { validation = event.error.message; });
        return {
            backendInfo: Object.freeze({ vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device,
                description: adapter.info.description, isFallbackAdapter: adapter.info.isFallbackAdapter }),
            render(field, styled = true, { lighting = true, bloom = true, water = true, reflections = true, refraction = true, haze = true } = {}) {
                if (closed || lost || validation) throw new Error(validation || lost || 'Renderer is closed');
                if (![styled, lighting, bloom, water, reflections, refraction, haze].every(value => typeof value === 'boolean')) throw new Error('Render switches must be boolean');
                if (field.width !== width || field.height !== height || field.registry.hash !== registry.hash) throw new Error('Renderer field contract differs');
                // Public copies, with no extra GPU readback or JSON conversion.
                [field.grid, field.energyQ, field.structure].forEach((values, i) => device.queue.writeBuffer(coordinates[i], 0, values));
                uniforms.forEach((uniform, i) => {
                    const data = new ArrayBuffer(32), ints = new Uint32Array(data), floats = new Float32Array(data);
                    ints.set([width, height, field.tick % 65536, styled ? 1 | (lighting ? 2 : 0) | (bloom ? 4 : 0) |
                        (water ? 8 : 0) | (reflections ? 16 : 0) | (refraction ? 32 : 0) | (haze ? 64 : 0) : 0]);
                    floats.set([canvas.width, canvas.height, i === 1 ? 4 : 0, i === 2 ? 1 : 0], 4);
                    device.queue.writeBuffer(uniform, 0, data);
                });
                const encoder = device.createCommandEncoder();
                const draw = (pipeline, colors, state, textureGroup) => {
                    const pass = encoder.beginRenderPass({ colorAttachments: colors });
                    pass.setPipeline(pipeline); pass.setBindGroup(0, state); pass.setBindGroup(1, textureGroup); pass.draw(3); pass.end();
                };
                draw(materialPipeline, [view(scene), view(emission)], groups[0], materialTextures);
                if (styled && haze) draw(densityPipeline, [view(hazeDensity)], groups[0], materialTextures);
                if (styled && lighting) {
                    draw(sourcesPipeline, [view(lightTiles), view(positionsA), view(positionsB)], groups[0], bloomSource);
                    draw(lightingPipeline, [view(illumination)], groups[0], lightingSources);
                }
                if (styled && haze) draw(hazePipeline, [view(hazeVolume)], groups[0], hazeSources);
                if (styled && water) {
                    const pass = encoder.beginComputePass();
                    pass.setPipeline(spansPipeline); pass.setBindGroup(0, groups[0]); pass.setBindGroup(1, emptyGroup); pass.setBindGroup(2, spanGroup);
                    pass.dispatchWorkgroups(Math.ceil(width / 64)); pass.end();
                }
                if (styled) draw(opticsPipeline, [view(waterScene), view(waterEmission)], groups[0], opticsSource);
                if (styled && bloom) {
                    draw(bloomPipeline, [view(blurA)], groups[1], waterBloom);
                    draw(bloomPipeline, [view(blurB)], groups[2], bloomIntermediate);
                }
                draw(presentPipeline, [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }], groups[0], styled ? composite : plainComposite);
                device.queue.submit([encoder.finish()]);
            },
            async completed() { await device.queue.onSubmittedWorkDone(); if (lost || validation) throw new Error(validation || lost); },
            close() { if (!closed) { closed = true; context.unconfigure(); owned.forEach(resource => resource.destroy()); device.destroy(); } },
        };
    } catch (error) { owned.forEach(resource => resource.destroy()); device.destroy(); throw error; }
}
