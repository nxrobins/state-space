// Seed 2: Thermal-only synchronization (no movement)
// Conservative: only thermal diffusion, no voxel movement.
// Guarantees matter conservation trivially (no material swaps).
// Good baseline for testing conservation properties.

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

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;

    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) {
        return;
    }

    let idx = get_idx(x, y);
    let voxel = grid_in[idx];
    let mat = get_material(voxel);

    // Air: no thermal transfer
    if (mat == MAT_AIR) {
        grid_out[idx] = voxel;
        return;
    }

    // Weighted average thermal diffusion with Von Neumann neighbors
    // Self weight: 60%, Neighbors: 40% split evenly
    let self_thermal = get_thermal(voxel);
    var neighbor_thermal_sum = 0u;
    var n_neighbors = 0u;

    if (x > 0u) {
        let neighbor = grid_in[get_idx(x - 1u, y)];
        if (get_material(neighbor) != MAT_AIR) {
            neighbor_thermal_sum = neighbor_thermal_sum + get_thermal(neighbor);
            n_neighbors = n_neighbors + 1u;
        }
    }
    if (x < GRID_WIDTH - 1u) {
        let neighbor = grid_in[get_idx(x + 1u, y)];
        if (get_material(neighbor) != MAT_AIR) {
            neighbor_thermal_sum = neighbor_thermal_sum + get_thermal(neighbor);
            n_neighbors = n_neighbors + 1u;
        }
    }
    if (y > 0u) {
        let neighbor = grid_in[get_idx(x, y - 1u)];
        if (get_material(neighbor) != MAT_AIR) {
            neighbor_thermal_sum = neighbor_thermal_sum + get_thermal(neighbor);
            n_neighbors = n_neighbors + 1u;
        }
    }
    if (y < GRID_HEIGHT - 1u) {
        let neighbor = grid_in[get_idx(x, y + 1u)];
        if (get_material(neighbor) != MAT_AIR) {
            neighbor_thermal_sum = neighbor_thermal_sum + get_thermal(neighbor);
            n_neighbors = n_neighbors + 1u;
        }
    }

    var new_thermal = self_thermal;
    if (n_neighbors > 0u) {
        // 75% self, 25% neighbor average
        let neighbor_avg = neighbor_thermal_sum / n_neighbors;
        new_thermal = (self_thermal * 3u + neighbor_avg) / 4u;
    }

    grid_out[idx] = set_thermal(voxel, new_thermal);
}
