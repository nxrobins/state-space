// ca-v2: conserved, mutually owned fuel/oxidizer reactions.
fn neighbor(index: u32, order: u32) -> u32 {
    let x = index % GRID_WIDTH;
    let y = index / GRID_WIDTH;
    var directions = array<u32, 4>(2u, 1u, 3u, 0u);
    if ((x + y) % 2u != 0u) { directions = array<u32, 4>(0u, 2u, 1u, 3u); }
    let direction = directions[order];
    if (direction == 0u && x > 0u) { return index - 1u; }
    if (direction == 1u && x + 1u < GRID_WIDTH) { return index + 1u; }
    if (direction == 2u && y > 0u) { return index - GRID_WIDTH; }
    if (direction == 3u && y + 1u < GRID_HEIGHT) { return index + GRID_WIDTH; }
    return NO_CELL;
}

fn burning(state: vec2<u32>) -> bool {
    return property(state.x, 2u) > 0u && temperature_q(state) > property(state.x, 10u);
}

fn chosen_air(index: u32) -> u32 {
    if (!burning(io_state(index))) { return NO_CELL; }
    for (var order = 0u; order < 4u; order += 1u) {
        let candidate = neighbor(index, order);
        if (candidate != NO_CELL) {
            if (property(io_state(candidate).x, 9u) == 1u) { return candidate; }
        }
    }
    return NO_CELL;
}

fn chosen_fuel(index: u32) -> u32 {
    for (var order = 0u; order < 4u; order += 1u) {
        let candidate = neighbor(index, order);
        if (candidate != NO_CELL) {
            if (chosen_air(candidate) == index) { return candidate; }
        }
    }
    return NO_CELL;
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }
    let index = gid.y * GRID_WIDTH + gid.x;
    let state = io_state(index);
    var packed = grid_in[index];
    var energy = state.y;
    if (burning(state)) {
        let air = chosen_air(index);
        if (air != NO_CELL) {
            if (chosen_fuel(air) == index) {
                let transfer = min(property(state.x, 2u) / 2u, MAX_ENERGY_Q - energy_in[air]);
                packed = io_rewrite(packed, property(state.x, 7u));
                energy = state.y - transfer;
            }
        }
    } else if (property(state.x, 9u) == 1u) {
        let fuel = chosen_fuel(index);
        if (fuel != NO_CELL) {
            let transfer = min(property(io_state(fuel).x, 2u) / 2u, MAX_ENERGY_Q - state.y);
            packed = io_rewrite(packed, property(io_state(fuel).x, 8u));
            energy = state.y + transfer;
        }
    } else if (state.x == MAT_FIRE) {
        // Fire marks a local reaction. Its finite heat survives as smoke when
        // fuel is absent, it cools, or liquid water interrupts the flame.
        var fuel_near = false;
        var water_near = false;
        for (var order = 0u; order < 4u; order += 1u) {
            let candidate = neighbor(index, order);
            if (candidate != NO_CELL) {
                fuel_near = fuel_near || property(io_state(candidate).x, 2u) > 0u;
                water_near = water_near || io_state(candidate).x == MAT_WATER;
            }
        }
        if (!fuel_near || water_near || temperature_q(state) < 80u * 256u) {
            packed = io_rewrite(packed, MAT_SMOKE);
        }
    }
    io_write(index, packed, energy);
}
