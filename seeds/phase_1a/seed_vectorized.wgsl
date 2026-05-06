// Seed 3: Vectorized approach
// Packs material+thermal into one u32 half, kinetic+phase+flags into other half.
// Uses vec2<u32> intermediate for potential SIMD-style operations.

fn pack_voxel(mat: u32, thermal: u32, kx: i32, ky: i32, phase: u32, flags: u32) -> u32 {
    // Lower 16 bits: material (8) + thermal (8)
    let lower = (mat & MATERIAL_MASK) | ((thermal & THERMAL_MASK) << 8u);
    // Upper 16 bits: kx (4) + ky (4) + phase (4) + flags (4)
    let upper = ((u32(kx) & KINETIC_X_MASK))
              | ((u32(ky) & KINETIC_Y_MASK) << 4u)
              | ((phase & PHASE_MASK) << 8u)
              | ((flags & FLAGS_MASK) << 12u);
    return lower | (upper << 16u);
}

fn unpack_voxel(packed: u32) -> VoxelState {
    var state: VoxelState;
    // Split into halves
    let lower = packed & 0xFFFFu;
    let upper = packed >> 16u;

    state.material = lower & 0xFFu;
    state.thermal = (lower >> 8u) & 0xFFu;

    let kx_raw = upper & 0xFu;
    let ky_raw = (upper >> 4u) & 0xFu;
    // Branchless sign extension
    state.kinetic_x = i32((kx_raw ^ 0x8u) - 0x8u);
    state.kinetic_y = i32((ky_raw ^ 0x8u) - 0x8u);

    state.phase = (upper >> 8u) & 0xFu;
    state.flags = (upper >> 12u) & 0xFu;
    return state;
}

fn exchange_thermal(a: u32, b: u32) -> vec2<u32> {
    // Extract thermal from lower half directly
    let ta = (a >> 8u) & 0xFFu;
    let tb = (b >> 8u) & 0xFFu;

    let diff = i32(ta) - i32(tb);
    let transfer = diff >> 2;

    let new_ta = u32(max(min(i32(ta) - transfer, 255), 0));
    let new_tb = u32(max(min(i32(tb) + transfer, 255), 0));

    let clear_mask = ~(0xFFu << 8u);
    return vec2<u32>(
        (a & clear_mask) | (new_ta << 8u),
        (b & clear_mask) | (new_tb << 8u)
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
