// Conservative diagonal matter fall.
//
// Each pass partitions the grid into disjoint 2x2 cells. One diagonal edge in
// each block is eligible, chosen by a deterministic hash and MOVE_SALT. This
// preserves exact per-material counts without atomics.


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

fn is_falling_matter(ph: u32) -> bool {
    return ph == PHASE_POWDER || ph == PHASE_LIQUID || ph == PHASE_VISCOUS || ph == PHASE_MOLTEN;
}

fn vertical_blocked(x: u32, y: u32, src: u32) -> bool {
    if (y >= GRID_HEIGHT - 1u) { return true; }
    return !io_can_fall(get_idx(x, y), get_idx(x, y + 1u));
}

fn hash_pair(x: u32, y: u32, salt: u32) -> u32 {
    var h = x * 374761393u + y * 668265263u + salt * 1442695041u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    return h ^ (h >> 16u);
}

fn should_swap(src_x: u32, src_y: u32, dst_x: u32, dst_y: u32) -> bool {
    let src = grid_in[get_idx(src_x, src_y)];
    let dst = grid_in[get_idx(dst_x, dst_y)];
    return vertical_blocked(src_x, src_y, src) && io_can_fall(get_idx(src_x, src_y), get_idx(dst_x, dst_y));
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }

    let idx = get_idx(x, y);
    let voxel = grid_in[idx];

    var upper_y = y;
    if ((y & 1u) != MOVE_PHASE) {
        if (y == 0u) {
            io_copy(idx, idx);
            return;
        }
        upper_y = y - 1u;
    }
    if (upper_y >= GRID_HEIGHT - 1u) {
        io_copy(idx, idx);
        return;
    }

    let pair_left = x - (x & 1u);
    if (pair_left >= GRID_WIDTH - 1u) {
        io_copy(idx, idx);
        return;
    }

    let prefer_right = (hash_pair(pair_left, upper_y, MOVE_SALT) & 1u) == 0u;
    let src_x = select(pair_left + 1u, pair_left, prefer_right);
    let dst_x = select(pair_left, pair_left + 1u, prefer_right);
    let src_y = upper_y;
    let dst_y = upper_y + 1u;
    let do_swap = should_swap(src_x, src_y, dst_x, dst_y);

    if (do_swap && x == src_x && y == src_y) {
        io_copy(idx, get_idx(dst_x, dst_y));
        return;
    }
    if (do_swap && x == dst_x && y == dst_y) {
        io_copy(idx, get_idx(src_x, src_y));
        return;
    }

    io_copy(idx, idx);
}
