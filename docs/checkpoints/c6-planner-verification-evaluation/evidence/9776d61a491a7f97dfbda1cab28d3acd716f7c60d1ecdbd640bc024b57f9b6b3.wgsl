// ca-v2: finite heat exchange across disjoint cardinal pairs.
override THERMAL_AXIS: u32 = 0u;
override THERMAL_PARITY: u32 = 0u;

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
    io_write(index, grid_in[index], energy + 1u);
}
