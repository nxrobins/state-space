// Seed 1: Basic shift-and-mask bitops
// Straightforward pack/unpack using individual bit shifts.

fn pack_voxel(mat: u32, thermal: u32, kx: i32, ky: i32, phase: u32, flags: u32) -> u32 {
    var packed: u32 = 0u;
    packed = packed | ((mat & MATERIAL_MASK) << MATERIAL_SHIFT);
    packed = packed | ((thermal & THERMAL_MASK) << THERMAL_SHIFT);
    packed = packed | ((u32(kx) & KINETIC_X_MASK) << KINETIC_X_SHIFT);
    packed = packed | ((u32(ky) & KINETIC_Y_MASK) << KINETIC_Y_SHIFT);
    packed = packed | ((phase & PHASE_MASK) << PHASE_SHIFT);
    packed = packed | ((flags & FLAGS_MASK) << FLAGS_SHIFT);
    return packed;
}

fn unpack_voxel(packed: u32) -> VoxelState {
    var state: VoxelState;
    state.material = (packed >> MATERIAL_SHIFT) & MATERIAL_MASK;
    state.thermal = (packed >> THERMAL_SHIFT) & THERMAL_MASK;

    // Sign-extend 4-bit kinetic values
    let kx_raw = (packed >> KINETIC_X_SHIFT) & KINETIC_X_MASK;
    let ky_raw = (packed >> KINETIC_Y_SHIFT) & KINETIC_Y_MASK;
    state.kinetic_x = i32(kx_raw) - i32((kx_raw & 0x8u) << 1u);
    state.kinetic_y = i32(ky_raw) - i32((ky_raw & 0x8u) << 1u);

    state.phase = (packed >> PHASE_SHIFT) & PHASE_MASK;
    state.flags = (packed >> FLAGS_SHIFT) & FLAGS_MASK;
    return state;
}

fn exchange_thermal(a: u32, b: u32) -> vec2<u32> {
    // Simple thermal diffusion: average neighboring temperatures
    let thermal_a = (a >> THERMAL_SHIFT) & THERMAL_MASK;
    let thermal_b = (b >> THERMAL_SHIFT) & THERMAL_MASK;

    let diff = i32(thermal_a) - i32(thermal_b);
    let transfer = diff / 4;  // 25% diffusion rate

    let new_thermal_a = u32(clamp(i32(thermal_a) - transfer, 0, 255));
    let new_thermal_b = u32(clamp(i32(thermal_b) + transfer, 0, 255));

    let new_a = (a & ~(THERMAL_MASK << THERMAL_SHIFT)) | (new_thermal_a << THERMAL_SHIFT);
    let new_b = (b & ~(THERMAL_MASK << THERMAL_SHIFT)) | (new_thermal_b << THERMAL_SHIFT);

    return vec2<u32>(new_a, new_b);
}

// ── Compute entry point ────────────────────────────────────────────

@group(0) @binding(0) var<storage, read> input: array<u32>;
@group(0) @binding(1) var<storage, read_write> output: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    let idx = gid.x;
    if (idx >= arrayLength(&input)) {
        return;
    }

    let packed = input[idx];
    let state = unpack_voxel(packed);
    let repacked = pack_voxel(
        state.material, state.thermal,
        state.kinetic_x, state.kinetic_y,
        state.phase, state.flags
    );
    output[idx] = repacked;
}
