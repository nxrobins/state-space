// C3 thermodynamics probe: vec2(material id, conserved energy Q).
// This is exercised independently before replacing the ca-v1 compositor.
@group(0) @binding(0) var<storage, read> state_in: array<vec2<u32>>;
@group(0) @binding(1) var<storage, read_write> state_out: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read> thermo: array<u32>;

override GRID_WIDTH: u32 = 1u;
override GRID_HEIGHT: u32 = 1u;
override OP: u32 = 0u; // 0 heat pair, 1 phase, 2 combustion
override AXIS: u32 = 0u;
override PARITY: u32 = 0u;
const THERMO_STRIDE: u32 = 12u;
const MAX_ENERGY_Q: u32 = 0x3fffffffu;
const NO_MATERIAL: u32 = 256u;
const NO_CELL: u32 = 0xffffffffu;

fn property(material: u32, field: u32) -> u32 {
    return thermo[material * THERMO_STRIDE + field];
}

// enthalpy_law.wgsl is prepended by the host.

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
    if (!burning(state_in[index])) { return NO_CELL; }
    for (var order = 0u; order < 4u; order += 1u) {
        let candidate = neighbor(index, order);
        if (candidate != NO_CELL) {
            if (property(state_in[candidate].x, 9u) == 1u) { return candidate; }
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

@compute @workgroup_size(64)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let index = gid.x;
    if (index >= GRID_WIDTH * GRID_HEIGHT) { return; }
    let state = state_in[index];
    var result = state;
    if (OP == 0u) {
        let coordinate = select(index % GRID_WIDTH, index / GRID_WIDTH, AXIS == 1u);
        let extent = select(GRID_WIDTH, GRID_HEIGHT, AXIS == 1u);
        let stride = select(1u, GRID_WIDTH, AXIS == 1u);
        if (coordinate >= PARITY) {
            if ((coordinate - PARITY) % 2u == 0u) {
                if (coordinate + 1u < extent) { result.y = pair_energy(state, state_in[index + stride]); }
            } else {
                result.y = pair_energy(state, state_in[index - stride]);
            }
        }
    } else if (OP == 1u) {
        result.x = phase_material(state);
    } else if (OP == 2u) {
        if (burning(state)) {
            let air = chosen_air(index);
            if (air != NO_CELL) {
                if (chosen_fuel(air) == index) {
                    let transfer = min(property(state.x, 2u) / 2u, MAX_ENERGY_Q - state_in[air].y);
                    result = vec2<u32>(property(state.x, 7u), state.y - transfer);
                }
            }
        } else if (property(state.x, 9u) == 1u) {
            let fuel = chosen_fuel(index);
            if (fuel != NO_CELL) {
                let transfer = min(property(state_in[fuel].x, 2u) / 2u, MAX_ENERGY_Q - state.y);
                result = vec2<u32>(property(state_in[fuel].x, 8u), state.y + transfer);
            }
        }
    }
    state_out[index] = result;
}
