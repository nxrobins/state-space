"""Validation and portable snapshots for the current engine contract."""

from dataclasses import dataclass, field

import numpy as np

from engine.validation import (MAX_CELLS as MAX_CELLS, MAX_TICK as MAX_TICK, checked_integer as checked_integer,
                               validate_dimensions as validate_dimensions, validate_packed as validate_packed)
from engine.registry import DEFAULT_REGISTRY, MaterialRegistry
from engine.structure_bulk import validate_structure_bulk
from engine._generated_schema import SCHEMA_VERSION as SCHEMA_VERSION
from engine.version import RULES_VERSION as RULES_VERSION


MATERIAL_CATALOG_HASH = DEFAULT_REGISTRY.hash
@dataclass(frozen=True)
class Snapshot:
    width: int
    height: int
    tick: int
    packed_cells: np.ndarray
    energy_q: np.ndarray
    structure: np.ndarray
    schema_version: int = SCHEMA_VERSION
    rules_version: str = RULES_VERSION
    material_catalog_hash: str | None = None
    registry: MaterialRegistry = field(default=DEFAULT_REGISTRY, repr=False, compare=False, kw_only=True)

    def __post_init__(self):
        width, height = validate_dimensions(self.width, self.height)
        checked_integer(self.tick, 0, MAX_TICK, "tick")
        if type(self.schema_version) is not int or self.schema_version != SCHEMA_VERSION:
            raise ValueError("Unsupported snapshot schema version")
        if self.rules_version != RULES_VERSION:
            raise ValueError("Incompatible snapshot rules version")
        if not isinstance(self.registry, MaterialRegistry):
            raise ValueError("Snapshot requires a validated material registry")
        expected_hash = self.registry.hash
        if self.material_catalog_hash is None:
            object.__setattr__(self, "material_catalog_hash", expected_hash)
        if self.material_catalog_hash != expected_hash:
            raise ValueError("Incompatible snapshot material catalog")
        cells, energy, structure = validate_structure_bulk(self.packed_cells, self.energy_q, self.structure, width, height, self.registry._structure)
        # Immutable bytes prevent callers from re-enabling ndarray writeability.
        object.__setattr__(self, "packed_cells", np.frombuffer(cells.astype("<u4").tobytes(), dtype="<u4"))
        object.__setattr__(self, "energy_q", np.frombuffer(energy.astype("<u4").tobytes(), dtype="<u4"))
        object.__setattr__(self, "structure", np.frombuffer(structure.astype("<u4").tobytes(), dtype="<u4"))

    def to_dict(self) -> dict:
        return {"schemaVersion": self.schema_version, "rulesVersion": self.rules_version,
                "materialCatalogHash": self.material_catalog_hash, "width": int(self.width),
                "height": int(self.height), "tick": int(self.tick), "packedCells": self.packed_cells.tolist(),
                "energyQ": self.energy_q.tolist(), "structure": self.structure.tolist()}

    @classmethod
    def from_dict(cls, value: dict, *, registry: MaterialRegistry = DEFAULT_REGISTRY) -> "Snapshot":
        expected = {"schemaVersion", "rulesVersion", "materialCatalogHash", "width", "height", "tick", "packedCells", "energyQ", "structure"}
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError("Snapshot contains missing or unexpected fields")
        if not isinstance(value["materialCatalogHash"], str):
            raise ValueError("Snapshot transport requires an explicit material catalog hash")
        return cls(value["width"], value["height"], value["tick"], value["packedCells"], value["energyQ"], value["structure"],
                   value["schemaVersion"], value["rulesVersion"], value["materialCatalogHash"], registry=registry)
