// ca-v2: finite heat exchange across disjoint cardinal pairs.
// pair_energy is candidate-owned thermal arithmetic; temperature_q, property()
// and the io_* adapters are host-owned.
override THERMAL_AXIS: u32 = 0u;
override THERMAL_PARITY: u32 = 0u;

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

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }
    let index = gid.y * GRID_WIDTH + gid.x;
    let coordinate = select(gid.x, gid.y, THERMAL_AXIS == 1u);
    let extent = select(GRID_WIDTH, GRID_HEIGHT, THERMAL_AXIS == 1u);
    let stride = select(1u, GRID_WIDTH, THERMAL_AXIS == 1u);
    var energy = energy_in[index];
    if (coordinate >= THERMAL_PARITY) {
        if ((coordinate - THERMAL_PARITY) % 2u == 0u) {
            if (coordinate + 1u < extent) { energy = pair_energy(io_state(index), io_state(index + stride)); }
        } else {
            energy = pair_energy(io_state(index), io_state(index - stride));
        }
    }
    io_write(index, grid_in[index], energy);
}
