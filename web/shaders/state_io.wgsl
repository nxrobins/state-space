// ca-v3 storage adapter: packed view, conserved energy, persistent structure.
@group(0) @binding(0) var<storage, read> grid_in: array<u32>;
@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;
@group(0) @binding(2) var<storage, read> cold_table: array<u32>;
@group(0) @binding(3) var<storage, read> energy_in: array<u32>;
@group(0) @binding(4) var<storage, read_write> energy_out: array<u32>;
@group(0) @binding(5) var<storage, read> structure_in: array<u32>;
@group(0) @binding(6) var<storage, read_write> structure_out: array<u32>;
@group(0) @binding(7) var<storage, read> structural_plan: array<vec2<u32>>;

const MAX_ENERGY_Q: u32 = 0x3fffffffu;
const NO_MATERIAL: u32 = 256u;
const NO_CELL: u32 = 0xffffffffu;

fn io_cold(material: u32, field: u32) -> u32 {
    return cold_table[material * 24u + field];
}

// Same logical property layout as Thermodynamics.gpu_table(); this adapter
// reads the authoritative cold table, so material edits need no shader rewrite.
fn property(material: u32, field: u32) -> u32 {
    switch field {
        case 0u: { return io_cold(material, 1u); }
        case 1u: { return io_cold(material, 19u) * 256u; }
        case 2u: { return io_cold(material, 16u) * 256u; }
        case 3u: {
            let boil = io_cold(material, 13u);
            if (boil != 0u) { return boil; }
            let melt = io_cold(material, 12u);
            return select(NO_MATERIAL, melt, melt != 0u);
        }
        case 4u: {
            if (io_cold(material, 13u) != 0u) { return io_cold(material, 3u) * 256u; }
            return io_cold(material, 2u) * 256u;
        }
        case 5u: {
            let freeze = io_cold(material, 14u);
            if (freeze != 0u) { return freeze; }
            let condense = io_cold(material, 15u);
            return select(NO_MATERIAL, condense, condense != 0u);
        }
        case 6u: {
            if (io_cold(material, 14u) != 0u) { return io_cold(material, 8u) * 256u; }
            return io_cold(material, 9u) * 256u;
        }
        case 7u: { return io_cold(material, 17u); }
        case 8u: { return io_cold(material, 18u); }
        case 9u: { return io_cold(material, 21u); }
        case 10u: { return io_cold(material, 4u) * 256u; }
        default: { return 0u; }
    }
}

fn io_state(index: u32) -> vec2<u32> {
    return vec2<u32>(grid_in[index] & MATERIAL_MASK, energy_in[index]);
}

fn io_copy(destination: u32, source: u32) {
    grid_out[destination] = grid_in[source];
    energy_out[destination] = energy_in[source];
    structure_out[destination] = structure_in[source];
}

fn io_write(index: u32, packed: u32, energy: u32) {
    let temperature = min(255u, temperature_q(vec2<u32>(packed & MATERIAL_MASK, energy)) / 256u);
    grid_out[index] = (packed & 0xffff00ffu) | (temperature << THERMAL_SHIFT);
    energy_out[index] = energy;
    var word = 0u;
    if (io_cohesive(packed)) {
        word = structure_in[index];
        if (!io_cohesive(grid_in[index]) || (packed & MATERIAL_MASK) != (grid_in[index] & MATERIAL_MASK)) {
            word = STRUCTURE_INTEGRITY_MASK | STRUCTURE_FRESH_MASK;
        }
    }
    structure_out[index] = word;
}

fn io_rewrite(packed: u32, material: u32) -> u32 {
    return (packed & 0xf0ff0000u) | material | (io_cold(material, 20u) << PHASE_SHIFT);
}

fn io_cohesive(packed: u32) -> bool {
    let phase = (packed >> PHASE_SHIFT) & PHASE_MASK;
    return (phase == PHASE_SOLID || phase == PHASE_FROZEN) && io_cold(packed & MATERIAL_MASK, 22u) > 0u;
}

fn io_bound(index: u32) -> bool {
    return io_cohesive(grid_in[index]) && (structure_in[index] & (STRUCTURE_INTEGRITY_MASK | STRUCTURE_ANCHOR_MASK)) != 0u;
}

fn io_can_fall(source: u32, destination: u32) -> bool {
    let phase = (grid_in[source] >> PHASE_SHIFT) & PHASE_MASK;
    let matter = phase == PHASE_SOLID || phase == PHASE_FROZEN || phase == PHASE_POWDER || phase == PHASE_LIQUID || phase == PHASE_VISCOUS || phase == PHASE_MOLTEN;
    return matter && !io_bound(source) && !io_bound(destination) && io_cold(grid_in[source] & MATERIAL_MASK, 0u) > io_cold(grid_in[destination] & MATERIAL_MASK, 0u);
}

fn io_apply_structure(index: u32) {
    let source = structural_plan[index].x;
    grid_out[index] = grid_in[source];
    energy_out[index] = energy_in[source];
    structure_out[index] = structural_plan[index].y;
}

fn io_normalize_structure(index: u32) {
    grid_out[index] = grid_in[index];
    energy_out[index] = energy_in[index];
    var result = 0u;
    if (io_cohesive(grid_in[index])) {
        let word = structure_in[index];
        result = word & (STRUCTURE_INTEGRITY_MASK | STRUCTURE_ANCHOR_MASK);
        if ((word & STRUCTURE_INTEGRITY_MASK) != 0u) {
            let x = index % GRID_WIDTH;
            let y = index / GRID_WIDTH;
            var adjacent = array<u32, 4>(NO_CELL, NO_CELL, NO_CELL, NO_CELL);
            if (x > 0u) { adjacent[0] = index - 1u; }
            if (x + 1u < GRID_WIDTH) { adjacent[1] = index + 1u; }
            if (y > 0u) { adjacent[2] = index - GRID_WIDTH; }
            if (y + 1u < GRID_HEIGHT) { adjacent[3] = index + GRID_WIDTH; }
            let bits = array<u32, 4>(STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_RIGHT_MASK, STRUCTURE_BOND_UP_MASK, STRUCTURE_BOND_DOWN_MASK);
            let reverse = array<u32, 4>(STRUCTURE_BOND_RIGHT_MASK, STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_DOWN_MASK, STRUCTURE_BOND_UP_MASK);
            for (var direction = 0u; direction < 4u; direction = direction + 1u) {
                let neighbor = adjacent[direction];
                if (neighbor == NO_CELL) { continue; }
                let other = structure_in[neighbor];
                if (!io_cohesive(grid_in[neighbor]) || (other & STRUCTURE_INTEGRITY_MASK) == 0u) { continue; }
                let retained = (word & bits[direction]) != 0u && (other & reverse[direction]) != 0u;
                if (retained || ((word | other) & STRUCTURE_FRESH_MASK) != 0u) { result = result | bits[direction]; }
            }
        }
    }
    structure_out[index] = result;
}
