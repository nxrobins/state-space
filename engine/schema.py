"""Version 3 packed-state schema and material catalog.

Physical approximations and snapshot semantics are documented in
ENGINE_CONTRACT.md. Shared constants are generated from materials.json.
"""

import numpy as np
from typing import NamedTuple

from engine.catalog import load_catalog
from engine._generated_schema import (
    SCHEMA_VERSION as SCHEMA_VERSION,
    MATERIAL_BITS as MATERIAL_BITS,
    MATERIAL_SHIFT as MATERIAL_SHIFT,
    MATERIAL_MASK as MATERIAL_MASK,
    THERMAL_BITS as THERMAL_BITS,
    THERMAL_SHIFT as THERMAL_SHIFT,
    THERMAL_MASK as THERMAL_MASK,
    KINETIC_X_BITS as KINETIC_X_BITS,
    KINETIC_X_SHIFT as KINETIC_X_SHIFT,
    KINETIC_X_MASK as KINETIC_X_MASK,
    KINETIC_Y_BITS as KINETIC_Y_BITS,
    KINETIC_Y_SHIFT as KINETIC_Y_SHIFT,
    KINETIC_Y_MASK as KINETIC_Y_MASK,
    PHASE_BITS as PHASE_BITS,
    PHASE_SHIFT as PHASE_SHIFT,
    PHASE_MASK as PHASE_MASK,
    FLAGS_BITS as FLAGS_BITS,
    FLAGS_SHIFT as FLAGS_SHIFT,
    FLAGS_MASK as FLAGS_MASK,
    MAT_AIR as MAT_AIR,
    MAT_STONE as MAT_STONE,
    MAT_WATER as MAT_WATER,
    MAT_SAND as MAT_SAND,
    MAT_FIRE as MAT_FIRE,
    MAT_METAL as MAT_METAL,
    MAT_OIL as MAT_OIL,
    MAT_WOOD as MAT_WOOD,
    MAT_ICE as MAT_ICE,
    MAT_STEAM as MAT_STEAM,
    MAT_LAVA as MAT_LAVA,
    MAT_GLASS as MAT_GLASS,
    MAT_PLAYER as MAT_PLAYER,
    MAT_ASH as MAT_ASH,
    MAT_SMOKE as MAT_SMOKE,
    PHASE_SOLID as PHASE_SOLID,
    PHASE_POWDER as PHASE_POWDER,
    PHASE_LIQUID as PHASE_LIQUID,
    PHASE_VISCOUS as PHASE_VISCOUS,
    PHASE_GAS as PHASE_GAS,
    PHASE_PLASMA as PHASE_PLASMA,
    PHASE_FROZEN as PHASE_FROZEN,
    PHASE_MOLTEN as PHASE_MOLTEN,
    PHASE_BURNING as PHASE_BURNING,
    PHASE_CONDENSING as PHASE_CONDENSING,
    PHASE_EVAPORATING as PHASE_EVAPORATING,
    PHASE_SUBLIMATING as PHASE_SUBLIMATING,
    FLAG_BURNING as FLAG_BURNING,
    FLAG_CONDUCTING as FLAG_CONDUCTING,
    FLAG_PRESSURIZED as FLAG_PRESSURIZED,
    FLAG_PLAYER_OWNED as FLAG_PLAYER_OWNED,
    COLD_TABLE_STRIDE as COLD_TABLE_STRIDE,
    COLD_TABLE_ENTRIES as COLD_TABLE_ENTRIES,
    COLD_TABLE_SIZE_BYTES as COLD_TABLE_SIZE_BYTES,
    COLD_DENSITY as COLD_DENSITY,
    COLD_CONDUCTIVITY as COLD_CONDUCTIVITY,
    COLD_MELT_POINT as COLD_MELT_POINT,
    COLD_BOIL_POINT as COLD_BOIL_POINT,
    COLD_FLASH_POINT as COLD_FLASH_POINT,
    COLD_REACTIVITY as COLD_REACTIVITY,
    COLD_POROSITY as COLD_POROSITY,
    COLD_OPTICAL as COLD_OPTICAL,
    COLD_FREEZE_POINT as COLD_FREEZE_POINT,
    COLD_CONDENSE_POINT as COLD_CONDENSE_POINT,
    COLD_LATENT_HEAT_MELT as COLD_LATENT_HEAT_MELT,
    COLD_LATENT_HEAT_BOIL as COLD_LATENT_HEAT_BOIL,
    COLD_MELTS_INTO as COLD_MELTS_INTO,
    COLD_BOILS_INTO as COLD_BOILS_INTO,
    COLD_FREEZES_INTO as COLD_FREEZES_INTO,
    COLD_CONDENSES_INTO as COLD_CONDENSES_INTO,
    COLD_FUEL_ENERGY as COLD_FUEL_ENERGY,
    COLD_BURNS_INTO as COLD_BURNS_INTO,
    COLD_SMOKE_PRODUCT as COLD_SMOKE_PRODUCT,
    COLD_PHASE_ENERGY as COLD_PHASE_ENERGY,
    COLD_DEFAULT_PHASE as COLD_DEFAULT_PHASE,
    COLD_OXIDIZER as COLD_OXIDIZER,
    MAT_OIL_VAPOR as MAT_OIL_VAPOR,
    MAT_MOLTEN_METAL as MAT_MOLTEN_METAL,
    MAT_MOLTEN_GLASS as MAT_MOLTEN_GLASS,
)


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
    phase_energy: int     # stored phase energy relative to the material family
    default_phase: int    # placement and transition phase
    oxidizer: int         # one abstract oxidizer cell when 1
    cohesion: int         # nominal structural capacity divided by 16
    softening: int        # onset of a 64-temperature-unit capacity decline; 0 disables it


_CATALOG = load_catalog()
COLD_TABLE = {
    record["id"]: ColdProperties(record["name"], **record["properties"])
    for record in _CATALOG["materials"]
}
MATERIAL_NAMES = {material_id: props.name for material_id, props in COLD_TABLE.items()}
DEFAULT_PHASES = {record["id"]: record["properties"]["default_phase"] for record in _CATALOG["materials"]}
DEFAULT_THERMALS = {record["id"]: record["default_thermal"] for record in _CATALOG["materials"]}


def build_cold_table_buffer() -> np.ndarray:
    """Return all 256 x 24 u32 property slots (24 KiB), including reserved slots."""
    buf = np.zeros(COLD_TABLE_ENTRIES * COLD_TABLE_STRIDE, dtype=np.uint32)
    for material_id, props in COLD_TABLE.items():
        base = material_id * COLD_TABLE_STRIDE
        buf[base:base + len(props) - 1] = props[1:]
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
    if isinstance(val, (bool, np.bool_)) or not isinstance(val, (int, np.integer)) or not -8 <= val <= 7:
        raise ValueError(f"kinetic value {val} out of range [-8, 7]")
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
    for name, value, maximum in (("material", state.material, 255), ("thermal", state.thermal, 255),
                                 ("phase", state.phase, 15), ("flags", state.flags, 15)):
        if isinstance(value, (bool, np.bool_)) or not isinstance(value, (int, np.integer)) or not 0 <= value <= maximum:
            raise ValueError(f"{name} must be an integer in [0, {maximum}]")
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
    states = np.asarray(states)
    if states.ndim != 2 or states.shape[1] != 6 or states.dtype.kind not in "iu":
        raise ValueError("states must be an integer array with shape (N, 6)")
    for index, (low, high) in enumerate(((0, 255), (0, 255), (-8, 7), (-8, 7), (0, 15), (0, 15))):
        if np.any(states[:, index] < low) or np.any(states[:, index] > high):
            raise ValueError(f"states column {index} outside [{low}, {high}]")
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
