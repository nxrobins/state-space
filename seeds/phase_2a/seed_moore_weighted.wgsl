// Phase 2a Seed 2: Moore neighborhood (8 neighbors) with distance weighting
//
// Cardinals get full weight, diagonals get 1/sqrt(2) ≈ 0.7 weight.
// Approximated as: cardinals * 4, diagonals * 3, normalize by sum.
// Uses harmonic mean conductivity at each interface.

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

// Compute weighted thermal contribution from one neighbor
fn neighbor_contrib(self_t: i32, self_c: u32, neighbor: u32, weight: i32) -> i32 {
    let n_mat = get_material(neighbor);
    let n_t = i32(get_thermal(neighbor));
    let k = i32(hmean(self_c, cond_of(n_mat)));
    // Transfer = weight * k * (n_t - self_t) / (256 * 4)
    // The extra /4 because we use integer weights 3-4 instead of 0.7-1.0
    return weight * k * (n_t - self_t) / 1024;
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

    var delta: i32 = 0;

    let has_n = y > 0u;
    let has_s = y < GRID_HEIGHT - 1u;
    let has_w = x > 0u;
    let has_e = x < GRID_WIDTH - 1u;

    // Cardinals (weight = 4)
    if (has_n) { delta += neighbor_contrib(self_t, self_c, grid_in[get_idx(x, y - 1u)], 4); }
    if (has_s) { delta += neighbor_contrib(self_t, self_c, grid_in[get_idx(x, y + 1u)], 4); }
    if (has_w) { delta += neighbor_contrib(self_t, self_c, grid_in[get_idx(x - 1u, y)], 4); }
    if (has_e) { delta += neighbor_contrib(self_t, self_c, grid_in[get_idx(x + 1u, y)], 4); }

    // Diagonals (weight = 3, approximating 1/sqrt(2))
    if (has_n && has_w) { delta += neighbor_contrib(self_t, self_c, grid_in[get_idx(x - 1u, y - 1u)], 3); }
    if (has_n && has_e) { delta += neighbor_contrib(self_t, self_c, grid_in[get_idx(x + 1u, y - 1u)], 3); }
    if (has_s && has_w) { delta += neighbor_contrib(self_t, self_c, grid_in[get_idx(x - 1u, y + 1u)], 3); }
    if (has_s && has_e) { delta += neighbor_contrib(self_t, self_c, grid_in[get_idx(x + 1u, y + 1u)], 3); }

    let new_thermal = u32(max(0, min(255, self_t + delta)));
    grid_out[idx] = set_thermal(voxel, new_thermal);
}
