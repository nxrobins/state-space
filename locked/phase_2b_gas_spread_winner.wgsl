// Conservative horizontal gas spread.
//
// Non-air gas/plasma spreads sideways through air/gas when upward buoyancy is
// blocked. Pair ownership is disjoint and salted to avoid one-way drift.


const COLD_STRIDE: u32 = 24u;
const COLD_DENSITY: u32 = 0u;
const GAS_RISE_THRESHOLD: i32 = 16;
override MOVE_PHASE: u32 = 0u;
override MOVE_SALT: u32 = 0u;

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }
fn get_thermal(p: u32) -> u32 { return (p >> THERMAL_SHIFT) & THERMAL_MASK; }
fn get_phase(p: u32) -> u32 { return (p >> PHASE_SHIFT) & PHASE_MASK; }

fn density_of(mat: u32) -> u32 {
    return cold_table[mat * COLD_STRIDE + COLD_DENSITY];
}

fn is_structural(ph: u32) -> bool {
    return ph == PHASE_SOLID || ph == PHASE_FROZEN;
}

fn is_gas_like(ph: u32) -> bool {
    return ph == PHASE_GAS || ph == PHASE_PLASMA;
}

fn gas_rank(index: u32) -> i32 {
    let v = grid_in[index];
    return i32(temperature_q(io_state(index)) / 256u) * 2 - i32(density_of(get_material(v)));
}

fn can_rise_into(src_idx: u32, dst_idx: u32) -> bool {
    let src = grid_in[src_idx];
    let dst = grid_in[dst_idx];
    if (get_material(src) == MAT_AIR || !is_gas_like(get_phase(src)) || is_structural(get_phase(dst))) {
        return false;
    }
    if (get_material(dst) != MAT_AIR && !is_gas_like(get_phase(dst))) {
        return false;
    }
    return gas_rank(src_idx) > gas_rank(dst_idx) + GAS_RISE_THRESHOLD;
}

fn upward_blocked(x: u32, y: u32, src: u32) -> bool {
    if (y == 0u) { return true; }
    return !can_rise_into(get_idx(x, y), get_idx(x, y - 1u));
}

fn can_spread_into(src_idx: u32, dst_idx: u32) -> bool {
    let src = grid_in[src_idx];
    let dst = grid_in[dst_idx];
    if (get_material(src) == MAT_AIR || !is_gas_like(get_phase(src)) || is_structural(get_phase(dst))) {
        return false;
    }
    if (get_material(dst) == MAT_AIR) {
        return true;
    }
    if (!is_gas_like(get_phase(dst))) {
        return false;
    }
    return gas_rank(src_idx) > gas_rank(dst_idx) + GAS_RISE_THRESHOLD;
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
            io_copy(idx, idx);
            return;
        }
        pair_left = x - 1u;
    }
    if (pair_left >= GRID_WIDTH - 1u) {
        io_copy(idx, idx);
        return;
    }

    let source_left = (hash_pair(pair_left, y, MOVE_SALT) & 1u) == 0u;
    let src_x = select(pair_left + 1u, pair_left, source_left);
    let dst_x = select(pair_left, pair_left + 1u, source_left);
    let src = grid_in[get_idx(src_x, y)];
    let dst = grid_in[get_idx(dst_x, y)];
    let do_swap = upward_blocked(src_x, y, src) && can_spread_into(get_idx(src_x, y), get_idx(dst_x, y));

    if (do_swap && x == src_x) {
        io_copy(idx, get_idx(dst_x, y));
        return;
    }
    if (do_swap && x == dst_x) {
        io_copy(idx, get_idx(src_x, y));
        return;
    }

    io_copy(idx, idx);
}
