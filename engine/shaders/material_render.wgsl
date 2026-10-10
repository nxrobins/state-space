fn material_color(mat_id: u32) -> vec3<f32> {
    switch mat_id {
        case 0u: { return vec3<f32>(0.05098039, 0.05098039, 0.07843137); }
        case 1u: { return vec3<f32>(0.50196078, 0.50196078, 0.50196078); }
        case 2u: { return vec3<f32>(0.14901961, 0.34901961, 0.80000000); }
        case 3u: { return vec3<f32>(0.76078431, 0.69803922, 0.50196078); }
        case 4u: { return vec3<f32>(1.00000000, 0.40000000, 0.06274510); }
        case 5u: { return vec3<f32>(0.70196078, 0.72156863, 0.74901961); }
        case 6u: { return vec3<f32>(0.20000000, 0.12156863, 0.05098039); }
        case 7u: { return vec3<f32>(0.54901961, 0.34901961, 0.14901961); }
        case 8u: { return vec3<f32>(0.74901961, 0.90196078, 0.94901961); }
        case 9u: { return vec3<f32>(0.85098039, 0.85098039, 0.90196078); }
        case 10u: { return vec3<f32>(1.00000000, 0.30196078, 0.00000000); }
        case 11u: { return vec3<f32>(0.70196078, 0.85098039, 0.90196078); }
        case 12u: { return vec3<f32>(0.20000000, 0.80000000, 0.40000000); }
        case 13u: { return vec3<f32>(0.30196078, 0.27843137, 0.25098039); }
        case 14u: { return vec3<f32>(0.40000000, 0.40000000, 0.41960784); }
        case 15u: { return vec3<f32>(0.70588235, 0.63137255, 0.47058824); }
        case 16u: { return vec3<f32>(1.00000000, 0.71372549, 0.39607843); }
        case 17u: { return vec3<f32>(0.96470588, 0.83529412, 0.66666667); }
        default: { return vec3<f32>(1.0, 0.0, 1.0); }
    }
}
// Presentation only. All physical coordinates are bound read-only.
struct VertexOutput { @builtin(position) position: vec4<f32>, @location(0) uv: vec2<f32> }
struct Params { size: vec2<u32>, tick: u32, styled: u32, viewport: vec2<f32>, direction: vec2<f32> }
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> energies: array<u32>;
@group(0) @binding(2) var<storage, read> structures: array<u32>;
@group(0) @binding(3) var<storage, read> cold: array<u32>;
@group(0) @binding(4) var<storage, read> palette: array<vec4<f32>>;
@group(0) @binding(5) var<uniform> params: Params;
@group(1) @binding(0) var source: texture_2d<f32>;
@group(1) @binding(1) var glow: texture_2d<f32>;
@group(1) @binding(2) var linear_sampler: sampler;
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
    let uv = vec2<f32>(f32((index << 1u) & 2u), f32(index & 2u));
    return VertexOutput(vec4<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 0.0, 1.0), uv);
}
fn hash(p: vec2<u32>) -> f32 {
    var h = p.x * 374761393u + p.y * 668265263u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    return f32((h ^ (h >> 16u)) & 65535u) / 65535.0;
}
fn property(material: u32, field: u32) -> u32 { return cold[material * 24u + field]; }
// Same integer phase/chemical subtraction as public temperatureQ. The packed
// temperature byte is deliberately not used: it saturates at 255.
fn temperature(material: u32, energy: u32) -> f32 {
    let heat = energy - property(material, 16u) * 256u;
    let phase = property(material, 19u) * 256u;
    var value = u32(max(0, i32(heat) - i32(phase)));
    let boil = property(material, 13u);
    let up = select(property(material, 12u), boil, boil != 0u);
    let up_point = select(property(material, 2u), property(material, 3u), boil != 0u) * 256u;
    let freeze = property(material, 14u);
    let down = select(property(material, 15u), freeze, freeze != 0u);
    let down_point = select(property(material, 9u), property(material, 8u), freeze != 0u) * 256u;
    if (up != 0u && heat >= phase + up_point) {
        value = u32(max(i32(up_point), i32(heat) - i32(property(up, 19u) * 256u)));
    } else if (down != 0u && heat <= phase + down_point) {
        value = min(down_point, u32(max(0, i32(heat) - i32(property(down, 19u) * 256u))));
    }
    return f32(value) / 256.0;
}
fn material_at(p: vec2<i32>) -> u32 {
    let q = clamp(p, vec2<i32>(0), vec2<i32>(params.size) - vec2<i32>(1));
    return cells[u32(q.y) * params.size.x + u32(q.x)] & 255u;
}
fn solid(p: vec2<i32>) -> f32 {
    let m = material_at(p);
    return select(1.0, 0.0, m == 0u || m == 2u || m == 4u || m == 9u || m == 14u || m == 15u);
}
struct MaterialOutput { @location(0) color: vec4<f32>, @location(1) emission: vec4<f32> }
@fragment fn fs_material(in: VertexOutput) -> MaterialOutput {
    let position = min(vec2<u32>(in.uv * vec2<f32>(params.size)), params.size - vec2<u32>(1));
    let index = position.y * params.size.x + position.x;
    let material = cells[index] & 255u;
    let phase = (cells[index] >> 24u) & 15u;
    let p = vec2<i32>(position);
    let f = in.uv * vec2<f32>(params.size);
    let time = f32(params.tick % 65536u) / 60.0;
    let grain = hash(position);
    var color = pow(palette[material].rgb, vec3<f32>(2.2));
    var emission = vec3<f32>(0.0);
    if (params.styled == 0u) {
        if (material == 0u) { color = vec3<f32>(0.003, 0.005, 0.009); }
        return MaterialOutput(vec4<f32>(color, 1.0), vec4<f32>(0.0));
    }
    if (material == 0u) {
        let sky = mix(vec3<f32>(0.003, 0.008, 0.019), vec3<f32>(0.012, 0.024, 0.031), in.uv.y);
        color = sky + vec3<f32>((grain - 0.5) * 0.001);
    } else {
        color *= 0.78 + grain * 0.44;
        let normal = normalize(vec3<f32>(solid(p + vec2<i32>(-1, 0)) - solid(p + vec2<i32>(1, 0)),
            solid(p + vec2<i32>(0, -1)) - solid(p + vec2<i32>(0, 1)), 1.4));
        let diffuse = max(0.0, dot(normal, normalize(vec3<f32>(-0.6, -0.8, 1.0))));
        color *= 0.46 + diffuse * 0.82;
        if (material == 1u) { color *= vec3<f32>(0.28, 0.37, 0.43) * (0.85 + hash(position / 4u) * 0.3); }
        if (material == 3u || material == 13u) { color *= 0.75 + grain * 0.55; }
        if (material == 7u) {
            let rings = sin(f.y * 2.3 + sin(f.x * 0.21) * 1.7 + grain * 0.5);
            color *= 0.7 + rings * 0.2;
        }
        if (material == 5u) {
            let polish = pow(max(0.0, dot(normal, normalize(vec3<f32>(-0.3, -0.7, 1.4)))), 18.0);
            color = color * 0.65 + vec3<f32>(0.37, 0.49, 0.59) * polish;
        }
        if (material == 2u || material == 6u) {
            let surface = select(0.0, 1.0, material_at(p + vec2<i32>(0, -1)) != material);
            let shimmer = pow(0.5 + 0.5 * sin(f.x * 0.2 + f.y * 0.4 + time * 1.8), 8.0);
            color = color * vec3<f32>(0.12, 0.55, 0.75) + vec3<f32>(0.008, 0.025, 0.032) * shimmer;
            color += vec3<f32>(0.025, 0.1, 0.13) * surface;
        }
        if (material == 8u || material == 11u) { color = color * 0.65 + vec3<f32>(0.11, 0.18, 0.21) * pow(grain, 9.0); }
        if (material == 9u || material == 14u || material == 15u) {
            let wisp = 0.3 + 0.3 * sin(f.x * 0.35 + f.y * 0.2 + time);
            color = mix(vec3<f32>(0.01, 0.02, 0.028), color, wisp);
        }
        let integrity = f32(structures[index] & 255u) / 255.0;
        if (solid(p) > 0.0 && integrity < 1.0) { color *= 0.5 + integrity * 0.5; }
        let heat = temperature(material, energies[index]);
        let hot = max(0.0, (heat - 85.0) / 260.0);
        let incandescent = mix(vec3<f32>(1.0, 0.12, 0.015), vec3<f32>(1.0, 0.78, 0.32), clamp(hot / 2.0, 0.0, 1.0));
        emission = incandescent * min(hot * hot * 0.65, 6.0);
        if (material == 4u || phase == 8u) {
            let flicker = 0.82 + hash(position + vec2<u32>(params.tick / 3u, 0u)) * 0.36;
            emission += vec3<f32>(1.0, 0.22, 0.015) * flicker * clamp(heat / 200.0, 0.0, 2.0);
        }
        color += emission;
    }
    return MaterialOutput(vec4<f32>(max(color, vec3<f32>(0.0)), 1.0), vec4<f32>(emission, 1.0));
}
@fragment fn fs_bloom(in: VertexOutput) -> @location(0) vec4<f32> {
    let delta = params.direction / vec2<f32>(textureDimensions(source));
    var color = vec3<f32>(0.0);
    var weight_sum = 0.0;
    for (var i = -6; i <= 6; i++) {
        let weight = exp(-f32(i * i) / 18.0);
        color += textureSampleLevel(source, linear_sampler, in.uv + delta * f32(i), 0.0).rgb * weight;
        weight_sum += weight;
    }
    return vec4<f32>(color / weight_sum, 1.0);
}
fn filmic(color: vec3<f32>) -> vec3<f32> {
    return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
}
@fragment fn fs_present(in: VertexOutput) -> @location(0) vec4<f32> {
    // Keep cells square and letterbox wide outputs; picking uses the same mapping.
    let scale = min(params.viewport.x / f32(params.size.x), params.viewport.y / f32(params.size.y));
    let extent = vec2<f32>(params.size) * scale;
    let uv = (in.uv * params.viewport - (params.viewport - extent) * 0.5) / extent;
    if (any(uv < vec2<f32>(0.0)) || any(uv >= vec2<f32>(1.0))) { return vec4<f32>(0.012, 0.018, 0.027, 1.0); }
    let texel = min(vec2<i32>(uv * vec2<f32>(textureDimensions(source))), vec2<i32>(textureDimensions(source)) - vec2<i32>(1));
    var color = textureLoad(source, texel, 0).rgb;
    if (params.styled != 0u) {
        color += textureSampleLevel(glow, linear_sampler, uv, 0.0).rgb * 0.55;
        color = filmic(color * 1.15);
    }
    return vec4<f32>(pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2)), 1.0);
}
