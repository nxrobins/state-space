// Shared integer energy law; property() is supplied by the storage adapter.
fn temperature_q(state: vec2<u32>) -> u32 {
    let heat = state.y - property(state.x, 2u);
    let phase_energy = property(state.x, 1u);
    var temperature = u32(max(0, i32(heat) - i32(phase_energy)));
    let up = property(state.x, 3u);
    let up_temperature = property(state.x, 4u);
    let down = property(state.x, 5u);
    let down_temperature = property(state.x, 6u);
    if (up != NO_MATERIAL && heat >= phase_energy + up_temperature) {
        temperature = u32(max(i32(up_temperature), i32(heat) - i32(property(up, 1u))));
    } else if (down != NO_MATERIAL && heat <= phase_energy + down_temperature) {
        temperature = min(down_temperature, u32(max(0, i32(heat) - i32(property(down, 1u)))));
    }
    return temperature;
}

fn phase_material(state: vec2<u32>) -> u32 {
    let chemical = property(state.x, 2u);
    let up = property(state.x, 3u);
    if (up != NO_MATERIAL) {
        let boundary = chemical + property(up, 1u) + property(state.x, 4u);
        if (state.y >= boundary) { return up; }
    }
    let down = property(state.x, 5u);
    if (down != NO_MATERIAL) {
        let boundary = chemical + property(down, 1u) + property(state.x, 6u);
        if (state.y <= boundary) { return down; }
    }
    return state.x;
}

fn pair_energy(a: vec2<u32>, b: vec2<u32>) -> u32 {
    let temp_a = temperature_q(a);
    let temp_b = temperature_q(b);
    let ca = property(a.x, 0u);
    let cb = property(b.x, 0u);
    var conductivity = 0u;
    if (ca + cb > 0u) { conductivity = 2u * ca * cb / (ca + cb); }
    let difference = u32(abs(i32(temp_a) - i32(temp_b)));
    // Avoid overflowing difference * conductivity in u32 arithmetic.
    var flux = difference / 512u * conductivity + (difference % 512u * conductivity + 511u) / 512u;
    flux = min(flux, difference / 2u);
    if (temp_a > temp_b) {
        flux = min(flux, min(a.y - property(a.x, 2u), MAX_ENERGY_Q - b.y));
        return a.y - flux;
    }
    flux = min(flux, min(b.y - property(b.x, 2u), MAX_ENERGY_Q - a.y));
    return a.y + flux;
}

