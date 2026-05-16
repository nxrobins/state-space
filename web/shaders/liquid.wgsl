// Conservative horizontal liquid spread.
//
// Each pass partitions rows into disjoint horizontal pairs. Direction is chosen
// by a deterministic coordinate hash plus MOVE_SALT to avoid global drift.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

const COLD_STRIDE: u32 = 24u;
const COLD_DENSITY: u32 = 0u;
override MOVE_PHASE: u32 = 0u;
override MOVE_SALT: u32 = 0u;

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }
fn get_phase(p: u32) -> u32 { return (p >> PHASE_SHIFT) & PHASE_MASK; }

fn density_of(mat: u32) -> u32 {
    return cold_table[mat * COLD_STRIDE + COLD_DENSITY];
}

fn is_structural(ph: u32) -> bool {
    return ph == PHASE_SOLID || ph == PHASE_FROZEN;
}

fn is_liquid_like(ph: u32) -> bool {
    return ph == PHASE_LIQUID || ph == PHASE_VISCOUS || ph == PHASE_MOLTEN;
}

fn is_falling_matter(ph: u32) -> bool {
    return ph == PHASE_POWDER || ph == PHASE_LIQUID || ph == PHASE_VISCOUS || ph == PHASE_MOLTEN;
}

fn can_fall_into(src: u32, dst: u32) -> bool {
    let src_phase = get_phase(src);
    let dst_phase = get_phase(dst);
    if (!is_falling_matter(src_phase) || is_structural(dst_phase)) {
        return false;
    }
    return density_of(get_material(src)) > density_of(get_material(dst));
}

fn has_down_or_diagonal_fall(x: u32, y: u32, src: u32) -> bool {
    if (y >= GRID_HEIGHT - 1u) { return false; }
    if (can_fall_into(src, grid_in[get_idx(x, y + 1u)])) { return true; }
    if (x > 0u && can_fall_into(src, grid_in[get_idx(x - 1u, y + 1u)])) { return true; }
    if (x < GRID_WIDTH - 1u && can_fall_into(src, grid_in[get_idx(x + 1u, y + 1u)])) { return true; }
    return false;
}

fn can_spread_into(src: u32, dst: u32) -> bool {
    if (!is_liquid_like(get_phase(src)) || is_structural(get_phase(dst))) {
        return false;
    }
    let dst_phase = get_phase(dst);
    if (dst_phase != PHASE_GAS && get_material(dst) != MAT_AIR) {
        return false;
    }
    return density_of(get_material(src)) > density_of(get_material(dst));
}

fn hash_pair(x: u32, y: u32, salt: u32) -> u32 {
    var h = x * 374761393u + y * 668265263u + salt * 1442695041u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    return h ^ (h >> 16u);
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }

    let idx = get_idx(x, y);
    let voxel = grid_in[idx];

    var pair_left = x;
    if (((x + MOVE_PHASE) & 1u) != 0u) {
        if (x == 0u) {
            grid_out[idx] = voxel;
            return;
        }
        pair_left = x - 1u;
    }
    if (pair_left >= GRID_WIDTH - 1u) {
        grid_out[idx] = voxel;
        return;
    }

    let left = grid_in[get_idx(pair_left, y)];
    let right = grid_in[get_idx(pair_left + 1u, y)];
    let left_can = !has_down_or_diagonal_fall(pair_left, y, left) && can_spread_into(left, right);
    let right_can = !has_down_or_diagonal_fall(pair_left + 1u, y, right) && can_spread_into(right, left);
    let source_left = select(
        left_can,
        (hash_pair(pair_left, y, MOVE_SALT) & 1u) == 0u,
        left_can && right_can,
    );
    let src_x = select(pair_left + 1u, pair_left, source_left);
    let dst_x = select(pair_left, pair_left + 1u, source_left);
    let src = select(right, left, source_left);
    let dst = select(left, right, source_left);
    let do_swap = left_can || right_can;

    if (do_swap && x == src_x) {
        grid_out[idx] = dst;
        return;
    }
    if (do_swap && x == dst_x) {
        grid_out[idx] = src;
        return;
    }

    grid_out[idx] = voxel;
}
