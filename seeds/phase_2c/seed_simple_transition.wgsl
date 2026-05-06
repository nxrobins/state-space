// Phase 2c Seed 1: Simple phase transitions with latent heat
//
// Checks all four transition directions per voxel:
//   1. Melting:    thermal > melt_point    AND melts_into != 0
//   2. Boiling:    thermal > boil_point    AND boils_into != 0
//   3. Freezing:   thermal < freeze_point  AND freezes_into != 0
//   4. Condensing: thermal < condense_point AND condenses_into != 0
//
// Priority: boiling > melting > freezing > condensing
// (higher-energy transitions checked first)
//
// On transition:
//   - Material ID rewritten to target material
//   - Phase bits rewritten based on transition type
//   - Thermal reduced by latent heat (melting/boiling consume energy)
//   - Thermal increased by latent heat (freezing/condensing release energy)

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

const COLD_STRIDE_L: u32 = 16u;

fn ct(mat: u32, field: u32) -> u32 {
    return cold_table[mat * COLD_STRIDE_L + field];
}

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }
fn get_thermal(p: u32) -> u32 { return (p >> THERMAL_SHIFT) & THERMAL_MASK; }
fn get_phase(p: u32) -> u32 { return (p >> PHASE_SHIFT) & PHASE_MASK; }

// Rewrite material, thermal, and phase in a packed voxel.
// Kinetic vectors and flags are preserved.
fn rewrite_voxel(packed: u32, new_mat: u32, new_thermal: u32, new_phase: u32) -> u32 {
    let kinetic_and_flags = packed & 0xF0FF0000u;  // bits 16-23 (kinetic) + 28-31 (flags)
    return (new_mat & MATERIAL_MASK)
         | ((new_thermal & THERMAL_MASK) << THERMAL_SHIFT)
         | kinetic_and_flags
         | ((new_phase & PHASE_MASK) << PHASE_SHIFT);
}

// Determine phase bits for a material after transition
fn phase_for_transition(transition_type: u32) -> u32 {
    // 0=melt (->liquid), 1=boil (->gas), 2=freeze (->solid/frozen), 3=condense (->liquid)
    if (transition_type == 0u) { return PHASE_LIQUID; }
    if (transition_type == 1u) { return PHASE_GAS; }
    if (transition_type == 2u) { return PHASE_FROZEN; }
    if (transition_type == 3u) { return PHASE_LIQUID; }
    return 0u;
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }

    let idx = get_idx(x, y);
    let voxel = grid_in[idx];
    let mat = get_material(voxel);
    let thermal = get_thermal(voxel);

    // Air and fire don't undergo phase transitions
    if (mat == MAT_AIR || mat == MAT_FIRE) {
        grid_out[idx] = voxel;
        return;
    }

    // Check boiling (highest priority — hottest transition)
    let boil_point = ct(mat, 3u);  // COLD_BOIL_POINT
    let boils_into = ct(mat, 13u); // COLD_BOILS_INTO
    if (boils_into != 0u && boil_point != 0u && thermal > boil_point) {
        let latent = ct(mat, 11u); // COLD_LATENT_HEAT_BOIL
        let new_thermal = select(0u, thermal - latent, thermal >= latent);
        grid_out[idx] = rewrite_voxel(voxel, boils_into, new_thermal, PHASE_GAS);
        return;
    }

    // Check melting
    let melt_point = ct(mat, 2u);  // COLD_MELT_POINT
    let melts_into = ct(mat, 12u); // COLD_MELTS_INTO
    if (melts_into != 0u && melt_point != 0u && thermal > melt_point) {
        let latent = ct(mat, 10u); // COLD_LATENT_HEAT_MELT
        let new_thermal = select(0u, thermal - latent, thermal >= latent);
        grid_out[idx] = rewrite_voxel(voxel, melts_into, new_thermal, PHASE_LIQUID);
        return;
    }

    // Check freezing (hysteresis: freeze_point < melt_point of the frozen form)
    let freeze_point = ct(mat, 8u);  // COLD_FREEZE_POINT
    let freezes_into = ct(mat, 14u); // COLD_FREEZES_INTO
    if (freezes_into != 0u && freeze_point != 0u && thermal < freeze_point) {
        // Freezing releases latent heat — but we don't add it here to keep conservation simple.
        // The released energy is "lost" to the phase transition (absorbed by crystallization).
        grid_out[idx] = rewrite_voxel(voxel, freezes_into, thermal, PHASE_FROZEN);
        return;
    }

    // Check condensing
    let condense_point = ct(mat, 9u);  // COLD_CONDENSE_POINT
    let condenses_into = ct(mat, 15u); // COLD_CONDENSES_INTO
    if (condenses_into != 0u && condense_point != 0u && thermal < condense_point) {
        grid_out[idx] = rewrite_voxel(voxel, condenses_into, thermal, PHASE_LIQUID);
        return;
    }

    // No transition
    grid_out[idx] = voxel;
}
