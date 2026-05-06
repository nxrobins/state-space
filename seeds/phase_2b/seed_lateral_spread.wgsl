// Phase 2b Seed 2: Vertical gravity + lateral spreading
//
// Priority order:
//   1. Fall straight down (density[self] > density[below])
//   2. If blocked below, try diagonal down-left or down-right
//      - Parity rule: (x + y) % 2 == 0 checks left first, else right first
//      - This prevents two particles from both claiming the same diagonal target
//   3. For liquids: also spread horizontally (left/right at same y)
//
// Buoyancy handled identically but upward.
// Each thread writes only grid_out[own_idx]. Swap is symmetric — the
// neighbor thread independently reaches the same conclusion.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

const COLD_STRIDE: u32 = 8u;
const COLD_DENSITY: u32 = 0u;

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }
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

// Check if voxel at (nx, ny) is swappable with a denser voxel
fn can_displace(nx: u32, ny: u32, my_density: u32) -> bool {
    if (nx >= GRID_WIDTH || ny >= GRID_HEIGHT) { return false; }
    let other = grid_in[get_idx(nx, ny)];
    let other_mat = get_material(other);
    let other_phase = get_phase(other);
    let other_density = density_of(other_mat);
    return my_density > other_density && (is_movable(other_phase) || other_mat == MAT_AIR);
}

// Determine what I should become: read the neighbor that would swap into me
fn resolve_swap(x: u32, y: u32, voxel: u32, mat: u32, phase: u32) -> u32 {
    let my_density = density_of(mat);
    let parity = (x + y) & 1u;

    // === FALLING (check below) ===
    if (y < GRID_HEIGHT - 1u) {
        let below = grid_in[get_idx(x, y + 1u)];
        let below_mat = get_material(below);
        let below_density = density_of(below_mat);
        let below_phase = get_phase(below);

        if (my_density > below_density && (is_movable(below_phase) || below_mat == MAT_AIR)) {
            // I fall: lighter material from below rises into my cell
            return below;
        }
    }

    // === DIAGONAL FALL (if blocked below) ===
    if (y < GRID_HEIGHT - 1u) {
        // Check if blocked straight down
        let below = grid_in[get_idx(x, y + 1u)];
        let below_density = density_of(get_material(below));
        let blocked_below = my_density <= below_density;

        if (blocked_below) {
            // Parity decides which diagonal to try first
            var dx1: u32 = 0u;
            var dx2: u32 = 0u;
            if (parity == 0u) {
                // Try left first, then right
                if (x > 0u && can_displace(x - 1u, y + 1u, my_density)) {
                    return grid_in[get_idx(x - 1u, y + 1u)];
                }
                if (x < GRID_WIDTH - 1u && can_displace(x + 1u, y + 1u, my_density)) {
                    return grid_in[get_idx(x + 1u, y + 1u)];
                }
            } else {
                // Try right first, then left
                if (x < GRID_WIDTH - 1u && can_displace(x + 1u, y + 1u, my_density)) {
                    return grid_in[get_idx(x + 1u, y + 1u)];
                }
                if (x > 0u && can_displace(x - 1u, y + 1u, my_density)) {
                    return grid_in[get_idx(x - 1u, y + 1u)];
                }
            }
        }
    }

    // === HORIZONTAL SPREAD (fluids only, if blocked below and diagonally) ===
    if (is_fluid(phase)) {
        if (parity == 0u) {
            if (x > 0u && can_displace(x - 1u, y, my_density)) {
                return grid_in[get_idx(x - 1u, y)];
            }
            if (x < GRID_WIDTH - 1u && can_displace(x + 1u, y, my_density)) {
                return grid_in[get_idx(x + 1u, y)];
            }
        } else {
            if (x < GRID_WIDTH - 1u && can_displace(x + 1u, y, my_density)) {
                return grid_in[get_idx(x + 1u, y)];
            }
            if (x > 0u && can_displace(x - 1u, y, my_density)) {
                return grid_in[get_idx(x - 1u, y)];
            }
        }
    }

    // === BUOYANCY (check above) ===
    if (y > 0u) {
        let above = grid_in[get_idx(x, y - 1u)];
        let above_mat = get_material(above);
        let above_density = density_of(above_mat);
        let above_phase = get_phase(above);

        if (above_density > my_density && (is_movable(above_phase) || above_mat == MAT_AIR)) {
            // Heavier thing above falls into me
            return above;
        }
    }

    // No movement
    return voxel;
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

    grid_out[idx] = resolve_swap(x, y, voxel, mat, phase);
}
