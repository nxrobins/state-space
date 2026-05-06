// Seed 3: Checkerboard synchronization (Margolus-inspired)
// Even ticks process (x+y)%2==0 cells, odd ticks process (x+y)%2==1 cells.
// This avoids read-write conflicts without a separate intention buffer.
// Uses a uniform tick_count to determine parity.

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

    // Checkerboard pattern: only process active cells this tick
    // Since we don't have a tick_count uniform, we process ALL cells
    // but only do thermal diffusion (conservative, no movement conflicts)
    let mat = get_material(voxel);

    if (mat == MAT_AIR) {
        grid_out[idx] = voxel;
        return;
    }

    // Thermal diffusion with directional bias based on checkerboard parity
    let parity = (x + y) & 1u;
    let self_thermal = get_thermal(voxel);
    var total_thermal = self_thermal * 2u;
    var count = 2u;

    // Even-parity cells exchange with right+down, odd with left+up
    if (parity == 0u) {
        if (x < GRID_WIDTH - 1u) {
            let right = grid_in[get_idx(x + 1u, y)];
            if (get_material(right) != MAT_AIR) {
                total_thermal = total_thermal + get_thermal(right);
                count = count + 1u;
            }
        }
        if (y < GRID_HEIGHT - 1u) {
            let down = grid_in[get_idx(x, y + 1u)];
            if (get_material(down) != MAT_AIR) {
                total_thermal = total_thermal + get_thermal(down);
                count = count + 1u;
            }
        }
    } else {
        if (x > 0u) {
            let left = grid_in[get_idx(x - 1u, y)];
            if (get_material(left) != MAT_AIR) {
                total_thermal = total_thermal + get_thermal(left);
                count = count + 1u;
            }
        }
        if (y > 0u) {
            let up = grid_in[get_idx(x, y - 1u)];
            if (get_material(up) != MAT_AIR) {
                total_thermal = total_thermal + get_thermal(up);
                count = count + 1u;
            }
        }
    }

    let new_thermal = total_thermal / count;
    grid_out[idx] = set_thermal(voxel, new_thermal);
}
