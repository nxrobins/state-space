// Seed 1: Classic double-buffer synchronization
// Read from grid_in, write to grid_out. Caller swaps buffers between ticks.
// Simple thermal diffusion: each voxel averages thermal energy with neighbors.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;

fn get_idx(x: u32, y: u32) -> u32 {
    return y * GRID_WIDTH + x;
}

fn get_thermal(packed: u32) -> u32 {
    return (packed >> THERMAL_SHIFT) & THERMAL_MASK;
}

fn get_material(packed: u32) -> u32 {
    return (packed >> MATERIAL_SHIFT) & MATERIAL_MASK;
}

fn set_thermal(packed: u32, thermal: u32) -> u32 {
    let clear_mask = ~(THERMAL_MASK << THERMAL_SHIFT);
    return (packed & clear_mask) | ((thermal & THERMAL_MASK) << THERMAL_SHIFT);
}

fn get_kinetic_y(packed: u32) -> i32 {
    let raw = (packed >> KINETIC_Y_SHIFT) & KINETIC_Y_MASK;
    return i32((raw ^ 0x8u) - 0x8u);
}

fn set_kinetic_y(packed: u32, ky: i32) -> u32 {
    let clear_mask = ~(KINETIC_Y_MASK << KINETIC_Y_SHIFT);
    return (packed & clear_mask) | ((u32(ky) & KINETIC_Y_MASK) << KINETIC_Y_SHIFT);
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;

    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) {
        return;
    }

    let idx = get_idx(x, y);
    var voxel = grid_in[idx];
    let mat = get_material(voxel);

    // Air: skip processing (static)
    if (mat == MAT_AIR) {
        grid_out[idx] = voxel;
        return;
    }

    // --- Thermal diffusion ---
    // Average thermal energy with Von Neumann neighbors (4-directional)
    var thermal_sum = get_thermal(voxel) * 4u;  // weight self 4x
    var neighbor_count = 4u;

    if (x > 0u) {
        thermal_sum = thermal_sum + get_thermal(grid_in[get_idx(x - 1u, y)]);
        neighbor_count = neighbor_count + 1u;
    }
    if (x < GRID_WIDTH - 1u) {
        thermal_sum = thermal_sum + get_thermal(grid_in[get_idx(x + 1u, y)]);
        neighbor_count = neighbor_count + 1u;
    }
    if (y > 0u) {
        thermal_sum = thermal_sum + get_thermal(grid_in[get_idx(x, y - 1u)]);
        neighbor_count = neighbor_count + 1u;
    }
    if (y < GRID_HEIGHT - 1u) {
        thermal_sum = thermal_sum + get_thermal(grid_in[get_idx(x, y + 1u)]);
        neighbor_count = neighbor_count + 1u;
    }

    let new_thermal = thermal_sum / neighbor_count;
    voxel = set_thermal(voxel, new_thermal);

    // --- Gravity (simple: powder/liquid falls down) ---
    let phase = (voxel >> PHASE_SHIFT) & PHASE_MASK;
    let is_movable = (phase == PHASE_POWDER) || (phase == PHASE_LIQUID) || (phase == PHASE_VISCOUS);

    if (is_movable && y < GRID_HEIGHT - 1u) {
        let below_idx = get_idx(x, y + 1u);
        let below = grid_in[below_idx];
        let below_mat = get_material(below);

        // Fall into air
        if (below_mat == MAT_AIR) {
            // Swap: current becomes air, below becomes this material
            grid_out[idx] = below;  // air takes our place
            grid_out[below_idx] = voxel;  // we fall down
            return;
        }
    }

    grid_out[idx] = voxel;
}
