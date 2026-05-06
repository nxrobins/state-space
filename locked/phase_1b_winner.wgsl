// Block-based thermal diffusion with bit-packed neighbor processing
// Packs multiple neighbor thermal values into u32s for parallel processing

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
    if (mat == MAT_AIR) {
        grid_out[idx] = voxel;
        return;
    }

    // Block-based pattern: 2x2 blocks process in different phases
    let block_phase = ((x >> 1u) + (y >> 1u)) & 3u;
    let self_thermal = get_thermal(voxel);
    
    // Start with heavily weighted self
    var thermal_sum = self_thermal << 4u; // *16 via shift
    var weight_sum = 16u;
    
    // Pack neighbor data for vectorized processing
    // We'll read all 8 neighbors and pack their thermal/valid bits
    var packed_cardinals = vec4<u32>(0u, 0u, 0u, 0u); // N, E, S, W thermals
    var packed_diagonals = vec4<u32>(0u, 0u, 0u, 0u); // NE, SE, SW, NW thermals
    var valid_mask = 0u; // Bit i set if neighbor i is valid (not air)
    
    // North (bit 0)
    if (y > 0u) {
        let north = grid_in[idx - GRID_WIDTH];
        if (get_material(north) != MAT_AIR) {
            packed_cardinals.x = get_thermal(north);
            valid_mask = valid_mask | 1u;
        }
    }
    
    // East (bit 1)
    if (x < GRID_WIDTH - 1u) {
        let east = grid_in[idx + 1u];
        if (get_material(east) != MAT_AIR) {
            packed_cardinals.y = get_thermal(east);
            valid_mask = valid_mask | 2u;
        }
    }
    
    // South (bit 2)
    if (y < GRID_HEIGHT - 1u) {
        let south = grid_in[idx + GRID_WIDTH];
        if (get_material(south) != MAT_AIR) {
            packed_cardinals.z = get_thermal(south);
            valid_mask = valid_mask | 4u;
        }
    }
    
    // West (bit 3)
    if (x > 0u) {
        let west = grid_in[idx - 1u];
        if (get_material(west) != MAT_AIR) {
            packed_cardinals.w = get_thermal(west);
            valid_mask = valid_mask | 8u;
        }
    }
    
    // Process diagonals based on block phase to avoid conflicts
    if ((block_phase & 1u) == 0u) {
        // Northeast (bit 4)
        if (x < GRID_WIDTH - 1u && y > 0u) {
            let ne = grid_in[idx - GRID_WIDTH + 1u];
            if (get_material(ne) != MAT_AIR) {
                packed_diagonals.x = get_thermal(ne);
                valid_mask = valid_mask | 16u;
            }
        }
        
        // Southwest (bit 5)
        if (x > 0u && y < GRID_HEIGHT - 1u) {
            let sw = grid_in[idx + GRID_WIDTH - 1u];
            if (get_material(sw) != MAT_AIR) {
                packed_diagonals.z = get_thermal(sw);
                valid_mask = valid_mask | 32u;
            }
        }
    }
    
    if (block_phase >= 2u) {
        // Southeast (bit 6)
        if (x < GRID_WIDTH - 1u && y < GRID_HEIGHT - 1u) {
            let se = grid_in[idx + GRID_WIDTH + 1u];
            if (get_material(se) != MAT_AIR) {
                packed_diagonals.y = get_thermal(se);
                valid_mask = valid_mask | 64u;
            }
        }
        
        // Northwest (bit 7)
        if (x > 0u && y > 0u) {
            let nw = grid_in[idx - GRID_WIDTH - 1u];
            if (get_material(nw) != MAT_AIR) {
                packed_diagonals.w = get_thermal(nw);
                valid_mask = valid_mask | 128u;
            }
        }
    }
    
    // Vectorized thermal accumulation
    // Cardinals get 2x weight
    let cardinal_valid = vec4<u32>(
        (valid_mask >> 0u) & 1u,
        (valid_mask >> 1u) & 1u,
        (valid_mask >> 2u) & 1u,
        (valid_mask >> 3u) & 1u
    );
    
    let diagonal_valid = vec4<u32>(
        (valid_mask >> 4u) & 1u,
        (valid_mask >> 5u) & 1u,
        (valid_mask >> 6u) & 1u,
        (valid_mask >> 7u) & 1u
    );
    
    // Parallel dot products for thermal sums
    let cardinal_sum = dot(packed_cardinals, cardinal_valid);
    let diagonal_sum = dot(packed_diagonals, diagonal_valid);
    let cardinal_count = dot(cardinal_valid, vec4<u32>(1u, 1u, 1u, 1u));
    let diagonal_count = dot(diagonal_valid, vec4<u32>(1u, 1u, 1u, 1u));
    
    // Accumulate with weights
    thermal_sum = thermal_sum + (cardinal_sum << 1u) + diagonal_sum;
    weight_sum = weight_sum + (cardinal_count << 1u) + diagonal_count;
    
    // Compute average
    let new_thermal = thermal_sum / weight_sum;
    grid_out[idx] = set_thermal(voxel, new_thermal);
}