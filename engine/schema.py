"""
Phase 0: Voxel Bitmask Schema — the Possibility Space definition.

32-bit voxel state encoding:
  Bits  0-7:  Material ID   (256 materials)
  Bits  8-15: Thermal energy (0-255 temperature range)
  Bits 16-19: Kinetic X      (-8 to +7 signed, 4-bit two's complement)
  Bits 20-23: Kinetic Y      (-8 to +7 signed, 4-bit two's complement)
  Bits 24-27: Phase state    (16 substates)
  Bits 28-31: Flags          (burning, conducting, pressurized, player-owned)

This schema IS the possibility space. Every state any voxel can ever
occupy must be encodable within this 32-bit structure.
"""

import numpy as np
from typing import NamedTuple

# ── Bit layout ──────────────────────────────────────────────────────

MATERIAL_BITS   = 8
MATERIAL_SHIFT  = 0
MATERIAL_MASK   = 0xFF

THERMAL_BITS    = 8
THERMAL_SHIFT   = 8
THERMAL_MASK    = 0xFF

KINETIC_X_BITS  = 4
KINETIC_X_SHIFT = 16
KINETIC_X_MASK  = 0xF

KINETIC_Y_BITS  = 4
KINETIC_Y_SHIFT = 20
KINETIC_Y_MASK  = 0xF

PHASE_BITS      = 4
PHASE_SHIFT     = 24
PHASE_MASK      = 0xF

FLAGS_BITS      = 4
FLAGS_SHIFT     = 28
FLAGS_MASK      = 0xF

# ── Material IDs ────────────────────────────────────────────────────

MAT_AIR     = 0
MAT_STONE   = 1
MAT_WATER   = 2
MAT_SAND    = 3
MAT_FIRE    = 4
MAT_METAL   = 5
MAT_OIL     = 6
MAT_WOOD    = 7
MAT_ICE     = 8
MAT_STEAM   = 9
MAT_LAVA    = 10
MAT_GLASS   = 11
MAT_PLAYER  = 12
MAT_ASH     = 13   # combustion product of wood
MAT_SMOKE   = 14   # combustion product replacing consumed air

MATERIAL_NAMES = {
    MAT_AIR: "air", MAT_STONE: "stone", MAT_WATER: "water",
    MAT_SAND: "sand", MAT_FIRE: "fire", MAT_METAL: "metal",
    MAT_OIL: "oil", MAT_WOOD: "wood", MAT_ICE: "ice",
    MAT_STEAM: "steam", MAT_LAVA: "lava", MAT_GLASS: "glass",
    MAT_PLAYER: "player", MAT_ASH: "ash", MAT_SMOKE: "smoke",
}

# ── Phase states ────────────────────────────────────────────────────

PHASE_SOLID       = 0
PHASE_POWDER      = 1   # granular solid (sand, gravel)
PHASE_LIQUID      = 2
PHASE_VISCOUS     = 3   # thick liquid (oil, lava)
PHASE_GAS         = 4
PHASE_PLASMA      = 5
PHASE_FROZEN      = 6   # solid from liquid (ice)
PHASE_MOLTEN      = 7   # liquid from solid (lava)
PHASE_BURNING     = 8   # active combustion
PHASE_CONDENSING  = 9   # gas→liquid transition
PHASE_EVAPORATING = 10  # liquid→gas transition
PHASE_SUBLIMATING = 11  # solid→gas transition
# 12-15 reserved

# ── Flags ───────────────────────────────────────────────────────────

FLAG_BURNING      = 0x1  # bit 28
FLAG_CONDUCTING   = 0x2  # bit 29
FLAG_PRESSURIZED  = 0x4  # bit 30
FLAG_PLAYER_OWNED = 0x8  # bit 31

# ══════════════════════════════════════════════════════════════════════
# COLD PROPERTY TABLE (Path B Architecture)
#
# Decision: 32-bit hot state + cold property lookup table.
# Material ID (bits 0-7) indexes into a 256-entry table stored in a
# GPU uniform/storage buffer. Properties that don't change per-frame
# live here, not in the per-voxel bitmask.
#
# The hot state (32-bit per voxel) carries frame-varying data:
#   material, thermal energy, kinetic vectors, phase, flags.
#
# The cold table carries material-intrinsic constants:
#   density, conductivity, melt/boil points, flash point, reactivity,
#   porosity, optical absorption.
#
# Cost: one indirection per neighbor read (~free, fits in L1 cache).
# Benefit: preserves all Phase 1 locks. No per-voxel bandwidth increase.
# ══════════════════════════════════════════════════════════════════════

# Each entry is 96 bytes (24 x u32) for alignment. 256 entries = 24KB.
# Fits in GPU L2 cache. Headroom for Phase 2.5+ fields.
COLD_TABLE_STRIDE = 24   # u32s per entry
COLD_TABLE_ENTRIES = 256
COLD_TABLE_SIZE_BYTES = COLD_TABLE_STRIDE * COLD_TABLE_ENTRIES * 4  # 24576 bytes

# Field offsets within each cold table entry (in u32 units)
COLD_DENSITY       = 0   # u32: 0-255, affects gravity (higher = heavier, sinks)
COLD_CONDUCTIVITY  = 1   # u32: 0-255, thermal transfer rate (0=insulator, 255=perfect)
COLD_MELT_POINT    = 2   # u32: thermal value for solid->liquid (0=no melt transition)
COLD_BOIL_POINT    = 3   # u32: thermal value for liquid->gas (0=no boil transition)
COLD_FLASH_POINT   = 4   # u32: thermal value for ignition (0=non-flammable)
COLD_REACTIVITY    = 5   # u32: 0-255, how eagerly this reacts (combustion rate, etc.)
COLD_POROSITY      = 6   # u32: 0-255, permeability to fluids/gas (0=solid, 255=sponge)
COLD_OPTICAL       = 7   # u32: packed — bits 0-7: absorption, 8-15: emission, 16-23: color_r, 24-31: color_g

# ── Phase transition fields (added for Phase 2c) ───────────────────
#
# Hysteresis approach (LOCKED): separate thresholds for up and down transitions.
#   melt_point: thermal to go solid->liquid (upward)
#   freeze_point: thermal to go liquid->solid (downward, BELOW melt_point)
#   boil_point: thermal to go liquid->gas (upward)
#   condense_point: thermal to go gas->liquid (downward, BELOW boil_point)
#
# Latent heat: energy consumed by the transition.
#   Ice at thermal=35 melts (melt_point=30), consuming latent_heat_melt=15.
#   Resulting water starts at thermal = 35 - 15 = 20, not 35.
#   Prevents runaway feedback: more conductive product doesn't inherit all heat.
#
# Transition targets: what material ID this becomes after transition.
#   ice -> water (melts_into=2), water -> steam (boils_into=9)
#   0 = no transition for this direction.

COLD_FREEZE_POINT       = 8   # u32: thermal for liquid->solid (hysteresis: below melt_point)
COLD_CONDENSE_POINT     = 9   # u32: thermal for gas->liquid (hysteresis: below boil_point)
COLD_LATENT_HEAT_MELT   = 10  # u32: thermal units consumed by melting
COLD_LATENT_HEAT_BOIL   = 11  # u32: thermal units consumed by boiling
COLD_MELTS_INTO         = 12  # u32: material ID of melted form (0=no melt transition)
COLD_BOILS_INTO         = 13  # u32: material ID of boiled form (0=no boil transition)
COLD_FREEZES_INTO       = 14  # u32: material ID of frozen form (0=no freeze transition)
COLD_CONDENSES_INTO     = 15  # u32: material ID of condensed form (0=no condense transition)

# ── Combustion fields (added for Phase 2d) ──────────────────────────
#
# Explicit oxygen model (LOCKED):
#   Combustion requires: thermal > flash_point AND adjacent air voxel.
#   The fuel voxel transitions to burns_into (e.g., wood→ash).
#   One adjacent air voxel is consumed, becoming smoke_product (e.g., air→smoke).
#   fuel_energy thermal units are distributed: half to self, half split among neighbors.
#   Conservation: total_thermal_after = total_thermal_before + sum(fuel_energy_consumed).
#
# Two-voxel mutation per burn event (same double-buffer pattern as 2b swaps):
#   Thread at fuel: reads self (fuel above flash_point) + neighbor (air).
#     Writes burns_into to grid_out[self], adds fuel_energy/2 to self thermal.
#   Thread at air: reads neighbor (burning fuel) + self (air).
#     Writes smoke_product to grid_out[self], absorbs fuel_energy/2/neighbor_count.

COLD_FUEL_ENERGY        = 16  # u32: thermal released on combustion (0=non-flammable)
COLD_BURNS_INTO         = 17  # u32: material ID of combustion product (wood→ash)
COLD_SMOKE_PRODUCT      = 18  # u32: material ID replacing consumed air (air→smoke)
# 19-23: reserved for Phase 2.5+ (bond_strength, cluster_id, etc.)


class ColdProperties(NamedTuple):
    """Static material properties stored in GPU cold table. Indexed by Material ID."""
    name: str
    density: int          # 0-255
    conductivity: int     # 0-255
    melt_point: int       # 0-255 thermal threshold (up: solid->liquid)
    boil_point: int       # 0-255 thermal threshold (up: liquid->gas)
    flash_point: int      # 0-255 thermal threshold (0 = non-flammable)
    reactivity: int       # 0-255
    porosity: int         # 0-255
    optical: int          # packed u32: absorption|emission|color
    # Phase transition fields
    freeze_point: int     # hysteresis: liquid->solid (below melt_point)
    condense_point: int   # hysteresis: gas->liquid (below boil_point)
    latent_heat_melt: int # thermal consumed by melting
    latent_heat_boil: int # thermal consumed by boiling
    melts_into: int       # material ID after melting (0=none)
    boils_into: int       # material ID after boiling (0=none)
    freezes_into: int     # material ID after freezing (0=none)
    condenses_into: int   # material ID after condensing (0=none)
    # Combustion fields
    fuel_energy: int      # thermal released on combustion (0=non-flammable)
    burns_into: int       # material ID of combustion product (0=none)
    smoke_product: int    # material ID replacing consumed air (0=none)


def _pack_optical(absorption: int, emission: int, color_r: int, color_g: int) -> int:
    return (absorption & 0xFF) | ((emission & 0xFF) << 8) | ((color_r & 0xFF) << 16) | ((color_g & 0xFF) << 24)


# ── The Cold Table ──────────────────────────────────────────────────
#
# Design rationale for each value:
# - density: relative to water=100. Air=1, stone=200, metal=220.
# - conductivity: how fast heat transfers per tick. Metal=200 (instant), wood=15 (slow).
# - melt_point: thermal value where solid->liquid. Stone=220 (hard to melt).
# - boil_point: thermal value where liquid->gas. Water=100.
# - flash_point: thermal value where combustion starts. Wood=180, oil=120.
# - reactivity: how fast reactions proceed once triggered. Oil=200 (explosive).
# - porosity: how permeable to fluid flow. Sand=150 (drains), glass=0 (impermeable).
# - optical: visual properties for rendering (Phase 3+).

# Transition graph (LOCKED):
#   ice  --melt(30)-->  water --boil(100)--> steam
#   ice <--freeze(25)-- water <--condense(90)-- steam
#   stone --melt(220)--> lava
#   stone <--freeze(210)-- lava
#   sand --melt(200)--> glass  (one-way: glass doesn't granulate back)
#   oil  --boil(80)-->  steam  (oil evaporates, simplified)
#   metal --melt(230)--> lava  (simplified: all molten material is lava)
#
# Hysteresis bands (LOCKED): freeze = melt - 5, condense = boil - 10
# Latent heats sized to prevent runaway: ~50% of the transition threshold

# Combustion budget:
#   wood: fuel_energy=80, burns_into=ash, smoke_product=smoke
#   oil:  fuel_energy=150, burns_into=smoke, smoke_product=smoke (oil burns hotter, leaves no solid residue)
#
# Combustion triggers: thermal > flash_point AND adjacent air voxel exists
#   wood: flash_point=180, so needs significant heat to ignite
#   oil:  flash_point=120, more volatile
#
# Energy audit: total_thermal_after = total_thermal_before + sum(fuel_energy_consumed)

COLD_TABLE = {
    #                                                                           optical                    frz  cnd  lhm  lhb  m_i    b_i       f_i       c_i       fuel burns  smoke
    MAT_AIR:    ColdProperties("air",      1,   5,   0,   0,   0,   0,  255, _pack_optical(0,0,200,220),   0,   0,   0,   0,   0,         0,        0,        0,        0,  0,     0),
    MAT_STONE:  ColdProperties("stone",  200,  30, 220, 255,   0,   0,    0, _pack_optical(200,0,128,128), 210, 0,  30,   0, MAT_LAVA,    0,        0,        0,        0,  0,     0),
    MAT_WATER:  ColdProperties("water",  100,  60,   0, 100,   0,   0,    0, _pack_optical(30,0,64,128),    25, 90,  0,  40,   0,  MAT_STEAM, MAT_ICE,       0,        0,  0,     0),
    MAT_SAND:   ColdProperties("sand",   180,  20, 200, 255,   0,   0,  150, _pack_optical(180,0,194,178),  0,  0,  25,   0, MAT_GLASS,   0,        0,        0,        0,  0,     0),
    MAT_FIRE:   ColdProperties("fire",     0, 255,   0,   0,   0, 255,  255, _pack_optical(10,250,255,100), 0,  0,   0,   0,   0,         0,        0,        0,        0,  0,     0),
    MAT_METAL:  ColdProperties("metal",  220, 200, 230, 255,   0,   0,    0, _pack_optical(220,0,180,180), 220, 0,  35,   0, MAT_LAVA,    0,        0,        0,        0,  0,     0),
    MAT_OIL:    ColdProperties("oil",     90,  10,   0,  80, 120, 200,    0, _pack_optical(150,0,40,30),     0, 70,  0,  30,   0,  MAT_STEAM,       0,        0,      150, MAT_SMOKE, MAT_FIRE),
    MAT_WOOD:   ColdProperties("wood",   120,  15,   0,   0, 180, 150,   30, _pack_optical(160,0,139,90),    0,  0,  0,   0,   0,         0,        0,        0,       80, MAT_ASH,   MAT_FIRE),
    MAT_ICE:    ColdProperties("ice",    100,  40,  30, 100,   0,   0,    0, _pack_optical(20,0,200,230),    0,  0, 15,   0, MAT_WATER,   0,        0,        0,        0,  0,     0),
    MAT_STEAM:  ColdProperties("steam",    5,  50,   0,   0,   0,   0,  255, _pack_optical(5,20,220,220),    0, 90,  0,   0,   0,         0,        0, MAT_WATER,       0,  0,     0),
    MAT_LAVA:   ColdProperties("lava",   210, 150,   0, 255,   0,  50,    0, _pack_optical(100,230,255,80), 210, 0,  0,   0,   0,         0, MAT_STONE,       0,        0,  0,     0),
    MAT_GLASS:  ColdProperties("glass",  170,  25, 240, 255,   0,   0,    0, _pack_optical(10,0,200,220),  235,  0, 30,   0, MAT_LAVA,    0,        0,        0,        0,  0,     0),
    MAT_PLAYER: ColdProperties("player", 100,  30,   0,   0,   0,   0,    0, _pack_optical(50,30,100,200),   0,  0,  0,   0,   0,         0,        0,        0,        0,  0,     0),
    MAT_ASH:    ColdProperties("ash",    150,  10,   0,   0,   0,   0,  100, _pack_optical(180,0,100,100),   0,  0,  0,   0,   0,         0,        0,        0,        0,  0,     0),
    MAT_SMOKE:  ColdProperties("smoke",    3,  30,   0,   0,   0,   0,  255, _pack_optical(80,10,100,100),   0,  0,  0,   0,   0,         0,        0,        0,        0,  0,     0),
}


def build_cold_table_buffer() -> np.ndarray:
    """
    Build the GPU-side cold property table as a flat u32 array.
    Shape: (256 * 8,) = 2048 u32s = 8192 bytes.
    Material ID indexes at offset = mat_id * 8.
    """
    buf = np.zeros(COLD_TABLE_ENTRIES * COLD_TABLE_STRIDE, dtype=np.uint32)
    for mat_id, props in COLD_TABLE.items():
        base = mat_id * COLD_TABLE_STRIDE
        buf[base + COLD_DENSITY]           = props.density
        buf[base + COLD_CONDUCTIVITY]      = props.conductivity
        buf[base + COLD_MELT_POINT]        = props.melt_point
        buf[base + COLD_BOIL_POINT]        = props.boil_point
        buf[base + COLD_FLASH_POINT]       = props.flash_point
        buf[base + COLD_REACTIVITY]        = props.reactivity
        buf[base + COLD_POROSITY]          = props.porosity
        buf[base + COLD_OPTICAL]           = props.optical
        buf[base + COLD_FREEZE_POINT]      = props.freeze_point
        buf[base + COLD_CONDENSE_POINT]    = props.condense_point
        buf[base + COLD_LATENT_HEAT_MELT]  = props.latent_heat_melt
        buf[base + COLD_LATENT_HEAT_BOIL]  = props.latent_heat_boil
        buf[base + COLD_MELTS_INTO]        = props.melts_into
        buf[base + COLD_BOILS_INTO]        = props.boils_into
        buf[base + COLD_FREEZES_INTO]      = props.freezes_into
        buf[base + COLD_CONDENSES_INTO]    = props.condenses_into
        buf[base + COLD_FUEL_ENERGY]       = props.fuel_energy
        buf[base + COLD_BURNS_INTO]        = props.burns_into
        buf[base + COLD_SMOKE_PRODUCT]     = props.smoke_product
    return buf


def interface_conductivity(mat_a: int, mat_b: int) -> int:
    """
    Harmonic mean of two materials' conductivities. LOCKED formula.
    H(a, b) = 2ab / (a + b). Slower material dominates.
    """
    ca = COLD_TABLE[mat_a].conductivity
    cb = COLD_TABLE[mat_b].conductivity
    s = ca + cb
    if s == 0:
        return 0
    return (2 * ca * cb) // s


# Legacy alias for backward compatibility with Phase 1 code
MaterialProperties = ColdProperties
MATERIAL_PROPS = COLD_TABLE

# ── CPU reference pack/unpack ───────────────────────────────────────

def _sign_extend_4bit(val: int) -> int:
    """Convert unsigned 4-bit to signed (-8 to +7)."""
    if val & 0x8:
        return val - 16
    return val


def _encode_signed_4bit(val: int) -> int:
    """Convert signed (-8 to +7) to unsigned 4-bit."""
    assert -8 <= val <= 7, f"kinetic value {val} out of range [-8, 7]"
    return val & 0xF


class VoxelState(NamedTuple):
    material: int    # 0-255
    thermal: int     # 0-255
    kinetic_x: int   # -8 to +7
    kinetic_y: int   # -8 to +7
    phase: int       # 0-15
    flags: int       # 0-15


def pack_voxel(state: VoxelState) -> int:
    """Pack a VoxelState into a 32-bit unsigned integer."""
    packed = (state.material & MATERIAL_MASK) << MATERIAL_SHIFT
    packed |= (state.thermal & THERMAL_MASK) << THERMAL_SHIFT
    packed |= _encode_signed_4bit(state.kinetic_x) << KINETIC_X_SHIFT
    packed |= _encode_signed_4bit(state.kinetic_y) << KINETIC_Y_SHIFT
    packed |= (state.phase & PHASE_MASK) << PHASE_SHIFT
    packed |= (state.flags & FLAGS_MASK) << FLAGS_SHIFT
    return packed & 0xFFFFFFFF


def unpack_voxel(packed: int) -> VoxelState:
    """Unpack a 32-bit unsigned integer into a VoxelState."""
    return VoxelState(
        material=(packed >> MATERIAL_SHIFT) & MATERIAL_MASK,
        thermal=(packed >> THERMAL_SHIFT) & THERMAL_MASK,
        kinetic_x=_sign_extend_4bit((packed >> KINETIC_X_SHIFT) & KINETIC_X_MASK),
        kinetic_y=_sign_extend_4bit((packed >> KINETIC_Y_SHIFT) & KINETIC_Y_MASK),
        phase=(packed >> PHASE_SHIFT) & PHASE_MASK,
        flags=(packed >> FLAGS_SHIFT) & FLAGS_MASK,
    )


def pack_voxel_array(states: np.ndarray) -> np.ndarray:
    """Vectorized pack for numpy arrays. states shape: (N, 6) [mat, thermal, kx, ky, phase, flags]."""
    packed = np.zeros(states.shape[0], dtype=np.uint32)
    packed |= (states[:, 0].astype(np.uint32) & MATERIAL_MASK) << MATERIAL_SHIFT
    packed |= (states[:, 1].astype(np.uint32) & THERMAL_MASK) << THERMAL_SHIFT
    packed |= (states[:, 2].astype(np.uint32) & KINETIC_X_MASK) << KINETIC_X_SHIFT
    packed |= (states[:, 3].astype(np.uint32) & KINETIC_Y_MASK) << KINETIC_Y_SHIFT
    packed |= (states[:, 4].astype(np.uint32) & PHASE_MASK) << PHASE_SHIFT
    packed |= (states[:, 5].astype(np.uint32) & FLAGS_MASK) << FLAGS_SHIFT
    return packed


def unpack_voxel_array(packed: np.ndarray) -> np.ndarray:
    """Vectorized unpack. Returns (N, 6) array [mat, thermal, kx, ky, phase, flags]."""
    result = np.zeros((packed.shape[0], 6), dtype=np.int32)
    result[:, 0] = (packed >> MATERIAL_SHIFT) & MATERIAL_MASK
    result[:, 1] = (packed >> THERMAL_SHIFT) & THERMAL_MASK
    # Sign-extend 4-bit kinetic values
    kx = ((packed >> KINETIC_X_SHIFT) & KINETIC_X_MASK).astype(np.int32)
    ky = ((packed >> KINETIC_Y_SHIFT) & KINETIC_Y_MASK).astype(np.int32)
    result[:, 2] = np.where(kx & 0x8, kx - 16, kx)
    result[:, 3] = np.where(ky & 0x8, ky - 16, ky)
    result[:, 4] = (packed >> PHASE_SHIFT) & PHASE_MASK
    result[:, 5] = (packed >> FLAGS_SHIFT) & FLAGS_MASK
    return result


# ── Validation ──────────────────────────────────────────────────────

def validate_schema():
    """Verify the schema is self-consistent: pack(unpack(x)) == x for all valid states."""
    import random
    errors = 0
    # Test all materials × edge cases
    for mat in range(13):  # defined materials
        for thermal in [0, 1, 127, 128, 254, 255]:
            for kx in range(-8, 8):
                for ky in range(-8, 8):
                    for phase in [0, 1, 7, 15]:
                        for flags in [0, 0xF]:
                            state = VoxelState(mat, thermal, kx, ky, phase, flags)
                            packed = pack_voxel(state)
                            unpacked = unpack_voxel(packed)
                            if unpacked != state:
                                errors += 1
                                if errors <= 5:
                                    print(f"MISMATCH: {state} -> 0x{packed:08X} -> {unpacked}")

    # Random exhaustive test
    for _ in range(100_000):
        raw = random.randint(0, 0xFFFFFFFF)
        unpacked = unpack_voxel(raw)
        repacked = pack_voxel(unpacked)
        re_unpacked = unpack_voxel(repacked)
        if re_unpacked != unpacked:
            errors += 1

    return errors


if __name__ == "__main__":
    errors = validate_schema()
    if errors == 0:
        print("Schema validation PASSED: all pack/unpack roundtrips correct")
    else:
        print(f"Schema validation FAILED: {errors} errors")
