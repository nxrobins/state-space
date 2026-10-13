// Integer pressure impulse. Mechanical damping is separate from thermal energy.
fn face_pressure(index: u32, other: u32, head: i32) -> i32 {
    let own = i32(structure_in[index] >> 16u);
    if (other == NO_CELL || !io_fluid(grid_in[other])) { return own; }
    return i32(structure_in[other] >> 16u) + head;
}

fn impulse_velocity(previous: i32, force: i32) -> i32 {
    // Unit drag; truncation toward zero is identical in WGSL/CPU.
    return clamp(previous - sign(previous) + clamp(force / 64, -4, 4), -4, 4);
}

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    let x = gid.x; let y = gid.y;
    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }
    let i = y * GRID_WIDTH + x;
    io_copy(i, i);
    var velocity = vec2<i32>(0, 0);
    if (!io_bound(i)) {
        let voxel = grid_in[i];
        let phase = (voxel >> PHASE_SHIFT) & PHASE_MASK;
        var head = 0;
        if (phase == PHASE_LIQUID || phase == PHASE_VISCOUS || phase == PHASE_MOLTEN) {
            head = i32(max(1u, (io_cold(voxel & MATERIAL_MASK, 0u) + 63u) / 64u) * 16u);
        }
        var adjacent = array<u32, 4>(NO_CELL, NO_CELL, NO_CELL, NO_CELL);
        if (x > 0u) { adjacent[0] = i - 1u; }
        if (x + 1u < GRID_WIDTH) { adjacent[1] = i + 1u; }
        if (y > 0u) { adjacent[2] = i - GRID_WIDTH; }
        if (y + 1u < GRID_HEIGHT) { adjacent[3] = i + GRID_WIDTH; }
        let fx = face_pressure(i, adjacent[0], 0) - face_pressure(i, adjacent[1], 0);
        let fy = face_pressure(i, adjacent[2], head) - face_pressure(i, adjacent[3], -head);
        velocity = vec2<i32>(impulse_velocity(io_velocity(voxel, 0u), fx), impulse_velocity(io_velocity(voxel, 1u), fy));
    }
    grid_out[i] = (grid_in[i] & 0xff00ffffu) | ((u32(velocity.x & 15)) << 16u) | ((u32(velocity.y & 15)) << 20u);
}
