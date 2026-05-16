// Conservative vertical matter gravity with phased symmetric density swaps.
//
// Movement is limited to disjoint row pairs selected by GRAVITY_PHASE, so a
// cell can participate in at most one swap per pass and per-material counts are
// preserved exactly. Gas is handled by separate buoyancy/spread passes.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

const COLD_STRIDE: u32 = 24u;
const COLD_DENSITY: u32 = 0u;
override GRAVITY_PHASE: u32 = 0u;

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }
fn get_phase(p: u32) -> u32 { return (p >> PHASE_SHIFT) & PHASE_MASK; }

fn density_of(mat: u32) -> u32 {
    return cold_table[mat * COLD_STRIDE + COLD_DENSITY];
}

fn is_structural(ph: u32) -> bool {
    return ph == PHASE_SOLID || ph == PHASE_FROZEN;
}

fn is_vertical_falling_matter(ph: u32) -> bool {
    return ph == PHASE_SOLID
        || ph == PHASE_FROZEN
        || ph == PHASE_POWDER
        || ph == PHASE_LIQUID
        || ph == PHASE_VISCOUS
        || ph == PHASE_MOLTEN;
}

fn should_swap(upper: u32, lower: u32) -> bool {
    let upper_mat = get_material(upper);
    let lower_mat = get_material(lower);
    let upper_phase = get_phase(upper);
    let lower_phase = get_phase(lower);

    if (!is_vertical_falling_matter(upper_phase) || is_structural(lower_phase)) {
        return false;
    }

    return density_of(upper_mat) > density_of(lower_mat);
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }

    let idx = get_idx(x, y);
    let voxel = grid_in[idx];

    if (y < GRID_HEIGHT - 1u && ((y & 1u) == GRAVITY_PHASE)) {
        let below = grid_in[get_idx(x, y + 1u)];
        if (should_swap(voxel, below)) {
            grid_out[idx] = below;
            return;
        }
    }

    if (y > 0u && (((y - 1u) & 1u) == GRAVITY_PHASE)) {
        let above = grid_in[get_idx(x, y - 1u)];
        if (should_swap(above, voxel)) {
            grid_out[idx] = above;
            return;
        }
    }

    grid_out[idx] = voxel;
}
