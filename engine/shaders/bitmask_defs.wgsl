// Phase 0: Voxel Bitmask Schema — shared by all compute shaders.
//
// 32-bit voxel state encoding:
//   Bits  0-7:  Material ID   (256 materials)
//   Bits  8-15: Thermal energy (0-255)
//   Bits 16-19: Kinetic X      (-8 to +7, 4-bit two's complement)
//   Bits 20-23: Kinetic Y      (-8 to +7, 4-bit two's complement)
//   Bits 24-27: Phase state    (16 substates)
//   Bits 28-31: Flags          (burning, conducting, pressurized, player-owned)

// ── Bit layout constants ───────────────────────────────────────────

const MATERIAL_SHIFT: u32 = 0u;
const MATERIAL_MASK:  u32 = 0xFFu;

const THERMAL_SHIFT:  u32 = 8u;
const THERMAL_MASK:   u32 = 0xFFu;

const KINETIC_X_SHIFT: u32 = 16u;
const KINETIC_X_MASK:  u32 = 0xFu;

const KINETIC_Y_SHIFT: u32 = 20u;
const KINETIC_Y_MASK:  u32 = 0xFu;

const PHASE_SHIFT:    u32 = 24u;
const PHASE_MASK:     u32 = 0xFu;

const FLAGS_SHIFT:    u32 = 28u;
const FLAGS_MASK:     u32 = 0xFu;

// ── Material IDs ───────────────────────────────────────────────────

const MAT_AIR:    u32 = 0u;
const MAT_STONE:  u32 = 1u;
const MAT_WATER:  u32 = 2u;
const MAT_SAND:   u32 = 3u;
const MAT_FIRE:   u32 = 4u;
const MAT_METAL:  u32 = 5u;
const MAT_OIL:    u32 = 6u;
const MAT_WOOD:   u32 = 7u;
const MAT_ICE:    u32 = 8u;
const MAT_STEAM:  u32 = 9u;
const MAT_LAVA:   u32 = 10u;
const MAT_GLASS:  u32 = 11u;
const MAT_PLAYER: u32 = 12u;
const MAT_ASH:    u32 = 13u;
const MAT_SMOKE:  u32 = 14u;

// ── Phase states ───────────────────────────────────────────────────

const PHASE_SOLID:       u32 = 0u;
const PHASE_POWDER:      u32 = 1u;
const PHASE_LIQUID:      u32 = 2u;
const PHASE_VISCOUS:     u32 = 3u;
const PHASE_GAS:         u32 = 4u;
const PHASE_PLASMA:      u32 = 5u;
const PHASE_FROZEN:      u32 = 6u;
const PHASE_MOLTEN:      u32 = 7u;
const PHASE_BURNING:     u32 = 8u;
const PHASE_CONDENSING:  u32 = 9u;
const PHASE_EVAPORATING: u32 = 10u;
const PHASE_SUBLIMATING: u32 = 11u;

// ── Flags ──────────────────────────────────────────────────────────

const FLAG_BURNING:      u32 = 0x1u;
const FLAG_CONDUCTING:   u32 = 0x2u;
const FLAG_PRESSURIZED:  u32 = 0x4u;
const FLAG_PLAYER_OWNED: u32 = 0x8u;

// ── Unpacked voxel struct ──────────────────────────────────────────

struct VoxelState {
    material:  u32,
    thermal:   u32,
    kinetic_x: i32,   // -8 to +7
    kinetic_y: i32,   // -8 to +7
    phase:     u32,
    flags:     u32,
}

// ── Grid dimensions (set per dispatch) ─────────────────────────────

override GRID_WIDTH:  u32 = 256u;
override GRID_HEIGHT: u32 = 256u;
