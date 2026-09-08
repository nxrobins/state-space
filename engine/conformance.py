"""Generate deterministic, per-pass native GPU evidence for backend comparisons."""

import contextlib
import json
import sys

import numpy as np

from engine.compositor import CompositionEngine
from engine.registry import DEFAULT_REGISTRY
from engine.structure_bulk import seed_structure_bulk
from engine.state import seed_state, thermal_view, thermodynamics_from_cold
from engine.schema import (DEFAULT_PHASES, MAT_AIR, MAT_FIRE, MAT_SMOKE, MAT_STEAM, MAT_STONE, MAT_WATER, MAT_WOOD,
                           VoxelState, build_cold_table_buffer, pack_voxel)


def conformance_cases() -> list[dict]:
    cases = []
    for width, height in ((1, 1), (1, 7), (7, 1), (7, 5), (8, 8), (17, 19)):
        for seed in range(3):
            rng = np.random.default_rng(6000 + seed)
            cells = [pack_voxel(VoxelState(int(material), int(rng.integers(0, 256)), int(rng.integers(-8, 8)),
                                          int(rng.integers(-8, 8)), DEFAULT_PHASES[int(material)], int(rng.integers(0, 16))))
                     for material in rng.integers(0, len(DEFAULT_PHASES), size=width * height)]
            cases.append({"name": f"mixed-{width}x{height}-{seed}", "width": width, "height": height,
                          "tick": 0, "ticks": 4, "cells": cells})
    wood = pack_voxel(VoxelState(MAT_WOOD, 255, 0, 0, DEFAULT_PHASES[MAT_WOOD], 0))
    air = pack_voxel(VoxelState(MAT_AIR, 20, 0, 0, DEFAULT_PHASES[MAT_AIR], 0))
    cases.append({"name": "shared-oxygen", "width": 3, "height": 1, "tick": 0, "ticks": 1, "cells": [wood, air, wood]})
    gas = [air] * 15
    gas[10] = pack_voxel(VoxelState(MAT_SMOKE, 200, -3, 7, DEFAULT_PHASES[MAT_SMOKE], 8))
    cases.append({"name": "hot-smoke", "width": 3, "height": 5, "tick": 0, "ticks": 4, "cells": gas})
    cases.append({"name": "orphan-fire", "width": 1, "height": 1, "tick": 3, "ticks": 1,
                  "cells": [pack_voxel(VoxelState(MAT_FIRE, 255, 3, -4, DEFAULT_PHASES[MAT_FIRE], 8))]})
    rng = np.random.default_rng(7142)
    baffles = [air] * (17 * 19)
    for index in rng.choice(np.arange(17 * 3, 17 * 15), size=38, replace=False):
        baffles[int(index)] = pack_voxel(VoxelState(MAT_STONE, 20, 0, 0, DEFAULT_PHASES[MAT_STONE], 0))
    for y in (15, 16, 17):
        for x in range(5, 12):
            mat = MAT_SMOKE if (x + y) % 2 else MAT_STEAM
            baffles[y * 17 + x] = pack_voxel(VoxelState(mat, 180, 0, 0, DEFAULT_PHASES[mat], 0))
    cases.append({"name": "baffled-hot-gas", "width": 17, "height": 19, "tick": 0, "ticks": 12, "cells": baffles})
    for mat, name in ((MAT_WATER, "freeze-local-index"), (MAT_STEAM, "condense-local-index")):
        cases.append({"name": name, "width": 1, "height": 1, "tick": 0, "ticks": 1,
                      "cells": [pack_voxel(VoxelState(mat, 20, -8, 7, DEFAULT_PHASES[mat], 15))]})
    def structural_scene(name, width, height, placements, ticks, energy_overrides=None, structure_overrides=None):
        cells = [air] * (width * height)
        for x, y, material, temperature in placements:
            cells[y * width + x] = pack_voxel(VoxelState(material, temperature, x % 16 - 8, y % 16 - 8, DEFAULT_PHASES[material], (x + y) % 16))
        cases.append({"name": name, "width": width, "height": height, "tick": 0, "ticks": ticks, "cells": cells,
                      "energyOverrides": energy_overrides or {}, "structureOverrides": structure_overrides or {}})
    floor = [(x, 6, 1, 20) for x in range(9)]
    pillars = [(x, y, 1, 20) for x in (1, 7) for y in range(3, 6)]
    structural_scene("supported-metal-span", 9, 7, floor + pillars + [(x, 2, 5, 20) for x in range(1, 8)], 8)
    structural_scene("coherent-metal-plate", 9, 9, [(x, y, 5, 20) for y in (1, 2) for x in (2, 3, 4)], 4)
    support = [(x, 7, 1, 20) for x in range(7)] + [(1, y, 7, 255) for y in range(2, 7)] + [(x, 1, 5, 20) for x in range(1, 5)]
    structural_scene("burning-wood-support", 7, 8, support, 8)
    structural_scene("melting-fragment", 5, 5, [(1, 1, 5, 255), (2, 1, 5, 255)], 4, {6: 800 * 256, 7: 800 * 256})
    structural_scene("solidification-bonds", 3, 3, [(x, 2, 1, 0) for x in range(3)] + [(x, 1, 2, 0) for x in range(3)], 3, {3: 0, 4: 0, 5: 0})
    structural_scene("broken-pinned-grain", 1, 4, [(0, 1, 5, 20), (0, 2, 7, 20), (0, 3, 1, 20)], 4,
                     structure_overrides={1: 0, 2: 4096})
    # A broken pin still supports the intact beam until combustion consumes it.
    # This distinguishes loss of support through reaction from prior heat damage.
    structural_scene("consumed-pinned-support", 5, 7,
                     [(x, 6, 1, 20) for x in range(5)] + [(x, 2, 5, 20) for x in range(1, 4)] + [(2, 3, 7, 255)], 5,
                     structure_overrides={17: 4096})
    return cases


def run_cases() -> list[dict]:
    cold = build_cold_table_buffer()
    results = []
    model = thermodynamics_from_cold(cold)
    with CompositionEngine() as engine:
        for case in conformance_cases():
            grid, energy = seed_state(np.array(case["cells"], dtype=np.uint32), model)
            if case["name"].startswith("mixed-") and case["name"].endswith("-2"):
                rng = np.random.default_rng(48193)
                energy = energy + rng.integers(1, 500 * 256, size=energy.size, dtype=np.uint32)
                grid = thermal_view(grid, energy, model)
            for index, value in case.get("energyOverrides", {}).items():
                energy[int(index)] = value
            grid = thermal_view(grid, energy, model)
            structure = seed_structure_bulk(grid, case["width"], case["height"], DEFAULT_REGISTRY._structure)
            for index, value in case.get("structureOverrides", {}).items():
                structure[int(index)] = value
            # A provided structural edit can detach an existing reciprocal edge.
            from engine.structure_bulk import normalize_bonds_bulk
            structure = normalize_bonds_bulk(grid, structure, case["width"], case["height"], DEFAULT_REGISTRY._structure)
            result = engine.run(grid, cold, case["width"], case["height"], initial_energy=energy, initial_structure=structure,
                                n_ticks=case["ticks"], start_tick=case["tick"], trace_passes=True)
            passes = []
            for (tick, pass_id, cells), (_, _, energies), (_, _, words) in zip(result["pass_snapshots"], result["pass_energy_snapshots"], result["pass_structure_snapshots"]):
                if sum(int(e) for e in energies) != sum(int(e) for e in energy):
                    raise AssertionError(f"Energy drift in {case['name']} {pass_id}")
                passes.append({"tick": tick, "id": pass_id, "cells": cells.tolist(), "energyQ": energies.tolist(), "structure": words.tolist()})
            results.append({**case, "cells": grid.tolist(), "energyQ": energy.tolist(), "structure": structure.tolist(), "passes": passes})
    return results


if __name__ == "__main__":
    with contextlib.redirect_stdout(sys.stderr):
        results = run_cases()
    print(json.dumps(results, allow_nan=False))
