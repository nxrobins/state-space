// Seed 3: Shared memory vote with exact active count
// Uses workgroup shared memory for precise activity counting.
// Thread 0 sums all flags for a definitive activity decision.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read_write> active_counter: array<atomic<u32>>;

var<workgroup> activity_flags: array<u32, 256>;
var<workgroup> tile_is_active: u32;

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

@compute @workgroup_size(16, 16)
fn tick(
    @builtin(global_invocation_id) gid: vec3<u32>,
    @builtin(local_invocation_id) lid: vec3<u32>,
) {
    let x = gid.x;
    let y = gid.y;
    let local_idx = lid.y * 16u + lid.x;
    let is_in_bounds = x < GRID_WIDTH && y < GRID_HEIGHT;

    // Write per-thread activity flag
    var my_active = 0u;
    if (is_in_bounds && get_material(grid_in[get_idx(x, y)]) != MAT_AIR) {
        my_active = 1u;
    }
    activity_flags[local_idx] = my_active;
    workgroupBarrier();

    // Thread 0 sums all flags
    if (local_idx == 0u) {
        var sum = 0u;
        for (var i = 0u; i < 256u; i++) { sum += activity_flags[i]; }
        tile_is_active = sum;
        if (sum > 0u) { atomicAdd(&active_counter[0], 1u); }
    }
    workgroupBarrier();

    if (tile_is_active == 0u) {
        if (is_in_bounds) { grid_out[get_idx(x, y)] = grid_in[get_idx(x, y)]; }
        return;
    }

    if (is_in_bounds) { process_voxel(x, y); }
}
