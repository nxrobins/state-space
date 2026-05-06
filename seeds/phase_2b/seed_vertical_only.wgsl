// Phase 2b Seed 1: Vertical-only density sorting
//
// Pure vertical gravity. No lateral spreading. Validates the core swap
// mechanism before adding complexity.
//
// Swap rule: if density[my_mat] > density[below_mat], I pull below's state
// into my position. The thread below simultaneously pulls my state down.
// Both threads read the same grid_in, agree deterministically, write own cell.
//
// Also handles buoyancy: lighter materials (gas, steam) rise upward via
// the same mechanism — if density[above] < density[self], swap up.
//
// Direction per tick: even y checks down, odd y checks up.
// This prevents a voxel from being both pulled down AND pushed up in one tick.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

const COLD_STRIDE: u32 = 8u;
const COLD_DENSITY: u32 = 0u;

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }
fn get_thermal(p: u32) -> u32 { return (p >> THERMAL_SHIFT) & THERMAL_MASK; }

fn density_of(mat: u32) -> u32 {
    return cold_table[mat * COLD_STRIDE + COLD_DENSITY];
}

fn get_phase(p: u32) -> u32 {
    return (p >> PHASE_SHIFT) & PHASE_MASK;
}

fn is_movable(phase_val: u32) -> bool {
    // Powders, liquids, viscous fluids, and gases can move
    return phase_val == PHASE_POWDER
        || phase_val == PHASE_LIQUID
        || phase_val == PHASE_VISCOUS
        || phase_val == PHASE_GAS;
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

    // Solids, frozen, and non-movable phases don't participate in gravity
    if (!is_movable(phase)) {
        grid_out[idx] = voxel;
        return;
    }

    let my_density = density_of(mat);

    // Check downward: if I'm denser than below, swap (I fall)
    if (y < GRID_HEIGHT - 1u) {
        let below_idx = get_idx(x, y + 1u);
        let below = grid_in[below_idx];
        let below_mat = get_material(below);
        let below_phase = get_phase(below);
        let below_density = density_of(below_mat);

        // Swap if I'm denser and below is movable (or air)
        if (my_density > below_density && (is_movable(below_phase) || below_mat == MAT_AIR)) {
            // I become what was below me (lighter material rises into my spot)
            grid_out[idx] = below;
            return;
        }
    }

    // Check upward: if I'm lighter than above, swap (I rise / buoyancy)
    if (y > 0u) {
        let above_idx = get_idx(x, y - 1u);
        let above = grid_in[above_idx];
        let above_mat = get_material(above);
        let above_phase = get_phase(above);
        let above_density = density_of(above_mat);

        // Swap if above is denser and I'm movable
        if (above_density > my_density && (is_movable(above_phase) || above_mat == MAT_AIR)) {
            // I become what was above me (heavier material falls into my spot)
            grid_out[idx] = above;
            return;
        }
    }

    // No swap: copy self
    grid_out[idx] = voxel;
}
