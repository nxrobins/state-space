// Seed 1: Per-workgroup activity scan wrapping Phase 1b winner logic
// Each 16x16 workgroup scans its tile for non-air voxels.
// If all voxels are air, the workgroup early-exits (just copies).
// Otherwise runs the full Phase 1b thermal diffusion logic.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read_write> active_counter: array<atomic<u32>>;

var<workgroup> has_active: u32;

fn get_idx(x: u32, y: u32) -> u32 {
    return y * GRID_WIDTH + x;
}

fn get_material(packed: u32) -> u32 {
    return (packed >> MATERIAL_SHIFT) & MATERIAL_MASK;
}

fn get_thermal(packed: u32) -> u32 {
    return (packed >> THERMAL_SHIFT) & THERMAL_MASK;
}

fn set_thermal(packed: u32, thermal: u32) -> u32 {
    let clear_mask = ~(THERMAL_MASK << THERMAL_SHIFT);
    return (packed & clear_mask) | ((thermal & THERMAL_MASK) << THERMAL_SHIFT);
}

// Phase 1b winner thermal logic (must match exactly for output_match=1.0)
fn process_voxel(x: u32, y: u32) {
    let idx = get_idx(x, y);
    let voxel = grid_in[idx];
    let mat = get_material(voxel);

    if (mat == MAT_AIR) {
        grid_out[idx] = voxel;
        return;
    }

    let block_phase = ((x >> 1u) + (y >> 1u)) & 3u;
    let self_thermal = get_thermal(voxel);
    var thermal_sum = self_thermal << 4u;
    var weight_sum = 16u;

    var packed_cardinals = vec4<u32>(0u, 0u, 0u, 0u);
    var packed_diagonals = vec4<u32>(0u, 0u, 0u, 0u);
    var valid_mask = 0u;

    if (y > 0u) {
        let north = grid_in[idx - GRID_WIDTH];
        if (get_material(north) != MAT_AIR) { packed_cardinals.x = get_thermal(north); valid_mask = valid_mask | 1u; }
    }
    if (x < GRID_WIDTH - 1u) {
        let east = grid_in[idx + 1u];
        if (get_material(east) != MAT_AIR) { packed_cardinals.y = get_thermal(east); valid_mask = valid_mask | 2u; }
    }
    if (y < GRID_HEIGHT - 1u) {
        let south = grid_in[idx + GRID_WIDTH];
        if (get_material(south) != MAT_AIR) { packed_cardinals.z = get_thermal(south); valid_mask = valid_mask | 4u; }
    }
    if (x > 0u) {
        let west = grid_in[idx - 1u];
        if (get_material(west) != MAT_AIR) { packed_cardinals.w = get_thermal(west); valid_mask = valid_mask | 8u; }
    }

    if ((block_phase & 1u) == 0u) {
        if (x < GRID_WIDTH - 1u && y > 0u) {
            let ne = grid_in[idx - GRID_WIDTH + 1u];
            if (get_material(ne) != MAT_AIR) { packed_diagonals.x = get_thermal(ne); valid_mask = valid_mask | 16u; }
        }
        if (x > 0u && y < GRID_HEIGHT - 1u) {
            let sw = grid_in[idx + GRID_WIDTH - 1u];
            if (get_material(sw) != MAT_AIR) { packed_diagonals.z = get_thermal(sw); valid_mask = valid_mask | 32u; }
        }
    }
    if (block_phase >= 2u) {
        if (x < GRID_WIDTH - 1u && y < GRID_HEIGHT - 1u) {
            let se = grid_in[idx + GRID_WIDTH + 1u];
            if (get_material(se) != MAT_AIR) { packed_diagonals.y = get_thermal(se); valid_mask = valid_mask | 64u; }
        }
        if (x > 0u && y > 0u) {
            let nw = grid_in[idx - GRID_WIDTH - 1u];
            if (get_material(nw) != MAT_AIR) { packed_diagonals.w = get_thermal(nw); valid_mask = valid_mask | 128u; }
        }
    }

    let cardinal_valid = vec4<u32>((valid_mask >> 0u) & 1u, (valid_mask >> 1u) & 1u, (valid_mask >> 2u) & 1u, (valid_mask >> 3u) & 1u);
    let diagonal_valid = vec4<u32>((valid_mask >> 4u) & 1u, (valid_mask >> 5u) & 1u, (valid_mask >> 6u) & 1u, (valid_mask >> 7u) & 1u);

    let cardinal_sum = dot(packed_cardinals, cardinal_valid);
    let diagonal_sum = dot(packed_diagonals, diagonal_valid);
    let cardinal_count = dot(cardinal_valid, vec4<u32>(1u, 1u, 1u, 1u));
    let diagonal_count = dot(diagonal_valid, vec4<u32>(1u, 1u, 1u, 1u));

    thermal_sum = thermal_sum + (cardinal_sum << 1u) + diagonal_sum;
    weight_sum = weight_sum + (cardinal_count << 1u) + diagonal_count;

    let new_thermal = thermal_sum / weight_sum;
    grid_out[idx] = set_thermal(voxel, new_thermal);
}

@compute @workgroup_size(16, 16)
fn tick(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
) {
    let x = gid.x;
    let y = gid.y;
    let local_idx = lid.y * 16u + lid.x;
    let is_in_bounds = x < GRID_WIDTH && y < GRID_HEIGHT;

    // Phase 1: Scan for activity
    if (local_idx == 0u) { has_active = 0u; }
    workgroupBarrier();

    if (is_in_bounds) {
        if (get_material(grid_in[get_idx(x, y)]) != MAT_AIR) {
            has_active = 1u;
        }
    }
    workgroupBarrier();

    // Early exit: tile is all air
    if (has_active == 0u) {
        if (is_in_bounds) { grid_out[get_idx(x, y)] = grid_in[get_idx(x, y)]; }
        return;
    }

    // Count active workgroup
    if (local_idx == 0u) { atomicAdd(&active_counter[0], 1u); }

    // Run full Phase 1b logic
    if (is_in_bounds) { process_voxel(x, y); }
}
