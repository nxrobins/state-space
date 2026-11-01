// ca-v2: phase changes preserve the complete energy coordinate.
// phase_material is candidate-owned phase selection; property() and the io_*
// adapters are host-owned.

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

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }
    let index = gid.y * GRID_WIDTH + gid.x;
    let material = phase_material(io_state(index));
    var packed = grid_in[index];
    if (material != (packed & MATERIAL_MASK)) { packed = io_rewrite(packed, material); }
    io_write(index, packed, energy_in[index]);
}
