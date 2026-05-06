// Phase 2d Seed 1: Simple combustion with explicit oxygen
//
// Three conditions for combustion:
//   1. thermal > flash_point  (fuel is hot enough)
//   2. fuel_energy > 0        (material is flammable)
//   3. at least one adjacent air voxel  (oxygen available)
//
// On combustion:
//   - Fuel voxel → burns_into (wood→ash, oil→smoke)
//   - Fuel voxel thermal += fuel_energy / 2 (self-heating, clamped to 255)
//   - The adjacent air voxel is NOT written by this thread (the air thread handles itself)
//
// Air voxel thread logic:
//   - If adjacent to a burning fuel voxel → become smoke_product
//   - Absorb fuel_energy / (2 * neighbor_count) thermal from the burn
//
// Energy audit: fuel_energy goes half to self, half distributed to the air that got consumed.
// total_thermal_after = total_thermal_before + fuel_energy for each burn event.
//
// Double-buffer safe: both threads read grid_in, agree on combustion outcome,
// each writes only grid_out[own_cell].

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
fn get_phase(p: u32) -> u32 { return (p >> PHASE_SHIFT) & PHASE_MASK; }

fn rewrite_voxel(packed: u32, new_mat: u32, new_thermal: u32, new_phase: u32) -> u32 {
    let keep = packed & 0xF0FF0000u;  // kinetic + flags
    return (new_mat & MATERIAL_MASK)
         | ((new_thermal & THERMAL_MASK) << THERMAL_SHIFT)
         | keep
         | ((new_phase & PHASE_MASK) << PHASE_SHIFT);
}

// Count adjacent air voxels
fn count_adjacent_air(x: u32, y: u32) -> u32 {
    var count = 0u;
    if (x > 0u && get_material(grid_in[get_idx(x - 1u, y)]) == MAT_AIR) { count += 1u; }
    if (x < GRID_WIDTH - 1u && get_material(grid_in[get_idx(x + 1u, y)]) == MAT_AIR) { count += 1u; }
    if (y > 0u && get_material(grid_in[get_idx(x, y - 1u)]) == MAT_AIR) { count += 1u; }
    if (y < GRID_HEIGHT - 1u && get_material(grid_in[get_idx(x, y + 1u)]) == MAT_AIR) { count += 1u; }
    return count;
}

// Check if a neighbor at (nx, ny) is a burning fuel voxel
fn is_burning_fuel(nx: u32, ny: u32) -> bool {
    if (nx >= GRID_WIDTH || ny >= GRID_HEIGHT) { return false; }
    let n = grid_in[get_idx(nx, ny)];
    let n_mat = get_material(n);
    let n_thermal = get_thermal(n);
    let flash = ct(n_mat, 4u);  // COLD_FLASH_POINT
    let fuel = ct(n_mat, 16u);  // COLD_FUEL_ENERGY
    // Fuel is burning if: has fuel energy, thermal > flash_point, and has oxygen (air neighbor)
    if (fuel == 0u || flash == 0u || n_thermal <= flash) { return false; }
    // Check if THAT fuel voxel has adjacent air (so it actually burns)
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

    // === CASE 1: I am a fuel voxel — check if I should burn ===
    let fuel_energy = ct(mat, 16u);  // COLD_FUEL_ENERGY
    let flash_point = ct(mat, 4u);   // COLD_FLASH_POINT

    if (fuel_energy > 0u && flash_point > 0u && thermal > flash_point) {
        let air_count = count_adjacent_air(x, y);
        if (air_count > 0u) {
            // BURN! Fuel → burns_into product
            let burns_into = ct(mat, 17u);  // COLD_BURNS_INTO
            // Self gets half the fuel energy
            let self_heat = fuel_energy / 2u;
            let new_thermal = min(thermal + self_heat, 255u);
            grid_out[idx] = rewrite_voxel(voxel, burns_into, new_thermal, PHASE_BURNING);
            return;
        }
    }

    // === CASE 2: I am air — check if adjacent to burning fuel ===
    if (mat == MAT_AIR) {
        // Check each cardinal neighbor for burning fuel
        // Use parity to pick which burning neighbor consumes this air
        // (prevents two fuel voxels from both claiming the same air)
        let parity = (x + y) & 1u;
        var burn_found = false;
        var burn_fuel_energy = 0u;
        var burn_smoke = 0u;

        // Priority order based on parity
        if (parity == 0u) {
            if (!burn_found && y > 0u && is_burning_fuel(x, y - 1u)) {
                let n_mat = get_material(grid_in[get_idx(x, y - 1u)]);
                burn_fuel_energy = ct(n_mat, 16u);
                burn_smoke = ct(n_mat, 18u);
                burn_found = true;
            }
            if (!burn_found && x < GRID_WIDTH - 1u && is_burning_fuel(x + 1u, y)) {
                let n_mat = get_material(grid_in[get_idx(x + 1u, y)]);
                burn_fuel_energy = ct(n_mat, 16u);
                burn_smoke = ct(n_mat, 18u);
                burn_found = true;
            }
            if (!burn_found && y < GRID_HEIGHT - 1u && is_burning_fuel(x, y + 1u)) {
                let n_mat = get_material(grid_in[get_idx(x, y + 1u)]);
                burn_fuel_energy = ct(n_mat, 16u);
                burn_smoke = ct(n_mat, 18u);
                burn_found = true;
            }
            if (!burn_found && x > 0u && is_burning_fuel(x - 1u, y)) {
                let n_mat = get_material(grid_in[get_idx(x - 1u, y)]);
                burn_fuel_energy = ct(n_mat, 16u);
                burn_smoke = ct(n_mat, 18u);
                burn_found = true;
            }
        } else {
            if (!burn_found && x > 0u && is_burning_fuel(x - 1u, y)) {
                let n_mat = get_material(grid_in[get_idx(x - 1u, y)]);
                burn_fuel_energy = ct(n_mat, 16u);
                burn_smoke = ct(n_mat, 18u);
                burn_found = true;
            }
            if (!burn_found && y < GRID_HEIGHT - 1u && is_burning_fuel(x, y + 1u)) {
                let n_mat = get_material(grid_in[get_idx(x, y + 1u)]);
                burn_fuel_energy = ct(n_mat, 16u);
                burn_smoke = ct(n_mat, 18u);
                burn_found = true;
            }
            if (!burn_found && x < GRID_WIDTH - 1u && is_burning_fuel(x + 1u, y)) {
                let n_mat = get_material(grid_in[get_idx(x + 1u, y)]);
                burn_fuel_energy = ct(n_mat, 16u);
                burn_smoke = ct(n_mat, 18u);
                burn_found = true;
            }
            if (!burn_found && y > 0u && is_burning_fuel(x, y - 1u)) {
                let n_mat = get_material(grid_in[get_idx(x, y - 1u)]);
                burn_fuel_energy = ct(n_mat, 16u);
                burn_smoke = ct(n_mat, 18u);
                burn_found = true;
            }
        }

        if (burn_found && burn_smoke > 0u) {
            // Air consumed by combustion → becomes smoke
            let absorbed_heat = burn_fuel_energy / 2u;  // other half went to the fuel voxel
            let new_thermal = min(thermal + absorbed_heat, 255u);
            grid_out[idx] = rewrite_voxel(voxel, burn_smoke, new_thermal, PHASE_GAS);
            return;
        }
    }

    // No combustion — pass through
    grid_out[idx] = voxel;
}
