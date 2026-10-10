"""Native offscreen material rendering; shares WGSL with the browser renderer.

Owns a GPU device and private presentation resources. Fields are consumed through
public copies; rendering never writes to a field or schedules physical ticks.
"""
import struct

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
        try:
            self._initialize()
        except Exception:
            self.close()
            raise

    def _initialize(self):
        device = self.device
        module = device.create_shader_module(code=shader_source('material_render.wgsl'))
        state_layout = device.create_bind_group_layout(entries=[{
            'binding': binding, 'visibility': wgpu.ShaderStage.FRAGMENT,
            'buffer': {'type': 'uniform' if binding == 5 else 'read-only-storage'},
        } for binding in range(6)])
        texture_layout = device.create_bind_group_layout(entries=[
            {'binding': 0, 'visibility': wgpu.ShaderStage.FRAGMENT, 'texture': {}},
            {'binding': 1, 'visibility': wgpu.ShaderStage.FRAGMENT, 'texture': {}},
            {'binding': 2, 'visibility': wgpu.ShaderStage.FRAGMENT, 'sampler': {}},
        ])
        layout = device.create_pipeline_layout(bind_group_layouts=[state_layout, texture_layout])

        def pipeline(entry, formats):
            return device.create_render_pipeline(layout=layout,
                vertex={'module': module, 'entry_point': 'vs_main', 'buffers': []},
                fragment={'module': module, 'entry_point': entry, 'targets': [{'format': f} for f in formats]},
                primitive={'topology': 'triangle-list'})

        self._material = pipeline('fs_material', ['rgba16float', 'rgba16float'])
        self._bloom = pipeline('fs_bloom', ['rgba16float'])
        self._present = pipeline('fs_present', ['rgba8unorm'])

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
        self._groups = [device.create_bind_group(layout=state_layout, entries=[
            {'binding': i, 'resource': {'buffer': resource}} for i, resource in enumerate([*self._coordinates, cold, palette, uniform])
        ]) for uniform in self._uniforms]

        def texture(width, height, format='rgba16float', copy=False):
            resource = device.create_texture(size=(width, height, 1), format=format,
                usage=wgpu.TextureUsage.RENDER_ATTACHMENT | wgpu.TextureUsage.TEXTURE_BINDING |
                (wgpu.TextureUsage.COPY_SRC if copy else 0))
            self._owned.append(resource)
            return resource

        self._scene = texture(self.width * 2, self.height * 2)
        self._emission = texture(self.width * 2, self.height * 2)
        self._blur_a = texture((self.width + 1) // 2, (self.height + 1) // 2)
        self._blur_b = texture((self.width + 1) // 2, (self.height + 1) // 2)
        self._output = texture(*self.output_size, format='rgba8unorm', copy=True)
        sampler = device.create_sampler(min_filter='linear', mag_filter='linear')

        def textures(source, glow):
            return device.create_bind_group(layout=texture_layout, entries=[
                {'binding': 0, 'resource': source.create_view()}, {'binding': 1, 'resource': glow.create_view()},
                {'binding': 2, 'resource': sampler},
            ])

        self._texture_groups = [textures(self._blur_b, self._blur_b), textures(self._emission, self._emission),
                               textures(self._blur_a, self._blur_a), textures(self._scene, self._blur_b)]

    def render(self, field, *, styled=True):
        if self._closed:
            raise RuntimeError('Renderer is closed')
        if not isinstance(styled, bool):
            raise ValueError('styled must be boolean')
        if (field.width, field.height, field.registry.hash) != (self.width, self.height, self.registry.hash):
            raise ValueError('Renderer field contract differs')
        for buffer, values in zip(self._coordinates, (field.grid, field.energy_q, field.structure)):
            self.device.queue.write_buffer(buffer, 0, values)
        for i, buffer in enumerate(self._uniforms):
            self.device.queue.write_buffer(buffer, 0, struct.pack('<4I4f', self.width, self.height, field.tick % 65536,
                int(styled), *self.output_size, 4 if i == 1 else 0, 1 if i == 2 else 0))
        encoder = self.device.create_command_encoder()

        def draw(pipeline, targets, group, textures):
            render_pass = encoder.begin_render_pass(color_attachments=[{
                'view': target.create_view(), 'load_op': 'clear', 'store_op': 'store', 'clear_value': (0, 0, 0, 1),
            } for target in targets])
            render_pass.set_pipeline(pipeline)
            render_pass.set_bind_group(0, group)
            render_pass.set_bind_group(1, textures)
            render_pass.draw(3)
            render_pass.end()

        draw(self._material, [self._scene, self._emission], self._groups[0], self._texture_groups[0])
        if styled:
            draw(self._bloom, [self._blur_a], self._groups[1], self._texture_groups[1])
            draw(self._bloom, [self._blur_b], self._groups[2], self._texture_groups[2])
        draw(self._present, [self._output], self._groups[0], self._texture_groups[3])
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
            for resource in self._owned:
                resource.destroy()
            self.device.destroy()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.close()
