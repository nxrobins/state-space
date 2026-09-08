"""Native GPU transport probe for C6, ahead of the production ABI migration."""

from contextlib import ExitStack

import numpy as np
import wgpu

from engine.resources import shader_source
from engine.structure import StructuralPlan
from engine.validation import validate_dimensions, validate_packed


class StructuralGPUProbe:
    def __init__(self):
        self.adapter = wgpu.gpu.request_adapter_sync(power_preference="high-performance")
        if self.adapter is None:
            raise RuntimeError("No GPU adapter for structural transport")
        self.device = self.adapter.request_device_sync()
        self._closed = False

    def close(self):
        if not self._closed:
            self._closed = True
            self.device.destroy()

    def __enter__(self):
        if self._closed:
            raise RuntimeError("Structural GPU probe is closed")
        return self

    def __exit__(self, *_exc):
        self.close()

    def apply(self, plan: StructuralPlan, cells, energy, structure, width, height, *, source: str | None = None):
        if self._closed:
            raise RuntimeError("Structural GPU probe is closed")
        width, height = validate_dimensions(width, height)
        cells = validate_packed(cells, width * height)
        energy = validate_packed(energy, len(cells), "energyQ")
        structure = validate_packed(structure, len(cells), "structure")
        if not isinstance(plan, StructuralPlan):
            raise ValueError("GPU transport requires a computed StructuralPlan")
        plan.apply(cells, energy, structure, width=width, height=height)  # Reject stale state/geometry before GPU work.
        bytes_per_field = len(cells) * 4
        if bytes_per_field * 2 > self.device.limits["max-storage-buffer-binding-size"]:
            raise ValueError("Structural plan exceeds the storage binding limit")
        if max((width + 15) // 16, (height + 15) // 16) > self.device.limits["max-compute-workgroups-per-dimension"]:
            raise ValueError("Structural plan exceeds the dispatch limit")
        source = shader_source("structure_apply.wgsl") if source is None else source
        module = self.device.create_shader_module(code=source)
        layout = self.device.create_bind_group_layout(entries=[
            {"binding": binding, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": "storage" if binding in (1, 4, 6) else "read-only-storage"}}
            for binding in range(8)])
        pipeline = self.device.create_compute_pipeline(layout=self.device.create_pipeline_layout(bind_group_layouts=[layout]),
                    compute={"module": module, "entry_point": "tick", "constants": {"GRID_WIDTH": width, "GRID_HEIGHT": height}})
        with ExitStack() as resources:
            def keep(buffer):
                resources.callback(buffer.destroy)
                return buffer
            inputs = [cells, None, np.zeros(1, dtype=np.uint32), energy, None, structure, None,
                      np.column_stack((plan.sources, plan.structure)).astype(np.uint32)]
            buffers = []
            for data in inputs:
                if data is None:
                    buffers.append(keep(self.device.create_buffer(size=bytes_per_field, usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC)))
                else:
                    buffers.append(keep(self.device.create_buffer_with_data(data=data, usage=wgpu.BufferUsage.STORAGE)))
            group = self.device.create_bind_group(layout=layout, entries=[
                {"binding": binding, "resource": {"buffer": buffer}} for binding, buffer in enumerate(buffers)])
            encoder = self.device.create_command_encoder()
            compute = encoder.begin_compute_pass()
            compute.set_pipeline(pipeline)
            compute.set_bind_group(0, group)
            compute.dispatch_workgroups((width + 15) // 16, (height + 15) // 16)
            compute.end()
            self.device.queue.submit([encoder.finish()])
            # Complete all three readbacks before returning; no submit-only result.
            return tuple(np.frombuffer(self.device.queue.read_buffer(buffers[binding]), dtype=np.uint32).copy()
                         for binding in (1, 4, 6))
