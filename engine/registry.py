"""Immutable validated material catalogs for independently embedded worlds."""

import copy
import json
from dataclasses import dataclass, field
from types import MappingProxyType

import numpy as np

from engine.catalog import canonical_catalog, catalog_hash, load_catalog, validate_catalog
from engine.enthalpy import Thermodynamics
from engine.thermal_registry import thermodynamics_from_catalog
from engine.validation import checked_integer


@dataclass(frozen=True, init=False)
class MaterialRegistry:
    """A complete, validated catalog with stable hash and isolated public views.

    Export a mutable catalog with to_dict(), edit it, and construct a new registry
    to change properties or add phase families. Existing worlds retain their
    original registry and cannot silently reinterpret snapshots.
    """

    hash: str
    _json: str = field(repr=False)
    _cold_bytes: bytes = field(repr=False)
    _records: object = field(repr=False, compare=False)
    _model: Thermodynamics = field(repr=False, compare=False)
    _structure: object = field(repr=False, compare=False)

    def __init__(self, catalog: dict):
        value = copy.deepcopy(catalog)
        validate_catalog(value)
        cold = np.zeros(value["cold_stride"] * value["capacity"], dtype="<u4")
        records = {}
        for record in value["materials"]:
            start = record["id"] * value["cold_stride"]
            cold[start:start + len(value["cold_fields"])] = [record["properties"][name] for name in value["cold_fields"]]
            records[record["id"]] = MappingProxyType({**record, "properties": MappingProxyType(record["properties"])})
        object.__setattr__(self, "hash", catalog_hash(value))
        object.__setattr__(self, "_json", canonical_catalog(value))
        object.__setattr__(self, "_cold_bytes", cold.tobytes())
        object.__setattr__(self, "_records", MappingProxyType(records))
        object.__setattr__(self, "_model", thermodynamics_from_catalog(value))
        from engine.structure import StructuralMaterial, StructuralRules
        object.__setattr__(self, "_structure", StructuralRules(
            [StructuralMaterial(row["id"], *(row["properties"][name] for name in ("density", "cohesion", "softening")))
             for row in value["materials"]], self._model))

    def to_dict(self) -> dict:
        return json.loads(self._json)

    def cold_table(self) -> np.ndarray:
        return np.frombuffer(self._cold_bytes, dtype="<u4").copy()

    @property
    def material_ids(self) -> tuple[int, ...]:
        return tuple(sorted(self._records))

    def material(self, material_id: int):
        material_id = checked_integer(material_id, 0, 255, "material")
        if material_id not in self._records:
            raise ValueError(f"Undefined material: {material_id}")
        return self._records[material_id]

    def extend(self, materials) -> "MaterialRegistry":
        catalog = self.to_dict()
        catalog["materials"].extend(copy.deepcopy(list(materials)))
        return MaterialRegistry(catalog)


DEFAULT_REGISTRY = MaterialRegistry(load_catalog())
