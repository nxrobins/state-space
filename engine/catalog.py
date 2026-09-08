"""Validated source of material and packed-state definitions.

No GPU dependencies: tools and external clients can validate catalogs before
creating a device. JSON duplicate keys are errors rather than silent overrides.
"""

import hashlib
import json
import re
from pathlib import Path


CATALOG_PATH = Path(__file__).with_name("materials.json")


def canonical_catalog(catalog: dict) -> str:
    canonical = {**catalog, "materials": sorted(catalog["materials"], key=lambda record: record["id"])}
    return json.dumps(canonical, sort_keys=True, separators=(",", ":"))


def catalog_hash(catalog: dict) -> str:
    return hashlib.sha256(canonical_catalog(catalog).encode("utf-8")).hexdigest()


def integer(value, minimum: int, maximum: int, label: str) -> int:
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(f"{label} must be an integer in [{minimum}, {maximum}]")
    return value


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate JSON key: {key}")
        result[key] = value
    return result


def load_catalog(path: Path = CATALOG_PATH) -> dict:
    catalog = json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=unique_object)
    validate_catalog(catalog)
    return catalog


def validate_catalog(catalog: dict) -> None:
    try:
        _validate_catalog(catalog)
    except (TypeError, KeyError, AttributeError) as error:
        raise ValueError(f"Malformed catalog structure: {error}") from error


def _validate_catalog(catalog: dict) -> None:
    if not isinstance(catalog, dict):
        raise ValueError("Catalog must be an object")
    required = {"schema_version", "cold_stride", "capacity", "bit_fields", "structure_fields", "phases", "flags", "cold_fields", "materials"}
    if set(catalog) != required:
        raise ValueError(f"Catalog keys must be {sorted(required)}")
    integer(catalog["schema_version"], 3, 3, "schema_version")
    integer(catalog["capacity"], 256, 256, "capacity")
    integer(catalog["cold_stride"], 24, 24, "cold_stride")
    expected_layout = {"material": (0, 8, False), "thermal": (8, 8, False),
                       "kinetic_x": (16, 4, True), "kinetic_y": (20, 4, True),
                       "phase": (24, 4, False), "flags": (28, 4, False)}
    if set(catalog["bit_fields"]) != set(expected_layout):
        raise ValueError("Version 3 requires all six packed-state fields")
    for name, expected in expected_layout.items():
        field = catalog["bit_fields"][name]
        if set(field) != {"shift", "bits", "signed"}:
            raise ValueError(f"Invalid bit-field definition: {name}")
        integer(field["shift"], 0, 31, f"{name}.shift")
        integer(field["bits"], 1, 32, f"{name}.bits")
        if type(field["signed"]) is not bool or (field["shift"], field["bits"], field["signed"]) != expected:
            raise ValueError(f"Changing {name} encoding requires a new schema version")
    structure_layout = {"integrity": {"shift": 0, "bits": 8}, **{name: {"shift": shift, "bits": 1}
                        for name, shift in zip(("bond_left", "bond_right", "bond_up", "bond_down", "anchor", "fresh"), range(8, 14))}}
    if catalog["structure_fields"] != structure_layout:
        raise ValueError("Structural bit layout requires a new schema version")
    for name, field in catalog["structure_fields"].items():
        integer(field["shift"], 0, 31, f"structure.{name}.shift")
        integer(field["bits"], 1, 32, f"structure.{name}.bits")
    for table_name, maximum in (("phases", 15), ("flags", 15)):
        table = catalog[table_name]
        if not isinstance(table, dict) or not table or len(set(table.values())) != len(table):
            raise ValueError(f"{table_name} must contain unique values")
        for name, value in table.items():
            if not re.fullmatch(r"[A-Z][A-Z_0-9]*", name):
                raise ValueError(f"Invalid {table_name} symbol: {name}")
            integer(value, 0 if table_name == "phases" else 1, maximum, name)
            if table_name == "flags" and value & (value - 1):
                raise ValueError(f"Flag must contain exactly one bit: {name}")
    phase_names = ["SOLID", "POWDER", "LIQUID", "VISCOUS", "GAS", "PLASMA", "FROZEN", "MOLTEN",
                   "BURNING", "CONDENSING", "EVAPORATING", "SUBLIMATING"]
    if any(catalog["phases"].get(name) != index for index, name in enumerate(phase_names)):
        raise ValueError("Changing existing phase IDs requires a new schema version")
    flags = {"BURNING": 1, "CONDUCTING": 2, "PRESSURIZED": 4, "PLAYER_OWNED": 8}
    if catalog["flags"] != flags:
        raise ValueError("Changing flag bits requires a new schema version")
    fields = catalog["cold_fields"]
    expected_fields = ["density", "conductivity", "melt_point", "boil_point", "flash_point",
                       "reactivity", "porosity", "optical", "freeze_point", "condense_point",
                       "latent_heat_melt", "latent_heat_boil", "melts_into", "boils_into",
                       "freezes_into", "condenses_into", "fuel_energy", "burns_into", "smoke_product",
                       "phase_energy", "default_phase", "oxidizer", "cohesion", "softening"]
    if fields != expected_fields:
        raise ValueError("Changing cold-table field offsets requires a new schema version")
    records = catalog["materials"]
    if not isinstance(records, list) or not records:
        raise ValueError("materials must be a nonempty list")
    ids, names = set(), set()
    for record in records:
        if set(record) != {"id", "name", "default_thermal", "color", "properties"}:
            raise ValueError("Material has missing or unexpected keys")
        material_id = integer(record["id"], 0, 255, "material.id")
        name = record["name"]
        if not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z_0-9]*", name):
            raise ValueError("Invalid material name")
        if material_id in ids or name in names:
            raise ValueError(f"Duplicate material ID or name: {material_id}/{name}")
        ids.add(material_id)
        names.add(name)
        integer(record["properties"]["default_phase"], 0, 15, f"{name}.default_phase")
        if record["properties"]["default_phase"] not in catalog["phases"].values():
            raise ValueError(f"Undefined default phase: {name}")
        integer(record["default_thermal"], 0, 255, f"{name}.default_thermal")
        if not isinstance(record["color"], str) or not re.fullmatch(r"#[0-9a-fA-F]{6}", record["color"]):
            raise ValueError(f"Invalid color: {name}")
        props = record["properties"]
        if set(props) != set(fields):
            raise ValueError(f"Missing or unexpected material properties: {name}")
        for field, value in props.items():
            integer(value, 0, 0xffffffff if field == "optical" else 255, f"{name}.{field}")
        if props["softening"] and not props["cohesion"]:
            raise ValueError(f"Softening requires nonzero cohesion: {name}")
    if not any(r["id"] == 0 and r["name"] == "air" for r in records):
        raise ValueError("Material 0 must be air")
    builtin_names = ["air", "stone", "water", "sand", "fire", "metal", "oil", "wood", "ice",
                     "steam", "lava", "glass", "player", "ash", "smoke", "oil_vapor", "molten_metal", "molten_glass"]
    by_id = {r["id"]: r for r in records}
    if any(by_id.get(index, {}).get("name") != name for index, name in enumerate(builtin_names)):
        raise ValueError("Changing existing material IDs requires a new schema version")
    for record in records:
        props = record["properties"]
        for field in ("melts_into", "boils_into", "freezes_into", "condenses_into", "burns_into", "smoke_product"):
            if props[field] not in ids:
                raise ValueError(f"Undefined target {record['name']}.{field}: {props[field]}")
        for threshold, target in (("melt_point", "melts_into"), ("boil_point", "boils_into"),
                                  ("freeze_point", "freezes_into"), ("condense_point", "condenses_into")):
            if props[target] and not props[threshold]:
                raise ValueError(f"Transition target without a threshold: {record['name']}.{target}")
        if props["fuel_energy"] and not all(props[f] for f in ("flash_point", "burns_into", "smoke_product")):
            raise ValueError(f"Incomplete combustion definition: {record['name']}")

    from engine.thermal_registry import thermodynamics_from_catalog
    thermodynamics_from_catalog(catalog)
