// Hybrid approach: bitfield construction with simplified priority resolution and fast paths

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

const COLD_STRIDE_L: u32 = 24u;

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

    // Load all transition parameters
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

    // Build transition bitfield with priority pre-encoded
    // Use bits 0-3 for priority order: boil=3, melt=2, freeze=1, condense=0
    let boil_mask = select(0u, 8u, boils_into != 0u && boil_point != 0u && thermal > boil_point);
    let melt_mask = select(0u, 4u, melts_into != 0u && melt_point != 0u && thermal > melt_point);
    let freeze_mask = select(0u, 2u, freezes_into != 0u && freeze_point != 0u && thermal < freeze_point);
    let condense_mask = select(0u, 1u, condenses_into != 0u && condense_point != 0u && thermal < condense_point);
    
    let transitions = boil_mask | melt_mask | freeze_mask | condense_mask;
    
    if (transitions == 0u) {
        grid_out[idx] = voxel;
        return;
    }

    // Find highest set bit (highest priority transition)
    let winner = 31u - countLeadingZeros(transitions);
    
    // Direct indexing into material array using winner bit
    let material_array = array<u32, 4>(condenses_into, freezes_into, melts_into, boils_into);
    let new_mat = material_array[winner];
    
    // Compute thermal change (only for melt/boil which are bits 2-3)
    let needs_latent = winner >> 1u;  // 1 if melt or boil
    let latent_array = array<u32, 2>(lh_melt, lh_boil);
    let thermal_cost = latent_array[winner - 2u] * needs_latent;
    let new_thermal = select(thermal, select(0u, thermal - thermal_cost, thermal >= thermal_cost), needs_latent != 0u);
    
    // Compute phase using lookup
    let phase_array = array<u32, 4>(PHASE_LIQUID, PHASE_FROZEN, PHASE_LIQUID, PHASE_GAS);
    let new_phase = phase_array[winner];

    grid_out[idx] = rewrite_voxel(voxel, new_mat, new_thermal, new_phase);
}