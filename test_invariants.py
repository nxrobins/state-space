"""
Phase 1 invariant scenario suite.

These tests are intentionally behavior-level. They exercise the composed engine
through small deterministic scenarios and assert the invariants that future
movement, reaction, and material-system work must preserve.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Callable

import numpy as np

from engine.compositor import CompositionEngine
from engine.schema import (
    MAT_AIR,
    MAT_ASH,
    MAT_FIRE,
    MAT_GLASS,
    MAT_ICE,
    MAT_METAL,
    MAT_SAND,
    MAT_SMOKE,
    MAT_STEAM,
    MAT_STONE,
    MAT_WATER,
    MAT_WOOD,
    PHASE_FROZEN,
    PHASE_GAS,
    PHASE_LIQUID,
    PHASE_POWDER,
    PHASE_SOLID,
    VoxelState,
    build_cold_table_buffer,
    pack_voxel,
)


WIDTH = 64
HEIGHT = 64
N = WIDTH * HEIGHT


@dataclass(frozen=True)
class Scenario:
    name: str
    ticks: int
    build: Callable[[], np.ndarray]
    check: Callable[[np.ndarray, np.ndarray], None]


def voxel(mat: int, thermal: int = 20, phase: int = PHASE_SOLID) -> np.uint32:
    return np.uint32(pack_voxel(VoxelState(mat, thermal, 0, 0, phase, 0)))


def air_grid(thermal: int = 20) -> np.ndarray:
    grid = np.empty(N, dtype=np.uint32)
    grid[:] = voxel(MAT_AIR, thermal, PHASE_GAS)
    return grid


def set_cell(grid: np.ndarray, x: int, y: int, packed: np.uint32) -> None:
    grid[y * WIDTH + x] = packed


def fill_rect(
    grid: np.ndarray,
    x0: int,
    y0: int,
    width: int,
    height: int,
    packed: np.uint32,
) -> None:
    for y in range(y0, y0 + height):
        start = y * WIDTH + x0
        grid[start : start + width] = packed


def material_ids(grid: np.ndarray) -> np.ndarray:
    return grid.astype(np.uint32) & 0xFF


def material_counts(grid: np.ndarray) -> np.ndarray:
    return np.bincount(material_ids(grid), minlength=256)


def count(grid: np.ndarray, mat: int) -> int:
    return int(material_counts(grid)[mat])


def center_y(grid: np.ndarray, mat: int) -> float:
    mask = material_ids(grid) == mat
    positions = np.flatnonzero(mask)
    if len(positions) == 0:
        return float("nan")
    return float(np.mean(positions // WIDTH))


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def assert_same_counts(initial: np.ndarray, final: np.ndarray, label: str) -> None:
    before = material_counts(initial)
    after = material_counts(final)
    if not np.array_equal(before, after):
        changed = [
            f"{mat}:{int(before[mat])}->{int(after[mat])}"
            for mat in np.flatnonzero(before != after)
        ]
        raise AssertionError(f"{label}: material counts changed: {', '.join(changed)}")


def assert_voxel_count(initial: np.ndarray, final: np.ndarray, label: str) -> None:
    assert_true(len(initial) == len(final), f"{label}: voxel array length changed")
    assert_true(int(np.sum(material_counts(initial))) == len(initial), f"{label}: bad initial count")
    assert_true(int(np.sum(material_counts(final))) == len(final), f"{label}: bad final count")


def build_sand_column() -> np.ndarray:
    grid = air_grid()
    fill_rect(grid, 0, HEIGHT - 4, WIDTH, 4, voxel(MAT_STONE, 20, PHASE_SOLID))
    fill_rect(grid, WIDTH // 2 - 2, 4, 4, 8, voxel(MAT_SAND, 20, PHASE_POWDER))
    return grid


def check_sand_column(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "sand_column")
    assert_true(center_y(final, MAT_SAND) > center_y(initial, MAT_SAND) + 10.0, "sand did not fall")


def build_water_basin() -> np.ndarray:
    grid = air_grid(thermal=60)
    stone = voxel(MAT_STONE, 60, PHASE_SOLID)
    water = voxel(MAT_WATER, 60, PHASE_LIQUID)
    fill_rect(grid, 8, HEIGHT - 8, WIDTH - 16, 3, stone)
    fill_rect(grid, 8, 18, 3, HEIGHT - 23, stone)
    fill_rect(grid, WIDTH - 11, 18, 3, HEIGHT - 23, stone)
    fill_rect(grid, WIDTH // 2 - 4, 10, 8, 5, water)
    return grid


def check_water_basin(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "water_basin")
    assert_true(center_y(final, MAT_WATER) > center_y(initial, MAT_WATER) + 10.0, "water did not settle")


def build_structural_solids() -> np.ndarray:
    grid = air_grid()
    fill_rect(grid, 9, 9, 8, 5, voxel(MAT_STONE, 20, PHASE_SOLID))
    fill_rect(grid, 24, 14, 7, 4, voxel(MAT_METAL, 20, PHASE_SOLID))
    fill_rect(grid, 38, 7, 6, 6, voxel(MAT_GLASS, 20, PHASE_SOLID))
    fill_rect(grid, 47, 19, 5, 5, voxel(MAT_WOOD, 20, PHASE_SOLID))
    return grid


def check_structural_solids(initial: np.ndarray, final: np.ndarray) -> None:
    assert_true(np.array_equal(initial, final), "structural solids moved or changed")


def build_smoke_column() -> np.ndarray:
    grid = air_grid()
    fill_rect(grid, WIDTH // 2 - 2, HEIGHT - 14, 4, 8, voxel(MAT_SMOKE, 20, PHASE_GAS))
    return grid


def check_smoke_column(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "smoke_column")


def build_sealed_hot_wood() -> np.ndarray:
    grid = air_grid()
    stone = voxel(MAT_STONE, 20, PHASE_SOLID)
    fill_rect(grid, 24, 24, 9, 9, stone)
    fill_rect(grid, 27, 27, 3, 3, voxel(MAT_WOOD, 220, PHASE_SOLID))
    return grid


def check_sealed_hot_wood(initial: np.ndarray, final: np.ndarray) -> None:
    assert_true(count(final, MAT_WOOD) == count(initial, MAT_WOOD), "sealed wood burned without air")
    assert_true(count(final, MAT_ASH) == 0, "sealed wood produced ash")
    assert_true(count(final, MAT_FIRE) == 0, "sealed wood produced fire")
    assert_true(count(final, MAT_SMOKE) == 0, "sealed wood produced smoke")


def build_exposed_hot_wood() -> np.ndarray:
    grid = air_grid()
    set_cell(grid, WIDTH // 2, HEIGHT // 2, voxel(MAT_WOOD, 220, PHASE_SOLID))
    return grid


def check_exposed_hot_wood(initial: np.ndarray, final: np.ndarray) -> None:
    before = material_counts(initial)
    after = material_counts(final)
    wood_burned = int(before[MAT_WOOD] - after[MAT_WOOD])
    air_consumed = int(before[MAT_AIR] - after[MAT_AIR])
    products = int(
        (after[MAT_ASH] - before[MAT_ASH])
        + (after[MAT_FIRE] - before[MAT_FIRE])
        + (after[MAT_SMOKE] - before[MAT_SMOKE])
    )
    assert_true(wood_burned == 1, f"expected one wood burn, got {wood_burned}")
    assert_true(air_consumed == 1, f"expected one air consumption, got {air_consumed}")
    assert_true(products == 2, f"expected two combustion products, got {products}")


def build_ice_melt() -> np.ndarray:
    grid = air_grid(thermal=80)
    set_cell(grid, WIDTH // 2, HEIGHT // 2, voxel(MAT_ICE, 80, PHASE_FROZEN))
    return grid


def check_ice_melt(initial: np.ndarray, final: np.ndarray) -> None:
    assert_true(count(final, MAT_ICE) == count(initial, MAT_ICE) - 1, "ice did not melt")
    assert_true(count(final, MAT_WATER) == count(initial, MAT_WATER) + 1, "water not produced")


def build_water_boils() -> np.ndarray:
    grid = air_grid(thermal=255)
    set_cell(grid, WIDTH // 2, HEIGHT // 2, voxel(MAT_WATER, 255, PHASE_LIQUID))
    return grid


def check_water_boils(initial: np.ndarray, final: np.ndarray) -> None:
    assert_true(count(final, MAT_WATER) == count(initial, MAT_WATER) - 1, "water did not boil")
    assert_true(count(final, MAT_STEAM) == count(initial, MAT_STEAM) + 1, "steam not produced")


def build_sand_vitrifies() -> np.ndarray:
    grid = air_grid(thermal=255)
    set_cell(grid, WIDTH // 2, HEIGHT // 2, voxel(MAT_SAND, 255, PHASE_POWDER))
    return grid


def check_sand_vitrifies(initial: np.ndarray, final: np.ndarray) -> None:
    assert_true(count(final, MAT_SAND) == count(initial, MAT_SAND) - 1, "sand did not vitrify")
    assert_true(count(final, MAT_GLASS) == count(initial, MAT_GLASS) + 1, "glass not produced")


def build_mixed_stress() -> np.ndarray:
    rng = np.random.RandomState(7)
    grid = air_grid()
    materials = [
        voxel(MAT_STONE, 20, PHASE_SOLID),
        voxel(MAT_SAND, 20, PHASE_POWDER),
        voxel(MAT_SMOKE, 20, PHASE_GAS),
        voxel(MAT_ASH, 20, PHASE_POWDER),
        voxel(MAT_METAL, 20, PHASE_SOLID),
        voxel(MAT_GLASS, 20, PHASE_SOLID),
    ]
    for idx in rng.choice(N, size=N // 5, replace=False):
        grid[idx] = materials[idx % len(materials)]
    return grid


def check_mixed_stress(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "mixed_stress")


SCENARIOS = [
    Scenario("structural_solids_fixed", 10, build_structural_solids, check_structural_solids),
    Scenario("sand_column", 24, build_sand_column, check_sand_column),
    Scenario("water_basin", 28, build_water_basin, check_water_basin),
    Scenario("smoke_column_conservation", 16, build_smoke_column, check_smoke_column),
    Scenario("sealed_hot_wood_starves", 12, build_sealed_hot_wood, check_sealed_hot_wood),
    Scenario("exposed_hot_wood_burns_once", 1, build_exposed_hot_wood, check_exposed_hot_wood),
    Scenario("ice_melts_to_water", 1, build_ice_melt, check_ice_melt),
    Scenario("water_boils_to_steam", 1, build_water_boils, check_water_boils),
    Scenario("sand_vitrifies_to_glass", 1, build_sand_vitrifies, check_sand_vitrifies),
    Scenario("mixed_nonreactive_stress", 18, build_mixed_stress, check_mixed_stress),
]


def run_scenario(engine: CompositionEngine, scenario: Scenario, cold_table: np.ndarray) -> None:
    initial = scenario.build()
    result_a = engine.run(initial, cold_table, WIDTH, HEIGHT, n_ticks=scenario.ticks)
    result_b = engine.run(initial, cold_table, WIDTH, HEIGHT, n_ticks=scenario.ticks)
    final = result_a["final_grid"]

    assert_voxel_count(initial, final, scenario.name)
    assert_true(
        np.array_equal(final, result_b["final_grid"]),
        f"{scenario.name}: deterministic replay failed",
    )
    scenario.check(initial, final)

    print(
        f"PASS {scenario.name:28s} ticks={scenario.ticks:3d} "
        f"mean={result_a['mean_tick_ms']:.3f}ms"
    )


def main() -> bool:
    print("PHASE 1: INVARIANT SCENARIO SUITE")
    print(f"Grid: {WIDTH}x{HEIGHT}")
    print(f"Scenarios: {len(SCENARIOS)}")

    engine = CompositionEngine(WIDTH, HEIGHT)
    cold_table = build_cold_table_buffer()

    for scenario in SCENARIOS:
        run_scenario(engine, scenario, cold_table)

    print("ALL INVARIANT SCENARIOS PASSED")
    return True


if __name__ == "__main__":
    try:
        ok = main()
    except Exception as exc:
        print(f"FAIL: {exc}")
        sys.exit(1)
    sys.exit(0 if ok else 1)
