// Conservative thermal gas buoyancy.
//
// Non-air gas/plasma can rise through air or other gas when its thermal
// buoyancy rank is sufficiently higher than the upper target.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

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

fn gas_rank(v: u32) -> i32 {
    return i32(get_thermal(v)) * 2 - i32(density_of(get_material(v)));
}

fn can_rise(src: u32, dst: u32) -> bool {
    let src_mat = get_material(src);
    let src_phase = get_phase(src);
    let dst_phase = get_phase(dst);
    if (src_mat == MAT_AIR || !is_gas_like(src_phase) || is_structural(dst_phase)) {
        return false;
    }
    if (get_material(dst) != MAT_AIR && !is_gas_like(dst_phase)) {
        return false;
    }
    return gas_rank(src) > gas_rank(dst) + GAS_RISE_THRESHOLD;
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
        if (can_rise(lower, voxel)) {
            grid_out[idx] = lower;
            return;
        }
    }

    if (y > 0u && (((y - 1u) & 1u) == MOVE_PHASE)) {
        let upper = grid_in[get_idx(x, y - 1u)];
        if (can_rise(voxel, upper)) {
            grid_out[idx] = upper;
            return;
        }
    }

    grid_out[idx] = voxel;
}
