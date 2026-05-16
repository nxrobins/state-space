"""
Engine invariant scenario suite.

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
    MAT_OIL,
    MAT_SAND,
    MAT_SMOKE,
    MAT_STEAM,
    MAT_STONE,
    MAT_WATER,
    MAT_WOOD,
    PHASE_FROZEN,
    PHASE_GAS,
    PHASE_LIQUID,
    PHASE_VISCOUS,
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


def positions(grid: np.ndarray, mat: int) -> np.ndarray:
    return np.flatnonzero(material_ids(grid) == mat)


def center_x(grid: np.ndarray, mat: int) -> float:
    pos = positions(grid, mat)
    if len(pos) == 0:
        return float("nan")
    return float(np.mean(pos % WIDTH))


def center_y(grid: np.ndarray, mat: int) -> float:
    pos = positions(grid, mat)
    if len(pos) == 0:
        return float("nan")
    return float(np.mean(pos // WIDTH))


def x_span(grid: np.ndarray, mat: int) -> int:
    pos = positions(grid, mat)
    if len(pos) == 0:
        return 0
    xs = pos % WIDTH
    return int(xs.max() - xs.min() + 1)


def min_x(grid: np.ndarray, mat: int) -> int:
    pos = positions(grid, mat)
    return int(np.min(pos % WIDTH))


def max_x(grid: np.ndarray, mat: int) -> int:
    pos = positions(grid, mat)
    return int(np.max(pos % WIDTH))


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


def build_solid_matter_falls() -> np.ndarray:
    grid = air_grid()
    fill_rect(grid, 9, 9, 8, 5, voxel(MAT_STONE, 20, PHASE_SOLID))
    fill_rect(grid, 24, 14, 7, 4, voxel(MAT_METAL, 20, PHASE_SOLID))
    fill_rect(grid, 38, 7, 6, 6, voxel(MAT_GLASS, 20, PHASE_SOLID))
    fill_rect(grid, 47, 19, 5, 5, voxel(MAT_WOOD, 20, PHASE_SOLID))
    return grid


def check_solid_matter_falls(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "solid_matter_falls")
    for mat in (MAT_STONE, MAT_METAL, MAT_GLASS, MAT_WOOD):
        assert_true(center_y(final, mat) > center_y(initial, mat) + 5.0, "solid matter did not fall")


def build_structural_targets_resist_displacement() -> np.ndarray:
    grid = air_grid()
    targets = [
        (18, MAT_WOOD),
        (26, MAT_STONE),
        (34, MAT_METAL),
        (42, MAT_GLASS),
    ]
    for x, mat in targets:
        set_cell(grid, x, 33, voxel(MAT_STONE, 20, PHASE_SOLID))
        set_cell(grid, x, 32, voxel(mat, 20, PHASE_SOLID))
        set_cell(grid, x, 31, voxel(MAT_SAND, 20, PHASE_POWDER))
    return grid


def check_structural_targets_resist_displacement(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "structural_targets_resist_displacement")
    for x, mat in [(18, MAT_WOOD), (26, MAT_STONE), (34, MAT_METAL), (42, MAT_GLASS)]:
        assert_true(material_ids(final)[32 * WIDTH + x] == mat, "structural target was displaced")
    assert_true(count(final, MAT_SAND) == count(initial, MAT_SAND), "sand count changed")


def build_sand_diagonal_fall() -> np.ndarray:
    grid = air_grid()
    set_cell(grid, WIDTH // 2, 16, voxel(MAT_SAND, 20, PHASE_POWDER))
    fill_rect(grid, WIDTH // 2, 17, 1, HEIGHT - 17, voxel(MAT_STONE, 20, PHASE_SOLID))
    return grid


def check_sand_diagonal_fall(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "sand_diagonal_fall")
    assert_true(center_y(final, MAT_SAND) > center_y(initial, MAT_SAND) + 2.0, "sand did not fall diagonally")
    assert_true(abs(center_x(final, MAT_SAND) - center_x(initial, MAT_SAND)) >= 1.0, "sand did not move sideways")


def build_water_horizontal_spread() -> np.ndarray:
    grid = air_grid(thermal=60)
    floor = voxel(MAT_STONE, 60, PHASE_SOLID)
    water = voxel(MAT_WATER, 60, PHASE_LIQUID)
    fill_rect(grid, 10, HEIGHT - 3, WIDTH - 20, 3, floor)
    fill_rect(grid, WIDTH // 2 - 2, HEIGHT - 4, 4, 1, water)
    return grid


def check_water_horizontal_spread(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "water_horizontal_spread")
    assert_true(x_span(final, MAT_WATER) > x_span(initial, MAT_WATER) + 2, "water did not spread horizontally")
    assert_true(min_x(final, MAT_WATER) < min_x(initial, MAT_WATER), "water did not spread left")
    assert_true(max_x(final, MAT_WATER) > max_x(initial, MAT_WATER), "water did not spread right")


def build_water_pillar_collapses() -> np.ndarray:
    grid = air_grid(thermal=60)
    floor = voxel(MAT_STONE, 60, PHASE_SOLID)
    water = voxel(MAT_WATER, 60, PHASE_LIQUID)
    fill_rect(grid, 0, HEIGHT - 1, WIDTH, 1, floor)
    fill_rect(grid, WIDTH // 2, HEIGHT - 24, 1, 23, water)
    return grid


def check_water_pillar_collapses(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "water_pillar_collapses")
    pos = positions(final, MAT_WATER)
    ys = pos // WIDTH
    assert_true(x_span(final, MAT_WATER) > 20, "water pillar did not spread across the floor")
    assert_true(int(ys.max() - ys.min() + 1) <= 2, "water remained stacked in a pillar")


def build_viscous_oil_spread() -> np.ndarray:
    grid = air_grid(thermal=30)
    floor = voxel(MAT_STONE, 30, PHASE_SOLID)
    oil = voxel(MAT_OIL, 30, PHASE_VISCOUS)
    fill_rect(grid, 10, HEIGHT - 3, WIDTH - 20, 3, floor)
    fill_rect(grid, WIDTH // 2 - 1, HEIGHT - 4, 2, 1, oil)
    return grid


def check_viscous_oil_spread(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "viscous_oil_spread")
    assert_true(x_span(final, MAT_OIL) > x_span(initial, MAT_OIL), "oil did not spread")


def build_smoke_column() -> np.ndarray:
    grid = air_grid()
    fill_rect(grid, WIDTH // 2 - 2, HEIGHT - 14, 4, 8, voxel(MAT_SMOKE, 20, PHASE_GAS))
    return grid


def check_smoke_column(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "smoke_column")
    assert_true(center_y(final, MAT_SMOKE) <= center_y(initial, MAT_SMOKE) + 0.5, "cool smoke sank")


def build_cool_smoke_spread() -> np.ndarray:
    grid = air_grid()
    fill_rect(grid, WIDTH // 2 - 1, HEIGHT // 2, 2, 2, voxel(MAT_SMOKE, 20, PHASE_GAS))
    return grid


def check_cool_smoke_spread(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "cool_smoke_spread")
    assert_true(center_y(final, MAT_SMOKE) <= center_y(initial, MAT_SMOKE) + 0.5, "cool smoke sank")
    assert_true(x_span(final, MAT_SMOKE) > x_span(initial, MAT_SMOKE), "cool smoke did not spread sideways")


def build_hot_smoke_rises() -> np.ndarray:
    grid = air_grid()
    fill_rect(grid, WIDTH // 2 - 2, HEIGHT - 12, 4, 4, voxel(MAT_SMOKE, 90, PHASE_GAS))
    return grid


def check_hot_smoke_rises(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "hot_smoke_rises")
    assert_true(center_y(final, MAT_SMOKE) < center_y(initial, MAT_SMOKE) - 4.0, "hot smoke did not rise")


def build_hot_steam_rises() -> np.ndarray:
    grid = air_grid()
    fill_rect(grid, WIDTH // 2 - 2, HEIGHT - 12, 4, 4, voxel(MAT_STEAM, 220, PHASE_GAS))
    return grid


def check_hot_steam_rises(initial: np.ndarray, final: np.ndarray) -> None:
    assert_same_counts(initial, final, "hot_steam_rises")
    assert_true(center_y(final, MAT_STEAM) < center_y(initial, MAT_STEAM) - 4.0, "hot steam did not rise")


def build_sealed_hot_wood() -> np.ndarray:
    grid = air_grid()
    stone = voxel(MAT_STONE, 20, PHASE_SOLID)
    y0 = HEIGHT - 9
    fill_rect(grid, 24, y0, 9, 9, stone)
    fill_rect(grid, 27, y0 + 3, 3, 3, voxel(MAT_WOOD, 220, PHASE_SOLID))
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
    Scenario("solid_matter_falls", 10, build_solid_matter_falls, check_solid_matter_falls),
    Scenario(
        "structural_targets_resist_displacement",
        1,
        build_structural_targets_resist_displacement,
        check_structural_targets_resist_displacement,
    ),
    Scenario("sand_column", 24, build_sand_column, check_sand_column),
    Scenario("sand_diagonal_fall", 8, build_sand_diagonal_fall, check_sand_diagonal_fall),
    Scenario("water_basin", 28, build_water_basin, check_water_basin),
    Scenario("water_horizontal_spread", 4, build_water_horizontal_spread, check_water_horizontal_spread),
    Scenario("water_pillar_collapses", 16, build_water_pillar_collapses, check_water_pillar_collapses),
    Scenario("viscous_oil_spread", 4, build_viscous_oil_spread, check_viscous_oil_spread),
    Scenario("smoke_column_conservation", 16, build_smoke_column, check_smoke_column),
    Scenario("cool_smoke_spread", 16, build_cool_smoke_spread, check_cool_smoke_spread),
    Scenario("hot_smoke_rises", 16, build_hot_smoke_rises, check_hot_smoke_rises),
    Scenario("hot_steam_rises", 8, build_hot_steam_rises, check_hot_steam_rises),
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
    print("ENGINE INVARIANT SCENARIO SUITE")
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
