"""
Production ca-v3 compositor. Each tick solves global structural support before
conservative movement, thermal exchange and reactions, then normalizes bonds.
Every pass transports packed cells, conserved energy and persistent structure.
The cold table and per-tick structural plan are read-only shader inputs.
"""

import time
from contextlib import ExitStack
import numpy as np
import wgpu

from engine.wgsl_fixer import strip_entry_points_and_bindings
from engine.schedule import KERNEL_SPECS as KERNEL_SPECS, movement_schedule_for_tick as movement_schedule_for_tick
from engine.contracts import MAX_TICK, checked_integer, validate_dimensions, validate_packed
from engine.schema import COLD_TABLE_ENTRIES, COLD_TABLE_STRIDE
from engine.state import seed_state, catalog_from_cold, validate_state
from engine.structure_bulk import plan_structure_bulk, seed_structure_bulk, validate_structure_bulk
from engine.registry import MaterialRegistry
from engine.sources import ShaderBundle
from engine.array_state import energy_ledger_array


class InvalidCompletedState(ValueError):
    """Observed GPU output that failed the completed-tick contract, with evidence."""

    def __init__(self, reason, state, tick):
        super().__init__(f"GPU output after tick {tick} is invalid: {reason}")
        self.state = tuple(np.frombuffer(np.asarray(value, dtype=np.uint32).tobytes(), dtype=np.uint32) for value in state)
        self.tick = tick


class CompositionEngine:
    """Runs the full physics pipeline per tick."""

    def __init__(self, grid_width: int | None = None, grid_height: int | None = None, *, sources: ShaderBundle | None = None):
        if (grid_width is None) != (grid_height is None):
            raise ValueError("Provide both grid dimensions or neither")
        if grid_width is not None:
            validate_dimensions(grid_width, grid_height)
        if sources is not None and not isinstance(sources, ShaderBundle):
            raise ValueError("sources must be an immutable ShaderBundle")
        self._sources = sources if sources is not None else ShaderBundle.load()
        self._bitmask_defs = self._sources.shader("bitmask_defs.wgsl")
        self._locked_1a = strip_entry_points_and_bindings(self._sources.kernel("phase_1a_winner.wgsl"))
        self._state_io = self._sources.shader("state_io.wgsl")
        self._enthalpy_law = self._sources.shader("enthalpy_law.wgsl")
        self._closed = False
        self.adapter = wgpu.gpu.request_adapter_sync(power_preference="high-performance")
        if self.adapter is None:
            raise RuntimeError("No GPU adapter found")
        self.device = self.adapter.request_device_sync()
        self.pipelines = {}
        self.kernel_sources = {}
        self._compiled_dims: tuple[int, int] | None = None

        if grid_width is not None and grid_height is not None:
            try:
                self._compile_pipelines(grid_width, grid_height)
            except Exception:
                self.close()
                raise

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            self.pipelines.clear()
            self.kernel_sources.clear()
            self.device.destroy()

    def __enter__(self):
        self._ensure_open()
        return self

    def __exit__(self, *_exc):
        self.close()

    def _ensure_open(self) -> None:
        if self._closed:
            raise RuntimeError("Composition engine is closed")

    def _compile_pipelines(self, grid_width: int, grid_height: int) -> None:
        """Compile kernels specialized to the requested grid dimensions."""
        self._ensure_open()
        dims = validate_dimensions(grid_width, grid_height)
        if dims[0] * dims[1] * 8 > self.device.limits["max-storage-buffer-binding-size"]:
            raise ValueError("Grid exceeds the device storage buffer binding limit")
        if any((dimension + 15) // 16 > self.device.limits["max-compute-workgroups-per-dimension"] for dimension in dims):
            raise ValueError("Grid exceeds the device dispatch dimension limit")
        if self._compiled_dims == dims:
            return

        pipelines = {}
        kernel_sources = {}
        constants = {"GRID_WIDTH": dims[0], "GRID_HEIGHT": dims[1]}

        for spec in KERNEL_SPECS:
            kernel_code = self._sources.kernel(spec.source_file)
            full_code = self._bitmask_defs + "\n\n" + self._locked_1a + "\n\n" + self._state_io + "\n" + self._enthalpy_law + "\n" + kernel_code
            kernel_sources[spec.id] = full_code

            shader = self.device.create_shader_module(code=full_code)

            # ca-v3 uses eight storage bindings, within the default WebGPU limit.
            bgl = self.device.create_bind_group_layout(entries=[
                {"binding": binding, "visibility": wgpu.ShaderStage.COMPUTE,
                 "buffer": {"type": "storage" if binding in (1, 4, 6) else "read-only-storage"}}
                for binding in range(8)])

            pl = self.device.create_pipeline_layout(bind_group_layouts=[bgl])
            pipeline_constants = {**constants, **spec.constants}
            pipeline = self.device.create_compute_pipeline(
                layout=pl,
                compute={"module": shader, "entry_point": "tick", "constants": pipeline_constants},
            )
            pipelines[spec.id] = (pipeline, bgl)

        self.pipelines, self.kernel_sources = pipelines, kernel_sources
        self._compiled_dims = dims
        print(f"CompositionEngine: {len(self.pipelines)} pipelines compiled for {dims[0]}x{dims[1]}")
        print("  Tick schedule:")
        for pid in movement_schedule_for_tick(0):
            spec = next(s for s in KERNEL_SPECS if s.id == pid)
            print(f"    {spec.name:32s} [{pid}]")

    def run(
        self, initial_grid: np.ndarray, cold_table: np.ndarray, grid_width: int, grid_height: int,
        n_ticks: int = 200, snapshot_interval: int = 0, start_tick: int = 0, trace_passes: bool = False,
        initial_energy: np.ndarray | None = None, registry: MaterialRegistry | None = None,
        initial_structure: np.ndarray | None = None,
    ) -> dict:
        """Run complete ca-v3 ticks with exact three-coordinate continuation.

        Structural planning is an explicit host operation; each tick reads back
        all three coordinates for the next global support solve. Timings include
        planning, uploads, all passes, and completion/readback.
        """
        self._ensure_open()
        grid_width, grid_height = validate_dimensions(grid_width, grid_height)
        n_ticks = checked_integer(n_ticks, 0, MAX_TICK, "n_ticks")
        start_tick = checked_integer(start_tick, 0, MAX_TICK, "start_tick")
        checked_integer(start_tick + n_ticks, 0, MAX_TICK, "end_tick")
        snapshot_interval = checked_integer(snapshot_interval, 0, MAX_TICK, "snapshot_interval")
        if type(trace_passes) is not bool:
            raise ValueError("trace_passes must be a boolean")
        initial_grid = validate_packed(initial_grid, grid_width * grid_height)
        cold_table = validate_packed(cold_table, COLD_TABLE_ENTRIES * COLD_TABLE_STRIDE, "cold_table")
        if registry is None:
            registry = MaterialRegistry(catalog_from_cold(cold_table))
        elif not isinstance(registry, MaterialRegistry) or not np.array_equal(cold_table, registry.cold_table()):
            raise ValueError("Cold table must match the supplied validated registry")
        model, structure_rules = registry._model, registry._structure
        if start_tick and (initial_energy is None or initial_structure is None):
            raise ValueError("Continuation requires initial_energy and initial_structure; packed state cannot reconstruct either")
        if initial_energy is None:
            initial_grid, initial_energy = seed_state(initial_grid, model)
        else:
            initial_grid, initial_energy = validate_state(initial_grid, initial_energy, grid_width * grid_height, model)
        if initial_structure is None:
            initial_structure = seed_structure_bulk(initial_grid, grid_width, grid_height, structure_rules)
        initial_grid, initial_energy, initial_structure = validate_structure_bulk(
            initial_grid, initial_energy, initial_structure, grid_width, grid_height, structure_rules)
        self._compile_pipelines(grid_width, grid_height)
        count = grid_width * grid_height
        wg_x, wg_y = (grid_width + 15) // 16, (grid_height + 15) // 16
        with ExitStack() as resources:
            def keep(buffer):
                resources.callback(buffer.destroy)
                return buffer
            fields = []
            for values in (initial_grid, initial_energy, initial_structure):
                fields.append((keep(self.device.create_buffer_with_data(data=values.tobytes(),
                                    usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC)),
                               keep(self.device.create_buffer(size=count * 4,
                                    usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_SRC))))
            cold_buf = keep(self.device.create_buffer_with_data(data=cold_table.tobytes(), usage=wgpu.BufferUsage.STORAGE))
            plan_buf = keep(self.device.create_buffer(size=count * 8, usage=wgpu.BufferUsage.STORAGE | wgpu.BufferUsage.COPY_DST))
            groups = {}
            for spec in KERNEL_SPECS:
                for current in (0, 1):
                    ordered = [fields[0][current], fields[0][1 - current], cold_buf,
                               fields[1][current], fields[1][1 - current], fields[2][current], fields[2][1 - current], plan_buf]
                    groups[spec.id, current] = self.device.create_bind_group(layout=self.pipelines[spec.id][1], entries=[
                        {"binding": binding, "resource": {"buffer": buffer}} for binding, buffer in enumerate(ordered)])
            def read_state(current):
                return tuple(np.frombuffer(self.device.queue.read_buffer(pair[current]), dtype=np.uint32).copy() for pair in fields)
            state = (initial_grid, initial_energy, initial_structure)
            current = 0
            tick_times, planning_times = [], []
            snapshots, energy_snapshots, structure_snapshots = [], [], []
            pass_snapshots, pass_energy_snapshots, pass_structure_snapshots = [], [], []
            plans = []
            for tick in range(start_tick, start_tick + n_ticks):
                started = time.perf_counter()
                plan = plan_structure_bulk(*state, grid_width, grid_height, structure_rules)
                planning_times.append((time.perf_counter() - started) * 1000)
                self.device.queue.write_buffer(plan_buf, 0, np.column_stack((plan.sources, plan.structure)).astype(np.uint32).tobytes())
                if trace_passes:
                    plans.append((tick, plan))
                for pass_id in movement_schedule_for_tick(tick):
                    encoder = self.device.create_command_encoder()
                    compute = encoder.begin_compute_pass()
                    compute.set_pipeline(self.pipelines[pass_id][0])
                    compute.set_bind_group(0, groups[pass_id, current])
                    compute.dispatch_workgroups(wg_x, wg_y)
                    compute.end()
                    self.device.queue.submit([encoder.finish()])
                    current = 1 - current
                    if trace_passes:
                        state = read_state(current)
                        for collection, values in zip((pass_snapshots, pass_energy_snapshots, pass_structure_snapshots), state):
                            collection.append((tick, pass_id, values))
                if not trace_passes:
                    state = read_state(current)
                try:
                    state = validate_structure_bulk(*state, grid_width, grid_height, structure_rules)
                except ValueError as error:
                    raise InvalidCompletedState(str(error), state, tick) from error
                # Readback above completes all submitted work; no submit-only timings.
                tick_times.append((time.perf_counter() - started) * 1000)
                if snapshot_interval and (tick + 1) % snapshot_interval == 0:
                    for collection, values in zip((snapshots, energy_snapshots, structure_snapshots), state):
                        collection.append((tick + 1, values.copy()))
            state = validate_structure_bulk(*state, grid_width, grid_height, structure_rules)
            return {
                "final_grid": state[0], "final_energy": state[1], "final_structure": state[2],
                "initial_grid": initial_grid.copy(), "initial_energy": initial_energy.copy(), "initial_structure": initial_structure.copy(),
                "energy_ledger": energy_ledger_array(state[0] & 255, state[1], model),
                "tick_times_ms": tick_times, "planning_times_ms": planning_times, "total_time_ms": sum(tick_times),
                "mean_tick_ms": float(np.mean(tick_times)) if tick_times else 0.0,
                "snapshots": snapshots, "energy_snapshots": energy_snapshots, "structure_snapshots": structure_snapshots,
                "start_tick": start_tick, "end_tick": start_tick + n_ticks,
                "pass_snapshots": pass_snapshots, "pass_energy_snapshots": pass_energy_snapshots,
                "pass_structure_snapshots": pass_structure_snapshots, "structural_plans": plans,
            }
