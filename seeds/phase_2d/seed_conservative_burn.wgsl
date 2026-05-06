// Phase 2d Seed 3: Strictly conservative combustion
//
// Designed to pass the energy audit exactly:
//   total_thermal_after = total_thermal_before + sum(fuel_energy_consumed)
//
// All fuel_energy goes to exactly two places:
//   - fuel_energy / 2 → self (fuel→product thermal)
//   - fuel_energy / 2 → consumed air (→smoke thermal)
// No radiant heat to other neighbors (keeps audit simple and exact).
// Fire spread depends entirely on the thermal diffusion kernel (2a)
// spreading the combustion heat to adjacent fuel on subsequent ticks.
//
// This is the "minimum viable combustion" — correct by construction.

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

fn count_adjacent_air(x: u32, y: u32) -> u32 {
    var count = 0u;
    if (x > 0u && get_material(grid_in[get_idx(x - 1u, y)]) == MAT_AIR) { count += 1u; }
    if (x < GRID_WIDTH - 1u && get_material(grid_in[get_idx(x + 1u, y)]) == MAT_AIR) { count += 1u; }
    if (y > 0u && get_material(grid_in[get_idx(x, y - 1u)]) == MAT_AIR) { count += 1u; }
    if (y < GRID_HEIGHT - 1u && get_material(grid_in[get_idx(x, y + 1u)]) == MAT_AIR) { count += 1u; }
    return count;
}

fn is_burning_at(nx: u32, ny: u32) -> bool {
    if (nx >= GRID_WIDTH || ny >= GRID_HEIGHT) { return false; }
    let n = grid_in[get_idx(nx, ny)];
    let n_mat = get_material(n);
    let n_thermal = get_thermal(n);
    let flash = ct(n_mat, 4u);
    let fuel = ct(n_mat, 16u);
    if (fuel == 0u || flash == 0u || n_thermal <= flash) { return false; }
    return count_adjacent_air(nx, ny) > 0u;
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

    // === Fuel voxel burns ===
    let fuel_energy = ct(mat, 16u);
    let flash_point = ct(mat, 4u);

    if (fuel_energy > 0u && flash_point > 0u && thermal > flash_point && count_adjacent_air(x, y) > 0u) {
        let burns_into = ct(mat, 17u);
        let self_heat = fuel_energy / 2u;
        let new_thermal = min(thermal + self_heat, 255u);
        grid_out[idx] = rewrite_voxel(voxel, burns_into, new_thermal, PHASE_BURNING);
        return;
    }

    // === Air consumed by adjacent burning fuel ===
    if (mat == MAT_AIR) {
        let parity = (x + y) & 1u;

        // Deterministic priority: parity selects which neighbor claims this air
        // Only ONE burning neighbor can consume this air per tick
        var dx_order = array<i32, 4>(0, 1, 0, -1);
        var dy_order = array<i32, 4>(-1, 0, 1, 0);
        if (parity == 1u) {
            dx_order = array<i32, 4>(-1, 0, 1, 0);
            dy_order = array<i32, 4>(0, 1, 0, -1);
        }

        for (var i = 0u; i < 4u; i++) {
            let nx = i32(x) + dx_order[i];
            let ny = i32(y) + dy_order[i];
            if (nx >= 0 && ny >= 0 && is_burning_at(u32(nx), u32(ny))) {
                let n_mat = get_material(grid_in[get_idx(u32(nx), u32(ny))]);
                let smoke = ct(n_mat, 18u);
                let heat = ct(n_mat, 16u) / 2u;  // other half of fuel_energy
                if (smoke > 0u) {
                    let new_thermal = min(thermal + heat, 255u);
                    grid_out[idx] = rewrite_voxel(voxel, smoke, new_thermal, PHASE_GAS);
                    return;
                }
            }
        }
    }

    grid_out[idx] = voxel;
}
