"""CPU-planned C6 structural corpus for the CPU-only Vitest negative controls.

``engine.structure_conformance`` steps the same corpus through the native GPU
transport and remains the native fixture. This module plans every scene with the
bulk Python planner alone, so ``engine/structure.cpu.test.ts`` can run its
executed source mutants on a host without a WebGPU adapter. Each step carries
the planner outputs and the planned state in the native report's shape.
"""

import json
from dataclasses import asdict

import numpy as np

from engine.structure_bulk import plan_structure_bulk
from engine.structure_conformance import corpus


def cases():
    output = []
    for case, rules in corpus():
        width, height = case["width"], case["height"]
        state = tuple(np.array(case[name], dtype=np.uint32) for name in ("cells", "energyQ", "structure"))
        steps = []
        for tick in range(case["ticks"]):
            plan = plan_structure_bulk(*state, width, height, rules)
            state = plan.apply(*state, width=width, height=height)
            steps.append({"tick": tick, "cells": state[0].tolist(), "energyQ": state[1].tolist(),
                          "structure": state[2].tolist(),
                          **{name: getattr(plan, name).tolist() for name in ("sources", "loads", "capacities", "reactions", "distances")},
                          "components": [asdict(component) for component in plan.components],
                          "supportedWeight": plan.supported_weight})
        output.append({**case, "steps": steps})
    return output


if __name__ == "__main__":
    print(json.dumps(cases(), separators=(",", ":"), allow_nan=False))
