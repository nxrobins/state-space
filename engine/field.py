"""Supported native field API. The compositor remains the sole GPU physics path."""

from __future__ import annotations

import math
from dataclasses import dataclass
from numbers import Real
from typing import TYPE_CHECKING

import numpy as np

from engine.contracts import Snapshot
from engine.enthalpy import EnergyLedger, MAX_ENERGY_Q
from engine.registry import DEFAULT_REGISTRY, MaterialRegistry
from engine.array_state import energy_ledger_array
from engine.schedule import movement_schedule_for_tick
from engine.schema import VoxelState, pack_voxel, unpack_voxel
from engine.state import seed_state, thermal_view
from engine.structure import ANCHOR, FRESH, INTEGRITY_MASK, BOND_BITS, StructuralPlan
from engine.structure_bulk import seed_structure_bulk, normalize_bonds_bulk, validate_structure_bulk, plan_structure_bulk
from engine.validation import MAX_TICK, checked_integer, validate_dimensions

if TYPE_CHECKING:
    from engine.compositor import CompositionEngine


@dataclass(frozen=True)
class EnergyBalance:
    initial_q: int
    external_q: int
    current_q: int

    @property
    def drift_q(self) -> int:
        return self.current_q - self.initial_q - self.external_q


@dataclass(frozen=True)
class CellChange:
    index: int
    before_packed: int
    after_packed: int
    before_energy_q: int
    after_energy_q: int
    before_structure: int
    after_structure: int


@dataclass(frozen=True)
class PassReport:
    tick: int
    pass_id: str
    changes: tuple[CellChange, ...]
    before: EnergyLedger
    after: EnergyLedger
    structure: StructuralPlan | None = None


def _geometry(value, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or abs(value) > MAX_TICK:
        raise ValueError(f"{label} must be finite and within the safe numeric range")
    return float(value)


class Field:
    """A native GPU world with isolated state, explicit edits, and exact replay.

    Use as a context manager or call close(). A supplied compositor is borrowed;
    its owner is responsible for closing it after all fields have finished.
    Read-only inspection remains available after a field has closed.
    """

    def __init__(self, width: int, height: int, fill_material: int = 0, *,
                 registry: MaterialRegistry = DEFAULT_REGISTRY, engine: CompositionEngine | None = None):
        self._width, self._height = validate_dimensions(width, height)
        if not isinstance(registry, MaterialRegistry):
            raise ValueError("Field requires a validated material registry")
        registry.material(fill_material)
        self._registry = registry
        self._closed = False
        self._tick = 0
        self._initial_q = self._external_q = 0
        from engine.compositor import CompositionEngine
        if engine is not None and not isinstance(engine, CompositionEngine):
            raise ValueError("engine must be a CompositionEngine")
        self._owns_engine = engine is None
        self._engine = engine if engine is not None else CompositionEngine(width, height)
        try:
            self._engine._compile_pipelines(width, height)
            self.clear(fill_material)
        except Exception:
            if self._owns_engine:
                self._engine.close()
            raise

    @property
    def width(self) -> int:
        return self._width

    @property
    def height(self) -> int:
        return self._height

    @property
    def registry(self) -> MaterialRegistry:
        return self._registry

    @property
    def tick(self) -> int:
        return self._tick

    @property
    def grid(self) -> np.ndarray:
        return self._cells.copy()

    @property
    def energy_q(self) -> np.ndarray:
        return self._energy.copy()

    @property
    def structure(self) -> np.ndarray:
        return self._structure.copy()

    def _ensure_open(self) -> None:
        if self._closed:
            raise RuntimeError("Field is closed")

    def __enter__(self):
        self._ensure_open()
        return self

    def __exit__(self, *_exc):
        self.close()

    def close(self) -> None:
        if not self._closed:
            self._closed = True
            if self._owns_engine:
                self._engine.close()

    def _placement(self, material: int, thermal: int | None = None, flags: int = 0):
        record = self.registry.material(material)
        dose = record["default_thermal"] if thermal is None else thermal
        packed = pack_voxel(VoxelState(material, dose, 0, 0, record["properties"]["default_phase"], flags))
        cells, energy = seed_state([packed], self.registry._model)
        return cells[0], energy[0]

    def clear(self, material: int = 0) -> None:
        self._ensure_open()
        packed, energy = self._placement(material)
        cells = np.full(self.width * self.height, packed, dtype=np.uint32)
        energies = np.full(self.width * self.height, energy, dtype=np.uint32)
        structure = seed_structure_bulk(cells, self.width, self.height, self.registry._structure)
        self._cells, self._energy, self._structure = cells, energies, structure
        self._tick = 0
        self._initial_q = int(energy) * self._cells.size
        self._external_q = 0

    def _edit_index(self, x: int, y: int) -> int | None:
        x = checked_integer(x, -MAX_TICK, MAX_TICK, "x")
        y = checked_integer(y, -MAX_TICK, MAX_TICK, "y")
        return y * self.width + x if 0 <= x < self.width and 0 <= y < self.height else None

    def _replace(self, index: int, packed: int, energy: int, *, placement: bool = False) -> None:
        self._external_q += int(energy) - int(self._energy[index])
        self._cells[index], self._energy[index] = packed, energy
        if placement:
            self._structure[index] = INTEGRITY_MASK | FRESH if self.registry._structure.eligible(packed) else 0

    def _normalize_structure(self):
        self._structure = normalize_bonds_bulk(self._cells, self._structure, self.width, self.height, self.registry._structure)

    def set_cell(self, x: int, y: int, material: int, thermal: int | None = None, flags: int = 0) -> None:
        self._ensure_open()
        index = self._edit_index(x, y)
        packed, energy = self._placement(material, thermal, flags)
        if index is not None:
            self._replace(index, packed, energy, placement=True)
            self._normalize_structure()

    def set_energy(self, x: int, y: int, energy_q: int) -> None:
        self._ensure_open()
        index = self._edit_index(x, y)
        checked_integer(energy_q, 0, MAX_ENERGY_Q, "energy_q")
        if index is not None:
            packed = thermal_view([self._cells[index]], [energy_q], self.registry._model)[0]
            self._replace(index, packed, energy_q)

    def paint_circle(self, x, y, radius, material: int, thermal: int | None = None, flags: int = 0) -> None:
        self._ensure_open()
        x, y, radius = (_geometry(value, label) for value, label in ((x, "x"), (y, "y"), (radius, "radius")))
        if radius < 0:
            raise ValueError("Paint radius must be nonnegative")
        packed, energy = self._placement(material, thermal, flags)
        for py in range(max(0, math.floor(y - radius)), min(self.height - 1, math.ceil(y + radius)) + 1):
            for px in range(max(0, math.floor(x - radius)), min(self.width - 1, math.ceil(x + radius)) + 1):
                if (px - x) ** 2 + (py - y) ** 2 <= radius ** 2:
                    self._replace(py * self.width + px, packed, energy, placement=True)
        self._normalize_structure()

    def set_anchor(self, x: int, y: int, anchored: bool = True) -> None:
        self._ensure_open()
        index = self._edit_index(x, y)
        if type(anchored) is not bool:
            raise ValueError("anchored must be a boolean")
        if index is None:
            return
        if not self.registry._structure.eligible(self._cells[index]):
            raise ValueError("Only cohesive solid/frozen cells can be anchored")
        self._structure[index] = (int(self._structure[index]) & ~ANCHOR) | (ANCHOR if anchored else 0)

    def set_integrity(self, x: int, y: int, integrity: int, *, weld: bool = False) -> None:
        """Explicit damage/repair. Repaired cells form new bonds only with weld=True."""
        self._ensure_open()
        index = self._edit_index(x, y)
        integrity = checked_integer(integrity, 0, INTEGRITY_MASK, "integrity")
        if type(weld) is not bool:
            raise ValueError("weld must be a boolean")
        if index is None:
            return
        if not self.registry._structure.eligible(self._cells[index]):
            raise ValueError("Only cohesive solid/frozen cells can have integrity")
        self._structure[index] = (int(self._structure[index]) & ~INTEGRITY_MASK) | integrity | (FRESH if weld and integrity else 0)
        self._normalize_structure()

    def inspect_structure(self) -> StructuralPlan:
        """Read-only prediction of support, damage and component motion for the next solve."""
        return plan_structure_bulk(self._cells, self._energy, self._structure, self.width, self.height, self.registry._structure)

    def sample(self, x, y) -> dict:
        px = max(0, min(self.width - 1, math.floor(_geometry(x, "x"))))
        py = max(0, min(self.height - 1, math.floor(_geometry(y, "y"))))
        index = py * self.width + px
        state = unpack_voxel(int(self._cells[index]))
        return {"material": state.material, "material_name": self.registry.material(state.material)["name"],
                "thermal": state.thermal, "energy_q": int(self._energy[index]),
                "temperature_q": self.registry._model.temperature_q(state.material, int(self._energy[index])),
                "phase": state.phase, "flags": state.flags, "kinetic_x": state.kinetic_x, "kinetic_y": state.kinetic_y,
                "structure": int(self._structure[index]), "integrity": int(self._structure[index]) & INTEGRITY_MASK,
                "anchored": bool(int(self._structure[index]) & ANCHOR), "bonds": int(self._structure[index]) & sum(BOND_BITS)}

    def energy_ledger(self) -> EnergyLedger:
        return energy_ledger_array(self._cells & 255, self._energy, self.registry._model)

    def energy_balance(self) -> EnergyBalance:
        return EnergyBalance(self._initial_q, self._external_q, self.energy_ledger().total_q)

    def snapshot(self) -> Snapshot:
        return Snapshot(self.width, self.height, self.tick, self._cells, self._energy, self._structure, registry=self.registry)

    def restore(self, snapshot: Snapshot | dict) -> None:
        self._ensure_open()
        # Revalidate even typed snapshots; dimensions and registry must agree.
        value = snapshot.to_dict() if isinstance(snapshot, Snapshot) else snapshot
        saved = Snapshot.from_dict(value, registry=self.registry)
        if saved.width != self.width or saved.height != self.height:
            raise ValueError("Snapshot dimensions differ from the field")
        self._cells, self._energy, self._structure = saved.packed_cells.copy(), saved.energy_q.copy(), saved.structure.copy()
        self._tick = int(saved.tick)
        self._initial_q = self.energy_ledger().total_q
        self._external_q = 0

    def step(self, ticks: int = 1, *, inspect: bool = False) -> tuple[PassReport, ...]:
        self._ensure_open()
        checked_integer(ticks, 0, MAX_TICK - self.tick, "ticks")
        if type(inspect) is not bool:
            raise ValueError("inspect must be a boolean")
        if ticks == 0:
            return ()
        result = self._engine.run(self._cells, self.registry.cold_table(), self.width, self.height, ticks,
                                  start_tick=self.tick, initial_energy=self._energy, registry=self.registry, trace_passes=inspect,
                                  initial_structure=self._structure)
        reports = []
        if inspect:
            before_cells, before_energy, before_structure = self._cells, self._energy, self._structure
            model = self.registry._model
            expected = [(tick, pass_id) for tick in range(self.tick, self.tick + ticks) for pass_id in movement_schedule_for_tick(tick)]
            traces = [result[key] for key in ("pass_snapshots", "pass_energy_snapshots", "pass_structure_snapshots")]
            if any(len(trace) != len(expected) for trace in traces):
                raise RuntimeError("Incomplete packed, energy or structure pass trace")
            plans = dict(result["structural_plans"])
            for required, packed_entry, energy_entry, structure_entry in zip(expected, *traces):
                if any(required != entry[:2] for entry in (packed_entry, energy_entry, structure_entry)):
                    raise RuntimeError("Mismatched complete-state pass traces")
                tick, pass_id = required
                cells, energy, structure = packed_entry[2], energy_entry[2], structure_entry[2]
                changed = np.flatnonzero((cells != before_cells) | (energy != before_energy) | (structure != before_structure))
                changes = tuple(CellChange(int(i), int(before_cells[i]), int(cells[i]), int(before_energy[i]), int(energy[i]),
                                           int(before_structure[i]), int(structure[i])) for i in changed)
                reports.append(PassReport(tick, pass_id, changes, energy_ledger_array(before_cells & 255, before_energy, model),
                                         energy_ledger_array(cells & 255, energy, model), plans[tick] if pass_id == "structure" else None))
                before_cells, before_energy, before_structure = cells, energy, structure
        final = validate_structure_bulk(result["final_grid"], result["final_energy"], result["final_structure"],
                                        self.width, self.height, self.registry._structure)
        self._cells, self._energy, self._structure = final
        self._tick = result["end_tick"]
        return tuple(reports)


def create_field(width: int, height: int, fill_material: int = 0, *,
                 registry: MaterialRegistry = DEFAULT_REGISTRY, engine: CompositionEngine | None = None) -> Field:
    return Field(width, height, fill_material, registry=registry, engine=engine)
