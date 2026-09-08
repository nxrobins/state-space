// C6 planned eight-binding ABI; exercised by the structural GPU probe.
override GRID_WIDTH: u32 = 1u;
override GRID_HEIGHT: u32 = 1u;
@group(0) @binding(0) var<storage, read> packed_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> packed_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold: array<u32>;
@group(0) @binding(3) var<storage, read> energy_in: array<u32>;
@group(0) @binding(4) var<storage, read_write> energy_out: array<u32>;
@group(0) @binding(5) var<storage, read> structure_in: array<u32>;
@group(0) @binding(6) var<storage, read_write> structure_out: array<u32>;
@group(0) @binding(7) var<storage, read> structural_plan: array<vec2<u32>>;

@compute @workgroup_size(16, 16)
fn tick(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }
    let index = gid.y * GRID_WIDTH + gid.x;
    let source = structural_plan[index].x;
    packed_out[index] = packed_in[source];
    energy_out[index] = energy_in[source];
    structure_out[index] = structural_plan[index].y;
}
