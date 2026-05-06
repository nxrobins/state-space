"""
Phase 2e: Composition Cascade Test

Deterministic scenario: 5x5 wood block + single fire source.
Run 200 ticks and validate exact conservation:

1. air consumed by combustion = wood burned
2. combustion products (ash + fire + smoke) = wood burned + air consumed
3. total_thermal_final ~= total_thermal_initial + sum(fuel_energy of all wood consumed)

If all three hold across 200 ticks of cascading combustion, the engine is real.
"""

import sys
import numpy as np
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from engine.schema import *
from engine.compositor import CompositionEngine


def build_cascade_grid(width: int = 128, height: int = 128) -> np.ndarray:
    """
    Build the deterministic cascade test grid.

    Layout:
    - Fill with air (thermal=20)
    - 5x5 wood block at center (thermal=0, cold, waiting to be ignited)
    - Single fire source: hot stone (thermal=255) adjacent to wood
      (stone doesn't burn, just radiates heat)

    The stone heats adjacent wood via thermal diffusion (2a).
    When wood thermal > flash_point (180), combustion (2d) ignites it.
    Burning wood releases fuel_energy (80) as thermal.
    Heat propagates to adjacent wood, chain reaction.
    Wood becomes ash, adjacent air becomes fire, and flame products settle as ash/smoke.
    """
    N = width * height
    grid = np.zeros(N, dtype=np.uint32)

    # Fill with air
    air = pack_voxel(VoxelState(MAT_AIR, 20, 0, 0, PHASE_GAS, 0))
    grid[:] = air

    # 5x5 wood block at center, pre-heated to 150 (close to flash_point=180)
    # This means only a small thermal push is needed to ignite
    cx, cy = width // 2, height // 2
    for dx in range(-2, 3):
        for dy in range(-2, 3):
            x, y = cx + dx, cy + dy
            grid[y * width + x] = pack_voxel(VoxelState(MAT_WOOD, 150, 0, 0, PHASE_SOLID, 0))

    # The rightmost column of wood is already above flash_point (ignition seed)
    for dy in range(-2, 3):
        x, y = cx + 2, cy + dy
        grid[y * width + x] = pack_voxel(VoxelState(MAT_WOOD, 200, 0, 0, PHASE_SOLID, 0))

    # Stone wall below wood (solid, won't burn, just structure)
    for dx in range(-3, 4):
        x, y = cx + dx, cy + 3
        grid[y * width + x] = pack_voxel(VoxelState(MAT_STONE, 20, 0, 0, PHASE_SOLID, 0))

    return grid


def count_materials(grid: np.ndarray) -> dict:
    """Count each material ID in the grid."""
    mats = grid.astype(np.uint32) & 0xFF
    result = {}
    for mat_id, name in MATERIAL_NAMES.items():
        count = int(np.sum(mats == mat_id))
        if count > 0:
            result[name] = count
    return result


def total_thermal(grid: np.ndarray) -> int:
    """Sum all thermal energy in the grid."""
    return int(np.sum((grid.astype(np.uint64) >> 8) & 0xFF))


def main():
    W, H = 128, 128
    N_TICKS = 200

    print("=" * 60)
    print("PHASE 2e: COMPOSITION CASCADE TEST")
    print("=" * 60)
    print(f"Grid: {W}x{H}")
    print(f"Ticks: {N_TICKS}")
    print(f"Dispatch order: Gravity(phase 0) -> Gravity(phase 1) -> Thermal -> Phase Transitions -> Combustion")
    print()

    # Build scenario
    grid = build_cascade_grid(W, H)
    cold_table = build_cold_table_buffer()

    # Initial state audit
    initial_mats = count_materials(grid)
    initial_thermal = total_thermal(grid)
    initial_wood = initial_mats.get("wood", 0)
    initial_air = initial_mats.get("air", 0)

    print("INITIAL STATE:")
    for name, count in sorted(initial_mats.items()):
        print(f"  {name:10s}: {count}")
    print(f"  total_thermal: {initial_thermal}")
    print()

    # Build and run composition engine
    print("Compiling physics kernels...")
    engine = CompositionEngine()
    print()

    print(f"Running {N_TICKS} ticks...")
    result = engine.run(grid, cold_table, W, H, n_ticks=N_TICKS, snapshot_interval=50)
    print(f"  Total time: {result['total_time_ms']:.1f}ms")
    print(f"  Mean tick: {result['mean_tick_ms']:.3f}ms")
    print(f"  Min tick: {min(result['tick_times_ms']):.3f}ms")
    print(f"  Max tick: {max(result['tick_times_ms']):.3f}ms")
    print()

    # Final state audit
    final_grid = result["final_grid"]
    final_mats = count_materials(final_grid)
    final_thermal = total_thermal(final_grid)
    final_wood = final_mats.get("wood", 0)
    final_ash = final_mats.get("ash", 0)
    final_fire = final_mats.get("fire", 0)
    final_smoke = final_mats.get("smoke", 0)
    final_air = final_mats.get("air", 0)

    print("FINAL STATE:")
    for name, count in sorted(final_mats.items()):
        print(f"  {name:10s}: {count}")
    print(f"  total_thermal: {final_thermal}")
    print()

    # === CONSERVATION TESTS ===
    print("=" * 60)
    print("CONSERVATION AUDIT")
    print("=" * 60)

    all_passed = True

    # Test 1: Fuel/oxygen pairing
    # Every wood burn consumes exactly one air voxel.
    wood_burned = initial_wood - final_wood
    air_consumed = initial_air - final_air
    print(f"\n[1] FUEL/OXYGEN PAIRING:")
    print(f"  Wood initial:   {initial_wood}")
    print(f"  Wood remaining: {final_wood}")
    print(f"  Wood burned:    {wood_burned}")
    print(f"  Air consumed:   {air_consumed}")
    if wood_burned == air_consumed:
        print(f"  PASS: wood_burned ({wood_burned}) == air_consumed ({air_consumed})")
    else:
        print(f"  FAIL: wood_burned ({wood_burned}) != air_consumed ({air_consumed})")
        all_passed = False

    # Test 2: Product accounting
    # Every combustion event transforms one wood voxel and one air voxel.
    # Products can pass through ash, fire, and smoke during the flame lifecycle.
    products = final_ash + final_fire + final_smoke
    expected_products = wood_burned + air_consumed
    print(f"\n[2] COMBUSTION PRODUCT ACCOUNTING:")
    print(f"  Air initial:  {initial_air}")
    print(f"  Air remaining: {final_air}")
    print(f"  Ash final:     {final_ash}")
    print(f"  Fire final:    {final_fire}")
    print(f"  Smoke final:   {final_smoke}")
    print(f"  Products:      {products}")
    if products == expected_products:
        print(f"  PASS: products ({products}) == wood_burned + air_consumed ({expected_products})")
    else:
        print(f"  FAIL: products ({products}) != wood_burned + air_consumed ({expected_products})")
        all_passed = False

    # Test 3: Total voxel count (matter conservation)
    initial_total = sum(initial_mats.values())
    final_total = sum(final_mats.values())
    print(f"\n[3] TOTAL VOXEL COUNT:")
    print(f"  Initial: {initial_total}")
    print(f"  Final:   {final_total}")
    if initial_total == final_total:
        print(f"  PASS: voxel count preserved ({initial_total})")
    else:
        print(f"  FAIL: voxel count changed ({initial_total} -> {final_total})")
        all_passed = False

    # Test 4: Energy budget
    # total_thermal_final = total_thermal_initial + sum(fuel_energy of burned wood)
    # Wood fuel_energy = 80 per voxel
    wood_fuel = COLD_TABLE[MAT_WOOD].fuel_energy
    expected_thermal_gain = wood_burned * wood_fuel
    expected_final_thermal = initial_thermal + expected_thermal_gain
    thermal_drift = final_thermal - expected_final_thermal
    thermal_drift_pct = abs(thermal_drift) / max(expected_final_thermal, 1) * 100

    print(f"\n[4] ENERGY BUDGET:")
    print(f"  Thermal initial:        {initial_thermal}")
    print(f"  Wood burned:            {wood_burned} x fuel_energy={wood_fuel} = +{expected_thermal_gain}")
    print(f"  Expected final thermal: {expected_final_thermal}")
    print(f"  Actual final thermal:   {final_thermal}")
    print(f"  Drift: {thermal_drift} ({thermal_drift_pct:.2f}%)")
    if thermal_drift_pct < 1.0:
        print(f"  PASS: thermal drift < 1% ({thermal_drift_pct:.2f}%)")
    else:
        print(f"  FAIL: thermal drift >= 1% ({thermal_drift_pct:.2f}%)")
        all_passed = False

    # Test 5: Determinism (run again, compare)
    print(f"\n[5] DETERMINISM:")
    result2 = engine.run(grid, cold_table, W, H, n_ticks=N_TICKS)
    if np.array_equal(final_grid, result2["final_grid"]):
        print(f"  PASS: Two runs of {N_TICKS} ticks produce identical output")
    else:
        diff_count = np.sum(final_grid != result2["final_grid"])
        print(f"  FAIL: {diff_count} voxels differ between two runs")
        all_passed = False

    # Snapshot progression
    if result["snapshots"]:
        print(f"\n--- Cascade Progression ---")
        for tick, snap in result["snapshots"]:
            snap_mats = count_materials(snap)
            snap_thermal = total_thermal(snap)
            wood_left = snap_mats.get("wood", 0)
            ash_count = snap_mats.get("ash", 0)
            fire_count = snap_mats.get("fire", 0)
            smoke_count = snap_mats.get("smoke", 0)
            print(f"  Tick {tick:3d}: wood={wood_left:3d} ash={ash_count:3d} "
                  f"fire={fire_count:3d} smoke={smoke_count:3d} thermal={snap_thermal}")

    print()
    print("=" * 60)
    if all_passed:
        print("ALL CONSERVATION TESTS PASSED")
        print("THE ENGINE IS REAL.")
    else:
        print("SOME TESTS FAILED — composition has ordering or conservation bugs")
    print("=" * 60)

    return all_passed


if __name__ == "__main__":
    passed = main()
    sys.exit(0 if passed else 1)
