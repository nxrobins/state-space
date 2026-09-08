"""Creation, validation, and accounting of packed cells plus conserved energy."""

import numpy as np

from engine.catalog import load_catalog, validate_catalog
from engine.enthalpy import ENERGY_SCALE, Thermodynamics
from engine.thermal_registry import thermodynamics_from_catalog
from engine.validation import validate_packed
from engine.array_state import temperature_q_array


def catalog_from_cold(cold) -> dict:
    catalog = load_catalog()
    stride, capacity = catalog["cold_stride"], catalog["capacity"]
    cold = validate_packed(cold, stride * capacity, "cold_table")
    fields = catalog["cold_fields"]
    ids = {record["id"] for record in catalog["materials"]}
    for mid in range(capacity):
        row = cold[mid * stride:(mid + 1) * stride]
        if np.any(row[len(fields):]) or (mid not in ids and np.any(row)):
            raise ValueError("Undefined cold material or nonzero reserved property")
    for record in catalog["materials"]:
        record["properties"] = {name: int(cold[record["id"] * stride + index]) for index, name in enumerate(fields)}
    validate_catalog(catalog)
    return catalog


def thermodynamics_from_cold(cold) -> Thermodynamics:
    return thermodynamics_from_catalog(catalog_from_cold(cold))


def thermal_view(cells, energies, model: Thermodynamics) -> np.ndarray:
    cells = validate_packed(cells, len(energies))
    temperatures = np.minimum(255, temperature_q_array(cells & 255, energies, model) // ENERGY_SCALE).astype(np.uint32)
    return (cells & np.uint32(0xffff00ff)) | (temperatures << 8)


def seed_state(cells, model: Thermodynamics | None = None) -> tuple[np.ndarray, np.ndarray]:
    """Import a new packed grid as a sensible heat dose, then derive its view.

    This is initial placement, not exact continuation. At a phase interval the
    supplied heat dose can become latent energy, changing the displayed byte.
    """
    model = model or thermodynamics_from_catalog(load_catalog())
    cells = validate_packed(cells, len(cells))
    energies = []
    for value in cells:
        material = model._material(int(value) & 255)
        energies.append(material.phase_energy_q + material.chemical_energy_q + ((int(value) >> 8) & 255) * ENERGY_SCALE)
    energy = np.array(energies, dtype=np.uint32)
    return thermal_view(cells, energy, model), energy


def validate_state(cells, energies, length: int, model: Thermodynamics | None = None) -> tuple[np.ndarray, np.ndarray]:
    model = model or thermodynamics_from_catalog(load_catalog())
    cells = validate_packed(cells, length)
    energy = validate_packed(energies, length, "energyQ")
    expected = thermal_view(cells, energy, model)
    if not np.array_equal(expected, cells):
        raise ValueError("Packed thermal view disagrees with conserved energy; use seed_state for initial placement")
    return cells, energy
