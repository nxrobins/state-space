"""Array-based C6 native planner, checked against scalar Python and TypeScript.

Connectivity and support propagation terminate on their actual fixed point;
neither uses a local iteration horizon. The scalar planner remains independent.
"""

import numpy as np

from engine.array_state import temperature_q_array
from engine.enthalpy import ENERGY_SCALE
from engine.state import validate_state
from engine.structure import (ANCHOR, BOND_BITS, COMPLETE_MASK, FRESH, INTEGRITY_MASK, INTERNAL_MASK,
                              ComponentReport, StructuralPlan, StructuralRules, _state_hash)
from engine.validation import validate_dimensions, validate_packed
from engine._generated_schema import PHASE_SOLID, PHASE_FROZEN


def _coefficients(rules):
    table = np.zeros((256, 4), dtype=np.int64)
    for row in rules.materials.values():
        table[row.id] = (1, row.density, row.cohesion, row.softening)
    return table


def _normalize(cells, words, width, height, table):
    material = cells & 255
    if np.any(table[material, 0] == 0):
        raise ValueError("Undefined structural material")
    if np.any(words > INTERNAL_MASK):
        raise ValueError("Reserved structural bits must be zero")
    phase = (cells >> 24) & 15
    eligible = ((phase == PHASE_SOLID) | (phase == PHASE_FROZEN)) & (table[material, 2] > 0)
    active = (eligible & ((words & INTEGRITY_MASK) != 0)).reshape(height, width)
    source = words.reshape(height, width)
    output = np.where(eligible, words & (INTEGRITY_MASK | ANCHOR), 0).astype(np.uint32).reshape(height, width)
    for first, second, forward, backward in (
        ((slice(None), slice(None, -1)), (slice(None), slice(1, None)), BOND_BITS[1], BOND_BITS[0]),
        ((slice(None, -1), slice(None)), (slice(1, None), slice(None)), BOND_BITS[3], BOND_BITS[2]),
    ):
        reciprocal = ((source[first] & forward) != 0) & ((source[second] & backward) != 0)
        fresh = ((source[first] | source[second]) & FRESH) != 0
        edge = active[first] & active[second] & (reciprocal | fresh)
        output[first] |= np.where(edge, forward, 0).astype(np.uint32)
        output[second] |= np.where(edge, backward, 0).astype(np.uint32)
    return output.reshape(-1)


def normalize_bonds_bulk(cells, words, width, height, rules):
    width, height = validate_dimensions(width, height)
    cells = validate_packed(cells, width * height)
    words = validate_packed(words, len(cells), "structure")
    return _normalize(cells, words, width, height, _coefficients(rules))


def seed_structure_bulk(cells, width, height, rules):
    width, height = validate_dimensions(width, height)
    cells = validate_packed(cells, width * height)
    table = _coefficients(rules)
    phase = (cells >> 24) & 15
    eligible = ((phase == PHASE_SOLID) | (phase == PHASE_FROZEN)) & (table[cells & 255, 2] > 0)
    words = np.where(eligible, INTEGRITY_MASK | FRESH, 0).astype(np.uint32)
    return _normalize(cells, words, width, height, table)


def validate_structure_bulk(cells, energy, words, width, height, rules):
    width, height = validate_dimensions(width, height)
    cells, energy = validate_state(cells, energy, width * height, rules.thermal)
    words = validate_packed(words, len(cells), "structure")
    if np.any(words > COMPLETE_MASK):
        raise ValueError("Completed structural state cannot contain reserved or pending bits")
    if not np.array_equal(words, _normalize(cells, words, width, height, _coefficients(rules))):
        raise ValueError("Structural bonds must be reciprocal, in bounds, and between intact cohesive cells")
    return cells, energy, words


def _bond_edges(words, width):
    # Reciprocal in-bounds input was already validated. Visit right/down once.
    right = np.flatnonzero(words & BOND_BITS[1])
    down = np.flatnonzero(words & BOND_BITS[3])
    return np.concatenate((right, down)), np.concatenate((right + 1, down + width))


def _components(words, width):
    active = np.flatnonzero(words & INTEGRITY_MASK)
    parents = np.arange(len(words), dtype=np.int64)
    a, b = _bond_edges(words, width)
    # Hook larger roots to smaller roots, then pointer-double to convergence.
    # Every changed parent strictly decreases, so cycles cannot be introduced.
    while len(a):
        left, right = parents[a], parents[b]
        different = left != right
        if not np.any(different):
            break
        np.minimum.at(parents, np.maximum(left[different], right[different]), np.minimum(left[different], right[different]))
        while True:
            compressed = parents[parents[active]]
            if np.array_equal(compressed, parents[active]):
                break
            parents[active] = compressed
    roots = parents[active]
    order = np.argsort(roots, kind="stable")
    sorted_members = active[order]
    boundaries = np.flatnonzero(np.diff(roots[order])) + 1
    groups = [(int(members[0]), tuple(int(i) for i in members))
              for members in np.split(sorted_members, boundaries) if len(members)]
    return parents, active, groups


def _range_indices(starts, lengths):
    """Flatten CSR rows without a Python loop over contacts."""
    total = int(np.sum(lengths, dtype=np.int64))
    relative = np.arange(total, dtype=np.int64) - np.repeat(np.cumsum(lengths, dtype=np.int64) - lengths, lengths)
    return np.repeat(starts, lengths) + relative


def plan_structure_bulk(cells, energy, words, width: int, height: int, rules: StructuralRules) -> StructuralPlan:
    width, height = validate_dimensions(width, height)
    count = width * height
    cells, energy = validate_state(cells, energy, count, rules.thermal)
    words = validate_packed(words, count, "structure")
    table = _coefficients(rules)
    if np.any(words > COMPLETE_MASK):
        raise ValueError("Completed structural state cannot contain reserved or pending bits")
    if not np.array_equal(words, _normalize(cells, words, width, height, table)):
        raise ValueError("Structural bonds must be reciprocal, in bounds, and between intact cohesive cells")
    indices = np.arange(count, dtype=np.int64)
    material = cells & 255
    density, cohesion, softening = (table[material, field] for field in (1, 2, 3))
    active = (words & INTEGRITY_MASK) != 0
    active_indices = np.flatnonzero(active)
    below = np.minimum(indices + width, count - 1)
    floor = indices + width >= count
    contact = active & ~floor & active[below]
    grain_support = ((words[below] & ANCHOR) != 0) | (density <= density[below])
    root = active & (((words & ANCHOR) != 0) | floor | (~active[below] & grain_support))
    predecessors = np.full((count, 4), -1, dtype=np.int64)
    followers = np.full((count, 4), -1, dtype=np.int64)
    for direction, offset in enumerate((-1, 1, -width, width)):
        bonded = np.flatnonzero(words & BOND_BITS[direction])
        predecessors[bonded, direction] = bonded + offset
        followers[bonded, direction] = bonded + offset
    contacting = np.flatnonzero(contact)
    predecessors[contacting, 3] = contacting + width
    followers[contacting + width, 2] = contacting
    distances = np.full(count, -1, dtype=np.int64)
    frontier = np.flatnonzero(root)
    distances[frontier] = 0
    levels = []
    while len(frontier):
        levels.append(frontier)
        next_indices = followers[frontier].reshape(-1)
        next_indices = next_indices[next_indices >= 0]
        frontier = np.unique(next_indices[distances[next_indices] < 0])
        distances[frontier] = len(levels)
    supported = distances >= 0
    loads = np.zeros(count, dtype=np.int64)
    loads[supported] = np.maximum(1, (density[supported] + 63) // 64)
    supported_weight = int(np.sum(loads, dtype=np.int64))
    for level in reversed(levels[1:]):
        candidates = np.sort(predecessors[level], axis=1)
        valid = (candidates >= 0) & (distances[np.maximum(candidates, 0)] == (distances[level, None] - 1))
        lengths = np.sum(valid, axis=1, dtype=np.int64)
        if np.any(lengths == 0):
            raise RuntimeError("Supported cell has no load predecessor")
        share, remainder = loads[level] // lengths, loads[level] % lengths
        rank = np.cumsum(valid, axis=1, dtype=np.int64) - 1
        contributions = share[:, None] + (rank < remainder[:, None])
        np.add.at(loads, candidates[valid], contributions[valid])
    reactions = np.zeros(count, dtype=np.int64)
    reactions[root] = loads[root]
    if int(np.sum(reactions, dtype=np.int64)) != supported_weight:
        raise RuntimeError("Support reactions must balance the supported weight exactly")

    nominal = cohesion[active_indices] * 16
    integrity = (words[active_indices] & INTEGRITY_MASK).astype(np.int64)
    temperature = temperature_q_array(material, energy, rules.thermal)[active_indices]
    thresholds = softening[active_indices]
    remaining = np.where(thresholds != 0, np.clip((thresholds + 64) * ENERGY_SCALE - temperature, 0, 64 * ENERGY_SCALE), 64 * ENERGY_SCALE)
    capacities = np.zeros(count, dtype=np.int64)
    capacity = nominal * integrity * remaining // (255 * 64 * ENERGY_SCALE)
    capacities[active_indices] = capacity
    overload = np.minimum(integrity, np.maximum(1, (loads[active_indices] - capacity) * 255 // nominal))
    loss = np.where(capacity == 0, integrity, np.where(loads[active_indices] > capacity, overload, 0))
    damaged = words.copy()
    damaged[active_indices] = (words[active_indices] & np.uint32(0xffffffff ^ INTEGRITY_MASK)) | (integrity - loss).astype(np.uint32)
    damaged = _normalize(cells, damaged, width, height, table)
    parents, intact, groups = _components(damaged, width)
    active_after = (damaged & INTEGRITY_MASK) != 0
    blocked = np.zeros(count, dtype=np.bool_)
    blocked_cells = active_after & (((damaged & ANCHOR) != 0) | floor | (~active_after[below] & grain_support))
    blocked[parents[blocked_cells]] = True
    contact_cells = np.flatnonzero(active_after & ~floor & active_after[below])
    lower, upper = parents[contact_cells + width], parents[contact_cells]
    external = lower != upper
    contacts = np.unique(np.column_stack((lower[external], upper[external])), axis=0)
    counts = np.bincount(contacts[:, 0], minlength=count)
    offsets = np.cumsum(counts, dtype=np.int64) - counts
    frontier = np.flatnonzero(blocked)
    while len(frontier):
        slots = _range_indices(offsets[frontier], counts[frontier])
        followers_of_blocked = contacts[slots, 1]
        frontier = np.unique(followers_of_blocked[~blocked[followers_of_blocked]])
        blocked[frontier] = True
    moving = np.zeros(count, dtype=np.bool_)
    moving[intact] = ~blocked[parents[intact]]
    if np.any(moving & floor):
        raise RuntimeError("Moving structure crossed the closed floor")
    reports = tuple(ComponentReport(root_id, members, not bool(blocked[root_id]), any(int(damaged[i]) & ANCHOR for i in members))
                    for root_id, members in groups)
    above_moves = np.zeros(count, dtype=np.bool_)
    above_moves[width:] = moving[:-width]
    starts = np.flatnonzero(moving & ~above_moves)
    stops = np.flatnonzero(~moving & above_moves)
    starts = starts[np.lexsort((starts // width, starts % width))]
    stops = stops[np.lexsort((stops // width, stops % width))]
    if len(starts) != len(stops) or np.any(starts % width != stops % width):
        raise RuntimeError("Structural column runs must have matched closed endpoints")
    sources = np.arange(count, dtype=np.uint32)
    source_cells = np.flatnonzero(moving)
    sources[source_cells + width] = source_cells
    sources[starts] = stops
    if not np.all(np.bincount(sources, minlength=count) == 1):
        raise RuntimeError("Structural transport must be a bijection")
    final_words = damaged[sources]
    if not np.array_equal(_normalize(cells[sources], final_words, width, height, table), final_words):
        raise RuntimeError("Structural transport broke reciprocal bonds")
    return StructuralPlan(width, height, sources, final_words, loads, capacities, reactions, distances, reports, supported_weight,
                          _state_hash(cells, energy, words))
