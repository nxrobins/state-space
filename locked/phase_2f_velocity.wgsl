// Disjoint pair exchange; pending MOVED bounds each axis to one cell/tick.
override MOVE_AXIS: u32 = 0u;
override MOVE_PHASE: u32 = 0u;
override MOVE_SALT: u32 = 0u;

fn velocity_request(source: u32, destination: u32, direction: i32) -> bool {
    return !io_bound(source) && !io_bound(destination) && io_fluid(grid_in[destination])
        && io_velocity(grid_in[source], MOVE_AXIS) * direction > i32(MOVE_SALT);
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x; let y = gid.y;
    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }
    let i = y * GRID_WIDTH + x;
    let coordinate = select(x, y, MOVE_AXIS == 1u);
    let extent = select(GRID_WIDTH, GRID_HEIGHT, MOVE_AXIS == 1u);
    let stride = select(1u, GRID_WIDTH, MOVE_AXIS == 1u);
    let second = ((coordinate + MOVE_PHASE) & 1u) != 0u;
    var source = i; var moved = false;
    if (!(second && coordinate == 0u)) {
        let first_coordinate = coordinate - select(0u, 1u, second);
        if (first_coordinate + 1u < extent) {
            let a = i - select(0u, stride, second); let b = a + stride;
            if (((structure_in[a] | structure_in[b]) & STRUCTURE_MOVED_MASK) == 0u
                && (velocity_request(a, b, 1) || velocity_request(b, a, -1))) {
                source = select(b, a, second); moved = true;
            }
        }
    }
    io_copy(i, source);
    if (MOVE_PHASE == 1u) { structure_out[i] = structure_in[source] & ~STRUCTURE_MOVED_MASK; }
    else if (moved) { structure_out[i] = structure_in[source] | STRUCTURE_MOVED_MASK; }
}
