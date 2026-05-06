// Phase 2a Seed 3: Strictly conservative pairwise thermal exchange
//
// Instead of computing a net delta per voxel (which can violate conservation
// due to integer rounding), this seed processes each cardinal pair as an
// explicit exchange: heat moved OUT of A equals heat moved INTO B.
//
// Each voxel only exchanges with neighbors to the right and below (to avoid
// double-counting in a double-buffer scheme). The other half of exchanges
// happen when the neighbor processes its left/up pairs.
//
// This ensures exact energy conservation at the cost of slower diffusion
// (only 2 of 4 neighbors per tick, alternating with the other 2).

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

const COLD_STRIDE: u32 = 8u;
const COLD_CONDUCTIVITY: u32 = 1u;

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }
fn get_thermal(p: u32) -> u32 { return (p >> THERMAL_SHIFT) & THERMAL_MASK; }

fn set_thermal(p: u32, t: u32) -> u32 {
    return (p & ~(THERMAL_MASK << THERMAL_SHIFT)) | ((t & THERMAL_MASK) << THERMAL_SHIFT);
}

fn cond_of(mat: u32) -> u32 {
    return cold_table[mat * COLD_STRIDE + COLD_CONDUCTIVITY];
}

fn hmean(a: u32, b: u32) -> u32 {
    let s = a + b;
    if (s == 0u) { return 0u; }
    return (2u * a * b) / s;
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }

    let idx = get_idx(x, y);
    let voxel = grid_in[idx];
    let mat = get_material(voxel);
    let self_t = i32(get_thermal(voxel));
    let self_c = cond_of(mat);

    var thermal_adjust: i32 = 0;

    // Exchange with right neighbor (this voxel is the "left" in the pair)
    if (x < GRID_WIDTH - 1u) {
        let right = grid_in[get_idx(x + 1u, y)];
        let r_mat = get_material(right);
        let r_t = i32(get_thermal(right));
        let k = hmean(self_c, cond_of(r_mat));

        // Compute transfer: positive = heat flows right (self loses, right gains)
        let diff = self_t - r_t;
        let transfer = diff * i32(k) / 512;  // /512 for stability
        thermal_adjust -= transfer;
    }

    // Receive from left neighbor's rightward exchange
    if (x > 0u) {
        let left = grid_in[get_idx(x - 1u, y)];
        let l_mat = get_material(left);
        let l_t = i32(get_thermal(left));
        let k = hmean(cond_of(l_mat), self_c);

        let diff = l_t - self_t;
        let transfer = diff * i32(k) / 512;
        thermal_adjust += transfer;
    }

    // Exchange with below neighbor
    if (y < GRID_HEIGHT - 1u) {
        let below = grid_in[get_idx(x, y + 1u)];
        let b_mat = get_material(below);
        let b_t = i32(get_thermal(below));
        let k = hmean(self_c, cond_of(b_mat));

        let diff = self_t - b_t;
        let transfer = diff * i32(k) / 512;
        thermal_adjust -= transfer;
    }

    // Receive from above neighbor's downward exchange
    if (y > 0u) {
        let above = grid_in[get_idx(x, y - 1u)];
        let a_mat = get_material(above);
        let a_t = i32(get_thermal(above));
        let k = hmean(cond_of(a_mat), self_c);

        let diff = a_t - self_t;
        let transfer = diff * i32(k) / 512;
        thermal_adjust += transfer;
    }

    let new_thermal = u32(max(0, min(255, self_t + thermal_adjust)));
    grid_out[idx] = set_thermal(voxel, new_thermal);
}
