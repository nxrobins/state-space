"""C6 planner/transport corpus; intentionally separate from production ca-v2 ticks."""

import argparse
from dataclasses import asdict
import hashlib
import json
from pathlib import Path

import numpy as np

from engine.registry import DEFAULT_REGISTRY, MaterialRegistry
from engine.schema import VoxelState, pack_voxel
from engine.state import seed_state, thermal_view
from engine.structure import (ANCHOR, BOND_BITS, INTEGRITY_MASK, StructuralMaterial, StructuralRules,
                              normalize_bonds, plan_structure, seed_structure, validate_structure)
from engine.structure_gpu import StructuralGPUProbe
from engine.structure_bulk import plan_structure_bulk


SEED = 630217


def fixture(name, width, height, placements, *, cohesion=255, softening=0, anchors=(), ticks=3,
            unbonded=False, owners=None, custom=False, temperature=20):
    catalog = DEFAULT_REGISTRY.to_dict()
    if custom:
        for material, density in ((254, 255), (255, 63)):
            properties = dict(catalog["materials"][1]["properties"])
            properties.update(density=density, conductivity=0)
            for property_name in ("melts_into", "boils_into", "freezes_into", "condenses_into", "melt_point", "boil_point",
                         "freeze_point", "condense_point", "latent_heat_melt", "latent_heat_boil", "phase_energy"):
                properties[property_name] = 0
            catalog["materials"].append({"id": material, "name": f"structural_probe_{material}",
                                          "default_thermal": 20, "color": "#64748b", "properties": properties})
    registry = MaterialRegistry(catalog)
    rows = [StructuralMaterial(record["id"], record["properties"]["density"],
             cohesion if record["properties"]["default_phase"] in (0, 6) else 0,
             softening if record["properties"]["default_phase"] in (0, 6) else 0)
            for record in catalog["materials"]]
    rules = StructuralRules(rows, registry._model)
    cells = np.array([pack_voxel(VoxelState(0, 20, i % 16 - 8, i // 16 % 16 - 8, 4, i % 16))
                      for i in range(width * height)], dtype=np.uint32)
    for x, y, material in placements:
        cells[y * width + x] = pack_voxel(VoxelState(material, min(255, temperature), x % 16 - 8, y % 16 - 8,
                                                   registry.material(material)["properties"]["default_phase"], (x + y) % 16))
    cells, energy = seed_state(cells, rules.thermal)
    energy += np.arange(len(cells), dtype=np.uint32) % 128
    if temperature > 255:
        for x, y, material in placements:
            record = registry.material(material)["properties"]
            energy[y * width + x] = (temperature + record["phase_energy"] + record["fuel_energy"]) * 256
    cells = thermal_view(cells, energy, rules.thermal)
    words = seed_structure(cells, width, height, rules, anchors=anchors)
    if unbonded:
        words &= np.uint32(INTEGRITY_MASK | ANCHOR)
    if owners:
        for index, owner in owners.items():
            for direction, offset in enumerate((-1, 1, -width, width)):
                if index + offset in owners and owners[index + offset] != owner:
                    words[index] &= np.uint32(0xffffffff ^ BOND_BITS[direction])
        words = normalize_bonds(cells, words, width, height, rules)
    return {"name": name, "width": width, "height": height, "ticks": ticks,
            "catalog": catalog, "materials": [asdict(row) for row in rows],
            "cells": cells.tolist(), "energyQ": energy.tolist(), "structure": words.tolist()}, rules


def corpus():
    cases = []
    beam = [(x, 6, 1) for x in range(9)] + [(x, y, 1) for x in (1, 7) for y in range(3, 6)] + [(x, 2, 5) for x in range(1, 8)]
    cases.append(fixture("supported-span", 9, 7, beam))
    cases.append(fixture("floating-plate", 9, 7, [(x, y, 5) for y in (1, 2) for x in (2, 3, 4)], ticks=6))
    cases.append(fixture("cantilever-fatigue", 8, 8, [(x, 1, 5) for x in range(1, 6)], cohesion=1, anchors=(9,), ticks=12))
    cases.append(fixture("contact-without-welding", 3, 5, [(1, 1, 5), (1, 2, 5)], unbonded=True, ticks=4))
    cases.append(fixture("contact-on-pin", 3, 5, [(1, 1, 5), (1, 2, 5)], unbonded=True, anchors=(7,)))
    cases.append(fixture("long-load-path", 515, 3, [(x, 1, 5) for x in range(1, 514)], anchors=(516, 1028), ticks=2))
    cases.append(fixture("exact-odd-load-split", 3, 3, [(x, 1, 255) for x in range(3)], custom=True, anchors=(3, 5)))
    cases.append(fixture("shared-load-junction", 3, 3, [(x, 1, 5) for x in range(3)], anchors=(4,)))
    cases.append(fixture("high-id-hot-softening", 5, 3, [(1, 1, 254), (2, 1, 254)], custom=True, softening=250, temperature=320))
    cases.append(fixture("high-id-warm-capacity", 5, 3, [(1, 1, 254), (2, 1, 254)], custom=True, softening=250, temperature=260))
    cases.append(fixture("fragmented-column-fluid", 5, 7, [(1, 1, 5), (2, 1, 5), (2, 2, 5), (1, 3, 5), (2, 3, 5), (1, 2, 2), (1, 4, 6)], ticks=5))
    a = {(1, 1), (2, 1), (3, 1), (1, 2), (1, 3), (2, 3)}
    b = {(2, 2), (3, 2), (3, 3), (3, 4)}
    for anchored in (False, True):
        owners = {y * 6 + x: int((x, y) in b) for x, y in a | b}
        cases.append(fixture(f"interlocking-{'pinned' if anchored else 'free'}", 6, 7,
                              [(x, y, 5) for x, y in sorted(a | b)], owners=owners, anchors=(7,) if anchored else ()))
    rng = np.random.default_rng(SEED)
    for width, height in ((1, 1), (1, 11), (13, 1), (7, 5), (17, 19), (33, 17)):
        for weak in (False, True):
            placements = [(x, y, int(rng.choice([0, 2, 3, 5, 7, 254, 255]))) for y in range(height) for x in range(width)]
            cases.append(fixture(f"mixed-{width}x{height}-{'weak' if weak else 'strong'}", width, height, placements,
                                  custom=True, cohesion=1 if weak else 255, unbonded=weak, ticks=4))
    names = [case["name"] for case, _ in cases]
    if len(set(names)) != len(names):
        raise RuntimeError("Structural conformance scenario identities must be unique")
    return cases


def source_hashes():
    root = Path(__file__).resolve().parent
    names = ("structure.py", "structure.ts", "structure_gpu.py", "structure_bulk.py", "structure_conformance.py",
             "shaders/structure_apply.wgsl", "state.py", "array_state.py", "enthalpy.py", "thermal.ts",
             "registry.py", "registry.ts", "materials.json")
    return {"engine/" + name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in names}


def run():
    before = source_hashes()
    output = []
    with StructuralGPUProbe() as gpu:
        device = dict(gpu.adapter.info)
        for case, rules in corpus():
            width, height = case["width"], case["height"]
            state = tuple(np.array(case[name], dtype=np.uint32) for name in ("cells", "energyQ", "structure"))
            initial_energy = sum(int(v) for v in state[1])
            initial_counts = np.bincount(state[0] & 255, minlength=256)
            steps = []
            for tick in range(case["ticks"]):
                reference = plan_structure(*state, width, height, rules)
                plan = plan_structure_bulk(*state, width, height, rules)
                if (any(not np.array_equal(getattr(reference, name), getattr(plan, name))
                        for name in ("sources", "structure", "loads", "capacities", "reactions", "distances"))
                        or reference.components != plan.components or reference.supported_weight != plan.supported_weight):
                    raise RuntimeError(f"Bulk structural planner differs: {case['name']} step {tick}")
                expected = plan.apply(*state, width=width, height=height)
                actual = gpu.apply(plan, *state, width, height)
                if any(not np.array_equal(a, b) for a, b in zip(expected, actual)):
                    raise RuntimeError(f"Structural GPU transport differs: {case['name']} step {tick}")
                validate_structure(*actual, width, height, rules)
                if sum(int(v) for v in actual[1]) != initial_energy or not np.array_equal(np.bincount(actual[0] & 255, minlength=256), initial_counts):
                    raise RuntimeError(f"Structural transport lost material/energy: {case['name']} step {tick}")
                steps.append({"tick": tick, "cells": actual[0].tolist(), "energyQ": actual[1].tolist(), "structure": actual[2].tolist(),
                              **{name: getattr(plan, name).tolist() for name in ("sources", "loads", "capacities", "reactions", "distances")},
                              "components": [asdict(component) for component in plan.components], "supportedWeight": plan.supported_weight})
                state = actual
            output.append({**case, "steps": steps})
    if before != source_hashes():
        raise RuntimeError("Structural sources changed during verification")
    return {"scope": "C6 scalar Python, bulk Python and native GPU permutation; TypeScript consumes this corpus; public backends remain ca-v2",
            "seed": SEED, "sourceHashes": before, "device": device, "cases": output}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()
    report = run()
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
        print(json.dumps({"cases": len(report["cases"]), "steps": sum(len(case["steps"]) for case in report["cases"]), "report": str(args.report)}, allow_nan=False))
    else:
        print(json.dumps(report, separators=(",", ":"), allow_nan=False))


if __name__ == "__main__":
    main()
