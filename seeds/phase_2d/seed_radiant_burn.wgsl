// Phase 2d Seed 2: Combustion with radiant heat distribution
//
// Like seed_simple_burn but distributes fuel_energy more broadly:
//   - 40% to self (fuel→product thermal boost)
//   - 30% to consumed air (→smoke thermal)
//   - 30% radiated to all cardinal neighbors as thermal boost
//     (even non-air neighbors get warmed, enabling fire spread)
//
// This creates cascading ignition: burning wood heats adjacent wood,
// which eventually exceeds flash_point and ignites.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

const COLD_STRIDE_L: u32 = 24u;

fn ct(mat: u32, field: u32) -> u32 {
    return cold_table[mat * COLD_STRIDE_L + field];
}

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }
fn get_thermal(p: u32) -> u32 { return (p >> THERMAL_SHIFT) & THERMAL_MASK; }

fn rewrite_voxel(packed: u32, new_mat: u32, new_thermal: u32, new_phase: u32) -> u32 {
    let keep = packed & 0xF0FF0000u;
    return (new_mat & MATERIAL_MASK)
         | ((new_thermal & THERMAL_MASK) << THERMAL_SHIFT)
         | keep
         | ((new_phase & PHASE_MASK) << PHASE_SHIFT);
}

fn set_thermal(p: u32, t: u32) -> u32 {
    return (p & ~(THERMAL_MASK << THERMAL_SHIFT)) | ((t & THERMAL_MASK) << THERMAL_SHIFT);
}

fn count_adjacent_air(x: u32, y: u32) -> u32 {
    var count = 0u;
    if (x > 0u && get_material(grid_in[get_idx(x - 1u, y)]) == MAT_AIR) { count += 1u; }
    if (x < GRID_WIDTH - 1u && get_material(grid_in[get_idx(x + 1u, y)]) == MAT_AIR) { count += 1u; }
    if (y > 0u && get_material(grid_in[get_idx(x, y - 1u)]) == MAT_AIR) { count += 1u; }
    if (y < GRID_HEIGHT - 1u && get_material(grid_in[get_idx(x, y + 1u)]) == MAT_AIR) { count += 1u; }
    return count;
}

fn is_burning_fuel_at(nx: u32, ny: u32) -> bool {
    if (nx >= GRID_WIDTH || ny >= GRID_HEIGHT) { return false; }
    let n = grid_in[get_idx(nx, ny)];
    let n_mat = get_material(n);
    let n_thermal = get_thermal(n);
    let flash = ct(n_mat, 4u);
    let fuel = ct(n_mat, 16u);
    if (fuel == 0u || flash == 0u || n_thermal <= flash) { return false; }
    return count_adjacent_air(nx, ny) > 0u;
}

// Count how many cardinal neighbors are actively burning
fn count_burning_neighbors(x: u32, y: u32) -> u32 {
    var count = 0u;
    if (x > 0u && is_burning_fuel_at(x - 1u, y)) { count += 1u; }
    if (x < GRID_WIDTH - 1u && is_burning_fuel_at(x + 1u, y)) { count += 1u; }
    if (y > 0u && is_burning_fuel_at(x, y - 1u)) { count += 1u; }
    if (y < GRID_HEIGHT - 1u && is_burning_fuel_at(x, y + 1u)) { count += 1u; }
    return count;
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x;
    let y = gid.y;
    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }

    let idx = get_idx(x, y);
    let voxel = grid_in[idx];
    let mat = get_material(voxel);
    let thermal = get_thermal(voxel);

    // === Fuel voxel: check if burning ===
    let fuel_energy = ct(mat, 16u);
    let flash_point = ct(mat, 4u);

    if (fuel_energy > 0u && flash_point > 0u && thermal > flash_point) {
        let air_count = count_adjacent_air(x, y);
        if (air_count > 0u) {
            let burns_into = ct(mat, 17u);
            // 40% to self
            let self_heat = fuel_energy * 2u / 5u;
            let new_thermal = min(thermal + self_heat, 255u);
            grid_out[idx] = rewrite_voxel(voxel, burns_into, new_thermal, PHASE_BURNING);
            return;
        }
    }

    // === Air voxel: check if consumed by adjacent burning fuel ===
    if (mat == MAT_AIR) {
        let parity = (x + y) & 1u;
        var consumed = false;
        var smoke_mat = 0u;
        var heat_absorbed = 0u;

        // Parity-based priority for which burning neighbor claims this air
        if (parity == 0u) {
            if (!consumed && y > 0u && is_burning_fuel_at(x, y - 1u)) {
                let n_mat = get_material(grid_in[get_idx(x, y - 1u)]);
                smoke_mat = ct(n_mat, 18u); heat_absorbed = ct(n_mat, 16u) * 3u / 10u; consumed = true;
            }
            if (!consumed && x < GRID_WIDTH - 1u && is_burning_fuel_at(x + 1u, y)) {
                let n_mat = get_material(grid_in[get_idx(x + 1u, y)]);
                smoke_mat = ct(n_mat, 18u); heat_absorbed = ct(n_mat, 16u) * 3u / 10u; consumed = true;
            }
            if (!consumed && y < GRID_HEIGHT - 1u && is_burning_fuel_at(x, y + 1u)) {
                let n_mat = get_material(grid_in[get_idx(x, y + 1u)]);
                smoke_mat = ct(n_mat, 18u); heat_absorbed = ct(n_mat, 16u) * 3u / 10u; consumed = true;
            }
            if (!consumed && x > 0u && is_burning_fuel_at(x - 1u, y)) {
                let n_mat = get_material(grid_in[get_idx(x - 1u, y)]);
                smoke_mat = ct(n_mat, 18u); heat_absorbed = ct(n_mat, 16u) * 3u / 10u; consumed = true;
            }
        } else {
            if (!consumed && x > 0u && is_burning_fuel_at(x - 1u, y)) {
                let n_mat = get_material(grid_in[get_idx(x - 1u, y)]);
                smoke_mat = ct(n_mat, 18u); heat_absorbed = ct(n_mat, 16u) * 3u / 10u; consumed = true;
            }
            if (!consumed && y < GRID_HEIGHT - 1u && is_burning_fuel_at(x, y + 1u)) {
                let n_mat = get_material(grid_in[get_idx(x, y + 1u)]);
                smoke_mat = ct(n_mat, 18u); heat_absorbed = ct(n_mat, 16u) * 3u / 10u; consumed = true;
            }
            if (!consumed && x < GRID_WIDTH - 1u && is_burning_fuel_at(x + 1u, y)) {
                let n_mat = get_material(grid_in[get_idx(x + 1u, y)]);
                smoke_mat = ct(n_mat, 18u); heat_absorbed = ct(n_mat, 16u) * 3u / 10u; consumed = true;
            }
            if (!consumed && y > 0u && is_burning_fuel_at(x, y - 1u)) {
                let n_mat = get_material(grid_in[get_idx(x, y - 1u)]);
                smoke_mat = ct(n_mat, 18u); heat_absorbed = ct(n_mat, 16u) * 3u / 10u; consumed = true;
            }
        }

        if (consumed && smoke_mat > 0u) {
            let new_thermal = min(thermal + heat_absorbed, 255u);
            grid_out[idx] = rewrite_voxel(voxel, smoke_mat, new_thermal, PHASE_GAS);
            return;
        }
    }

    // === Non-combustion: absorb radiant heat from burning neighbors ===
    let burn_count = count_burning_neighbors(x, y);
    if (burn_count > 0u && mat != MAT_AIR) {
        // Each burning neighbor radiates ~30% / 4 neighbors ≈ 8% of fuel_energy
        // Approximate: add 5 thermal per burning neighbor (fixed small amount)
        let radiant_heat = burn_count * 5u;
        let new_thermal = min(thermal + radiant_heat, 255u);
        grid_out[idx] = set_thermal(voxel, new_thermal);
        return;
    }

    grid_out[idx] = voxel;
}
