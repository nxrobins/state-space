"""Finite causal fixtures shared by native/browser conformance and pressure gates."""
import numpy as np
from engine import DEFAULT_REGISTRY
from engine.schema import DEFAULT_PHASES, VoxelState, pack_voxel
from engine.state import seed_state
from engine.structure_bulk import seed_structure_bulk


def pressure_scene(kind, control=False, width=24, height=24):
    cells = np.full(width * height, pack_voxel(VoxelState(0, 20, 0, 0, 4, 0)), dtype=np.uint32)
    def place(x, y, material, temperature=20):
        cells[y * width + x] = pack_voxel(VoxelState(material, temperature, 0, 0, DEFAULT_PHASES[material], 0))
    if kind == 'dam':
        for y in range(2, height):
            place(0, y, 1)
            place(width // 2, y, 5 if control else 7)
            for x in range(1, width // 2):
                place(x, y, 2, 35)
        for x in range(width):
            place(x, height - 1, 1)
    else:
        for y in range(8, 16):
            for x in range(8, 16):
                place(x, y, 9, 160)
        for k in range(7, 17):
            place(k, 7, 11)
            place(k, 16, 11)
            place(7, k, 11)
            place(16, k, 11)
        # A substantial vent connects the same initial hot gas to cool ambient.
        if control:
            for x in range(9, 14):
                place(x, 7, 0)
    grid, energy = seed_state(cells, DEFAULT_REGISTRY._model)
    words = seed_structure_bulk(grid, width, height, DEFAULT_REGISTRY._structure)
    return grid, energy, words
