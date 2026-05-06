// Seed 2: Border-aware activity scan wrapping Phase 1b winner
// Checks tile + 1-pixel border halo for activity.
// A tile wakes if ANY voxel in the tile or its immediate border is non-air.
// This correctly handles thermal diffusion across tile boundaries.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read_write> active_counter: array<atomic<u32>>;

var<workgroup> has_active: u32;

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(packed: u32) -> u32 { return (packed >> MATERIAL_SHIFT) & MATERIAL_MASK; }
fn get_thermal(packed: u32) -> u32 { return (packed >> THERMAL_SHIFT) & THERMAL_MASK; }
fn set_thermal(packed: u32, thermal: u32) -> u32 {
    return (packed & ~(THERMAL_MASK << THERMAL_SHIFT)) | ((thermal & THERMAL_MASK) << THERMAL_SHIFT);
}

fn process_voxel(x: u32, y: u32) {
    let idx = get_idx(x, y);
    let voxel = grid_in[idx];
    let mat = get_material(voxel);
    if (mat == MAT_AIR) { grid_out[idx] = voxel; return; }

    let block_phase = ((x >> 1u) + (y >> 1u)) & 3u;
    let self_thermal = get_thermal(voxel);
    var thermal_sum = self_thermal << 4u;
    var weight_sum = 16u;
    var packed_cardinals = vec4<u32>(0u, 0u, 0u, 0u);
    var packed_diagonals = vec4<u32>(0u, 0u, 0u, 0u);
    var valid_mask = 0u;

    if (y > 0u) { let n = grid_in[idx - GRID_WIDTH]; if (get_material(n) != MAT_AIR) { packed_cardinals.x = get_thermal(n); valid_mask |= 1u; } }
    if (x < GRID_WIDTH - 1u) { let n = grid_in[idx + 1u]; if (get_material(n) != MAT_AIR) { packed_cardinals.y = get_thermal(n); valid_mask |= 2u; } }
    if (y < GRID_HEIGHT - 1u) { let n = grid_in[idx + GRID_WIDTH]; if (get_material(n) != MAT_AIR) { packed_cardinals.z = get_thermal(n); valid_mask |= 4u; } }
    if (x > 0u) { let n = grid_in[idx - 1u]; if (get_material(n) != MAT_AIR) { packed_cardinals.w = get_thermal(n); valid_mask |= 8u; } }

    if ((block_phase & 1u) == 0u) {
        if (x < GRID_WIDTH - 1u && y > 0u) { let n = grid_in[idx - GRID_WIDTH + 1u]; if (get_material(n) != MAT_AIR) { packed_diagonals.x = get_thermal(n); valid_mask |= 16u; } }
        if (x > 0u && y < GRID_HEIGHT - 1u) { let n = grid_in[idx + GRID_WIDTH - 1u]; if (get_material(n) != MAT_AIR) { packed_diagonals.z = get_thermal(n); valid_mask |= 32u; } }
    }
    if (block_phase >= 2u) {
        if (x < GRID_WIDTH - 1u && y < GRID_HEIGHT - 1u) { let n = grid_in[idx + GRID_WIDTH + 1u]; if (get_material(n) != MAT_AIR) { packed_diagonals.y = get_thermal(n); valid_mask |= 64u; } }
        if (x > 0u && y > 0u) { let n = grid_in[idx - GRID_WIDTH - 1u]; if (get_material(n) != MAT_AIR) { packed_diagonals.w = get_thermal(n); valid_mask |= 128u; } }
    }

    let cv = vec4<u32>((valid_mask) & 1u, (valid_mask >> 1u) & 1u, (valid_mask >> 2u) & 1u, (valid_mask >> 3u) & 1u);
    let dv = vec4<u32>((valid_mask >> 4u) & 1u, (valid_mask >> 5u) & 1u, (valid_mask >> 6u) & 1u, (valid_mask >> 7u) & 1u);
    thermal_sum += (dot(packed_cardinals, cv) << 1u) + dot(packed_diagonals, dv);
    weight_sum += (dot(cv, vec4<u32>(1u, 1u, 1u, 1u)) << 1u) + dot(dv, vec4<u32>(1u, 1u, 1u, 1u));
    grid_out[idx] = set_thermal(voxel, thermal_sum / weight_sum);
}

fn is_active_at(sx: i32, sy: i32) -> bool {
    if (sx < 0 || sy < 0 || sx >= i32(GRID_WIDTH) || sy >= i32(GRID_HEIGHT)) { return false; }
    return get_material(grid_in[u32(sy) * GRID_WIDTH + u32(sx)]) != MAT_AIR;
}

@compute @workgroup_size(16, 16)
fn tick(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
    @builtin(workgroup_id) wid: vec3<u32>,
) {
    let x = gid.x;
    let y = gid.y;
    let local_idx = lid.y * 16u + lid.x;
    let is_in_bounds = x < GRID_WIDTH && y < GRID_HEIGHT;

    if (local_idx == 0u) { has_active = 0u; }
    workgroupBarrier();

    // Check own voxel
    if (is_in_bounds && get_material(grid_in[get_idx(x, y)]) != MAT_AIR) {
        has_active = 1u;
    }
    // Edge threads check border halo
    if (lid.x == 0u && is_active_at(i32(x) - 1, i32(y))) { has_active = 1u; }
    if (lid.x == 15u && is_active_at(i32(x) + 1, i32(y))) { has_active = 1u; }
    if (lid.y == 0u && is_active_at(i32(x), i32(y) - 1)) { has_active = 1u; }
    if (lid.y == 15u && is_active_at(i32(x), i32(y) + 1)) { has_active = 1u; }
    workgroupBarrier();

    if (has_active == 0u) {
        if (is_in_bounds) { grid_out[get_idx(x, y)] = grid_in[get_idx(x, y)]; }
        return;
    }

    if (local_idx == 0u) { atomicAdd(&active_counter[0], 1u); }
    if (is_in_bounds) { process_voxel(x, y); }
}
