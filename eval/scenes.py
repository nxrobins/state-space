"""Versioned, seeded acceptance and performance workloads."""

import copy

import numpy as np

from engine.conformance import conformance_cases
from engine.registry import DEFAULT_REGISTRY
from engine.schema import VoxelState, pack_voxel
from engine.state import seed_state, thermal_view
from engine.structure_bulk import seed_structure_bulk, normalize_bonds_bulk


KINDS = ("sparse", "dense", "thermal", "reactive")


def cell(material: int, thermal: int = 20, flags: int = 0, registry=DEFAULT_REGISTRY) -> int:
    record = registry.material(material)
    return pack_voxel(VoxelState(material, thermal, 0, 0, record["properties"]["default_phase"], flags))


def prepared(scene: dict, registry=DEFAULT_REGISTRY, fractional_seed: int | None = None) -> dict:
    cells, energy = seed_state(np.array(scene["cells"], dtype=np.uint32), registry._model)
    if fractional_seed is not None:
        rng = np.random.default_rng(fractional_seed)
        energy += rng.integers(1, 500 * 256, size=energy.size, dtype=np.uint32)
        cells = thermal_view(cells, energy, registry._model)
    for index, value in scene.get("energyOverrides", {}).items():
        energy[int(index)] = value
    cells = thermal_view(cells, energy, registry._model)
    words = seed_structure_bulk(cells, scene["width"], scene["height"], registry._structure)
    for index, value in scene.get("structureOverrides", {}).items():
        words[int(index)] = value
    words = normalize_bonds_bulk(cells, words, scene["width"], scene["height"], registry._structure)
    return {**scene, "cells": cells.tolist(), "energyQ": energy.tolist(), "structure": words.tolist(), "catalog": registry.to_dict()}


def workload(width: int, height: int, kind: str, seed: int, ticks: int) -> dict:
    if kind not in KINDS:
        raise ValueError("Unknown benchmark workload")
    rng = np.random.default_rng(seed)
    grid = np.full(width * height, cell(0), dtype=np.uint32)
    for y in range(height):
        for x in range(width):
            index = y * width + x
            if x in (0, width - 1) or y == height - 1:
                grid[index] = cell(1)
            elif kind == "sparse":
                if rng.random() < .03:
                    grid[index] = cell(int(rng.choice([2, 3, 14])), 160, int(rng.integers(0, 16)))
            elif kind == "dense":
                grid[index] = cell(int(rng.choice([0, 2, 3, 6, 14])), 25, int(rng.integers(0, 16)))
            elif kind == "thermal":
                grid[index] = cell(5, 255 if (x + y) % 2 else 0)
            else:
                grid[index] = cell(int(rng.choice([0, 0, 0, 2, 7, 8, 9, 6])), int(rng.integers(20, 256)))
    return prepared({"name": f"{kind}-{width}x{height}", "width": width, "height": height,
                     "tick": 3, "ticks": ticks, "cells": grid.tolist()},
                    fractional_seed=seed if kind == "thermal" else None)


def acceptance_cases(seed: int) -> list[dict]:
    cases = [prepared(scene, fractional_seed=seed if scene["name"].endswith("-2") else None)
             for scene in conformance_cases()]
    cases.extend(workload(33, 17, kind, seed + index, 4) for index, kind in enumerate(KINDS))
    # Custom IDs exercise registry-driven behavior, including the highest allowed ID.
    catalog = DEFAULT_REGISTRY.to_dict()
    records = {record["id"]: record for record in catalog["materials"]}
    powder = copy.deepcopy(records[3])
    powder.update(id=255, name="evaluation_grit")
    metal = copy.deepcopy(records[5])
    metal.update(id=18, name="evaluation_copper")
    liquid = copy.deepcopy(records[16])
    liquid.update(id=19, name="evaluation_molten_copper")
    metal["properties"].update(melt_point=80, latent_heat_melt=20, melts_into=19)
    liquid["properties"].update(freeze_point=60, latent_heat_melt=20, freezes_into=18, phase_energy=20)
    registry = DEFAULT_REGISTRY.extend([powder, metal, liquid])
    grid = [cell(0)] * (9 * 7)
    for x in range(9):
        grid[6 * 9 + x] = cell(1)
    grid[12], grid[13], grid[23] = cell(255, 20, 15, registry), cell(18, 150, 9, registry), cell(19, 20, 8, registry)
    cases.append(prepared({"name": "custom-registry", "width": 9, "height": 7, "tick": 7, "ticks": 5, "cells": grid}, registry))
    return cases
