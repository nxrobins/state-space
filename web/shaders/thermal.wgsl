// Variant: Optimized thermal diffusion with precomputed neighbor data and efficient delta accumulation

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

const COLD_STRIDE: u32 = 24u;
const COLD_CONDUCTIVITY: u32 = 1u;

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }
fn get_thermal(p: u32) -> u32 { return (p >> THERMAL_SHIFT) & THERMAL_MASK; }

fn set_thermal(p: u32, t: u32) -> u32 {
    return (p & ~(THERMAL_MASK << THERMAL_SHIFT)) | ((t & THERMAL_MASK) << THERMAL_SHIFT);
}

fn conductivity_of(mat: u32) -> u32 {
    return cold_table[mat * COLD_STRIDE + COLD_CONDUCTIVITY];
}

// Extract material and thermal in one operation
fn get_mat_thermal(p: u32) -> vec2<u32> {
    return vec2<u32>(get_material(p), get_thermal(p));
}

// Optimized harmonic mean using precomputed 2x value
fn harmonic_mean_2x(a_2x: u32, b: u32) -> u32 {
    let s = (a_2x >> 1u) + b;
    if (s == 0u) { return 0u; }
    return (a_2x * b) / s;
}

// Compute thermal exchange with neighbor using precomputed self_cond_2x
fn compute_exchange(self_thermal: u32, self_cond_2x: u32, neighbor: u32) -> i32 {
    let n_props = get_mat_thermal(neighbor);
    let n_thermal = n_props.y;
    let n_cond = conductivity_of(n_props.x);
    let k = harmonic_mean_2x(self_cond_2x, n_cond);
    return (i32(n_thermal) - i32(self_thermal)) * i32(k) / 256;
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }

    let idx = get_idx(x, y);
    let voxel = grid_in[idx];
    
    // Extract material and thermal together
    let props = get_mat_thermal(voxel);
    let self_thermal = props.y;
    let self_cond = conductivity_of(props.x);
    let self_cond_2x = self_cond << 1u; // Multiply by 2 using bit shift
    
    // Precompute neighbor indices
    let idx_north = idx - GRID_WIDTH;
    let idx_south = idx + GRID_WIDTH;
    let idx_west = idx - 1u;
    let idx_east = idx + 1u;
    
    // Accumulate thermal exchange
    var delta: i32 = 0;
    
    // North
    if (y > 0u) {
        delta += compute_exchange(self_thermal, self_cond_2x, grid_in[idx_north]);
    }
    
    // South
    if (y < GRID_HEIGHT - 1u) {
        delta += compute_exchange(self_thermal, self_cond_2x, grid_in[idx_south]);
    }
    
    // West
    if (x > 0u) {
        delta += compute_exchange(self_thermal, self_cond_2x, grid_in[idx_west]);
    }
    
    // East
    if (x < GRID_WIDTH - 1u) {
        delta += compute_exchange(self_thermal, self_cond_2x, grid_in[idx_east]);
    }

    // Source materials (fire, lava) radiate heat but don't cool.
    // They emit to neighbors (neighbors compute positive delta from us),
    // but we skip the self-subtraction. Energy is added to the system —
    // physically correct for ongoing chemical/geological energy input.
    // Fire lifetime is gated by fuel exhaustion (2d), not thermal budget.
    let mat = props.x;
    if (mat == MAT_FIRE || mat == MAT_LAVA) {
        grid_out[idx] = voxel;  // thermal unchanged
        return;
    }

    // Apply delta with saturating arithmetic
    let new_thermal = i32(self_thermal) + delta;
    let clamped = u32(max(0, min(255, new_thermal)));
    grid_out[idx] = set_thermal(voxel, clamped);
}