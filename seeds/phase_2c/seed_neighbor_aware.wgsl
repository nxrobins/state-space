// Phase 2c Seed 2: Neighbor-aware phase transitions
//
// Like seed_simple but also considers neighbor context:
// - A voxel is more likely to melt if surrounded by hot neighbors
// - A voxel is more likely to freeze if surrounded by cold neighbors
// - Uses average neighbor thermal as a modifier on the threshold
//
// This creates smoother transition fronts (melting propagates from
// the heat source outward) rather than all-at-once threshold crossings.

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

fn rewrite_voxel(packed: u32, new_mat: u32, new_thermal: u32, new_phase: u32) -> u32 {
    // Preserve kinetic (bits 16-23) and flags (bits 28-31)
    let keep = packed & 0xF0FF0000u;
    return (new_mat & MATERIAL_MASK)
         | ((new_thermal & THERMAL_MASK) << THERMAL_SHIFT)
         | keep
         | ((new_phase & PHASE_MASK) << PHASE_SHIFT);
}

// Compute average thermal of cardinal neighbors
fn avg_neighbor_thermal(x: u32, y: u32) -> u32 {
    var sum = 0u;
    var count = 0u;
    if (x > 0u) { sum += get_thermal(grid_in[get_idx(x - 1u, y)]); count += 1u; }
    if (x < GRID_WIDTH - 1u) { sum += get_thermal(grid_in[get_idx(x + 1u, y)]); count += 1u; }
    if (y > 0u) { sum += get_thermal(grid_in[get_idx(x, y - 1u)]); count += 1u; }
    if (y < GRID_HEIGHT - 1u) { sum += get_thermal(grid_in[get_idx(x, y + 1u)]); count += 1u; }
    if (count == 0u) { return 0u; }
    return sum / count;
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

    if (mat == MAT_AIR || mat == MAT_FIRE) {
        grid_out[idx] = voxel;
        return;
    }

    // Effective thermal = 75% self + 25% neighbor average
    // This smooths transitions and prevents single-voxel oscillation
    let n_avg = avg_neighbor_thermal(x, y);
    let effective = (thermal * 3u + n_avg) / 4u;

    // Boiling
    let boil_point = ct(mat, 3u);
    let boils_into = ct(mat, 13u);
    if (boils_into != 0u && boil_point != 0u && effective > boil_point) {
        let latent = ct(mat, 11u);
        let new_t = select(0u, thermal - latent, thermal >= latent);
        grid_out[idx] = rewrite_voxel(voxel, boils_into, new_t, PHASE_GAS);
        return;
    }

    // Melting
    let melt_point = ct(mat, 2u);
    let melts_into = ct(mat, 12u);
    if (melts_into != 0u && melt_point != 0u && effective > melt_point) {
        let latent = ct(mat, 10u);
        let new_t = select(0u, thermal - latent, thermal >= latent);
        grid_out[idx] = rewrite_voxel(voxel, melts_into, new_t, PHASE_LIQUID);
        return;
    }

    // Freezing
    let freeze_point = ct(mat, 8u);
    let freezes_into = ct(mat, 14u);
    if (freezes_into != 0u && freeze_point != 0u && effective < freeze_point) {
        grid_out[idx] = rewrite_voxel(voxel, freezes_into, thermal, PHASE_FROZEN);
        return;
    }

    // Condensing
    let condense_point = ct(mat, 9u);
    let condenses_into = ct(mat, 15u);
    if (condenses_into != 0u && condense_point != 0u && effective < condense_point) {
        grid_out[idx] = rewrite_voxel(voxel, condenses_into, thermal, PHASE_LIQUID);
        return;
    }

    grid_out[idx] = voxel;
}
