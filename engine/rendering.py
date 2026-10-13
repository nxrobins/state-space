"""Native offscreen material rendering; shares WGSL with the browser renderer.

Owns a GPU device and private presentation resources. Fields are consumed through
public copies; rendering never writes to a field or schedules physical ticks.
"""
import struct
import gc
import weakref

import numpy as np
import wgpu

from engine.contracts import validate_dimensions
from engine.registry import DEFAULT_REGISTRY, MaterialRegistry
from engine.resources import shader_source


class MaterialRenderer:
    def __init__(self, width, height, *, registry=DEFAULT_REGISTRY, output_size=(1920, 1080)):
        self.width, self.height = validate_dimensions(width, height)
        self.output_size = validate_dimensions(*output_size)
        if not isinstance(registry, MaterialRegistry):
            raise ValueError('Renderer requires a validated registry')
        self.registry = registry
        self._owned = []
        self._closed = False
        adapter = wgpu.gpu.request_adapter_sync(power_preference='high-performance')
        if adapter is None:
            raise RuntimeError('No rendering adapter')
        self.adapter_info = dict(adapter.info)
        self.device = adapter.request_device_sync()
        self._gpu_attributes = set()
        try:
            self._initialize()
        except Exception:
            self._gpu_attributes = set(vars(self)) - {'width', 'height', 'output_size', 'registry', '_closed', 'adapter_info', '_gpu_attributes'}
            self.close()
            raise
        self._gpu_attributes = set(vars(self)) - {'width', 'height', 'output_size', 'registry', '_closed', 'adapter_info', '_gpu_attributes'}

    def _initialize(self):
        device = self.device
        module = device.create_shader_module(code=shader_source('material_render.wgsl'))
        state_layout = device.create_bind_group_layout(entries=[{
            'binding': binding, 'visibility': wgpu.ShaderStage.FRAGMENT | wgpu.ShaderStage.COMPUTE,
            'buffer': {'type': 'uniform' if binding == 5 else 'read-only-storage'},
        } for binding in range(6)])
        texture_layout = device.create_bind_group_layout(entries=[
            {'binding': 0, 'visibility': wgpu.ShaderStage.FRAGMENT, 'texture': {}},
            {'binding': 1, 'visibility': wgpu.ShaderStage.FRAGMENT, 'texture': {}},
            {'binding': 2, 'visibility': wgpu.ShaderStage.FRAGMENT, 'sampler': {}},
            *[{'binding': i, 'visibility': wgpu.ShaderStage.FRAGMENT, 'texture': {}} for i in (3, 4, 5)],
            {'binding': 6, 'visibility': wgpu.ShaderStage.FRAGMENT, 'texture': {'sample_type': 'uint'}},
            *[{'binding': i, 'visibility': wgpu.ShaderStage.FRAGMENT, 'texture': {}} for i in (7, 8, 9)],
        ])
        empty_layout = device.create_bind_group_layout(entries=[])
        span_layout = device.create_bind_group_layout(entries=[{'binding': 0, 'visibility': wgpu.ShaderStage.COMPUTE,
            'storage_texture': {'access': 'write-only', 'format': 'rgba32uint'}}])
        self._spans = device.create_compute_pipeline(
            layout=device.create_pipeline_layout(bind_group_layouts=[state_layout, empty_layout, span_layout]),
            compute={'module': module, 'entry_point': 'cs_water_spans'})
        self._empty_group = device.create_bind_group(layout=empty_layout, entries=[])
        layout = device.create_pipeline_layout(bind_group_layouts=[state_layout, texture_layout])

        def pipeline(entry, formats):
            return device.create_render_pipeline(layout=layout,
                vertex={'module': module, 'entry_point': 'vs_main', 'buffers': []},
                fragment={'module': module, 'entry_point': entry, 'targets': [{'format': f} for f in formats]},
                primitive={'topology': 'triangle-list'})

        self._material = pipeline('fs_material', ['rgba16float', 'rgba16float'])
        self._bloom = pipeline('fs_bloom', ['rgba16float'])
        self._present = pipeline('fs_present', ['rgba8unorm'])
        self._sources = pipeline('fs_sources', ['rgba16float'] * 3)
        self._lighting = pipeline('fs_lighting', ['rgba16float'])
        self._optics = pipeline('fs_optics', ['rgba16float'] * 2)
        self._density = pipeline('fs_density', ['rgba16float'])
        self._haze = pipeline('fs_haze', ['rgba16float'])
        self._heat = pipeline('fs_heat', ['rgba16float'])

        def buffer(size, uniform=False):
            resource = device.create_buffer(size=size, usage=wgpu.BufferUsage.COPY_DST |
                (wgpu.BufferUsage.UNIFORM if uniform else wgpu.BufferUsage.STORAGE))
            self._owned.append(resource)
            return resource

        self._coordinates = [buffer(self.width * self.height * 4) for _ in range(3)]
        cold_data = self.registry.cold_table()
        cold, palette = buffer(cold_data.nbytes), buffer(256 * 16)
        device.queue.write_buffer(cold, 0, cold_data)
        colors = np.zeros((256, 4), dtype=np.float32)
        for record in self.registry.to_dict()['materials']:
            colors[record['id']] = [*[int(record['color'][i:i+2], 16) / 255 for i in (1, 3, 5)], 1]
        device.queue.write_buffer(palette, 0, colors)
        self._uniforms = [buffer(32, True) for _ in range(3)]
        self._uniform_data = [bytearray(32) for _ in range(3)]
        self._attachments = {}
        self._groups = [device.create_bind_group(layout=state_layout, entries=[
            {'binding': i, 'resource': {'buffer': resource}} for i, resource in enumerate([*self._coordinates, cold, palette, uniform])
        ]) for uniform in self._uniforms]

        def texture(width, height, format='rgba16float', copy=False):
            resource = device.create_texture(size=(width, height, 1), format=format,
                usage=wgpu.TextureUsage.TEXTURE_BINDING |
                (wgpu.TextureUsage.STORAGE_BINDING if format == 'rgba32uint' else wgpu.TextureUsage.RENDER_ATTACHMENT) |
                (wgpu.TextureUsage.COPY_SRC if copy else 0))
            self._owned.append(resource)
            return resource

        self._scene = texture(self.width * 2, self.height * 2)
        self._emission = texture(self.width * 2, self.height * 2)
        self._water_scene = texture(self.width * 2, self.height * 2)
        self._water_emission = texture(self.width * 2, self.height * 2)
        geometry = texture(self.width, self.height, format='rgba32uint')
        self._span_group = device.create_bind_group(layout=span_layout, entries=[{'binding': 0, 'resource': geometry.create_view()}])
        self._blur_a = texture((self.width + 1) // 2, (self.height + 1) // 2)
        self._blur_b = texture((self.width + 1) // 2, (self.height + 1) // 2)
        tiles = ((self.width + 15) // 16, (self.height + 15) // 16)
        self._light_tiles = texture(*tiles)
        self._positions_a = texture(*tiles)
        self._positions_b = texture(*tiles)
        self._illumination = texture(self.width, self.height)
        self._haze_density = texture(self.width, self.height)
        self._haze_volume = texture(self.width * 2, self.height * 2)
        self._heat_haze = texture(self.width, self.height)
        dummy = texture(1, 1)
        self._output = texture(*self.output_size, format='rgba8unorm', copy=True)
        sampler = device.create_sampler(min_filter='linear', mag_filter='linear')

        def textures(source, glow, a=dummy, b=dummy, light=dummy, density=dummy, volume=dummy, heat=dummy):
            return device.create_bind_group(layout=texture_layout, entries=[
                {'binding': 0, 'resource': source.create_view()}, {'binding': 1, 'resource': glow.create_view()},
                {'binding': 2, 'resource': sampler},
                {'binding': 3, 'resource': a.create_view()}, {'binding': 4, 'resource': b.create_view()},
                {'binding': 5, 'resource': light.create_view()},
                {'binding': 6, 'resource': geometry.create_view()},
                {'binding': 7, 'resource': density.create_view()}, {'binding': 8, 'resource': volume.create_view()},
                {'binding': 9, 'resource': heat.create_view()},
            ])

        self._texture_groups = [textures(dummy, dummy), textures(self._emission, self._emission),
                               textures(self._blur_a, self._blur_a), textures(self._water_scene, self._blur_b, heat=self._heat_haze),
                               textures(self._light_tiles, self._emission, self._positions_a, self._positions_b, density=self._haze_density),
                               textures(self._scene, self._emission, light=self._illumination, volume=self._haze_volume),
                               textures(self._water_emission, self._water_emission), textures(self._scene, self._blur_b),
                               textures(dummy, dummy, light=self._illumination, density=self._haze_density)]

    def render(self, field, *, styled=True, lighting=True, bloom=True, water=True, reflections=True, refraction=True, haze=True, distortion=True):
        if self._closed:
            raise RuntimeError('Renderer is closed')
        if not all(isinstance(value, bool) for value in (styled, lighting, bloom, water, reflections, refraction, haze, distortion)):
            raise ValueError('Render switches must be boolean')
        if (field.width, field.height, field.registry.hash) != (self.width, self.height, self.registry.hash):
            raise ValueError('Renderer field contract differs')
        for buffer, values in zip(self._coordinates, (field.grid, field.energy_q, field.structure)):
            self.device.queue.write_buffer(buffer, 0, values)
        for i, buffer in enumerate(self._uniforms):
            struct.pack_into('<4I4f', self._uniform_data[i], 0, self.width, self.height, field.tick % 65536,
                (1 | (2 if lighting else 0) | (4 if bloom else 0) | (8 if water else 0) |
                 (16 if reflections else 0) | (32 if refraction else 0) | (64 if haze else 0) | (128 if distortion else 0)) if styled else 0,
                *self.output_size, 4 if i == 1 else 0, 1 if i == 2 else 0)
            self.device.queue.write_buffer(buffer, 0, self._uniform_data[i])
        encoder = self.device.create_command_encoder()

        def draw(pipeline, targets, group, textures):
            for target in targets:
                if target not in self._attachments:
                    self._attachments[target] = {'view': target.create_view(), 'load_op': 'clear',
                                                 'store_op': 'store', 'clear_value': (0, 0, 0, 1)}
            render_pass = encoder.begin_render_pass(color_attachments=[self._attachments[target] for target in targets])
            render_pass.set_pipeline(pipeline)
            render_pass.set_bind_group(0, group)
            render_pass.set_bind_group(1, textures)
            render_pass.draw(3)
            render_pass.end()

        draw(self._material, [self._scene, self._emission], self._groups[0], self._texture_groups[0])
        if styled and haze:
            draw(self._density, [self._haze_density], self._groups[0], self._texture_groups[0])
        if styled and lighting:
            draw(self._sources, [self._light_tiles, self._positions_a, self._positions_b], self._groups[0], self._texture_groups[1])
            draw(self._lighting, [self._illumination], self._groups[0], self._texture_groups[4])
        if styled and haze:
            draw(self._haze, [self._haze_volume], self._groups[0], self._texture_groups[8])
        if styled and water:
            compute_pass = encoder.begin_compute_pass()
            compute_pass.set_pipeline(self._spans)
            compute_pass.set_bind_group(0, self._groups[0])
            compute_pass.set_bind_group(1, self._empty_group)
            compute_pass.set_bind_group(2, self._span_group)
            compute_pass.dispatch_workgroups((self.width + 63) // 64)
            compute_pass.end()
        if styled:
            draw(self._optics, [self._water_scene, self._water_emission], self._groups[0], self._texture_groups[5])
        if styled and bloom:
            draw(self._bloom, [self._blur_a], self._groups[1], self._texture_groups[6])
            draw(self._bloom, [self._blur_b], self._groups[2], self._texture_groups[2])
        if styled and distortion:
            draw(self._heat, [self._heat_haze], self._groups[0], self._texture_groups[0])
        draw(self._present, [self._output], self._groups[0], self._texture_groups[3 if styled else 7])
        self.device.queue.submit([encoder.finish()])
        self.device.queue.on_submitted_work_done_sync()

    def read_pixels(self):
        """RGBA8 capture; explicit readback is outside the ordinary frame path."""
        if self._closed:
            raise RuntimeError('Renderer is closed')
        width, height = self.output_size
        return bytes(self.device.queue.read_texture({'texture': self._output},
            {'bytes_per_row': width * 4, 'rows_per_image': height}, (width, height, 1)))

    def close(self):
        if not self._closed:
            self._closed = True
            while self._owned:
                self._owned.pop().destroy()
            retired = weakref.ref(self.device)
            self.device.destroy()
            for name in self._gpu_attributes:
                delattr(self, name)
            # Device/queue cycles otherwise defer native driver destruction to
            # an arbitrary later GC, producing large stalls in unrelated frames.
            if retired() is not None:
                gc.collect()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()
