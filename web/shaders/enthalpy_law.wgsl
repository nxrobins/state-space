// Shared integer energy law; property() is supplied by the storage adapter.
// temperature_q is host-owned: io_write, gas buoyancy, gas spread and combustion
// read it. The thermal exchange (pair_energy) and phase selection (phase_material)
// arithmetic belong to the evolvable kernels locked/phase_2a_winner.wgsl and
// locked/phase_2c_winner.wgsl; the standalone probe engine/shaders/enthalpy.wgsl
// keeps its own copies so historical verification stays decoupled from them.
fn temperature_q(state: vec2<u32>) -> u32 {
    let heat = state.y - property(state.x, 2u);
    let phase_energy = property(state.x, 1u);
    var temperature = u32(max(0, i32(heat) - i32(phase_energy)));
    let up = property(state.x, 3u);
    let up_temperature = property(state.x, 4u);
    let down = property(state.x, 5u);
    let down_temperature = property(state.x, 6u);
    if (up != NO_MATERIAL && heat >= phase_energy + up_temperature) {
        temperature = u32(max(i32(up_temperature), i32(heat) - i32(property(up, 1u))));
    } else if (down != NO_MATERIAL && heat <= phase_energy + down_temperature) {
        temperature = min(down_temperature, u32(max(0, i32(heat) - i32(property(down, 1u)))));
    }
    return temperature;
}
