// Phase 2a Seed 1: Cardinal-neighbor thermal diffusion with cold table conductivity
//
// Each voxel exchanges heat with its 4 Von Neumann neighbors.
// Transfer rate is the harmonic mean of the two materials' conductivities.
// Air acts as a weak insulator (conductivity=5).
//
// Bindings:
//   0: grid_in (read-only)
//   1: grid_out (read-write)
//   2: cold_table (read-only, 256 entries x 8 u32s)

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

fn conductivity_of(mat: u32) -> u32 {
    return cold_table[mat * COLD_STRIDE + COLD_CONDUCTIVITY];
}

// LOCKED: Harmonic mean for interface conductivity
fn harmonic_mean(a: u32, b: u32) -> u32 {
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
    let self_thermal = get_thermal(voxel);
    let self_cond = conductivity_of(mat);

    // Accumulate thermal exchange with each cardinal neighbor
    // Transfer = interface_conductivity * (neighbor_thermal - self_thermal) / 256
    // The /256 normalizes conductivity range (0-255) to a 0.0-1.0 fraction
    var delta: i32 = 0;

    // North
    if (y > 0u) {
        let n = grid_in[get_idx(x, y - 1u)];
        let n_mat = get_material(n);
        let n_thermal = get_thermal(n);
        let k = harmonic_mean(self_cond, conductivity_of(n_mat));
        delta += (i32(n_thermal) - i32(self_thermal)) * i32(k) / 256;
    }
    // South
    if (y < GRID_HEIGHT - 1u) {
        let n = grid_in[get_idx(x, y + 1u)];
        let n_mat = get_material(n);
        let n_thermal = get_thermal(n);
        let k = harmonic_mean(self_cond, conductivity_of(n_mat));
        delta += (i32(n_thermal) - i32(self_thermal)) * i32(k) / 256;
    }
    // West
    if (x > 0u) {
        let n = grid_in[get_idx(x - 1u, y)];
        let n_mat = get_material(n);
        let n_thermal = get_thermal(n);
        let k = harmonic_mean(self_cond, conductivity_of(n_mat));
        delta += (i32(n_thermal) - i32(self_thermal)) * i32(k) / 256;
    }
    // East
    if (x < GRID_WIDTH - 1u) {
        let n = grid_in[get_idx(x + 1u, y)];
        let n_mat = get_material(n);
        let n_thermal = get_thermal(n);
        let k = harmonic_mean(self_cond, conductivity_of(n_mat));
        delta += (i32(n_thermal) - i32(self_thermal)) * i32(k) / 256;
    }

    // Apply delta, clamp to [0, 255]
    let new_thermal = u32(max(0, min(255, i32(self_thermal) + delta)));
    grid_out[idx] = set_thermal(voxel, new_thermal);
}
