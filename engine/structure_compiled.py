"""Portable compiled global planner, independently checked against the references.

Only the compositor's already-validated tick state uses the private transport
entry point. Public diagnostic planning always validates the complete input.
The bundled Wasm module has no imports; runtime use never starts a compiler.
"""
import ctypes
from functools import lru_cache
from importlib.resources import files
import threading

import numpy as np
import wasmtime

from engine.structure import ANCHOR, ComponentReport, StructuralPlan, _state_hash
from engine.structure_bulk import validate_structure_bulk
from engine.validation import validate_dimensions, validate_packed
from engine.enthalpy import EnergyLedger

TABLE_WORDS = 256 * (24 + 12)
FIELD_COUNT = 15
_local = threading.local()


@lru_cache(maxsize=1)
def _module():
    engine = wasmtime.Engine()
    module = wasmtime.Module(engine, files("engine").joinpath("generated", "structure_solver.wasm").read_bytes())
    if list(module.imports):
        raise RuntimeError("Structural solver must not have host imports")
    return engine, module


class _Solver:
    def __init__(self):
        engine, module = _module()
        self.store = wasmtime.Store(engine)
        self.exports = wasmtime.Instance(self.store, module, []).exports(self.store)
        self.memory = self.exports["memory"]
        self.base = self.exports["__heap_base"].value(self.store)
        if self.exports["abi_version"](self.store) != 1:
            raise RuntimeError("Unsupported structural solver ABI")
        self.rules = None
        self.tables = None

    def prepare(self, state, width, height, rules):
        count = width * height
        needed = self.base + (TABLE_WORDS + FIELD_COUNT * count) * 4
        if needed > 0xffffffff:
            raise ValueError("World exceeds the compiled planner's linear memory limit")
        if needed > self.memory.data_len(self.store):
            self.memory.grow(self.store, (needed - self.memory.data_len(self.store) + 65535) // 65536)
        # Recreate views after growth; results are copied before another call.
        backing = (ctypes.c_ubyte * (needed - self.base)).from_address(
            ctypes.addressof(self.memory.data_ptr(self.store).contents) + self.base)
        words = np.frombuffer(backing, dtype="<u4")
        arrays = words[TABLE_WORDS:].reshape(FIELD_COUNT, count)
        if self.rules is not rules:
            # Only the cold columns the solver reads. Presence is marked in the
            # private thermal slot 0, so no property column has a second meaning.
            table = np.zeros(256 * 24, dtype=np.uint32).reshape(256, 24)
            for row in rules.materials.values():
                table[row.id, [0, 22, 23]] = row.density, row.cohesion, row.softening
            thermal = np.asarray(rules.thermal.gpu_table(), dtype=np.uint32).reshape(256, 12)
            thermal[:, 0] = 0
            thermal[list(rules.thermal.materials), 0] = 1
            self.tables = np.concatenate((table.reshape(-1), thermal.reshape(-1)))
            self.rules = rules
        words[:TABLE_WORDS] = self.tables
        for coordinate, values in enumerate(state):
            arrays[coordinate] = values
        return arrays

    def solve(self, state, width, height, rules, diagnostics):
        arrays = self.prepare(state, width, height, rules)
        status = self.exports["solve"](self.store, width, height, self.base)
        if status:
            raise RuntimeError(f"Global structural solver invariant failed: {status}")
        if not diagnostics:
            return arrays[3].copy(), arrays[4].copy()
        parents = arrays[9].view("<i4")
        groups = {}
        for i in np.flatnonzero(parents >= 0):
            groups.setdefault(int(parents[i]), []).append(int(i))
        components = tuple(ComponentReport(root, tuple(members), not bool(arrays[11, root]),
                            any(int(arrays[14, i]) & ANCHOR for i in members)) for root, members in sorted(groups.items()))
        return StructuralPlan(width, height, arrays[3].copy(), arrays[4].copy(),
                              arrays[5].astype(np.int64), arrays[6].astype(np.int64), arrays[7].astype(np.int64),
                              arrays[8].view("<i4").astype(np.int64), components,
                              self.exports["weight"](self.store) & 0xffffffff, _state_hash(*state))


def _solver():
    if not hasattr(_local, "solver"):
        _local.solver = _Solver()
    return _local.solver


def _transport_validated(cells, energy, words, width, height, rules):
    """Private complete-state compositor boundary; all arrays are already checked."""
    return _solver().solve((cells, energy, words), width, height, rules, False)


def validate_structure_compiled(cells, energy, words, width, height, rules):
    """Copy and validate the full public state, with independent error diagnostics."""
    width, height = validate_dimensions(width, height)
    state = tuple(validate_packed(values, width * height, label) for values, label in
                  zip((cells, energy, words), ("packedCells", "energyQ", "structure")))
    solver = _solver()
    solver.prepare(state, width, height, rules)
    if solver.exports["validate"](solver.store, width, height, solver.base):
        # Keep the reference's precise public errors and fail closed on disagreement.
        validate_structure_bulk(*state, width, height, rules)
        raise ValueError("Compiled complete-state validator disagrees with the reference")
    return state


def _ledger_validated(cells, energy, words, width, height, rules):
    solver = _solver()
    solver.prepare((cells, energy, words), width, height, rules)
    solver.exports["ledger"](solver.store, width, height, solver.base)
    total = solver.exports["ledger_total"](solver.store)
    sensible = solver.exports["ledger_sensible"](solver.store)
    chemical = solver.exports["ledger_chemical"](solver.store)
    return EnergyLedger(sensible, total - sensible - chemical, chemical)


def plan_structure_compiled(cells, energy, words, width, height, rules):
    state = validate_structure_bulk(cells, energy, words, width, height, rules)
    return _solver().solve(state, width, height, rules, True)
