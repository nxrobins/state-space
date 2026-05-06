// Phase 2c Seed 3: Branchless phase transition
//
// Evaluates all 4 transition conditions simultaneously and selects
// the highest-priority one via select() chains instead of if/return.
// Reduces branch divergence within workgroups.

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
    let keep = packed & 0xF0FF0000u;
    return (new_mat & MATERIAL_MASK)
         | ((new_thermal & THERMAL_MASK) << THERMAL_SHIFT)
         | keep
         | ((new_phase & PHASE_MASK) << PHASE_SHIFT);
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

    // Load all transition parameters at once
    let melt_point     = ct(mat, 2u);
    let boil_point     = ct(mat, 3u);
    let freeze_point   = ct(mat, 8u);
    let condense_point = ct(mat, 9u);
    let lh_melt        = ct(mat, 10u);
    let lh_boil        = ct(mat, 11u);
    let melts_into     = ct(mat, 12u);
    let boils_into     = ct(mat, 13u);
    let freezes_into   = ct(mat, 14u);
    let condenses_into = ct(mat, 15u);

    // Evaluate conditions (all branchless)
    let can_boil     = boils_into != 0u && boil_point != 0u && thermal > boil_point;
    let can_melt     = melts_into != 0u && melt_point != 0u && thermal > melt_point;
    let can_freeze   = freezes_into != 0u && freeze_point != 0u && thermal < freeze_point;
    let can_condense = condenses_into != 0u && condense_point != 0u && thermal < condense_point;

    // Priority: boil > melt > freeze > condense
    // Start from lowest priority and overwrite upward
    var new_mat = mat;
    var new_thermal = thermal;
    var new_phase = (voxel >> PHASE_SHIFT) & PHASE_MASK;
    var transitioned = false;

    if (can_condense) {
        new_mat = condenses_into;
        new_phase = PHASE_LIQUID;
        transitioned = true;
    }
    if (can_freeze) {
        new_mat = freezes_into;
        new_phase = PHASE_FROZEN;
        transitioned = true;
    }
    if (can_melt) {
        new_mat = melts_into;
        new_thermal = select(0u, thermal - lh_melt, thermal >= lh_melt);
        new_phase = PHASE_LIQUID;
        transitioned = true;
    }
    if (can_boil) {
        new_mat = boils_into;
        new_thermal = select(0u, thermal - lh_boil, thermal >= lh_boil);
        new_phase = PHASE_GAS;
        transitioned = true;
    }

    if (transitioned) {
        grid_out[idx] = rewrite_voxel(voxel, new_mat, new_thermal, new_phase);
    } else {
        grid_out[idx] = voxel;
    }
}
