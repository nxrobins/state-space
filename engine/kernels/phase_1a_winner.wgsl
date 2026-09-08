// Seed 2: Branchless optimized pack/unpack
// Uses bitwise tricks to avoid branching for sign extension.

fn pack_voxel(mat: u32, thermal: u32, kx: i32, ky: i32, phase: u32, flags: u32) -> u32 {
    // Single expression pack — compiler can fuse these
    return ((mat & MATERIAL_MASK) << MATERIAL_SHIFT)
         | ((thermal & THERMAL_MASK) << THERMAL_SHIFT)
         | ((u32(kx) & KINETIC_X_MASK) << KINETIC_X_SHIFT)
         | ((u32(ky) & KINETIC_Y_MASK) << KINETIC_Y_SHIFT)
         | ((phase & PHASE_MASK) << PHASE_SHIFT)
         | ((flags & FLAGS_MASK) << FLAGS_SHIFT);
}

fn unpack_voxel(packed: u32) -> VoxelState {
    var state: VoxelState;
    state.material = (packed >> MATERIAL_SHIFT) & MATERIAL_MASK;
    state.thermal = (packed >> THERMAL_SHIFT) & THERMAL_MASK;

    // Branchless sign extension: (val ^ 0x8) - 0x8 converts 4-bit unsigned to signed
    let kx_raw = (packed >> KINETIC_X_SHIFT) & KINETIC_X_MASK;
    let ky_raw = (packed >> KINETIC_Y_SHIFT) & KINETIC_Y_MASK;
    state.kinetic_x = i32((kx_raw ^ 0x8u) - 0x8u);
    state.kinetic_y = i32((ky_raw ^ 0x8u) - 0x8u);

    state.phase = (packed >> PHASE_SHIFT) & PHASE_MASK;
    state.flags = (packed >> FLAGS_SHIFT) & FLAGS_MASK;
    return state;
}

fn exchange_thermal(a: u32, b: u32) -> vec2<u32> {
    // Branchless thermal exchange with configurable rate
    let ta = (a >> THERMAL_SHIFT) & THERMAL_MASK;
    let tb = (b >> THERMAL_SHIFT) & THERMAL_MASK;

    // Arithmetic shift for signed division
    let diff = i32(ta) - i32(tb);
    let transfer = diff >> 2;  // Divide by 4 via shift

    let new_ta = u32(max(min(i32(ta) - transfer, 255), 0));
    let new_tb = u32(max(min(i32(tb) + transfer, 255), 0));

    let clear_mask = ~(THERMAL_MASK << THERMAL_SHIFT);
    return vec2<u32>(
        (a & clear_mask) | (new_ta << THERMAL_SHIFT),
        (b & clear_mask) | (new_tb << THERMAL_SHIFT)
    );
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
