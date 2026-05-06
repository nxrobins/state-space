// Phase 2b Seed 3: Vertical gravity + stochastic lateral spreading
//
// Same vertical rules as seed_lateral_spread, but lateral direction
// is chosen by a deterministic hash of position rather than simple parity.
// This creates more natural-looking fluid flow by breaking the
// left/right symmetry that parity introduces.
//
// Hash: (x * 1597u + y * 51749u + tick_proxy) where tick_proxy is
// derived from the grid state itself (sum of nearby thermals), making
// it vary per-tick without needing a tick counter uniform.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

const COLD_STRIDE: u32 = 8u;
const COLD_DENSITY: u32 = 0u;

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }
fn get_thermal(p: u32) -> u32 { return (p >> THERMAL_SHIFT) & THERMAL_MASK; }
fn get_phase(p: u32) -> u32 { return (p >> PHASE_SHIFT) & PHASE_MASK; }

fn density_of(mat: u32) -> u32 {
    return cold_table[mat * COLD_STRIDE + COLD_DENSITY];
}

fn is_movable(ph: u32) -> bool {
    return ph == PHASE_POWDER || ph == PHASE_LIQUID || ph == PHASE_VISCOUS || ph == PHASE_GAS;
}

fn is_fluid(ph: u32) -> bool {
    return ph == PHASE_LIQUID || ph == PHASE_VISCOUS || ph == PHASE_GAS;
}

// Deterministic spatial hash for direction preference
fn dir_hash(x: u32, y: u32) -> u32 {
    // Use position + neighbor thermal sum as pseudo-random seed
    // This varies spatially AND temporally (thermal changes each tick)
    var h = x * 1597u + y * 51749u;
    // Mix in local thermal state for temporal variation
    let idx = y * GRID_WIDTH + x;
    h = h ^ grid_in[idx];
    h = h ^ (h >> 16u);
    h = h * 0x45d9f3bu;
    return h;
}

fn can_swap_into(nx: u32, ny: u32, my_density: u32) -> bool {
    if (nx >= GRID_WIDTH || ny >= GRID_HEIGHT) { return false; }
    let other = grid_in[get_idx(nx, ny)];
    let other_mat = get_material(other);
    let other_phase = get_phase(other);
    return my_density > density_of(other_mat) && (is_movable(other_phase) || other_mat == MAT_AIR);
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }

    let idx = get_idx(x, y);
    let voxel = grid_in[idx];
    let mat = get_material(voxel);
    let phase = get_phase(voxel);

    if (!is_movable(phase) && mat != MAT_AIR) {
        grid_out[idx] = voxel;
        return;
    }

    let my_density = density_of(mat);
    let hash = dir_hash(x, y);
    let go_left = (hash & 1u) == 0u;

    // === 1. VERTICAL FALL ===
    if (y < GRID_HEIGHT - 1u) {
        let below = grid_in[get_idx(x, y + 1u)];
        let below_mat = get_material(below);
        if (my_density > density_of(below_mat) && (is_movable(get_phase(below)) || below_mat == MAT_AIR)) {
            grid_out[idx] = below;
            return;
        }
    }

    // === 2. DIAGONAL FALL (stochastic direction) ===
    if (y < GRID_HEIGHT - 1u) {
        if (go_left) {
            if (x > 0u && can_swap_into(x - 1u, y + 1u, my_density)) {
                grid_out[idx] = grid_in[get_idx(x - 1u, y + 1u)];
                return;
            }
            if (x < GRID_WIDTH - 1u && can_swap_into(x + 1u, y + 1u, my_density)) {
                grid_out[idx] = grid_in[get_idx(x + 1u, y + 1u)];
                return;
            }
        } else {
            if (x < GRID_WIDTH - 1u && can_swap_into(x + 1u, y + 1u, my_density)) {
                grid_out[idx] = grid_in[get_idx(x + 1u, y + 1u)];
                return;
            }
            if (x > 0u && can_swap_into(x - 1u, y + 1u, my_density)) {
                grid_out[idx] = grid_in[get_idx(x - 1u, y + 1u)];
                return;
            }
        }
    }

    // === 3. HORIZONTAL SPREAD (fluids only) ===
    if (is_fluid(phase)) {
        if (go_left) {
            if (x > 0u && can_swap_into(x - 1u, y, my_density)) {
                grid_out[idx] = grid_in[get_idx(x - 1u, y)];
                return;
            }
            if (x < GRID_WIDTH - 1u && can_swap_into(x + 1u, y, my_density)) {
                grid_out[idx] = grid_in[get_idx(x + 1u, y)];
                return;
            }
        } else {
            if (x < GRID_WIDTH - 1u && can_swap_into(x + 1u, y, my_density)) {
                grid_out[idx] = grid_in[get_idx(x + 1u, y)];
                return;
            }
            if (x > 0u && can_swap_into(x - 1u, y, my_density)) {
                grid_out[idx] = grid_in[get_idx(x - 1u, y)];
                return;
            }
        }
    }

    // === 4. BUOYANCY (lighter-than-above rises) ===
    if (y > 0u) {
        let above = grid_in[get_idx(x, y - 1u)];
        let above_mat = get_material(above);
        if (density_of(above_mat) > my_density && (is_movable(get_phase(above)) || above_mat == MAT_AIR)) {
            grid_out[idx] = above;
            return;
        }
    }

    grid_out[idx] = voxel;
}
