"""
Phase 2e: Composition Engine

Dispatches the physics kernels per tick in locked order:
  1. Gravity phase 0 (conservative vertical swaps)
  2. Gravity phase 1 (conservative vertical swaps)
  3. Thermal diffusion (heat transfer by conductivity)
  4. Phase transitions (material state changes)
  5. Combustion (fuel + oxygen -> product + heat)

Each kernel runs as a full double-buffer pass: reads grid_A, writes grid_B,
then swap.

The cold table is shared read-only across all kernels.
"""

import time
import numpy as np
import wgpu
from pathlib import Path

from engine.wgsl_fixer import strip_entry_points_and_bindings


WORK_DIR = Path("D:/state-space")

# Dispatch order (LOCKED)
KERNEL_ORDER = ["2b0", "2b1", "2a", "2c", "2d"]  # gravity phases, thermal, phase, combustion
KERNEL_NAMES = {
    "2b0": "Gravity phase 0",
    "2b1": "Gravity phase 1",
    "2a": "Thermal",
    "2c": "Phase Transitions",
    "2d": "Combustion",
}


class CompositionEngine:
    """Runs the full physics pipeline per tick."""

    def __init__(self, grid_width: int | None = None, grid_height: int | None = None):
        self.adapter = wgpu.gpu.request_adapter_sync(power_preference="high-performance")
        self.device = self.adapter.request_device_sync()
        self._bitmask_defs = (WORK_DIR / "engine" / "shaders" / "bitmask_defs.wgsl").read_text()
        self._locked_1a = strip_entry_points_and_bindings(
            (WORK_DIR / "locked" / "phase_1a_winner.wgsl").read_text()
        )

        self.pipelines = {}
        self.kernel_sources = {}
        self._compiled_dims: tuple[int, int] | None = None

        if grid_width is not None and grid_height is not None:
            self._compile_pipelines(grid_width, grid_height)

    def _compile_pipelines(self, grid_width: int, grid_height: int) -> None:
        """Compile kernels specialized to the requested grid dimensions."""
        dims = (int(grid_width), int(grid_height))
        if self._compiled_dims == dims:
            return

        self.pipelines = {}
        self.kernel_sources = {}
        constants = {"GRID_WIDTH": dims[0], "GRID_HEIGHT": dims[1]}

        for phase_id in KERNEL_ORDER:
            locked_phase_id = "2b" if phase_id.startswith("2b") else phase_id
            winner_path = WORK_DIR / "locked" / f"phase_{locked_phase_id}_winner.wgsl"
            if not winner_path.exists():
                raise FileNotFoundError(f"Locked winner not found: {winner_path}")

            kernel_code = winner_path.read_text()
            full_code = self._bitmask_defs + "\n\n" + self._locked_1a + "\n\n" + kernel_code
            self.kernel_sources[phase_id] = full_code

            shader = self.device.create_shader_module(code=full_code)

            # Determine binding layout based on phase
            if locked_phase_id in ("2a", "2b", "2c", "2d"):
                # Bindings: 0=grid_in, 1=grid_out, 2=cold_table
                bgl = self.device.create_bind_group_layout(entries=[
                    {"binding": 0, "visibility": wgpu.ShaderStage.COMPUTE,
                     "buffer": {"type": wgpu.BufferBindingType.read_only_storage}},
                    {"binding": 1, "visibility": wgpu.ShaderStage.COMPUTE,
                     "buffer": {"type": wgpu.BufferBindingType.storage}},
                    {"binding": 2, "visibility": wgpu.ShaderStage.COMPUTE,
                     "buffer": {"type": wgpu.BufferBindingType.read_only_storage}},
                ])
            else:
                raise ValueError(f"Unknown phase binding layout: {phase_id}")

            pl = self.device.create_pipeline_layout(bind_group_layouts=[bgl])
            pipeline_constants = dict(constants)
            if phase_id == "2b0":
                pipeline_constants["GRAVITY_PHASE"] = 0
            elif phase_id == "2b1":
                pipeline_constants["GRAVITY_PHASE"] = 1
            pipeline = self.device.create_compute_pipeline(
                layout=pl,
                compute={"module": shader, "entry_point": "tick", "constants": pipeline_constants},
            )
            self.pipelines[phase_id] = (pipeline, bgl)

        self._compiled_dims = dims
        print(f"CompositionEngine: {len(self.pipelines)} kernels compiled for {dims[0]}x{dims[1]}")
        for pid in KERNEL_ORDER:
            print(f"  {KERNEL_NAMES[pid]:20s} [{pid}]")

    def run(
        self,
        initial_grid: np.ndarray,
        cold_table: np.ndarray,
        grid_width: int,
        grid_height: int,
        n_ticks: int = 200,
        snapshot_interval: int = 0,
    ) -> dict:
        """
        Run n_ticks of the full 4-kernel pipeline.

        Returns dict with:
          - final_grid: np.ndarray of the final state
          - tick_times_ms: list of per-tick wall-clock times
          - total_time_ms: total wall-clock time
          - snapshots: list of (tick, grid) tuples if snapshot_interval > 0
        """
        self._compile_pipelines(grid_width, grid_height)

        N = grid_width * grid_height
        wg_x = (grid_width + 15) // 16
        wg_y = (grid_height + 15) // 16

        # Create double buffers
        grid_a = self.device.create_buffer_with_data(
            data=initial_grid.astype(np.uint32).tobytes(),
            usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC,
        )
        grid_b = self.device.create_buffer(
            size=N * 4,
            usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC,
        )
        cold_buf = self.device.create_buffer_with_data(
            data=cold_table.astype(np.uint32).tobytes(),
            usage=wgpu.BufferUsage.STORAGE,
        )

        # Pre-create bind groups for both directions, for each kernel
        bind_groups = {}
        for phase_id in KERNEL_ORDER:
            _, bgl = self.pipelines[phase_id]
            bind_groups[(phase_id, "ab")] = self.device.create_bind_group(
                layout=bgl, entries=[
                    {"binding": 0, "resource": {"buffer": grid_a, "offset": 0, "size": grid_a.size}},
                    {"binding": 1, "resource": {"buffer": grid_b, "offset": 0, "size": grid_b.size}},
                    {"binding": 2, "resource": {"buffer": cold_buf, "offset": 0, "size": cold_buf.size}},
                ])
            bind_groups[(phase_id, "ba")] = self.device.create_bind_group(
                layout=bgl, entries=[
                    {"binding": 0, "resource": {"buffer": grid_b, "offset": 0, "size": grid_b.size}},
                    {"binding": 1, "resource": {"buffer": grid_a, "offset": 0, "size": grid_a.size}},
                    {"binding": 2, "resource": {"buffer": cold_buf, "offset": 0, "size": cold_buf.size}},
                ])

        # Run ticks
        tick_times = []
        snapshots = []
        # Track which buffer is "current" (contains latest state)
        # Start: grid_a has initial state
        current_is_a = True

        for tick in range(n_ticks):
            t0 = time.perf_counter()

            # Dispatch all 4 kernels in order, each as a separate pass
            for kernel_idx, phase_id in enumerate(KERNEL_ORDER):
                pipeline, _ = self.pipelines[phase_id]

                # Determine read/write direction
                if current_is_a:
                    bg = bind_groups[(phase_id, "ab")]  # read A, write B
                else:
                    bg = bind_groups[(phase_id, "ba")]  # read B, write A

                encoder = self.device.create_command_encoder()
                cp = encoder.begin_compute_pass()
                cp.set_pipeline(pipeline)
                cp.set_bind_group(0, bg)
                cp.dispatch_workgroups(wg_x, wg_y)
                cp.end()
                self.device.queue.submit([encoder.finish()])

                # Swap buffers after each kernel
                current_is_a = not current_is_a

            # Force GPU sync at end of tick (read 4 bytes to flush)
            sync_buf = grid_a if current_is_a else grid_b
            _ = self.device.queue.read_buffer(sync_buf, size=4)
            t1 = time.perf_counter()
            tick_times.append((t1 - t0) * 1000)

            # Optional snapshot
            if snapshot_interval > 0 and (tick + 1) % snapshot_interval == 0:
                data = np.frombuffer(
                    self.device.queue.read_buffer(sync_buf),
                    dtype=np.uint32
                )
                snapshots.append((tick + 1, data.copy()))

        # Read final state
        final_buf = grid_a if current_is_a else grid_b
        final_grid = np.frombuffer(
            self.device.queue.read_buffer(final_buf),
            dtype=np.uint32
        )

        return {
            "final_grid": final_grid.copy(),
            "tick_times_ms": tick_times,
            "total_time_ms": sum(tick_times),
            "mean_tick_ms": np.mean(tick_times),
            "snapshots": snapshots,
        }
