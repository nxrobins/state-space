// ca-v2: phase changes preserve the complete energy coordinate.
@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }
    let index = gid.y * GRID_WIDTH + gid.x;
    let material = phase_material(io_state(index));
    var packed = grid_in[index];
    if (material != (packed & MATERIAL_MASK)) { packed = io_rewrite(packed, material); }
    io_write(index, packed, energy_in[index]);
}
