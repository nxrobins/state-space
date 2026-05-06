"""
GPUTrialRunner: Compile WGSL shader → create buffers → dispatch compute → readback → measure fitness.

This replaces the subprocess-based qat_train.py runner from autoresearch.
Trials run in-process via wgpu-native, completing in 1-10 seconds.
"""

import time
import numpy as np
import wgpu
from pathlib import Path
from typing import Optional


class GPUTrialRunner:
    """Manages wgpu device lifecycle and runs compute shader trials."""

    def __init__(self):
        self.adapter = wgpu.gpu.request_adapter_sync(power_preference="high-performance")
        if self.adapter is None:
            raise RuntimeError("No GPU adapter found")
        self.device = self.adapter.request_device_sync()
        self._shader_defs = self._load_bitmask_defs()

    def _load_bitmask_defs(self) -> str:
        """Load the shared bitmask definitions WGSL."""
        defs_path = Path(__file__).parent / "shaders" / "bitmask_defs.wgsl"
        return defs_path.read_text()

    def compile_shader(self, wgsl_code: str) -> wgpu.GPUShaderModule:
        """Compile WGSL source into a shader module. Prepends bitmask_defs."""
        full_code = self._shader_defs + "\n\n" + wgsl_code
        return self.device.create_shader_module(code=full_code)

    def create_storage_buffer(self, data: np.ndarray) -> wgpu.GPUBuffer:
        """Create a GPU storage buffer initialized with numpy data."""
        return self.device.create_buffer_with_data(
            data=data.tobytes(),
            usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC,
        )

    def create_empty_storage_buffer(self, size_bytes: int) -> wgpu.GPUBuffer:
        """Create an uninitialized GPU storage buffer."""
        return self.device.create_buffer(
            size=size_bytes,
            usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC,
        )

    def read_buffer(self, buf: wgpu.GPUBuffer, dtype=np.uint32) -> np.ndarray:
        """Read a GPU buffer back to CPU as a numpy array."""
        return np.frombuffer(self.device.queue.read_buffer(buf), dtype=dtype)

    def run_pack_unpack_trial(
        self,
        shader_code: str,
        test_data: np.ndarray,
        n_timing_runs: int = 10,
    ) -> dict:
        """
        Run a Phase 1a pack/unpack trial.

        Args:
            shader_code: WGSL with pack_voxel, unpack_voxel, and a main entry point
                         that reads from input[], unpacks, repacks, writes to output[].
            test_data: uint32 array of packed voxel states to test.
            n_timing_runs: Number of timing iterations for performance measurement.

        Returns:
            dict with:
                - roundtrip_errors: int (count of mismatches)
                - cycle_time_us: float (mean microseconds per voxel)
                - total_time_ms: float (total dispatch time in ms)
                - diverged: bool (True if shader compilation failed)
        """
        N = len(test_data)

        # Try to compile
        try:
            shader = self.compile_shader(shader_code)
        except Exception as e:
            return {
                "roundtrip_errors": N,
                "cycle_time_us": float("inf"),
                "total_time_ms": float("inf"),
                "diverged": True,
                "error": str(e),
            }

        # Create buffers
        input_buf = self.create_storage_buffer(test_data.astype(np.uint32))
        output_buf = self.create_empty_storage_buffer(N * 4)

        # Create pipeline
        bind_group_layout = self.device.create_bind_group_layout(
            entries=[
                {
                    "binding": 0,
                    "visibility": wgpu.ShaderStage.COMPUTE,
                    "buffer": {"type": wgpu.BufferBindingType.read_only_storage},
                },
                {
                    "binding": 1,
                    "visibility": wgpu.ShaderStage.COMPUTE,
                    "buffer": {"type": wgpu.BufferBindingType.storage},
                },
            ]
        )
        pipeline_layout = self.device.create_pipeline_layout(
            bind_group_layouts=[bind_group_layout]
        )

        try:
            pipeline = self.device.create_compute_pipeline(
                layout=pipeline_layout,
                compute={"module": shader, "entry_point": "main"},
            )
        except Exception as e:
            return {
                "roundtrip_errors": N,
                "cycle_time_us": float("inf"),
                "total_time_ms": float("inf"),
                "diverged": True,
                "error": f"Pipeline creation failed: {e}",
            }

        bind_group = self.device.create_bind_group(
            layout=bind_group_layout,
            entries=[
                {"binding": 0, "resource": {"buffer": input_buf, "offset": 0, "size": input_buf.size}},
                {"binding": 1, "resource": {"buffer": output_buf, "offset": 0, "size": output_buf.size}},
            ],
        )

        workgroups = (N + 63) // 64

        # Warmup dispatch
        encoder = self.device.create_command_encoder()
        compute_pass = encoder.begin_compute_pass()
        compute_pass.set_pipeline(pipeline)
        compute_pass.set_bind_group(0, bind_group)
        compute_pass.dispatch_workgroups(workgroups)
        compute_pass.end()
        self.device.queue.submit([encoder.finish()])

        # Read correctness result
        result = self.read_buffer(output_buf)
        roundtrip_errors = int(np.sum(result != test_data.astype(np.uint32)))

        # Timing runs
        times = []
        for _ in range(n_timing_runs):
            t0 = time.perf_counter()
            encoder = self.device.create_command_encoder()
            compute_pass = encoder.begin_compute_pass()
            compute_pass.set_pipeline(pipeline)
            compute_pass.set_bind_group(0, bind_group)
            compute_pass.dispatch_workgroups(workgroups)
            compute_pass.end()
            self.device.queue.submit([encoder.finish()])
            # Force GPU sync by reading a tiny amount
            _ = self.device.queue.read_buffer(output_buf, size=4)
            t1 = time.perf_counter()
            times.append(t1 - t0)

        mean_time_s = np.mean(times)
        cycle_time_us = (mean_time_s / N) * 1_000_000

        return {
            "roundtrip_errors": roundtrip_errors,
            "cycle_time_us": float(cycle_time_us),
            "total_time_ms": float(mean_time_s * 1000),
            "diverged": False,
        }

    def run_sync_trial(
        self,
        shader_code: str,
        initial_grid: np.ndarray,
        grid_width: int,
        grid_height: int,
        n_ticks: int = 10,
    ) -> dict:
        """
        Run a Phase 1b synchronization trial.

        Tests matter conservation and determinism over n_ticks of simulation.

        Args:
            shader_code: WGSL with simulation tick logic (read→write or multi-pass).
            initial_grid: uint32 array of shape (grid_height * grid_width,).
            grid_width: Width of the simulation grid.
            grid_height: Height of the simulation grid.
            n_ticks: Number of simulation ticks to run.

        Returns:
            dict with:
                - matter_conservation_error: float (total material count delta)
                - determinism_score: float (1.0 = deterministic)
                - tick_time_ms: float (mean ms per tick)
                - diverged: bool
        """
        N = grid_width * grid_height

        try:
            shader = self.compile_shader(shader_code)
        except Exception as e:
            return {
                "matter_conservation_error": float("inf"),
                "determinism_score": 0.0,
                "tick_time_ms": float("inf"),
                "diverged": True,
                "error": str(e),
            }

        # Double buffer: grid_a and grid_b
        grid_a = self.create_storage_buffer(initial_grid.astype(np.uint32))
        grid_b = self.create_empty_storage_buffer(N * 4)

        # Create pipeline for A→B direction
        bind_group_layout = self.device.create_bind_group_layout(
            entries=[
                {
                    "binding": 0,
                    "visibility": wgpu.ShaderStage.COMPUTE,
                    "buffer": {"type": wgpu.BufferBindingType.read_only_storage},
                },
                {
                    "binding": 1,
                    "visibility": wgpu.ShaderStage.COMPUTE,
                    "buffer": {"type": wgpu.BufferBindingType.storage},
                },
            ]
        )
        pipeline_layout = self.device.create_pipeline_layout(
            bind_group_layouts=[bind_group_layout]
        )

        try:
            pipeline = self.device.create_compute_pipeline(
                layout=pipeline_layout,
                compute={
                    "module": shader,
                    "entry_point": "tick",
                    "constants": {"GRID_WIDTH": grid_width, "GRID_HEIGHT": grid_height},
                },
            )
        except Exception as e:
            return {
                "matter_conservation_error": float("inf"),
                "determinism_score": 0.0,
                "tick_time_ms": float("inf"),
                "diverged": True,
                "error": f"Pipeline creation failed: {e}",
            }

        # Bind groups for A→B and B→A
        bg_a_to_b = self.device.create_bind_group(
            layout=bind_group_layout,
            entries=[
                {"binding": 0, "resource": {"buffer": grid_a, "offset": 0, "size": grid_a.size}},
                {"binding": 1, "resource": {"buffer": grid_b, "offset": 0, "size": grid_b.size}},
            ],
        )
        bg_b_to_a = self.device.create_bind_group(
            layout=bind_group_layout,
            entries=[
                {"binding": 0, "resource": {"buffer": grid_b, "offset": 0, "size": grid_b.size}},
                {"binding": 1, "resource": {"buffer": grid_a, "offset": 0, "size": grid_a.size}},
            ],
        )

        workgroups_x = (grid_width + 15) // 16
        workgroups_y = (grid_height + 15) // 16

        # Count initial materials
        initial_materials = self._count_materials(initial_grid)

        # Run n_ticks
        times = []
        for tick in range(n_ticks):
            bg = bg_a_to_b if tick % 2 == 0 else bg_b_to_a

            t0 = time.perf_counter()
            encoder = self.device.create_command_encoder()
            compute_pass = encoder.begin_compute_pass()
            compute_pass.set_pipeline(pipeline)
            compute_pass.set_bind_group(0, bg)
            compute_pass.dispatch_workgroups(workgroups_x, workgroups_y)
            compute_pass.end()
            self.device.queue.submit([encoder.finish()])
            t1 = time.perf_counter()
            times.append(t1 - t0)

        # Read final state
        final_buf = grid_b if n_ticks % 2 == 1 else grid_a
        final_grid = self.read_buffer(final_buf)

        # Check matter conservation
        final_materials = self._count_materials(final_grid)
        voxel_count_error = abs(sum(initial_materials.values()) - sum(final_materials.values()))
        material_count_error = self._material_count_error(initial_materials, final_materials)

        # Check determinism: run again from same initial state
        grid_a2 = self.create_storage_buffer(initial_grid.astype(np.uint32))
        grid_b2 = self.create_empty_storage_buffer(N * 4)

        bg_a2_to_b2 = self.device.create_bind_group(
            layout=bind_group_layout,
            entries=[
                {"binding": 0, "resource": {"buffer": grid_a2, "offset": 0, "size": grid_a2.size}},
                {"binding": 1, "resource": {"buffer": grid_b2, "offset": 0, "size": grid_b2.size}},
            ],
        )
        bg_b2_to_a2 = self.device.create_bind_group(
            layout=bind_group_layout,
            entries=[
                {"binding": 0, "resource": {"buffer": grid_b2, "offset": 0, "size": grid_b2.size}},
                {"binding": 1, "resource": {"buffer": grid_a2, "offset": 0, "size": grid_a2.size}},
            ],
        )

        for tick in range(n_ticks):
            bg = bg_a2_to_b2 if tick % 2 == 0 else bg_b2_to_a2
            encoder = self.device.create_command_encoder()
            compute_pass = encoder.begin_compute_pass()
            compute_pass.set_pipeline(pipeline)
            compute_pass.set_bind_group(0, bg)
            compute_pass.dispatch_workgroups(workgroups_x, workgroups_y)
            compute_pass.end()
            self.device.queue.submit([encoder.finish()])

        final_buf2 = grid_b2 if n_ticks % 2 == 1 else grid_a2
        final_grid2 = self.read_buffer(final_buf2)

        determinism = 1.0 if np.array_equal(final_grid, final_grid2) else 0.0

        return {
            "matter_conservation_error": float(material_count_error),
            "material_count_error": float(material_count_error),
            "voxel_count_error": float(voxel_count_error),
            "determinism_score": determinism,
            "tick_time_ms": float(np.mean(times) * 1000),
            "diverged": False,
        }

    def run_spatial_trial(
        self,
        shader_code: str,
        initial_grid: np.ndarray,
        reference_shader_code: str,
        grid_width: int,
        grid_height: int,
        n_ticks: int = 5,
        chunk_size: int = 32,
    ) -> dict:
        """
        Run a Phase 1c spatial partitioning trial.

        The candidate shader should include chunk classification logic that
        early-exits inactive workgroups. We compare output against a reference
        (Phase 1b winner, full-grid dispatch) and measure the speedup.

        An atomic counter buffer at binding(2) tracks how many workgroups
        actually did work. workgroup_reduction = 1 - (active/total).
        """
        N = grid_width * grid_height
        total_workgroups_x = (grid_width + 15) // 16
        total_workgroups_y = (grid_height + 15) // 16
        total_workgroups = total_workgroups_x * total_workgroups_y

        # --- Run reference (full grid, no culling) ---
        try:
            ref_shader = self.compile_shader(reference_shader_code)
        except Exception as e:
            return {"diverged": True, "error": f"Reference shader failed: {e}"}

        ref_a = self.create_storage_buffer(initial_grid.astype(np.uint32))
        ref_b = self.create_empty_storage_buffer(N * 4)

        ref_bgl = self.device.create_bind_group_layout(entries=[
            {"binding": 0, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.read_only_storage}},
            {"binding": 1, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.storage}},
        ])
        ref_pl = self.device.create_pipeline_layout(bind_group_layouts=[ref_bgl])
        try:
            ref_pipeline = self.device.create_compute_pipeline(
                layout=ref_pl,
                compute={
                    "module": ref_shader,
                    "entry_point": "tick",
                    "constants": {"GRID_WIDTH": grid_width, "GRID_HEIGHT": grid_height},
                },
            )
        except Exception as e:
            return {"diverged": True, "error": f"Reference pipeline failed: {e}"}

        ref_bg_ab = self.device.create_bind_group(layout=ref_bgl, entries=[
            {"binding": 0, "resource": {"buffer": ref_a, "offset": 0, "size": ref_a.size}},
            {"binding": 1, "resource": {"buffer": ref_b, "offset": 0, "size": ref_b.size}},
        ])
        ref_bg_ba = self.device.create_bind_group(layout=ref_bgl, entries=[
            {"binding": 0, "resource": {"buffer": ref_b, "offset": 0, "size": ref_b.size}},
            {"binding": 1, "resource": {"buffer": ref_a, "offset": 0, "size": ref_a.size}},
        ])

        for tick in range(n_ticks):
            bg = ref_bg_ab if tick % 2 == 0 else ref_bg_ba
            enc = self.device.create_command_encoder()
            cp = enc.begin_compute_pass()
            cp.set_pipeline(ref_pipeline)
            cp.set_bind_group(0, bg)
            cp.dispatch_workgroups(total_workgroups_x, total_workgroups_y)
            cp.end()
            self.device.queue.submit([enc.finish()])

        ref_final_buf = ref_b if n_ticks % 2 == 1 else ref_a
        ref_output = self.read_buffer(ref_final_buf)

        # --- Run candidate (with spatial culling + atomic counter) ---
        try:
            cand_shader = self.compile_shader(shader_code)
        except Exception as e:
            return {
                "output_match": 0.0, "workgroup_reduction": 0.0,
                "overhead_ms": float("inf"), "diverged": True, "error": str(e),
            }

        cand_a = self.create_storage_buffer(initial_grid.astype(np.uint32))
        cand_b = self.create_empty_storage_buffer(N * 4)
        # Atomic counter buffer
        counter_data = np.zeros(1, dtype=np.uint32)
        counter_buf = self.create_storage_buffer(counter_data)

        cand_bgl = self.device.create_bind_group_layout(entries=[
            {"binding": 0, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.read_only_storage}},
            {"binding": 1, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.storage}},
            {"binding": 2, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.storage}},
        ])
        cand_pl = self.device.create_pipeline_layout(bind_group_layouts=[cand_bgl])

        try:
            cand_pipeline = self.device.create_compute_pipeline(
                layout=cand_pl,
                compute={
                    "module": cand_shader,
                    "entry_point": "tick",
                    "constants": {"GRID_WIDTH": grid_width, "GRID_HEIGHT": grid_height},
                },
            )
        except Exception as e:
            return {
                "output_match": 0.0, "workgroup_reduction": 0.0,
                "overhead_ms": float("inf"), "diverged": True,
                "error": f"Pipeline creation failed: {e}",
            }

        cand_bg_ab = self.device.create_bind_group(layout=cand_bgl, entries=[
            {"binding": 0, "resource": {"buffer": cand_a, "offset": 0, "size": cand_a.size}},
            {"binding": 1, "resource": {"buffer": cand_b, "offset": 0, "size": cand_b.size}},
            {"binding": 2, "resource": {"buffer": counter_buf, "offset": 0, "size": counter_buf.size}},
        ])
        cand_bg_ba = self.device.create_bind_group(layout=cand_bgl, entries=[
            {"binding": 0, "resource": {"buffer": cand_b, "offset": 0, "size": cand_b.size}},
            {"binding": 1, "resource": {"buffer": cand_a, "offset": 0, "size": cand_a.size}},
            {"binding": 2, "resource": {"buffer": counter_buf, "offset": 0, "size": counter_buf.size}},
        ])

        times = []
        for tick in range(n_ticks):
            bg = cand_bg_ab if tick % 2 == 0 else cand_bg_ba
            t0 = time.perf_counter()
            enc = self.device.create_command_encoder()
            cp = enc.begin_compute_pass()
            cp.set_pipeline(cand_pipeline)
            cp.set_bind_group(0, bg)
            cp.dispatch_workgroups(total_workgroups_x, total_workgroups_y)
            cp.end()
            self.device.queue.submit([enc.finish()])
            _ = self.device.queue.read_buffer(counter_buf, size=4)  # force sync
            t1 = time.perf_counter()
            times.append(t1 - t0)

        cand_final_buf = cand_b if n_ticks % 2 == 1 else cand_a
        cand_output = self.read_buffer(cand_final_buf)

        # Read atomic counter
        counter_val = int(np.frombuffer(
            self.device.queue.read_buffer(counter_buf), dtype=np.uint32)[0])
        total_dispatched = total_workgroups * n_ticks
        active_workgroups = counter_val
        workgroup_reduction = 1.0 - (active_workgroups / max(total_dispatched, 1))

        # Compare outputs
        output_match = 1.0 if np.array_equal(cand_output, ref_output) else 0.0

        return {
            "output_match": output_match,
            "workgroup_reduction": float(workgroup_reduction),
            "overhead_ms": float(np.mean(times) * 1000),
            "active_workgroups": active_workgroups,
            "total_workgroups": total_dispatched,
            "diverged": False,
        }

    def run_physics_trial(
        self,
        shader_code: str,
        initial_grid: np.ndarray,
        cold_table: np.ndarray,
        grid_width: int,
        grid_height: int,
        n_ticks: int = 20,
    ) -> dict:
        """
        Run a Phase 2 physics trial with cold property table.

        Bindings:
          0: grid_in (read-only storage)
          1: grid_out (read-write storage)
          2: cold_table (read-only storage, 8KB)

        Measures:
          - energy_conservation_error: |total_thermal_before - total_thermal_after| / total_before
          - matter_conservation_error: total_material_count delta
          - tick_time_ms: mean ms per tick
          - determinism: same input → same output
        """
        N = grid_width * grid_height

        try:
            shader = self.compile_shader(shader_code)
        except Exception as e:
            return {
                "energy_conservation_error": float("inf"),
                "matter_conservation_error": float("inf"),
                "determinism_score": 0.0,
                "tick_time_ms": float("inf"),
                "diverged": True,
                "error": str(e),
            }

        grid_a = self.create_storage_buffer(initial_grid.astype(np.uint32))
        grid_b = self.create_empty_storage_buffer(N * 4)
        cold_buf = self.create_storage_buffer(cold_table.astype(np.uint32))

        bgl = self.device.create_bind_group_layout(entries=[
            {"binding": 0, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.read_only_storage}},
            {"binding": 1, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.storage}},
            {"binding": 2, "visibility": wgpu.ShaderStage.COMPUTE,
             "buffer": {"type": wgpu.BufferBindingType.read_only_storage}},
        ])
        pl = self.device.create_pipeline_layout(bind_group_layouts=[bgl])

        try:
            pipeline = self.device.create_compute_pipeline(
                layout=pl,
                compute={
                    "module": shader,
                    "entry_point": "tick",
                    "constants": {"GRID_WIDTH": grid_width, "GRID_HEIGHT": grid_height},
                },
            )
        except Exception as e:
            return {
                "energy_conservation_error": float("inf"),
                "matter_conservation_error": float("inf"),
                "determinism_score": 0.0,
                "tick_time_ms": float("inf"),
                "diverged": True,
                "error": f"Pipeline creation failed: {e}",
            }

        bg_ab = self.device.create_bind_group(layout=bgl, entries=[
            {"binding": 0, "resource": {"buffer": grid_a, "offset": 0, "size": grid_a.size}},
            {"binding": 1, "resource": {"buffer": grid_b, "offset": 0, "size": grid_b.size}},
            {"binding": 2, "resource": {"buffer": cold_buf, "offset": 0, "size": cold_buf.size}},
        ])
        bg_ba = self.device.create_bind_group(layout=bgl, entries=[
            {"binding": 0, "resource": {"buffer": grid_b, "offset": 0, "size": grid_b.size}},
            {"binding": 1, "resource": {"buffer": grid_a, "offset": 0, "size": grid_a.size}},
            {"binding": 2, "resource": {"buffer": cold_buf, "offset": 0, "size": cold_buf.size}},
        ])

        wg_x = (grid_width + 15) // 16
        wg_y = (grid_height + 15) // 16

        # Measure initial state
        initial_thermal = self._total_thermal(initial_grid)
        initial_materials = self._count_materials(initial_grid)

        # Run ticks
        times = []
        for tick in range(n_ticks):
            bg = bg_ab if tick % 2 == 0 else bg_ba
            t0 = time.perf_counter()
            enc = self.device.create_command_encoder()
            cp = enc.begin_compute_pass()
            cp.set_pipeline(pipeline)
            cp.set_bind_group(0, bg)
            cp.dispatch_workgroups(wg_x, wg_y)
            cp.end()
            self.device.queue.submit([enc.finish()])
            t1 = time.perf_counter()
            times.append(t1 - t0)

        # Read final state
        final_buf = grid_b if n_ticks % 2 == 1 else grid_a
        final_grid = self.read_buffer(final_buf)

        # Energy conservation
        final_thermal = self._total_thermal(final_grid)
        if initial_thermal > 0:
            energy_error = abs(final_thermal - initial_thermal) / initial_thermal
        else:
            energy_error = 0.0 if final_thermal == 0 else float("inf")

        # Matter conservation
        final_materials = self._count_materials(final_grid)
        voxel_count_error = abs(sum(initial_materials.values()) - sum(final_materials.values()))
        material_count_error = self._material_count_error(initial_materials, final_materials)

        # Determinism check
        grid_a2 = self.create_storage_buffer(initial_grid.astype(np.uint32))
        grid_b2 = self.create_empty_storage_buffer(N * 4)
        bg_ab2 = self.device.create_bind_group(layout=bgl, entries=[
            {"binding": 0, "resource": {"buffer": grid_a2, "offset": 0, "size": grid_a2.size}},
            {"binding": 1, "resource": {"buffer": grid_b2, "offset": 0, "size": grid_b2.size}},
            {"binding": 2, "resource": {"buffer": cold_buf, "offset": 0, "size": cold_buf.size}},
        ])
        bg_ba2 = self.device.create_bind_group(layout=bgl, entries=[
            {"binding": 0, "resource": {"buffer": grid_b2, "offset": 0, "size": grid_b2.size}},
            {"binding": 1, "resource": {"buffer": grid_a2, "offset": 0, "size": grid_a2.size}},
            {"binding": 2, "resource": {"buffer": cold_buf, "offset": 0, "size": cold_buf.size}},
        ])
        for tick in range(n_ticks):
            bg = bg_ab2 if tick % 2 == 0 else bg_ba2
            enc = self.device.create_command_encoder()
            cp = enc.begin_compute_pass()
            cp.set_pipeline(pipeline)
            cp.set_bind_group(0, bg)
            cp.dispatch_workgroups(wg_x, wg_y)
            cp.end()
            self.device.queue.submit([enc.finish()])

        final_buf2 = grid_b2 if n_ticks % 2 == 1 else grid_a2
        final_grid2 = self.read_buffer(final_buf2)
        determinism = 1.0 if np.array_equal(final_grid, final_grid2) else 0.0

        return {
            "energy_conservation_error": float(energy_error),
            "matter_conservation_error": float(voxel_count_error),
            "material_count_error": float(material_count_error),
            "voxel_count_error": float(voxel_count_error),
            "determinism_score": determinism,
            "tick_time_ms": float(np.mean(times) * 1000),
            "diverged": False,
        }

    @staticmethod
    def _total_thermal(grid: np.ndarray) -> float:
        """Sum all thermal energy in a packed grid."""
        thermals = ((grid.astype(np.uint64) >> 8) & 0xFF)
        return float(np.sum(thermals))

    @staticmethod
    def _count_materials(grid: np.ndarray) -> dict:
        """Count occurrences of each material ID in a packed grid."""
        materials = grid.astype(np.uint32) & 0xFF  # material is bits 0-7
        unique, counts = np.unique(materials, return_counts=True)
        return dict(zip(unique.tolist(), counts.tolist()))

    @staticmethod
    def _material_count_error(before: dict, after: dict) -> int:
        """Sum absolute per-material count deltas between two histograms."""
        material_ids = set(before) | set(after)
        return sum(abs(before.get(mat, 0) - after.get(mat, 0)) for mat in material_ids)


def generate_test_data(n: int = 1_048_576, seed: int = 42) -> np.ndarray:
    """Generate random packed voxel states for testing. Default: 1M voxels (1024x1024)."""
    rng = np.random.RandomState(seed)
    return rng.randint(0, 0xFFFFFFFF, size=n, dtype=np.uint32)


def generate_test_grid(
    width: int = 1024,
    height: int = 1024,
    seed: int = 42,
    fill_ratio: float = 0.2,
) -> np.ndarray:
    """
    Generate a test grid with realistic material distribution.
    Most voxels are air (static), fill_ratio are active materials.
    """
    from engine.schema import (
        MAT_AIR, MAT_STONE, MAT_WATER, MAT_SAND, MAT_FIRE,
        pack_voxel, VoxelState, PHASE_GAS, PHASE_SOLID, PHASE_LIQUID, PHASE_POWDER, PHASE_PLASMA,
    )

    rng = np.random.RandomState(seed)
    N = width * height
    grid = np.zeros(N, dtype=np.uint32)

    # Fill with air
    air_packed = pack_voxel(VoxelState(MAT_AIR, 20, 0, 0, PHASE_GAS, 0))
    grid[:] = air_packed

    # Place active materials
    n_active = int(N * fill_ratio)
    active_indices = rng.choice(N, size=n_active, replace=False)

    materials = [
        (MAT_STONE, 20, PHASE_SOLID),
        (MAT_WATER, 25, PHASE_LIQUID),
        (MAT_SAND, 20, PHASE_POWDER),
        (MAT_FIRE, 200, PHASE_PLASMA),
    ]

    for i, idx in enumerate(active_indices):
        mat, thermal, phase = materials[i % len(materials)]
        kx = rng.randint(-3, 4)
        ky = rng.randint(-3, 4)
        grid[idx] = pack_voxel(VoxelState(mat, thermal, kx, ky, phase, 0))

    return grid


def generate_sparse_grid(
    width: int = 1024,
    height: int = 1024,
    seed: int = 42,
    n_clusters: int = 5,
    cluster_radius: int = 40,
) -> np.ndarray:
    """
    Generate a sparse grid for Phase 1c testing.
    Most of the grid is air. Active materials are clustered in a few regions.
    This creates a grid where ~80-90% of chunks are all-air (sleepable).
    """
    from engine.schema import (
        MAT_AIR, MAT_STONE, MAT_WATER, MAT_SAND, MAT_FIRE, MAT_LAVA,
        pack_voxel, VoxelState, PHASE_GAS, PHASE_SOLID, PHASE_LIQUID,
        PHASE_POWDER, PHASE_PLASMA, PHASE_MOLTEN,
    )

    rng = np.random.RandomState(seed)
    N = width * height
    grid = np.zeros(N, dtype=np.uint32)

    # Fill with air
    air_packed = pack_voxel(VoxelState(MAT_AIR, 20, 0, 0, PHASE_GAS, 0))
    grid[:] = air_packed

    # Place clusters of active materials
    materials = [
        (MAT_STONE, 20, PHASE_SOLID),
        (MAT_WATER, 25, PHASE_LIQUID),
        (MAT_SAND, 20, PHASE_POWDER),
        (MAT_FIRE, 200, PHASE_PLASMA),
        (MAT_LAVA, 240, PHASE_MOLTEN),
    ]

    for c in range(n_clusters):
        cx = rng.randint(cluster_radius, width - cluster_radius)
        cy = rng.randint(cluster_radius, height - cluster_radius)
        mat, thermal, phase = materials[c % len(materials)]

        for _ in range(cluster_radius * cluster_radius):
            dx = rng.randint(-cluster_radius, cluster_radius + 1)
            dy = rng.randint(-cluster_radius, cluster_radius + 1)
            if dx * dx + dy * dy <= cluster_radius * cluster_radius:
                x = cx + dx
                y = cy + dy
                if 0 <= x < width and 0 <= y < height:
                    idx = y * width + x
                    kx = rng.randint(-2, 3)
                    ky = rng.randint(-2, 3)
                    grid[idx] = pack_voxel(VoxelState(mat, thermal, kx, ky, phase, 0))

    return grid


if __name__ == "__main__":
    runner = GPUTrialRunner()
    print("GPUTrialRunner initialized successfully")

    # Quick pack/unpack test with a trivial shader
    test_data = generate_test_data(n=1024)
    trivial_shader = """
    @group(0) @binding(0) var<storage, read> input: array<u32>;
    @group(0) @binding(1) var<storage, read_write> output: array<u32>;

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
        let idx = gid.x;
        if (idx < arrayLength(&input)) {
            // Identity: just copy (baseline)
            output[idx] = input[idx];
        }
    }
    """
    result = runner.run_pack_unpack_trial(trivial_shader, test_data)
    print(f"Identity trial: errors={result['roundtrip_errors']}, "
          f"cycle_time={result['cycle_time_us']:.4f}us, "
          f"total={result['total_time_ms']:.2f}ms")
