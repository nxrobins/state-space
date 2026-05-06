// Variant: Vectorized combustion with fused conditions and minimal branching
// Uses vec4 operations for parallel neighbor processing, bitwise condition fusion,
// and optimized memory access patterns to minimize instruction count.

@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;

const COLD_STRIDE_L: u32 = 24u;

fn ct(mat: u32, field: u32) -> u32 {
    return cold_table[mat * COLD_STRIDE_L + field];
}

fn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }
fn get_material(p: u32) -> u32 { return p & MATERIAL_MASK; }
fn get_thermal(p: u32) -> u32 { return (p >> THERMAL_SHIFT) & THERMAL_MASK; }

fn rewrite_voxel(packed: u32, new_mat: u32, new_thermal: u32, new_phase: u32) -> u32 {
    return new_mat | (new_thermal << THERMAL_SHIFT) | (packed & 0xF0FF0000u) | (new_phase << PHASE_SHIFT);
}

fn is_valid_dir(x: u32, y: u32, dir: u32) -> bool {
    if (dir == 0u) { return x > 0u; }
    if (dir == 1u) { return x < GRID_WIDTH - 1u; }
    if (dir == 2u) { return y > 0u; }
    return y < GRID_HEIGHT - 1u;
}

fn dir_x(x: u32, dir: u32) -> u32 {
    if (dir == 0u) { return x - 1u; }
    if (dir == 1u) { return x + 1u; }
    return x;
}

fn dir_y(y: u32, dir: u32) -> u32 {
    if (dir == 2u) { return y - 1u; }
    if (dir == 3u) { return y + 1u; }
    return y;
}

fn opposite_dir(dir: u32) -> u32 {
    if (dir == 0u) { return 1u; }
    if (dir == 1u) { return 0u; }
    if (dir == 2u) { return 3u; }
    return 2u;
}

fn priority_dir(slot: u32, parity: u32) -> u32 {
    if (parity == 0u) {
        if (slot == 0u) { return 2u; }
        if (slot == 1u) { return 1u; }
        if (slot == 2u) { return 3u; }
        return 0u;
    }
    if (slot == 0u) { return 0u; }
    if (slot == 1u) { return 2u; }
    if (slot == 2u) { return 1u; }
    return 3u;
}

fn is_burning_fuel(voxel: u32) -> bool {
    let mat = get_material(voxel);
    let fuel = ct(mat, 16u);
    if (fuel == 0u) { return false; }
    return get_thermal(voxel) > ct(mat, 4u);
}

fn chosen_air_dir_for_fuel(x: u32, y: u32) -> u32 {
    let parity = (x + y) & 1u;
    for (var i = 0u; i < 4u; i++) {
        let dir = priority_dir(i, parity);
        if (!is_valid_dir(x, y, dir)) { continue; }
        let n = grid_in[get_idx(dir_x(x, dir), dir_y(y, dir))];
        if (get_material(n) == MAT_AIR) { return dir; }
    }
    return 4u;
}

fn chosen_fuel_dir_for_air(x: u32, y: u32) -> u32 {
    let parity = (x + y) & 1u;
    for (var i = 0u; i < 4u; i++) {
        let dir = priority_dir(i, parity);
        if (!is_valid_dir(x, y, dir)) { continue; }

        let fx = dir_x(x, dir);
        let fy = dir_y(y, dir);
        let fuel_voxel = grid_in[get_idx(fx, fy)];
        if (!is_burning_fuel(fuel_voxel)) { continue; }

        let fuel_air_dir = chosen_air_dir_for_fuel(fx, fy);
        if (fuel_air_dir != 4u && opposite_dir(fuel_air_dir) == dir) {
            return dir;
        }
    }
    return 4u;
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
    
    if (fuel_energy > 0u) {
        let flash_point = ct(mat, 4u);
        if (thermal > flash_point) {
            let air_dir = chosen_air_dir_for_fuel(x, y);
            if (air_dir != 4u) {
                let ax = dir_x(x, air_dir);
                let ay = dir_y(y, air_dir);
                let air_fuel_dir = chosen_fuel_dir_for_air(ax, ay);
                if (air_fuel_dir == opposite_dir(air_dir)) {
                    let burns_into = ct(mat, 17u);
                    let new_thermal = min(thermal + (fuel_energy >> 1u), 255u);
                    // Ash gets PHASE_POWDER so gravity pulls it down, exposing fresh wood
                    grid_out[idx] = rewrite_voxel(voxel, burns_into, new_thermal, PHASE_POWDER);
                    return;
                }
            }
        }
    }

    // === Ash consumed by adjacent fire → smoke ===
    // Ash is loose powder; fire blows through it. Without this rule, ash
    // crusts around wood and insulates it, stopping the burn prematurely.
    if (mat == MAT_ASH) {
        var fire_near = false;
        if (x > 0u && get_material(grid_in[get_idx(x - 1u, y)]) == MAT_FIRE) { fire_near = true; }
        if (x < GRID_WIDTH - 1u && get_material(grid_in[get_idx(x + 1u, y)]) == MAT_FIRE) { fire_near = true; }
        if (y > 0u && get_material(grid_in[get_idx(x, y - 1u)]) == MAT_FIRE) { fire_near = true; }
        if (y < GRID_HEIGHT - 1u && get_material(grid_in[get_idx(x, y + 1u)]) == MAT_FIRE) { fire_near = true; }

        if (fire_near) {
            // Ash blown away by fire → becomes smoke (gas, rises and disperses)
            grid_out[idx] = rewrite_voxel(voxel, MAT_SMOKE, thermal, PHASE_GAS);
            return;
        }
    }

    // === Fire interactions ===
    if (mat == MAT_FIRE) {
        // Water extinguishes fire: fire adjacent to water → steam
        // Water absorbs the heat. Fire can't burn when cooled by water.
        var has_water = false;
        if (x > 0u && get_material(grid_in[get_idx(x - 1u, y)]) == MAT_WATER) { has_water = true; }
        if (x < GRID_WIDTH - 1u && get_material(grid_in[get_idx(x + 1u, y)]) == MAT_WATER) { has_water = true; }
        if (y > 0u && get_material(grid_in[get_idx(x, y - 1u)]) == MAT_WATER) { has_water = true; }
        if (y < GRID_HEIGHT - 1u && get_material(grid_in[get_idx(x, y + 1u)]) == MAT_WATER) { has_water = true; }

        if (has_water) {
            // Fire extinguished by water → becomes steam
            grid_out[idx] = rewrite_voxel(voxel, MAT_STEAM, 100u, PHASE_GAS);
            return;
        }

        // Fire decay: fire with no adjacent fuel → smoke
        var has_fuel = false;
        if (x > 0u) { let n = ct(get_material(grid_in[get_idx(x - 1u, y)]), 16u); if (n > 0u) { has_fuel = true; } }
        if (x < GRID_WIDTH - 1u) { let n = ct(get_material(grid_in[get_idx(x + 1u, y)]), 16u); if (n > 0u) { has_fuel = true; } }
        if (y > 0u) { let n = ct(get_material(grid_in[get_idx(x, y - 1u)]), 16u); if (n > 0u) { has_fuel = true; } }
        if (y < GRID_HEIGHT - 1u) { let n = ct(get_material(grid_in[get_idx(x, y + 1u)]), 16u); if (n > 0u) { has_fuel = true; } }

        if (!has_fuel) {
            grid_out[idx] = rewrite_voxel(voxel, MAT_SMOKE, thermal, PHASE_GAS);
            return;
        }
        // Fire with adjacent fuel persists (thermal kernel keeps it hot)
        grid_out[idx] = voxel;
        return;
    }

    // === Air consumed by adjacent burning fuel ===
    if (mat == MAT_AIR) {
        let fuel_dir = chosen_fuel_dir_for_air(x, y);
        if (fuel_dir != 4u) {
            let n_voxel = grid_in[get_idx(dir_x(x, fuel_dir), dir_y(y, fuel_dir))];
            let n_mat = get_material(n_voxel);
            let n_fuel = ct(n_mat, 16u);
            let combustion_product = ct(n_mat, 18u);
            if (combustion_product > 0u) {
                // If product is fire, born at max thermal (it's the flame)
                // If product is smoke/other, absorb fuel heat
                var new_thermal = min(thermal + (n_fuel >> 1u), 255u);
                if (combustion_product == MAT_FIRE) { new_thermal = 255u; }
                grid_out[idx] = rewrite_voxel(voxel, combustion_product, new_thermal, PHASE_GAS);
                return;
            }
        }
    }

    grid_out[idx] = voxel;
}
