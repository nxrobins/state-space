// Phase 3a: Fragment shader — Noita-inspired rendering
// Material ID → base color with per-voxel variation
// Thermal → heat glow (orange/white for hot voxels)
// Position hash → color variation (breaks flat-block look)
// Air → subtle gradient atmosphere instead of void

struct VertexOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VertexOutput {
    let x = f32(vi & 1u) * 2.0 - 1.0;
    let y = f32((vi >> 1u) & 1u) * 2.0 - 1.0;
    var out: VertexOutput;
    out.pos = vec4<f32>(x, -y, 0.0, 1.0);
    out.uv = vec2<f32>(f32(vi & 1u), f32((vi >> 1u) & 1u));
    return out;
}

@group(0) @binding(0) var<storage, read> grid: array<u32>;
@group(0) @binding(1) var<uniform> params: vec4<u32>;

// Deterministic hash for per-voxel color variation
fn hash_pos(x: u32, y: u32) -> f32 {
    var h = x * 374761393u + y * 668265263u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    h = h ^ (h >> 16u);
    return f32(h & 0xFFFFu) / 65535.0;  // 0.0 to 1.0
}

// material_color() is generated from engine/materials.json by the bundler.

// How much color variation each material gets (0 = flat, 0.15 = noisy)
fn material_variation(mat_id: u32) -> f32 {
    switch(mat_id) {
        case 0u:  { return 0.02; }  // air: very subtle
        case 1u:  { return 0.12; }  // stone: noticeable grain
        case 2u:  { return 0.06; }  // water: gentle shimmer
        case 3u:  { return 0.10; }  // sand: grainy
        case 4u:  { return 0.15; }  // fire: flickering
        case 5u:  { return 0.04; }  // metal: polished
        case 6u:  { return 0.05; }  // oil: slight sheen
        case 7u:  { return 0.08; }  // wood: grain pattern
        case 8u:  { return 0.04; }  // ice: crystalline
        case 9u:  { return 0.10; }  // steam: wispy
        case 10u: { return 0.12; }  // lava: churning
        case 11u: { return 0.03; }  // glass: smooth
        case 13u: { return 0.06; }  // ash: dusty
        case 14u: { return 0.08; }  // smoke: hazy
        default:  { return 0.05; }
    }
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    let width = params.x;
    let height = params.y;

    let gx = u32(in.uv.x * f32(width));
    let gy = u32(in.uv.y * f32(height));

    if (gx >= width || gy >= height) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }

    let idx = gy * width + gx;
    let voxel = grid[idx];

    let mat_id = voxel & 0xFFu;
    let thermal = (voxel >> 8u) & 0xFFu;
    let phase = (voxel >> 24u) & 0xFu;
    let flags = (voxel >> 28u) & 0xFu;

    // === AIR: subtle depth gradient ===
    if (mat_id == 0u) {
        let depth = f32(gy) / f32(height);
        // Sky gradient: darker at top, slightly warmer at bottom (ground reflection)
        let sky = mix(
            vec3<f32>(0.03, 0.03, 0.08),  // deep space at top
            vec3<f32>(0.08, 0.07, 0.10),  // ground glow at bottom
            depth
        );
        // Subtle noise to prevent banding
        let noise = (hash_pos(gx, gy) - 0.5) * 0.01;
        return vec4<f32>(sky + noise, 1.0);
    }

    // === BASE COLOR with per-voxel variation ===
    var color = material_color(mat_id);
    let variation = material_variation(mat_id);
    let noise = hash_pos(gx, gy);
    // Vary brightness and hue slightly
    let bright_var = 1.0 + (noise - 0.5) * variation * 2.0;
    // Second hash for hue shift
    let noise2 = hash_pos(gx + 1000u, gy + 1000u);
    let hue_shift = (noise2 - 0.5) * variation * 0.3;
    color = color * bright_var + vec3<f32>(hue_shift, -hue_shift * 0.5, hue_shift * 0.3);

    // === THERMAL GLOW ===
    let heat = f32(thermal) / 255.0;

    // Low heat: subtle warm tint (above ambient ~20/255 = 0.08)
    if (heat > 0.15) {
        let warmth = (heat - 0.15) / 0.85;
        // Warm: red-orange at moderate heat, white-yellow at extreme
        let warm_color = mix(
            vec3<f32>(0.8, 0.2, 0.0),   // deep red (moderate)
            vec3<f32>(1.0, 0.9, 0.5),   // white-yellow (extreme)
            warmth
        );
        color = mix(color, warm_color, warmth * 0.6);
    }

    // Very hot: additive glow (emissive, above 0.7)
    if (heat > 0.7) {
        let glow = (heat - 0.7) / 0.3;
        let emissive = vec3<f32>(1.0, 0.6, 0.15) * glow * 0.4;
        color = color + emissive;
    }

    // === PHASE-SPECIFIC EFFECTS ===

    // Burning: flickering ember overlay
    if (phase == 8u || (flags & 1u) != 0u) {
        let flicker = hash_pos(gx ^ thermal, gy ^ thermal);
        color = mix(color, vec3<f32>(1.0, 0.3, 0.0), 0.5 + flicker * 0.3);
    }

    // Liquid: slight transparency effect (darken slightly)
    if (phase == 2u || phase == 3u) {
        let liquid_depth = hash_pos(gx, gy + 500u) * 0.1;
        color = color * (0.92 + liquid_depth);
    }

    // Gas/steam: semi-transparent feel (lighten toward air color)
    if (phase == 4u && mat_id != 0u) {
        color = mix(color, vec3<f32>(0.06, 0.06, 0.10), 0.3);
    }

    // Clamp to valid range
    color = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));

    return vec4<f32>(color, 1.0);
}
