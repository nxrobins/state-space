"""C6 reference structural planner. Production integration is tracked in STRUCTURES.md.

Persistent bonds define fragments; contact transmits support without welding.
The output is a conservative source permutation and the transported damage state.
"""

from collections import deque
from dataclasses import dataclass
import hashlib
from types import MappingProxyType

import numpy as np

from engine.enthalpy import ENERGY_SCALE, Thermodynamics
from engine.array_state import temperature_q_array
from engine.state import validate_state
from engine.validation import checked_integer, validate_dimensions, validate_packed
from engine._generated_schema import (PHASE_SOLID, PHASE_FROZEN, STRUCTURE_INTEGRITY_MASK,
    STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_RIGHT_MASK, STRUCTURE_BOND_UP_MASK, STRUCTURE_BOND_DOWN_MASK,
    STRUCTURE_ANCHOR_MASK, STRUCTURE_FRESH_MASK, STRUCTURE_COMPLETE_MASK, STRUCTURE_INTERNAL_MASK)


INTEGRITY_MASK = STRUCTURE_INTEGRITY_MASK
BOND_BITS = (STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_RIGHT_MASK, STRUCTURE_BOND_UP_MASK, STRUCTURE_BOND_DOWN_MASK)
OPPOSITE = (1, 0, 3, 2)
ANCHOR = STRUCTURE_ANCHOR_MASK
FRESH = STRUCTURE_FRESH_MASK
COMPLETE_MASK = STRUCTURE_COMPLETE_MASK
INTERNAL_MASK = STRUCTURE_INTERNAL_MASK
NO_COMPONENT = 0xffffffff


@dataclass(frozen=True)
class StructuralMaterial:
    id: int
    density: int
    cohesion: int = 0
    softening: int = 0


@dataclass(frozen=True, init=False)
class StructuralRules:
    """Validated structural coefficients paired with the independent heat law."""

    materials: object
    thermal: Thermodynamics

    def __init__(self, materials, thermal: Thermodynamics):
        records = tuple(materials)
        if not isinstance(thermal, Thermodynamics) or not records or any(not isinstance(row, StructuralMaterial) for row in records):
            raise ValueError("Structural rules require material records and a validated thermal law")
        ids = set()
        for row in records:
            for name in ("id", "density", "cohesion", "softening"):
                checked_integer(getattr(row, name), 0, 255, name)
            if row.id in ids:
                raise ValueError("Duplicate structural material ID")
            if not row.cohesion and row.softening:
                raise ValueError("Noncohesive material cannot have a softening threshold")
            ids.add(row.id)
        if ids != set(thermal.materials):
            raise ValueError("Structural and thermal registries must contain the same material IDs")
        object.__setattr__(self, "materials", MappingProxyType({row.id: row for row in records}))
        object.__setattr__(self, "thermal", thermal)

    def eligible(self, packed: int) -> bool:
        material = int(packed) & 255
        if material not in self.materials:
            raise ValueError("Undefined structural material")
        return ((int(packed) >> 24) & 15) in (PHASE_SOLID, PHASE_FROZEN) and self.materials[material].cohesion > 0


def neighbors(index: int, width: int, height: int) -> tuple[int, int, int, int]:
    x, y = index % width, index // width
    return (index - 1 if x else -1, index + 1 if x + 1 < width else -1,
            index - width if y else -1, index + width if y + 1 < height else -1)


def normalize_bonds(cells, words, width: int, height: int, rules: StructuralRules) -> np.ndarray:
    """Remove invalid edges and reciprocally consume explicit solidification requests."""
    width, height = validate_dimensions(width, height)
    cells = validate_packed(cells, width * height)
    words = validate_packed(words, len(cells), "structure")
    if np.any(words > INTERNAL_MASK):
        raise ValueError("Reserved structural bits must be zero")
    active = [rules.eligible(cell) and bool(int(word) & INTEGRITY_MASK) for cell, word in zip(cells, words)]
    output = np.zeros(len(cells), dtype=np.uint32)
    for index, value in enumerate(words):
        word = int(value)
        if not rules.eligible(cells[index]):
            continue
        result = word & (INTEGRITY_MASK | ANCHOR)
        if active[index]:
            for direction, neighbor in enumerate(neighbors(index, width, height)):
                if neighbor < 0 or not active[neighbor]:
                    continue
                other = int(words[neighbor])
                reciprocal = word & BOND_BITS[direction] and other & BOND_BITS[OPPOSITE[direction]]
                if reciprocal or (word | other) & FRESH:
                    result |= BOND_BITS[direction]
        output[index] = result
    return output


def seed_structure(cells, width: int, height: int, rules: StructuralRules, *, anchors=()) -> np.ndarray:
    width, height = validate_dimensions(width, height)
    cells = validate_packed(cells, width * height)
    words = np.array([255 | FRESH if rules.eligible(cell) else 0 for cell in cells], dtype=np.uint32)
    for index in anchors:
        index = checked_integer(index, 0, len(cells) - 1, "anchor index")
        if not words[index]:
            raise ValueError("Only cohesive solid/frozen cells can be anchored")
        words[index] |= ANCHOR
    return normalize_bonds(cells, words, width, height, rules)


def validate_structure(cells, energy, words, width: int, height: int, rules: StructuralRules):
    width, height = validate_dimensions(width, height)
    cells, energy = validate_state(cells, energy, width * height, rules.thermal)
    words = validate_packed(words, len(cells), "structure")
    if np.any(words > COMPLETE_MASK):
        raise ValueError("Completed structural state cannot contain reserved or pending bits")
    normalized = normalize_bonds(cells, words, width, height, rules)
    if not np.array_equal(words, normalized):
        raise ValueError("Structural bonds must be reciprocal, in bounds, and between intact cohesive cells")
    return cells, energy, words


def _bond_graph(words, active, width, height):
    graph = {}
    for index in active:
        graph[index] = tuple(neighbor for direction, neighbor in enumerate(neighbors(index, width, height))
                             if neighbor >= 0 and int(words[index]) & BOND_BITS[direction])
    return graph


def _components(graph):
    groups, labels = [], {}
    for root in sorted(graph):
        if root in labels:
            continue
        members = []
        pending = [root]
        labels[root] = root
        while pending:
            index = pending.pop()
            members.append(index)
            for neighbor in graph[index]:
                if neighbor not in labels:
                    labels[neighbor] = root
                    pending.append(neighbor)
        groups.append((root, tuple(sorted(members))))
    return groups, labels


@dataclass(frozen=True)
class ComponentReport:
    id: int
    cells: tuple[int, ...]
    moving: bool
    anchored: bool


@dataclass(frozen=True)
class StructuralPlan:
    width: int
    height: int
    sources: np.ndarray
    structure: np.ndarray
    loads: np.ndarray
    capacities: np.ndarray
    reactions: np.ndarray
    distances: np.ndarray
    components: tuple[ComponentReport, ...]
    supported_weight: int
    input_hash: str

    def __post_init__(self):
        for name in ("sources", "structure", "loads", "capacities", "reactions", "distances"):
            array = np.asarray(getattr(self, name))
            immutable = np.frombuffer(array.tobytes(), dtype=array.dtype)
            object.__setattr__(self, name, immutable)

    def apply(self, cells, energy, structure, *, width: int, height: int):
        width, height = validate_dimensions(width, height)
        if (width, height) != (self.width, self.height):
            raise ValueError("Structural plan dimensions changed; recompute for the current geometry")
        cells = validate_packed(cells, len(self.sources))
        energy = validate_packed(energy, len(self.sources), "energyQ")
        structure = validate_packed(structure, len(self.sources), "structure")
        if _state_hash(cells, energy, structure) != self.input_hash:
            raise ValueError("Structural plan input changed; recompute against the current full state")
        return cells[self.sources], energy[self.sources], self.structure.copy()


def _state_hash(cells, energy, words):
    digest = hashlib.sha256()
    for array in (cells, energy, words):
        digest.update(np.asarray(array, dtype="<u4").tobytes())
    return digest.hexdigest()


def plan_structure(cells, energy, words, width: int, height: int, rules: StructuralRules) -> StructuralPlan:
    cells, energy, words = validate_structure(cells, energy, words, width, height, rules)
    count = len(cells)
    active = set(int(i) for i in np.flatnonzero(words & INTEGRITY_MASK))
    graph = _bond_graph(words, active, width, height)
    material = [rules.materials[int(cell) & 255] for cell in cells]

    def blocked_by_grain(source, target):
        return bool(int(words[target]) & ANCHOR) or material[source].density <= material[target].density

    # Predecessors point toward supports; followers point in the BFS direction.
    predecessors = {index: set(graph[index]) for index in active}
    followers = {index: set(graph[index]) for index in active}
    roots = set()
    for index in active:
        if int(words[index]) & ANCHOR or index // width == height - 1:
            roots.add(index)
        else:
            below = index + width
            if below in active:
                predecessors[index].add(below)
                followers[below].add(index)
            elif blocked_by_grain(index, below):
                roots.add(index)
    distance = np.full(count, -1, dtype=np.int64)
    queue = deque(sorted(roots))
    order = []
    for index in roots:
        distance[index] = 0
    while queue:
        index = queue.popleft()
        order.append(index)
        for neighbor in sorted(followers[index]):
            if distance[neighbor] < 0:
                distance[neighbor] = distance[index] + 1
                queue.append(neighbor)
    loads = np.zeros(count, dtype=np.int64)
    reactions = np.zeros(count, dtype=np.int64)
    weight = {index: max(1, (material[index].density + 63) // 64) for index in order}
    for index in order:
        loads[index] = weight[index]
    for index in reversed(order):
        if distance[index] == 0:
            reactions[index] = loads[index]
            continue
        supports = sorted(neighbor for neighbor in predecessors[index] if distance[neighbor] == distance[index] - 1)
        if not supports:
            raise RuntimeError("Supported cell has no load predecessor")
        quotient, remainder = divmod(int(loads[index]), len(supports))
        for rank, neighbor in enumerate(supports):
            loads[neighbor] += quotient + int(rank < remainder)
    supported_weight = sum(weight.values())
    if int(np.sum(reactions, dtype=np.int64)) != supported_weight:
        raise RuntimeError("Support reactions must balance the supported weight exactly")

    capacities = np.zeros(count, dtype=np.int64)
    temperatures = temperature_q_array(cells & 255, energy, rules.thermal)
    damaged = words.copy()
    for index in sorted(active):
        row = material[index]
        integrity = int(words[index]) & INTEGRITY_MASK
        nominal = row.cohesion * 16
        thermal_remaining = 64 * ENERGY_SCALE
        if row.softening:
            thermal_remaining = max(0, min(thermal_remaining, (row.softening + 64) * ENERGY_SCALE - int(temperatures[index])))
        capacity = nominal * integrity * thermal_remaining // (255 * 64 * ENERGY_SCALE)
        capacities[index] = capacity
        loss = 0
        if capacity == 0:
            loss = integrity
        elif loads[index] > capacity:
            loss = min(integrity, max(1, (int(loads[index]) - capacity) * 255 // nominal))
        damaged[index] = (int(words[index]) & ~INTEGRITY_MASK) | (integrity - loss)
    damaged = normalize_bonds(cells, damaged, width, height, rules)
    active_after = set(int(i) for i in np.flatnonzero(damaged & INTEGRITY_MASK))
    groups, labels = _components(_bond_graph(damaged, active_after, width, height))

    # Contact dependencies propagate immobility; cycles without a blocker move
    # together. This avoids ordering artifacts for stacked/interlocking bodies.
    blocked = set()
    dependents = {root: set() for root, _ in groups}
    for root, members in groups:
        for index in members:
            if int(damaged[index]) & ANCHOR or index // width == height - 1:
                blocked.add(root)
                continue
            below = index + width
            if below in active_after:
                lower_root = labels[below]
                if lower_root != root:
                    dependents[lower_root].add(root)
            elif blocked_by_grain(index, below):
                blocked.add(root)
    queue = deque(sorted(blocked))
    while queue:
        root = queue.popleft()
        for dependent in sorted(dependents[root]):
            if dependent not in blocked:
                blocked.add(dependent)
                queue.append(dependent)
    moving = np.zeros(count, dtype=np.bool_)
    reports = []
    for root, members in groups:
        falls = root not in blocked
        if falls:
            moving[list(members)] = True
        reports.append(ComponentReport(root, members, falls, any(int(damaged[i]) & ANCHOR for i in members)))
    sources = np.arange(count, dtype=np.uint32)
    for x in range(width):
        y = 0
        while y < height:
            index = y * width + x
            if not moving[index]:
                y += 1
                continue
            start = index
            while y < height and moving[y * width + x]:
                y += 1
            if y >= height:
                raise RuntimeError("Moving structure crossed the closed floor")
            stop = y * width + x
            sources[start] = stop
            for destination in range(start + width, stop + 1, width):
                sources[destination] = destination - width
    if not np.all(np.bincount(sources, minlength=count) == 1):
        raise RuntimeError("Structural transport must be a bijection")
    final_words = damaged[sources]
    # Transport cannot create/remove an edge between distinct fragments.
    if not np.array_equal(normalize_bonds(cells[sources], final_words, width, height, rules), final_words):
        raise RuntimeError("Structural transport broke reciprocal bonds")
    return StructuralPlan(width, height, sources, final_words, loads, capacities, reactions, distance, tuple(reports), supported_weight,
                          _state_hash(cells, energy, words))
