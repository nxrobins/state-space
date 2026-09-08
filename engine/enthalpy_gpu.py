"""Isolated native GPU harness for the C3 enthalpy law, not the production SDK."""

from pathlib import Path

import numpy as np
import wgpu

from engine.contracts import MAX_TICK, checked_integer, validate_dimensions
from engine.enthalpy import Thermodynamics


PASSES = (("heat_x0", 0, 0, 0), ("heat_x1", 0, 0, 1),
          ("heat_y0", 0, 1, 0), ("heat_y1", 0, 1, 1),
          ("phase", 1, 0, 0), ("combustion", 2, 0, 0))


class EnthalpyGPU:
    def __init__(self, shader_source: str | None = None):
        self.adapter = wgpu.gpu.request_adapter_sync(power_preference="high-performance")
        if self.adapter is None:
            raise RuntimeError("No GPU adapter available for enthalpy conformance")
        self.device = self.adapter.request_device_sync()
        self.source = shader_source if shader_source is not None else Path(__file__).with_name("shaders").joinpath("enthalpy.wgsl").read_text(encoding="utf-8")
        if shader_source is None:
            self.source = Path(__file__).with_name("shaders").joinpath("enthalpy_law.wgsl").read_text(encoding="utf-8") + "\n" + self.source
        self.shader = self.device.create_shader_module(code=self.source)
        self.layout = self.device.create_bind_group_layout(entries=[
            {"binding": 0, "visibility": wgpu.ShaderStage.COMPUTE, "buffer": {"type": "read-only-storage"}},
            {"binding": 1, "visibility": wgpu.ShaderStage.COMPUTE, "buffer": {"type": "storage"}},
            {"binding": 2, "visibility": wgpu.ShaderStage.COMPUTE, "buffer": {"type": "read-only-storage"}},
        ])
        self.pipeline_layout = self.device.create_pipeline_layout(bind_group_layouts=[self.layout])
        self.pipelines = {}

    def run(self, model: Thermodynamics, materials, energies, width: int, height: int, ticks: int,
            trace: bool = False, pass_ids: tuple[str, ...] | None = None) -> dict:
        width, height = validate_dimensions(width, height)
        materials, energies = model.validate_state(materials, energies, width, height)
        ticks = checked_integer(ticks, 0, MAX_TICK, "ticks")
        if type(trace) is not bool:
            raise ValueError("trace must be boolean")
        selected = tuple(spec for spec in PASSES if pass_ids is None or spec[0] in pass_ids)
        if pass_ids is not None and tuple(spec[0] for spec in selected) != pass_ids:
            raise ValueError("Pass selection must use unique, known passes in schedule order")
        data = np.column_stack((materials, energies)).astype(np.uint32)
        if data.nbytes > self.device.limits["max-storage-buffer-binding-size"]:
            raise ValueError("Enthalpy state exceeds the device storage limit")
        storage = wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC
        buffers = [self.device.create_buffer_with_data(data=data, usage=storage),
                   self.device.create_buffer(size=data.nbytes, usage=storage)]
        properties = self.device.create_buffer_with_data(data=np.array(model.gpu_table(), dtype=np.uint32), usage=wgpu.BufferUsage.STORAGE)
        groups = [self.device.create_bind_group(layout=self.layout, entries=[
            {"binding": 0, "resource": {"buffer": buffers[i]}},
            {"binding": 1, "resource": {"buffer": buffers[1 - i]}},
            {"binding": 2, "resource": {"buffer": properties}},
        ]) for i in (0, 1)]
        for name, op, axis, parity in selected:
            key = (width, height, name)
            if key not in self.pipelines:
                self.pipelines[key] = self.device.create_compute_pipeline(layout=self.pipeline_layout, compute={
                    "module": self.shader, "entry_point": "tick",
                    "constants": {"GRID_WIDTH": width, "GRID_HEIGHT": height, "OP": op, "AXIS": axis, "PARITY": parity}})
        current = 0
        traces = []

        def read():
            array = np.frombuffer(self.device.queue.read_buffer(buffers[current]), dtype=np.uint32).reshape(-1, 2)
            return tuple(int(v) for v in array[:, 0]), tuple(int(v) for v in array[:, 1])

        try:
            for tick in range(ticks):
                encoder = self.device.create_command_encoder()
                for name, _, _, _ in selected:
                    compute = encoder.begin_compute_pass()
                    compute.set_pipeline(self.pipelines[(width, height, name)])
                    compute.set_bind_group(0, groups[current])
                    compute.dispatch_workgroups((width * height + 63) // 64)
                    compute.end()
                    current = 1 - current
                    if trace:
                        self.device.queue.submit([encoder.finish()])
                        traces.append((tick, name, *read()))
                        encoder = self.device.create_command_encoder()
                self.device.queue.submit([encoder.finish()])
            final_materials, final_energies = read()
            return {"materials": final_materials, "energyQ": final_energies, "traces": traces}
        finally:
            for buffer in (*buffers, properties):
                buffer.destroy()
