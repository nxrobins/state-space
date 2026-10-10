"""State Space: deterministic material fields and portable, validated state."""

from engine.contracts import Snapshot
from engine.field import Field, PassReport, create_field
from engine.registry import DEFAULT_REGISTRY, MaterialRegistry
from engine.rendering import MaterialRenderer

__all__ = ["DEFAULT_REGISTRY", "Field", "MaterialRegistry", "MaterialRenderer", "PassReport", "Snapshot", "create_field"]
