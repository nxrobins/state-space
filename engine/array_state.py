"""Bulk host projections/accounting, differential-tested against the scalar law.

The scalar Thermodynamics implementation remains the independent reference.
All intermediates and reductions use signed 64-bit integers. A valid world has
at most MAX_CELLS cells with at most MAX_ENERGY_Q each, so its sum fits in i64.
"""

import numpy as np

from engine.enthalpy import EnergyLedger, MAX_ENERGY_Q, NO_MATERIAL, THERMO_STRIDE, Thermodynamics
from engine.validation import MAX_CELLS, validate_packed


def _validated(materials, energies, model: Thermodynamics):
    count = len(materials)
    if not 0 < count <= MAX_CELLS:
        raise ValueError("Bulk state requires a nonempty, addressable world")
    ids = validate_packed(materials, count, "materials")
    energy = validate_packed(energies, count, "energyQ")
    if np.any(ids > 255):
        raise ValueError("Material IDs must be in [0, 255]")
    known = np.zeros(256, dtype=np.bool_)
    known[list(model.materials)] = True
    if not np.all(known[ids]):
        raise ValueError("Undefined thermal material")
    table = np.array(model.gpu_table(), dtype=np.int64).reshape(256, THERMO_STRIDE)
    if np.any(energy > MAX_ENERGY_Q) or np.any(energy < table[ids, 2]):
        raise ValueError("Energy lies outside its material's permitted range")
    return ids, energy.astype(np.int64), table


def _temperatures(ids, energy, table):
    phase, chemical = table[ids, 1], table[ids, 2]
    heat = energy - chemical
    temperature = np.maximum(0, heat - phase)
    up_id, up_threshold = table[ids, 3], table[ids, 4]
    down_id, down_threshold = table[ids, 5], table[ids, 6]
    upward = (up_id != NO_MATERIAL) & (heat >= phase + up_threshold)
    downward = ~upward & (down_id != NO_MATERIAL) & (heat <= phase + down_threshold)
    # NumPy evaluates both where branches. Replace absent targets BEFORE lookup.
    up_phase = table[np.where(up_id == NO_MATERIAL, 0, up_id), 1]
    down_phase = table[np.where(down_id == NO_MATERIAL, 0, down_id), 1]
    temperature = np.where(upward, np.maximum(up_threshold, heat - up_phase), temperature)
    return np.where(downward, np.minimum(down_threshold, np.maximum(0, heat - down_phase)), temperature)


def temperature_q_array(materials, energies, model: Thermodynamics) -> np.ndarray:
    ids, energy, table = _validated(materials, energies, model)
    return _temperatures(ids, energy, table)


def energy_ledger_array(materials, energies, model: Thermodynamics) -> EnergyLedger:
    ids, energy, table = _validated(materials, energies, model)
    chemical = int(np.sum(table[ids, 2], dtype=np.int64))
    sensible = int(np.sum(_temperatures(ids, energy, table), dtype=np.int64))
    total = int(np.sum(energy, dtype=np.int64))
    return EnergyLedger(sensible, total - chemical - sensible, chemical)
