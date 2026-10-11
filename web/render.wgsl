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
@group(1) @binding(3) var light_positions_a: texture_2d<f32>;
@group(1) @binding(4) var light_positions_b: texture_2d<f32>;
@group(1) @binding(5) var illumination: texture_2d<f32>;
@group(1) @binding(6) var water_geometry: texture_2d<u32>;
@group(1) @binding(7) var haze_density: texture_2d<f32>;
@group(1) @binding(8) var haze_volume: texture_2d<f32>;
@group(1) @binding(9) var heat_haze: texture_2d<f32>;
@group(2) @binding(0) var span_output: texture_storage_2d<rgba32uint, write>;

// One invocation per column: linear work, exact integer surface/floor positions.
// Only private presentation geometry is written. Rebuilt after every state upload.
@compute @workgroup_size(64) fn cs_water_spans(@builtin(global_invocation_id) id: vec3<u32>) {
    let x = id.x;
    if (x >= params.size.x) { return; }
    var y = 0u;
    while (y < params.size.y) {
        if ((cells[y * params.size.x + x] & 255u) != 2u) { y++; continue; }
        let top = y;
        while (y < params.size.y) {
            if ((cells[y * params.size.x + x] & 255u) != 2u) { break; }
            y++;
        }
        var exposed = 0u;
        if (top > 0u) {
            let above = cells[(top - 1u) * params.size.x + x];
            let material = above & 255u;
            let phase = (above >> 24u) & 15u;
            exposed = select(0u, 1u, material == 0u || material == 4u || phase == 4u || phase == 5u);
        }
        for (var row = top; row < y; row++) {
            textureStore(span_output, vec2<i32>(i32(x), i32(row)), vec4<u32>(top, y, exposed, 0u));
        }
    }
}
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
fn haze_open(p: vec2<i32>) -> bool {
    let m = material_at(p);
    return m == 0u || m == 4u || m == 9u || m == 14u || m == 15u;
}
fn heat_strength(p: vec2<i32>) -> f32 {
    let index = u32(p.y) * params.size.x + u32(p.x);
    // Cheap rejection before consulting the phase/chemical stores. A temperature
    // above this threshold requires at least this much total conserved energy.
    if (energies[index] <= 120u * 256u) { return 0.0; }
    return clamp((temperature(cells[index] & 255u, energies[index]) - 120.0) / 650.0, 0.0, 1.0);
}
fn sky_color(uv: vec2<f32>, grain: f32) -> vec3<f32> {
    return mix(vec3<f32>(0.003, 0.008, 0.019), vec3<f32>(0.012, 0.024, 0.031), uv.y) + (grain - 0.5) * 0.001;
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
    if ((params.styled & 64u) != 0u && (material == 9u || material == 14u)) {
        // Steam/smoke scatter incident light in the volume pass, without becoming
        // incandescent light sources merely because their model temperature is hot.
        return MaterialOutput(vec4<f32>(sky_color(in.uv, grain), 1.0), vec4<f32>(0.0));
    }
    if (material == 0u) {
        color = sky_color(in.uv, grain);
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
        // Artistic glow ramp: deep red, then orange, then amber at lava heat. It
        // stays saturated; the tone curve below keeps that hue when it is bright.
        let glow_t = clamp(hot / 4.0, 0.0, 1.0);
        var incandescent = mix(vec3<f32>(1.0, 0.1, 0.012), vec3<f32>(1.0, 0.36, 0.05), smoothstep(0.0, 0.35, glow_t));
        incandescent = mix(incandescent, vec3<f32>(1.0, 0.6, 0.17), smoothstep(0.3, 1.0, glow_t));
        emission = incandescent * min(hot * hot * 0.65, 6.0);
        if (material == 10u || material == 16u || material == 17u) {
            // Molten surfaces churn and form darker crust, so a hot pool reads as
            // liquid rock instead of a flat lamp. Cosmetic only; mean stays near 1.
            let churn = volume_noise(vec3<f32>(f * 0.18, time * 0.25));
            let crust = smoothstep(0.62, 0.86, volume_noise(vec3<f32>(f * 0.42 + vec2<f32>(17.0, 3.0), time * 0.12)));
            emission *= (0.72 + 0.56 * churn) * (1.0 - 0.5 * crust);
        }
        if (material == 4u || phase == 8u) {
            let flicker = 0.82 + hash(position + vec2<u32>(params.tick / 3u, 0u)) * 0.36;
            emission += vec3<f32>(1.0, 0.22, 0.015) * flicker * clamp(heat / 200.0, 0.0, 2.0);
        }
        color += emission;
    }
    return MaterialOutput(vec4<f32>(max(color, vec3<f32>(0.0)), 1.0), vec4<f32>(emission, 1.0));
}
// One 16-cell tile stores integrated radiance and four actual emitting cells
// on its luminous boundary. Area sampling gives a penumbra without inventing sources
// inside terrain. These private render targets never feed back into physics.
struct LightOutput {
    @location(0) radiance: vec4<f32>,
    @location(1) positions_a: vec4<f32>,
    @location(2) positions_b: vec4<f32>,
}
@fragment fn fs_sources(in: VertexOutput) -> LightOutput {
    let base = vec2<u32>(in.position.xy) * 16u;
    var sum = vec3<f32>(0.0);
    var positions = array<vec2<f32>, 4>(vec2<f32>(-1.0), vec2<f32>(-1.0), vec2<f32>(-1.0), vec2<f32>(-1.0));
    var scores = array<f32, 4>(-1000.0, -1000.0, -1000.0, -1000.0);
    let directions = array<vec2<f32>, 4>(vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(-1.0, 1.0), vec2<f32>(1.0, 1.0));
    var count = 0.0;
    for (var y = 0u; y < 16u; y++) {
        for (var x = 0u; x < 16u; x++) {
            let p = base + vec2<u32>(x, y);
            if (any(p >= params.size)) { continue; }
            let emission = textureLoad(source, vec2<i32>(p * 2u + 1u), 0).rgb;
            let brightness = max(emission.r, max(emission.g, emission.b));
            if (brightness < 0.02) { continue; }
            sum += emission;
            let offset = vec2<f32>(f32(x), f32(y)) - 7.5;
            for (var i = 0u; i < 4u; i++) {
                let score = dot(offset, directions[i]) + brightness * 0.01;
                if (score > scores[i]) {
                    scores[i] = score;
                    // Tile-local centers stay exact in rgba16float even when
                    // absolute grid coordinates exceed half-float precision.
                    positions[i] = vec2<f32>(f32(x), f32(y)) + 0.5;
                }
            }
            count = 4.0;
        }
    }
    return LightOutput(vec4<f32>(sum * 0.32, count), vec4<f32>(positions[0], positions[1]), vec4<f32>(positions[2], positions[3]));
}
fn transmission(p: vec2<i32>) -> f32 {
    let index = u32(p.y) * params.size.x + u32(p.x);
    let cell = cells[index];
    let material = cell & 255u;
    let phase = (cell >> 24u) & 15u;
    if (material == 0u || material == 4u || phase == 5u) { return 1.0; }
    if (material == 2u) { return 0.96; }
    if (material == 8u || material == 11u) { return 0.88; }
    if (phase == 4u) { return select(0.97, 0.88, material == 14u); }
    return 0.0;
}
fn traced_visibility(receiver: vec2<f32>, emitter: vec2<f32>, water_path: bool) -> f32 {
    // Grid traversal visits every crossed cell, including one-cell walls.
    // Ignore only the emitting and receiving cells, so exposed faces can glow.
    let delta = emitter - receiver;
    let ray = delta / max(length(delta), 0.001);
    let stride = select(vec2<i32>(-1), vec2<i32>(1), ray >= vec2<f32>(0.0));
    let crossing_step = 1.0 / max(abs(ray), vec2<f32>(0.00001));
    var cell = vec2<i32>(floor(receiver));
    let destination = vec2<i32>(floor(emitter));
    var crossing = select(fract(receiver), 1.0 - fract(receiver), ray >= vec2<f32>(0.0)) * crossing_step;
    var transmittance = 1.0;
    // Lighting has a 48-cell radius; water images extend at most 96 cells.
    // This bound affects presentation only, never the physical tick schedule.
    for (var i = 0u; i < 192u; i++) {
        if (all(cell == destination)) { return transmittance; }
        if (crossing.x < crossing.y) {
            cell.x += stride.x; crossing.x += crossing_step.x;
        } else {
            cell.y += stride.y; crossing.y += crossing_step.y;
        }
        if (all(cell == destination)) { return transmittance; }
        if (any(cell < vec2<i32>(0)) || any(cell >= vec2<i32>(params.size))) { return 0.0; }
        transmittance *= select(transmission(cell), 1.0, water_path && material_at(cell) == 2u);
        if (transmittance < 0.01) { return 0.0; }
    }
    return 0.0;
}
fn visibility(receiver: vec2<f32>, emitter: vec2<f32>) -> f32 {
    return traced_visibility(receiver, emitter, false);
}
@fragment fn fs_heat(in: VertexOutput) -> @location(0) vec4<f32> {
    let p = min(vec2<i32>(in.position.xy), vec2<i32>(params.size) - 1);
    if (!haze_open(p)) { return vec4<f32>(0.0); }
    var strength = heat_strength(p);
    // Reconstruct a short rising optical plume from this committed state.
    // This transports no model energy and keeps no history or particle state.
    for (var y = 0; y <= 20; y++) {
        for (var x = -2; x <= 2; x++) {
            let q = p + vec2<i32>(x, y);
            if (any(q < vec2<i32>(0)) || any(q >= vec2<i32>(params.size))) { continue; }
            let hot = heat_strength(q);
            if (hot == 0.0) { continue; }
            let width = 1.0 + f32(y) * 0.08;
            let weight = exp(-f32(y) / 9.0 - f32(x * x) / (2.0 * width * width));
            if (hot * weight <= strength) { continue; }
            let through = traced_visibility(vec2<f32>(p) + 0.5, vec2<f32>(q) + 0.5, true);
            strength = max(strength, hot * weight * through);
        }
    }
    return vec4<f32>(strength, 0.0, 0.0, 1.0);
}
@fragment fn fs_density(in: VertexOutput) -> @location(0) vec4<f32> {
    let p = min(vec2<i32>(in.position.xy), vec2<i32>(params.size) - 1);
    if (!haze_open(p)) { return vec4<f32>(0.0); }
    var density = vec2<f32>(0.0);
    // Compact reconstruction of actual gas cells. Every crossed cell is checked,
    // so smoothing cannot carry a plume through a one-cell opaque divider.
    for (var y = -2; y <= 2; y++) {
        for (var x = -2; x <= 2; x++) {
            let q = p + vec2<i32>(x, y);
            if (any(q < vec2<i32>(0)) || any(q >= vec2<i32>(params.size))) { continue; }
            let material = material_at(q);
            if (material != 9u && material != 14u) { continue; }
            let weight = exp(-f32(x * x + y * y) / 2.0) / 6.169;
            let through = traced_visibility(vec2<f32>(p) + 0.5, vec2<f32>(q) + 0.5, true);
            density += select(vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0), material == 9u) * weight * through;
        }
    }
    return vec4<f32>(density, 0.0, 1.0);
}
@fragment fn fs_lighting(in: VertexOutput) -> @location(0) vec4<f32> {
    let position = min(vec2<u32>(in.position.xy), params.size - 1u);
    let index = position.y * params.size.x + position.x;
    let material = cells[index] & 255u;
    var has_haze = false;
    if ((params.styled & 64u) != 0u) {
        let density = textureLoad(haze_density, vec2<i32>(position), 0).rg;
        has_haze = density.x + density.y > 0.001;
    }
    if (!has_haze && (material == 0u || temperature(material, energies[index]) > 85.0)) { return vec4<f32>(0.0); }
    let receiver = vec2<f32>(position) + 0.5;
    let tile = vec2<i32>(position / 16u);
    let dimensions = vec2<i32>(textureDimensions(source));
    var light = vec3<f32>(0.0);
    for (var y = -3; y <= 3; y++) {
        for (var x = -3; x <= 3; x++) {
            let q = tile + vec2<i32>(x, y);
            if (any(q < vec2<i32>(0)) || any(q >= dimensions)) { continue; }
            let radiance = textureLoad(source, q, 0);
            if (radiance.a == 0.0) { continue; }
            let tile_origin = vec4<f32>(vec2<f32>(q * 16), vec2<f32>(q * 16));
            let a = textureLoad(light_positions_a, q, 0) + tile_origin;
            let b = textureLoad(light_positions_b, q, 0) + tile_origin;
            // Four boundary probes plus four edge midpoints, accepted only if
            // they are genuinely emitting cells. Deduplicate small sources.
            let emitters = array<vec2<f32>, 8>(a.xy, a.zw, b.xy, b.zw,
                floor((a.xy + a.zw) * 0.5) + 0.5, floor((b.xy + b.zw) * 0.5) + 0.5,
                floor((a.xy + b.xy) * 0.5) + 0.5, floor((a.zw + b.zw) * 0.5) + 0.5);
            var attenuation = 0.0;
            var sample_count = 0.0;
            for (var i = 0u; i < 8u; i++) {
                let emitter = emitters[i];
                if (emitter.x < 0.0) { continue; }
                var duplicate = false;
                for (var j = 0u; j < i; j++) {
                    duplicate = duplicate || all(emitter == emitters[j]);
                }
                if (duplicate) { continue; }
                if (i >= 4u) {
                    let emitted = textureLoad(glow, vec2<i32>(floor(emitter)) * 2 + 1, 0).rgb;
                    if (max(emitted.r, max(emitted.g, emitted.b)) < 0.02) { continue; }
                }
                sample_count += 1.0;
                let delta = emitter - receiver;
                let distance_sq = dot(delta, delta);
                if (distance_sq >= 2304.0) { continue; }
                let falloff = 1.0 - distance_sq / 2304.0;
                attenuation += visibility(receiver, emitter) * falloff * falloff / (1.0 + distance_sq / 100.0);
            }
            light += radiance.rgb * attenuation / max(sample_count, 1.0);
        }
    }
    return vec4<f32>(min(light, vec3<f32>(8.0)), 1.0);
}
fn lattice_noise(p: vec3<i32>) -> f32 {
    return hash(vec2<u32>(p.xy) + u32(p.z) * vec2<u32>(1597334677u, 3812015801u));
}
fn volume_noise(p: vec3<f32>) -> f32 {
    let base = vec3<i32>(floor(p));
    let f = fract(p);
    let t = f * f * (3.0 - 2.0 * f);
    let a = mix(mix(lattice_noise(base), lattice_noise(base + vec3<i32>(1, 0, 0)), t.x),
        mix(lattice_noise(base + vec3<i32>(0, 1, 0)), lattice_noise(base + vec3<i32>(1, 1, 0)), t.x), t.y);
    let b = mix(mix(lattice_noise(base + vec3<i32>(0, 0, 1)), lattice_noise(base + vec3<i32>(1, 0, 1)), t.x),
        mix(lattice_noise(base + vec3<i32>(0, 1, 1)), lattice_noise(base + vec3<i32>(1, 1, 1)), t.x), t.y);
    return mix(a, b, t.z);
}
@fragment fn fs_haze(in: VertexOutput) -> @location(0) vec4<f32> {
    let f = in.uv * vec2<f32>(params.size);
    let p = min(vec2<i32>(f), vec2<i32>(params.size) - 1);
    let gas = textureLoad(haze_density, p, 0).rg;
    if (!haze_open(p) || gas.x + gas.y < 0.001) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    var incident = vec3<f32>(0.0);
    if ((params.styled & 2u) != 0u) { incident = textureLoad(illumination, p, 0).rgb; }
    let time = f32(params.tick) / 60.0;
    var transmittance = 1.0;
    var scattering = vec3<f32>(0.0);
    // Extrude the 2D concentration into an eight-unit cosmetic slab. Eight
    // front-to-back samples integrate Beer-Lambert extinction and single scatter.
    // Depth/noise are derived afresh, with no particles or temporal history.
    for (var i = 0u; i < 8u; i++) {
        let z = f32(i) + 0.5;
        let uv = (f + vec2<f32>(sin(z * 0.9 + time) * 0.3, 0.0)) / vec2<f32>(params.size);
        let concentration = textureSampleLevel(haze_density, linear_sampler, uv, 0.0).rg;
        let noise = volume_noise(vec3<f32>(f * 0.12 + vec2<f32>(time * 0.25, time * 0.7), z * 0.27));
        let detail = volume_noise(vec3<f32>(f * 0.37 - vec2<f32>(0.0, time * 0.3), z * 0.61));
        let envelope = sin(z * 3.14159265 / 8.0);
        let densities = concentration * (0.35 + noise * 0.9 + detail * 0.25) * envelope;
        let extinction = densities.x * 0.23 + densities.y * 0.14;
        let step_transmittance = exp(-extinction);
        let steam_fraction = densities.y / max(densities.x + densities.y, 0.0001);
        let albedo = mix(vec3<f32>(0.48, 0.44, 0.40), vec3<f32>(0.92, 0.96, 1.0), steam_fraction);
        let depth_light = 1.0 / (1.0 + (z - 4.0) * (z - 4.0) * 0.06);
        let radiance = albedo * (vec3<f32>(0.035, 0.045, 0.06) + incident * depth_light * 0.45);
        scattering += transmittance * (1.0 - step_transmittance) * radiance;
        transmittance *= step_transmittance;
    }
    return vec4<f32>(scattering, transmittance);
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
fn haze_at(p: vec2<f32>) -> vec4<f32> {
    if ((params.styled & 64u) == 0u) { return vec4<f32>(0.0, 0.0, 0.0, 1.0); }
    let texel = clamp(vec2<i32>(p * 2.0), vec2<i32>(0), vec2<i32>(params.size * 2u) - 1);
    return textureLoad(haze_volume, texel, 0);
}
fn lit_scene(p: vec2<f32>) -> vec3<f32> {
    let cell = clamp(vec2<i32>(floor(p)), vec2<i32>(0), vec2<i32>(params.size) - 1);
    let texel = clamp(vec2<i32>(p * 2.0), vec2<i32>(0), vec2<i32>(params.size * 2u) - 1);
    var color = textureLoad(source, texel, 0).rgb;
    if ((params.styled & 2u) != 0u && !((params.styled & 64u) != 0u && haze_open(cell))) {
        let light = textureLoad(illumination, cell, 0).rgb;
        color += min(color + 0.025, vec3<f32>(0.7)) * light * 1.7;
    }
    let volume = haze_at(p);
    return color * volume.a + volume.rgb;
}
// Screen-space water optics sample the unmodified HDR scene, never themselves.
// Surface/floor spans, crossed-cell visibility and depth absorption keep sealed
// pockets dark and stop refraction through submerged opaque objects. Reflection
// mirrors the visible 2D scene; it does not infer hidden 3D geometry behind it.
@fragment fn fs_optics(in: VertexOutput) -> MaterialOutput {
    let f = in.uv * vec2<f32>(params.size);
    let p = min(vec2<i32>(f), vec2<i32>(params.size) - 1);
    var color = lit_scene(f);
    var emission = textureLoad(glow, vec2<i32>(f * 2.0), 0).rgb * haze_at(f).a;
    if ((params.styled & 8u) == 0u || material_at(p) != 2u) {
        return MaterialOutput(vec4<f32>(color, 1.0), vec4<f32>(emission, 1.0));
    }
    let span = textureLoad(water_geometry, p, 0);
    let top = f32(span.x);
    let bottom = f32(span.y);
    let depth = f.y - top;
    let time = f32(params.tick) / 60.0;
    let ripple = sin(f.x * 0.23 + time * 1.7) + 0.5 * sin(f.x * 0.57 - time * 1.1 + depth * 0.14);

    // Bend a shallow ray toward the nearest submerged floor. Opaque intervening
    // cells stop it; water absorbs progressively, retaining the blue base at depth.
    let refracted = vec2<f32>(f.x + ripple * min(3.0, 0.6 + depth * 0.06), bottom + 0.5);
    if ((params.styled & 32u) != 0u && bottom < f32(params.size.y) && bottom - f.y < 64.0 &&
        refracted.x >= 0.0 && refracted.x < f32(params.size.x)) {
        let floor_material = material_at(vec2<i32>(floor(refracted)));
        if (floor_material != 0u && floor_material != 2u && solid(vec2<i32>(floor(refracted))) > 0.0) {
            let through = visibility(f, refracted);
            let floor_color = lit_scene(refracted) * vec3<f32>(0.55, 0.82, 0.95);
            // The floor shows through near the bottom and fades with height, so its
            // pattern does not repeat up every water column as vertical streaks.
            let reach = exp(-(bottom - f.y) * 0.14);
            color = mix(color, floor_color, through * 0.82 * reach);
        }
    }

    // Mirror above this water body's actual surface. Waves displace the image;
    // finite depth and roughness fade it without creating physical heat or light.
    let reflected = vec2<f32>(f.x + ripple * min(2.2, 0.3 + depth * 0.06), top - depth);
    if ((params.styled & 16u) != 0u && span.z != 0u && depth < 96.0 && reflected.y >= 0.0 &&
        reflected.x >= 0.0 && reflected.x < f32(params.size.x)) {
        let column = vec2<i32>(i32(floor(reflected.x)), p.y);
        let other = textureLoad(water_geometry, column, 0);
        if (material_at(column) == 2u && other.x == span.x && other.z != 0u) {
            let surface = vec2<f32>(reflected.x, top + 0.001);
            let through = traced_visibility(f, surface, true);
            let roughness = 0.86 + 0.14 * sin(depth * 1.8 + ripple * 0.7);
            let weight = through * 0.48 * exp(-depth * 0.018) * roughness;
            color = mix(color, lit_scene(reflected), weight);
            emission += textureLoad(glow, vec2<i32>(reflected * 2.0), 0).rgb * haze_at(reflected).a * weight;
        }
    }
    return MaterialOutput(vec4<f32>(color, 1.0), vec4<f32>(emission, 1.0));
}
fn filmic(color: vec3<f32>) -> vec3<f32> {
    return clamp((color * (2.51 * color + 0.03)) / (color * (2.43 * color + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
}
// Ordinary values use the per-channel curve unchanged. Bright values map their
// strongest channel and keep the channel ratios, so hot orange light stays
// orange instead of every channel saturating to white. Only extreme
// overexposure still whitens a little.
fn tonemap(color: vec3<f32>) -> vec3<f32> {
    let peak = max(color.r, max(color.g, color.b));
    let channel = filmic(color);
    if (peak <= 0.8) { return channel; }
    let mapped = filmic(vec3<f32>(peak)).r;
    let preserved = mix(color * (mapped / peak), vec3<f32>(mapped), clamp((peak - 6.0) / 24.0, 0.0, 0.25));
    return mix(channel, preserved, smoothstep(0.8, 2.5, peak));
}
fn shimmer_uv(uv: vec2<f32>) -> vec2<f32> {
    let f = uv * vec2<f32>(params.size);
    let p = min(vec2<i32>(f), vec2<i32>(params.size) - 1);
    if (!haze_open(p)) { return uv; }
    let strength = textureLoad(heat_haze, p, 0).r;
    if (strength < 0.001) { return uv; }
    let time = f32(params.tick) / 60.0;
    let a = volume_noise(vec3<f32>(f * 0.38 + vec2<f32>(0.0, time * 3.5), 0.4));
    let b = volume_noise(vec3<f32>(f * 0.83 + vec2<f32>(0.0, time * 5.0), 0.91));
    let offset = vec2<f32>((a - 0.5) * 3.2, (b - 0.5) * 0.65) * strength;
    let q = f + offset;
    if (any(q < vec2<f32>(0.0)) || any(q >= vec2<f32>(params.size))) { return uv; }
    if (!haze_open(vec2<i32>(floor(q))) || traced_visibility(f, q, true) == 0.0) { return uv; }
    // The four bilinear HDR taps must also stay in the open medium. This keeps
    // terrain silhouettes/cell picking fixed and avoids pulling solid colors
    // across a wall merely because a filtered tap straddles its boundary.
    let base = vec2<i32>(floor(q * 2.0 - 0.5));
    for (var y = 0; y < 2; y++) {
        for (var x = 0; x < 2; x++) {
            let tap = clamp(base + vec2<i32>(x, y), vec2<i32>(0), vec2<i32>(params.size * 2u) - 1);
            if (!haze_open(tap / 2)) { return uv; }
        }
    }
    return q / vec2<f32>(params.size);
}
@fragment fn fs_present(in: VertexOutput) -> @location(0) vec4<f32> {
    // Keep cells square and letterbox wide outputs; picking uses the same mapping.
    let scale = min(params.viewport.x / f32(params.size.x), params.viewport.y / f32(params.size.y));
    let extent = vec2<f32>(params.size) * scale;
    let uv = (in.uv * params.viewport - (params.viewport - extent) * 0.5) / extent;
    if (any(uv < vec2<f32>(0.0)) || any(uv >= vec2<f32>(1.0))) { return vec4<f32>(0.012, 0.018, 0.027, 1.0); }
    var sample_uv = uv;
    if ((params.styled & 128u) != 0u) { sample_uv = shimmer_uv(uv); }
    let texel = min(vec2<i32>(uv * vec2<f32>(textureDimensions(source))), vec2<i32>(textureDimensions(source)) - vec2<i32>(1));
    var color = textureLoad(source, texel, 0).rgb;
    if (any(sample_uv != uv)) { color = textureSampleLevel(source, linear_sampler, sample_uv, 0.0).rgb; }
    if (params.styled != 0u) {
        if ((params.styled & 4u) != 0u) { color += textureSampleLevel(glow, linear_sampler, sample_uv, 0.0).rgb * 0.55; }
        color = tonemap(color * 1.15);
    }
    return vec4<f32>(pow(max(color, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.2)), 1.0);
}
