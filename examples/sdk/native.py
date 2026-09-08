"""Run after installing the wheel. Uses only the supported package entry point."""

import contextlib
import json
import sys
from dataclasses import asdict
from pathlib import Path

from engine import DEFAULT_REGISTRY, create_field


def run():
    registry = DEFAULT_REGISTRY.extend(json.loads(Path(__file__).with_name("materials.json").read_text()))
    with create_field(8, 7, registry=registry) as world:
        for x in range(world.width):
            world.set_cell(x, 6, 1, 20)
        world.set_cell(2, 1, 18, 120, 9)
        world.set_cell(4, 2, 20, 150)
        world.set_cell(1, 1, 255, 20, 15)
        world.set_energy(2, 1, 120 * 256 + 17)
        initial = world.snapshot().to_dict()
        passes = world.step(3, inspect=True)
        saved = world.snapshot().to_dict()
        world.step(2)
        final = world.snapshot().to_dict()
        world.restore(saved)
        world.step(2)
        if world.snapshot().to_dict() != final:
            raise RuntimeError("Snapshot continuation differed")
        return {"catalogHash": registry.hash, "initial": initial, "final": final,
                "energyQ": str(world.energy_ledger().total_q), "replayEqual": True,
                "passes": [{"tick": report.tick, "passId": report.pass_id,
                            "changes": [asdict(change) for change in report.changes],
                            "deltaQ": str(report.after.total_q - report.before.total_q)} for report in passes]}


if __name__ == "__main__":
    with contextlib.redirect_stdout(sys.stderr):
        result = run()
    print(json.dumps(result))
