"""JSON-compatible catalog cases shared with the TypeScript validator."""

import copy
import json

from engine import MaterialRegistry
from tests.test_sdk import example_registry


def cases():
    source = example_registry().to_dict()
    values = [("valid-extension", copy.deepcopy(source))]
    reverse = copy.deepcopy(source)
    reverse["materials"].reverse()
    values.append(("reordered", reverse))
    for name, change in [
        ("schema", lambda c: c.update(schema_version=1)),
        ("stride", lambda c: c.update(cold_stride=23)),
        ("missing-field", lambda c: c.pop("flags")),
        ("duplicate-id", lambda c: c["materials"].append(copy.deepcopy(c["materials"][18]))),
        ("renamed-v2-id", lambda c: c["materials"][15].update(name="reused")),
        ("bad-color", lambda c: c["materials"][18].update(color="red")),
        ("bad-default", lambda c: c["materials"][18].update(default_thermal=0.5)),
    ]:
        candidate = copy.deepcopy(source)
        change(candidate)
        values.append((name, candidate))
    for mid, name, value in [(18, "melts_into", 254), (18, "latent_heat_melt", 0),
                             (19, "freezes_into", 5), (19, "freeze_point", 80),
                             (19, "fuel_energy", 1), (20, "smoke_product", 20),
                             (255, "conductivity", 0.5), (255, "density", True),
                             (255, "density", "2"), (255, "density", None),
                             (255, "density", 0), (255, "optical", 0xffffffff),
                             (255, "optical", 0x100000000), (18, "oxidizer", 1),
                             (18, "boils_into", 19), (18, "default_phase", 15)]:
        candidate = copy.deepcopy(source)
        next(record for record in candidate["materials"] if record["id"] == mid)["properties"][name] = value
        values.append((f"{mid}-{name}-{value}", candidate))
    result = []
    for name, catalog in values:
        try:
            registry = MaterialRegistry(catalog)
            result.append(dict(name=name, catalog=catalog, accepted=True, hash=registry.hash))
        except ValueError:
            result.append(dict(name=name, catalog=catalog, accepted=False))
    return result


if __name__ == "__main__":
    print(json.dumps(cases(), allow_nan=False))
