// Close the tick with reciprocal bonds and no pending solidification requests.
@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }
    io_normalize_structure(gid.y * GRID_WIDTH + gid.x);
}
