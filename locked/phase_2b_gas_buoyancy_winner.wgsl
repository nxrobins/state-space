// Conservative thermal gas buoyancy.
//
// Non-air gas/plasma can rise through air or other gas when its thermal
// buoyancy rank is sufficiently higher than the upper target.


const COLD_STRIDE: u32 = 24u;
const COLD_DENSITY: u32 = 0u;
const GAS_RISE_THRESHOLD: i32 = 16;
override MOVE_PHASE: u32 = 0u;

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

fn can_rise(src_idx: u32, dst_idx: u32) -> bool {
    let src = grid_in[src_idx];
    let dst = grid_in[dst_idx];
    let src_mat = get_material(src);
    let src_phase = get_phase(src);
    let dst_phase = get_phase(dst);
    if (src_mat == MAT_AIR || !is_gas_like(src_phase) || is_structural(dst_phase)) {
        return false;
    }
    if (get_material(dst) != MAT_AIR && !is_gas_like(dst_phase)) {
        return false;
    }
    return gas_rank(src_idx) > gas_rank(dst_idx) + GAS_RISE_THRESHOLD;
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }

    let idx = get_idx(x, y);
    let voxel = grid_in[idx];

    if (y < GRID_HEIGHT - 1u && ((y & 1u) == MOVE_PHASE)) {
        let lower = grid_in[get_idx(x, y + 1u)];
        if (can_rise(get_idx(x, y + 1u), idx)) {
            io_copy(idx, get_idx(x, y + 1u));
            return;
        }
    }

    if (y > 0u && (((y - 1u) & 1u) == MOVE_PHASE)) {
        let upper = grid_in[get_idx(x, y - 1u)];
        if (can_rise(idx, get_idx(x, y - 1u))) {
            io_copy(idx, get_idx(x, y - 1u));
            return;
        }
    }

    io_copy(idx, idx);
}
