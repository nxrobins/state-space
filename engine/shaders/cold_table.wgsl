// Cold Property Table — Path B Architecture
//
// Material ID (bits 0-7 of voxel) indexes into this 256-entry table.
// Each entry is 16 x u32 = 64 bytes. Total table: 16KB (fits in L1/L2 cache).
//
// These are material-intrinsic constants that don't change per frame.
// The hot state (32-bit per voxel) carries frame-varying data.
// The cold table carries everything else.

const COLD_STRIDE: u32 = 24u;  // u32s per entry

// Field offsets within each entry
const COLD_DENSITY:           u32 = 0u;   // 0-255, gravity weight
const COLD_CONDUCTIVITY:      u32 = 1u;   // 0-255, thermal transfer rate
const COLD_MELT_POINT:        u32 = 2u;   // thermal threshold solid->liquid (upward)
const COLD_BOIL_POINT:        u32 = 3u;   // thermal threshold liquid->gas (upward)
const COLD_FLASH_POINT:       u32 = 4u;   // thermal threshold for ignition
const COLD_REACTIVITY:        u32 = 5u;   // 0-255, reaction rate
const COLD_POROSITY:          u32 = 6u;   // 0-255, fluid permeability
const COLD_OPTICAL:           u32 = 7u;   // packed: absorption|emission|color_r|color_g

// Phase transition fields (LOCKED: hysteresis band approach)
const COLD_FREEZE_POINT:      u32 = 8u;   // thermal for liquid->solid (BELOW melt_point)
const COLD_CONDENSE_POINT:    u32 = 9u;   // thermal for gas->liquid (BELOW boil_point)
const COLD_LATENT_HEAT_MELT:  u32 = 10u;  // thermal consumed by melting
const COLD_LATENT_HEAT_BOIL:  u32 = 11u;  // thermal consumed by boiling
const COLD_MELTS_INTO:        u32 = 12u;  // material ID after melting (0=none)
const COLD_BOILS_INTO:        u32 = 13u;  // material ID after boiling (0=none)
const COLD_FREEZES_INTO:      u32 = 14u;  // material ID after freezing (0=none)
const COLD_CONDENSES_INTO:    u32 = 15u;  // material ID after condensing (0=none)

// ── Lookup functions ───────────────────────────────────────────────

fn cold_lookup(cold_table: ptr<storage, array<u32>>, mat_id: u32, field: u32) -> u32 {
    return (*cold_table)[mat_id * COLD_STRIDE + field];
}

fn get_density(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_DENSITY);
}

fn get_conductivity(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_CONDUCTIVITY);
}

fn get_melt_point(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_MELT_POINT);
}

fn get_boil_point(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_BOIL_POINT);
}

fn get_flash_point(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_FLASH_POINT);
}

fn get_reactivity(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_REACTIVITY);
}

fn get_porosity(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_POROSITY);
}

// Phase transition lookups
fn get_freeze_point(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_FREEZE_POINT);
}

fn get_condense_point(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_CONDENSE_POINT);
}

fn get_latent_heat_melt(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_LATENT_HEAT_MELT);
}

fn get_latent_heat_boil(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_LATENT_HEAT_BOIL);
}

fn get_melts_into(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_MELTS_INTO);
}

fn get_boils_into(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_BOILS_INTO);
}

fn get_freezes_into(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_FREEZES_INTO);
}

fn get_condenses_into(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_CONDENSES_INTO);
}

// Combustion lookups (Phase 2d)
const COLD_FUEL_ENERGY:    u32 = 16u;  // thermal released on combustion
const COLD_BURNS_INTO:     u32 = 17u;  // material ID of combustion product
const COLD_SMOKE_PRODUCT:  u32 = 18u;  // material ID replacing consumed air
// 19-23: reserved

fn get_fuel_energy(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_FUEL_ENERGY);
}

fn get_burns_into(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_BURNS_INTO);
}

fn get_smoke_product(cold_table: ptr<storage, array<u32>>, mat_id: u32) -> u32 {
    return cold_lookup(cold_table, mat_id, COLD_SMOKE_PRODUCT);
}

// ── Interface conductivity (LOCKED: harmonic mean) ─────────────────

fn interface_conductivity(cold_table: ptr<storage, array<u32>>, mat_a: u32, mat_b: u32) -> u32 {
    let ca = get_conductivity(cold_table, mat_a);
    let cb = get_conductivity(cold_table, mat_b);
    let sum = ca + cb;
    if (sum == 0u) { return 0u; }
    return (2u * ca * cb) / sum;
}
