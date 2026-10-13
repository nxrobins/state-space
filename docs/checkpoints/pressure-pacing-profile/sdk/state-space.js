const MATERIAL_CATALOG_HASH = "f5e8af40e58281e2e8b5d343fddbc849c1daecfa54d4a51ea10d4b3bf9ce5ce7";
const RULES_VERSION = "ca-v4";
const SCHEMA_VERSION = 4;
const MATERIAL_MASK = 255;
const THERMAL_SHIFT = 8;
const KINETIC_X_SHIFT = 16;
const KINETIC_Y_SHIFT = 20;
const PHASE_SHIFT = 24;
const PHASE_MASK = 15;
const FLAGS_SHIFT = 28;
const STRUCTURE_INTEGRITY_MASK = 255;
const STRUCTURE_BOND_LEFT_MASK = 256;
const STRUCTURE_BOND_RIGHT_MASK = 512;
const STRUCTURE_BOND_UP_MASK = 1024;
const STRUCTURE_BOND_DOWN_MASK = 2048;
const STRUCTURE_ANCHOR_MASK = 4096;
const STRUCTURE_FRESH_MASK = 8192;
const STRUCTURE_PRESSURE_MASK = 4294901760;
const STRUCTURE_COMPLETE_MASK = 4294909951;
const STRUCTURE_INTERNAL_MASK = 4294934527;
const PHASE_SOLID = 0;
const PHASE_FROZEN = 6;
const COLD_TABLE_STRIDE = 24;
const COLD_TABLE_ENTRIES = 256;
const COLD_DENSITY = 0;
const COLD_CONDUCTIVITY = 1;
const COLD_MELT_POINT = 2;
const COLD_BOIL_POINT = 3;
const COLD_FLASH_POINT = 4;
const COLD_FREEZE_POINT = 8;
const COLD_CONDENSE_POINT = 9;
const COLD_MELTS_INTO = 12;
const COLD_BOILS_INTO = 13;
const COLD_FREEZES_INTO = 14;
const COLD_CONDENSES_INTO = 15;
const COLD_FUEL_ENERGY = 16;
const COLD_BURNS_INTO = 17;
const COLD_SMOKE_PRODUCT = 18;
const COLD_PHASE_ENERGY = 19;
const COLD_DEFAULT_PHASE = 20;
const COLD_OXIDIZER = 21;
const COLD_STRIDE = COLD_TABLE_STRIDE;
function freezeDefinition(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freezeDefinition(child);
    Object.freeze(value);
  }
  return value;
}
const MAT = freezeDefinition({
  "AIR": 0,
  "STONE": 1,
  "WATER": 2,
  "SAND": 3,
  "FIRE": 4,
  "METAL": 5,
  "OIL": 6,
  "WOOD": 7,
  "ICE": 8,
  "STEAM": 9,
  "LAVA": 10,
  "GLASS": 11,
  "PLAYER": 12,
  "ASH": 13,
  "SMOKE": 14,
  "OIL_VAPOR": 15,
  "MOLTEN_METAL": 16,
  "MOLTEN_GLASS": 17
});
const PHASE = freezeDefinition({
  "SOLID": 0,
  "POWDER": 1,
  "LIQUID": 2,
  "VISCOUS": 3,
  "GAS": 4,
  "PLASMA": 5,
  "FROZEN": 6,
  "MOLTEN": 7,
  "BURNING": 8,
  "CONDENSING": 9,
  "EVAPORATING": 10,
  "SUBLIMATING": 11
});
const FLAG = freezeDefinition({
  "BURNING": 1,
  "CONDUCTING": 2,
  "PRESSURIZED": 4,
  "PLAYER_OWNED": 8
});
const MATERIAL_NAMES = freezeDefinition({
  "0": "air",
  "1": "stone",
  "2": "water",
  "3": "sand",
  "4": "fire",
  "5": "metal",
  "6": "oil",
  "7": "wood",
  "8": "ice",
  "9": "steam",
  "10": "lava",
  "11": "glass",
  "12": "player",
  "13": "ash",
  "14": "smoke",
  "15": "oil_vapor",
  "16": "molten_metal",
  "17": "molten_glass"
});
freezeDefinition({
  "0": "#0d0d14",
  "1": "#808080",
  "2": "#2659cc",
  "3": "#c2b280",
  "4": "#ff6610",
  "5": "#b3b8bf",
  "6": "#331f0d",
  "7": "#8c5926",
  "8": "#bfe6f2",
  "9": "#d9d9e6",
  "10": "#ff4d00",
  "11": "#b3d9e6",
  "12": "#33cc66",
  "13": "#4d4740",
  "14": "#66666b",
  "15": "#b4a178",
  "16": "#ffb665",
  "17": "#f6d5aa"
});
const MAT_PHASE = freezeDefinition({
  "0": 4,
  "1": 0,
  "2": 2,
  "3": 1,
  "4": 4,
  "5": 0,
  "6": 3,
  "7": 0,
  "8": 6,
  "9": 4,
  "10": 3,
  "11": 0,
  "12": 0,
  "13": 1,
  "14": 4,
  "15": 4,
  "16": 7,
  "17": 7
});
const MAT_THERMAL = freezeDefinition({
  "0": 20,
  "1": 20,
  "2": 25,
  "3": 20,
  "4": 255,
  "5": 20,
  "6": 22,
  "7": 20,
  "8": 5,
  "9": 120,
  "10": 250,
  "11": 20,
  "12": 20,
  "13": 30,
  "14": 40,
  "15": 120,
  "16": 250,
  "17": 250
});
const COLD_ROWS = freezeDefinition([
  [
    0,
    1,
    5,
    0,
    0,
    0,
    0,
    255,
    3704094720,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    4,
    1,
    0,
    0
  ],
  [
    1,
    200,
    30,
    220,
    255,
    0,
    0,
    0,
    2155872456,
    210,
    0,
    30,
    0,
    10,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    200,
    180
  ],
  [
    2,
    100,
    60,
    0,
    100,
    0,
    0,
    0,
    2151677982,
    15,
    90,
    0,
    40,
    0,
    9,
    8,
    0,
    0,
    0,
    0,
    15,
    2,
    0,
    0,
    0
  ],
  [
    3,
    180,
    20,
    200,
    255,
    0,
    0,
    150,
    2999058612,
    0,
    0,
    25,
    0,
    11,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0
  ],
  [
    4,
    0,
    255,
    0,
    0,
    0,
    255,
    255,
    1694497290,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    4,
    0,
    0,
    0
  ],
  [
    5,
    220,
    200,
    230,
    255,
    0,
    0,
    0,
    3031695580,
    220,
    0,
    35,
    0,
    16,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    255,
    185
  ],
  [
    6,
    90,
    10,
    0,
    80,
    120,
    200,
    0,
    505938070,
    0,
    70,
    0,
    30,
    0,
    15,
    0,
    0,
    150,
    14,
    4,
    0,
    3,
    0,
    0,
    0
  ],
  [
    7,
    120,
    15,
    0,
    0,
    180,
    150,
    30,
    1519059104,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    80,
    13,
    4,
    0,
    0,
    0,
    24,
    120
  ],
  [
    8,
    100,
    40,
    30,
    100,
    0,
    0,
    0,
    3871866900,
    0,
    0,
    15,
    0,
    2,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    6,
    0,
    12,
    12
  ],
  [
    9,
    5,
    50,
    0,
    0,
    0,
    0,
    255,
    3705410565,
    0,
    90,
    0,
    0,
    0,
    0,
    0,
    2,
    0,
    0,
    0,
    55,
    4,
    0,
    0,
    0
  ],
  [
    10,
    210,
    150,
    0,
    255,
    0,
    50,
    0,
    1358947940,
    210,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0,
    0,
    30,
    3,
    0,
    0,
    0
  ],
  [
    11,
    170,
    25,
    240,
    255,
    0,
    0,
    0,
    3704094730,
    235,
    0,
    30,
    0,
    17,
    0,
    0,
    0,
    0,
    0,
    0,
    25,
    0,
    0,
    48,
    190
  ],
  [
    12,
    100,
    30,
    0,
    0,
    0,
    0,
    0,
    3362004530,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    32,
    0
  ],
  [
    13,
    150,
    10,
    0,
    0,
    0,
    0,
    100,
    1684275380,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0
  ],
  [
    14,
    3,
    30,
    0,
    0,
    0,
    0,
    255,
    1684277840,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    4,
    0,
    0,
    0
  ],
  [
    15,
    2,
    30,
    0,
    0,
    120,
    200,
    0,
    505938070,
    0,
    70,
    0,
    0,
    0,
    0,
    0,
    6,
    150,
    14,
    4,
    30,
    4,
    0,
    0,
    0
  ],
  [
    16,
    220,
    200,
    0,
    0,
    0,
    0,
    0,
    3031695580,
    220,
    0,
    0,
    0,
    0,
    0,
    5,
    0,
    0,
    0,
    0,
    35,
    7,
    0,
    0,
    0
  ],
  [
    17,
    170,
    40,
    0,
    0,
    0,
    0,
    0,
    3704094730,
    235,
    0,
    0,
    0,
    0,
    0,
    11,
    0,
    0,
    0,
    0,
    55,
    7,
    0,
    0,
    0
  ]
]);
const DEFAULT_CATALOG = freezeDefinition({
  "schema_version": 4,
  "cold_stride": 24,
  "capacity": 256,
  "bit_fields": {
    "material": {
      "shift": 0,
      "bits": 8,
      "signed": false
    },
    "thermal": {
      "shift": 8,
      "bits": 8,
      "signed": false
    },
    "kinetic_x": {
      "shift": 16,
      "bits": 4,
      "signed": true
    },
    "kinetic_y": {
      "shift": 20,
      "bits": 4,
      "signed": true
    },
    "phase": {
      "shift": 24,
      "bits": 4,
      "signed": false
    },
    "flags": {
      "shift": 28,
      "bits": 4,
      "signed": false
    }
  },
  "phases": {
    "SOLID": 0,
    "POWDER": 1,
    "LIQUID": 2,
    "VISCOUS": 3,
    "GAS": 4,
    "PLASMA": 5,
    "FROZEN": 6,
    "MOLTEN": 7,
    "BURNING": 8,
    "CONDENSING": 9,
    "EVAPORATING": 10,
    "SUBLIMATING": 11
  },
  "flags": {
    "BURNING": 1,
    "CONDUCTING": 2,
    "PRESSURIZED": 4,
    "PLAYER_OWNED": 8
  },
  "cold_fields": [
    "density",
    "conductivity",
    "melt_point",
    "boil_point",
    "flash_point",
    "reactivity",
    "porosity",
    "optical",
    "freeze_point",
    "condense_point",
    "latent_heat_melt",
    "latent_heat_boil",
    "melts_into",
    "boils_into",
    "freezes_into",
    "condenses_into",
    "fuel_energy",
    "burns_into",
    "smoke_product",
    "phase_energy",
    "default_phase",
    "oxidizer",
    "cohesion",
    "softening"
  ],
  "materials": [
    {
      "id": 0,
      "name": "air",
      "default_thermal": 20,
      "color": "#0d0d14",
      "properties": {
        "density": 1,
        "conductivity": 5,
        "melt_point": 0,
        "boil_point": 0,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 255,
        "optical": 3704094720,
        "freeze_point": 0,
        "condense_point": 0,
        "latent_heat_melt": 0,
        "latent_heat_boil": 0,
        "melts_into": 0,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 0,
        "default_phase": 4,
        "oxidizer": 1,
        "cohesion": 0,
        "softening": 0
      }
    },
    {
      "id": 1,
      "name": "stone",
      "default_thermal": 20,
      "color": "#808080",
      "properties": {
        "density": 200,
        "conductivity": 30,
        "melt_point": 220,
        "boil_point": 255,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 0,
        "optical": 2155872456,
        "freeze_point": 210,
        "condense_point": 0,
        "latent_heat_melt": 30,
        "latent_heat_boil": 0,
        "melts_into": 10,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 0,
        "default_phase": 0,
        "oxidizer": 0,
        "cohesion": 200,
        "softening": 180
      }
    },
    {
      "id": 2,
      "name": "water",
      "default_thermal": 25,
      "color": "#2659cc",
      "properties": {
        "density": 100,
        "conductivity": 60,
        "melt_point": 0,
        "boil_point": 100,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 0,
        "optical": 2151677982,
        "freeze_point": 15,
        "condense_point": 90,
        "latent_heat_melt": 0,
        "latent_heat_boil": 40,
        "melts_into": 0,
        "boils_into": 9,
        "freezes_into": 8,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 15,
        "default_phase": 2,
        "oxidizer": 0,
        "cohesion": 0,
        "softening": 0
      }
    },
    {
      "id": 3,
      "name": "sand",
      "default_thermal": 20,
      "color": "#c2b280",
      "properties": {
        "density": 180,
        "conductivity": 20,
        "melt_point": 200,
        "boil_point": 255,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 150,
        "optical": 2999058612,
        "freeze_point": 0,
        "condense_point": 0,
        "latent_heat_melt": 25,
        "latent_heat_boil": 0,
        "melts_into": 11,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 0,
        "default_phase": 1,
        "oxidizer": 0,
        "cohesion": 0,
        "softening": 0
      }
    },
    {
      "id": 4,
      "name": "fire",
      "default_thermal": 255,
      "color": "#ff6610",
      "properties": {
        "density": 0,
        "conductivity": 255,
        "melt_point": 0,
        "boil_point": 0,
        "flash_point": 0,
        "reactivity": 255,
        "porosity": 255,
        "optical": 1694497290,
        "freeze_point": 0,
        "condense_point": 0,
        "latent_heat_melt": 0,
        "latent_heat_boil": 0,
        "melts_into": 0,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 0,
        "default_phase": 4,
        "oxidizer": 0,
        "cohesion": 0,
        "softening": 0
      }
    },
    {
      "id": 5,
      "name": "metal",
      "default_thermal": 20,
      "color": "#b3b8bf",
      "properties": {
        "density": 220,
        "conductivity": 200,
        "melt_point": 230,
        "boil_point": 255,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 0,
        "optical": 3031695580,
        "freeze_point": 220,
        "condense_point": 0,
        "latent_heat_melt": 35,
        "latent_heat_boil": 0,
        "melts_into": 16,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 0,
        "default_phase": 0,
        "oxidizer": 0,
        "cohesion": 255,
        "softening": 185
      }
    },
    {
      "id": 6,
      "name": "oil",
      "default_thermal": 22,
      "color": "#331f0d",
      "properties": {
        "density": 90,
        "conductivity": 10,
        "melt_point": 0,
        "boil_point": 80,
        "flash_point": 120,
        "reactivity": 200,
        "porosity": 0,
        "optical": 505938070,
        "freeze_point": 0,
        "condense_point": 70,
        "latent_heat_melt": 0,
        "latent_heat_boil": 30,
        "melts_into": 0,
        "boils_into": 15,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 150,
        "burns_into": 14,
        "smoke_product": 4,
        "phase_energy": 0,
        "default_phase": 3,
        "oxidizer": 0,
        "cohesion": 0,
        "softening": 0
      }
    },
    {
      "id": 7,
      "name": "wood",
      "default_thermal": 20,
      "color": "#8c5926",
      "properties": {
        "density": 120,
        "conductivity": 15,
        "melt_point": 0,
        "boil_point": 0,
        "flash_point": 180,
        "reactivity": 150,
        "porosity": 30,
        "optical": 1519059104,
        "freeze_point": 0,
        "condense_point": 0,
        "latent_heat_melt": 0,
        "latent_heat_boil": 0,
        "melts_into": 0,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 80,
        "burns_into": 13,
        "smoke_product": 4,
        "phase_energy": 0,
        "default_phase": 0,
        "oxidizer": 0,
        "cohesion": 24,
        "softening": 120
      }
    },
    {
      "id": 8,
      "name": "ice",
      "default_thermal": 5,
      "color": "#bfe6f2",
      "properties": {
        "density": 100,
        "conductivity": 40,
        "melt_point": 30,
        "boil_point": 100,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 0,
        "optical": 3871866900,
        "freeze_point": 0,
        "condense_point": 0,
        "latent_heat_melt": 15,
        "latent_heat_boil": 0,
        "melts_into": 2,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 0,
        "default_phase": 6,
        "oxidizer": 0,
        "cohesion": 12,
        "softening": 12
      }
    },
    {
      "id": 9,
      "name": "steam",
      "default_thermal": 120,
      "color": "#d9d9e6",
      "properties": {
        "density": 5,
        "conductivity": 50,
        "melt_point": 0,
        "boil_point": 0,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 255,
        "optical": 3705410565,
        "freeze_point": 0,
        "condense_point": 90,
        "latent_heat_melt": 0,
        "latent_heat_boil": 0,
        "melts_into": 0,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 2,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 55,
        "default_phase": 4,
        "oxidizer": 0,
        "cohesion": 0,
        "softening": 0
      }
    },
    {
      "id": 10,
      "name": "lava",
      "default_thermal": 250,
      "color": "#ff4d00",
      "properties": {
        "density": 210,
        "conductivity": 150,
        "melt_point": 0,
        "boil_point": 255,
        "flash_point": 0,
        "reactivity": 50,
        "porosity": 0,
        "optical": 1358947940,
        "freeze_point": 210,
        "condense_point": 0,
        "latent_heat_melt": 0,
        "latent_heat_boil": 0,
        "melts_into": 0,
        "boils_into": 0,
        "freezes_into": 1,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 30,
        "default_phase": 3,
        "oxidizer": 0,
        "cohesion": 0,
        "softening": 0
      }
    },
    {
      "id": 11,
      "name": "glass",
      "default_thermal": 20,
      "color": "#b3d9e6",
      "properties": {
        "density": 170,
        "conductivity": 25,
        "melt_point": 240,
        "boil_point": 255,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 0,
        "optical": 3704094730,
        "freeze_point": 235,
        "condense_point": 0,
        "latent_heat_melt": 30,
        "latent_heat_boil": 0,
        "melts_into": 17,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 25,
        "default_phase": 0,
        "oxidizer": 0,
        "cohesion": 48,
        "softening": 190
      }
    },
    {
      "id": 12,
      "name": "player",
      "default_thermal": 20,
      "color": "#33cc66",
      "properties": {
        "density": 100,
        "conductivity": 30,
        "melt_point": 0,
        "boil_point": 0,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 0,
        "optical": 3362004530,
        "freeze_point": 0,
        "condense_point": 0,
        "latent_heat_melt": 0,
        "latent_heat_boil": 0,
        "melts_into": 0,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 0,
        "default_phase": 0,
        "oxidizer": 0,
        "cohesion": 32,
        "softening": 0
      }
    },
    {
      "id": 13,
      "name": "ash",
      "default_thermal": 30,
      "color": "#4d4740",
      "properties": {
        "density": 150,
        "conductivity": 10,
        "melt_point": 0,
        "boil_point": 0,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 100,
        "optical": 1684275380,
        "freeze_point": 0,
        "condense_point": 0,
        "latent_heat_melt": 0,
        "latent_heat_boil": 0,
        "melts_into": 0,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 0,
        "default_phase": 1,
        "oxidizer": 0,
        "cohesion": 0,
        "softening": 0
      }
    },
    {
      "id": 14,
      "name": "smoke",
      "default_thermal": 40,
      "color": "#66666b",
      "properties": {
        "density": 3,
        "conductivity": 30,
        "melt_point": 0,
        "boil_point": 0,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 255,
        "optical": 1684277840,
        "freeze_point": 0,
        "condense_point": 0,
        "latent_heat_melt": 0,
        "latent_heat_boil": 0,
        "melts_into": 0,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 0,
        "default_phase": 4,
        "oxidizer": 0,
        "cohesion": 0,
        "softening": 0
      }
    },
    {
      "id": 15,
      "name": "oil_vapor",
      "default_thermal": 120,
      "color": "#b4a178",
      "properties": {
        "density": 2,
        "conductivity": 30,
        "melt_point": 0,
        "boil_point": 0,
        "flash_point": 120,
        "reactivity": 200,
        "porosity": 0,
        "optical": 505938070,
        "freeze_point": 0,
        "condense_point": 70,
        "latent_heat_melt": 0,
        "latent_heat_boil": 0,
        "melts_into": 0,
        "boils_into": 0,
        "freezes_into": 0,
        "condenses_into": 6,
        "fuel_energy": 150,
        "burns_into": 14,
        "smoke_product": 4,
        "phase_energy": 30,
        "default_phase": 4,
        "oxidizer": 0,
        "cohesion": 0,
        "softening": 0
      }
    },
    {
      "id": 16,
      "name": "molten_metal",
      "default_thermal": 250,
      "color": "#ffb665",
      "properties": {
        "density": 220,
        "conductivity": 200,
        "melt_point": 0,
        "boil_point": 0,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 0,
        "optical": 3031695580,
        "freeze_point": 220,
        "condense_point": 0,
        "latent_heat_melt": 0,
        "latent_heat_boil": 0,
        "melts_into": 0,
        "boils_into": 0,
        "freezes_into": 5,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 35,
        "default_phase": 7,
        "oxidizer": 0,
        "cohesion": 0,
        "softening": 0
      }
    },
    {
      "id": 17,
      "name": "molten_glass",
      "default_thermal": 250,
      "color": "#f6d5aa",
      "properties": {
        "density": 170,
        "conductivity": 40,
        "melt_point": 0,
        "boil_point": 0,
        "flash_point": 0,
        "reactivity": 0,
        "porosity": 0,
        "optical": 3704094730,
        "freeze_point": 235,
        "condense_point": 0,
        "latent_heat_melt": 0,
        "latent_heat_boil": 0,
        "melts_into": 0,
        "boils_into": 0,
        "freezes_into": 11,
        "condenses_into": 0,
        "fuel_energy": 0,
        "burns_into": 0,
        "smoke_product": 0,
        "phase_energy": 55,
        "default_phase": 7,
        "oxidizer": 0,
        "cohesion": 0,
        "softening": 0
      }
    }
  ],
  "structure_fields": {
    "integrity": {
      "shift": 0,
      "bits": 8
    },
    "bond_left": {
      "shift": 8,
      "bits": 1
    },
    "bond_right": {
      "shift": 9,
      "bits": 1
    },
    "bond_up": {
      "shift": 10,
      "bits": 1
    },
    "bond_down": {
      "shift": 11,
      "bits": 1
    },
    "anchor": {
      "shift": 12,
      "bits": 1
    },
    "fresh": {
      "shift": 13,
      "bits": 1
    },
    "moved": {
      "shift": 14,
      "bits": 1
    },
    "pressure": {
      "shift": 16,
      "bits": 16
    }
  }
});
function buildColdTable() {
  const buffer = new Uint32Array(COLD_TABLE_ENTRIES * COLD_STRIDE);
  for (const [id, ...props] of COLD_ROWS) buffer.set(props, id * COLD_STRIDE);
  return buffer;
}
const MAX_CELLS = 1073741823;
const typedArrayName = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint32Array.prototype), Symbol.toStringTag).get;
const typedArrayPrototype = Object.getPrototypeOf(Uint32Array.prototype);
const arrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length").get;
const arrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer").get;
const arrayOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset").get;
function stateCopyTargets(target, count) {
  if (!target || typeof target !== "object") throw new Error("State copy requires output storage.");
  const values = ["grid", "energyQ", "structure"].map((key) => Object.getOwnPropertyDescriptor(target, key)?.value);
  for (const value of values) {
    if (!(value instanceof Uint32Array) || typedArrayName.call(value) !== "Uint32Array" || arrayLength.call(value) !== count) {
      throw new Error("State copy requires three Uint32Arrays of the field cell count.");
    }
  }
  for (let i = 0; i < values.length; i++) for (let j = 0; j < i; j++) {
    if (arrayBuffer.call(values[i]) === arrayBuffer.call(values[j]) && Math.abs(arrayOffset.call(values[i]) - arrayOffset.call(values[j])) < count * 4) {
      throw new Error("State copy coordinates must not overlap.");
    }
  }
  return values;
}
function checkedInteger(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer in [${minimum}, ${maximum}].`);
  }
  return value;
}
function validateDimensions(width, height) {
  checkedInteger(width, 1, MAX_CELLS, "dimensions.width");
  checkedInteger(height, 1, MAX_CELLS, "dimensions.height");
  return checkedInteger(width * height, 1, MAX_CELLS, "cell count");
}
function validatePackedCells(values, length) {
  if (!values || values.length !== length) {
    throw new Error(`Engine snapshot cell length mismatch: expected ${length}, received ${values?.length}.`);
  }
  if (values instanceof Uint32Array && typedArrayName.call(values) === "Uint32Array") {
    const copy = new Uint32Array(values);
    if (copy.length !== length) throw new Error("Engine snapshot cell length mismatch.");
    return copy;
  }
  for (let index = 0; index < length; index += 1) {
    const value = values[index];
    if (!Number.isSafeInteger(value) || value < 0 || value > 4294967295) {
      checkedInteger(value, 0, 4294967295, `packedCells[${index}]`);
    }
  }
  return Uint32Array.from(values);
}
const sameKeys = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label} has missing or unexpected fields.`);
  }
};
const integer = (value, min, max, label) => {
  if (typeof value !== "number") throw new Error(`${label} must be a number.`);
  checkedInteger(value, min, max, label);
};
function canonicalCatalog(catalog) {
  const stable = (value) => {
    if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
    if (value && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return stable({ ...catalog, materials: [...catalog.materials].sort((a, b) => a.id - b.id) });
}
function validateCatalog(value) {
  sameKeys(value, Object.keys(DEFAULT_CATALOG), "Catalog");
  const catalog = value;
  integer(catalog.schema_version, 4, 4, "schema_version");
  integer(catalog.capacity, 256, 256, "capacity");
  integer(catalog.cold_stride, 24, 24, "cold_stride");
  sameKeys(catalog.structure_fields, Object.keys(DEFAULT_CATALOG.structure_fields), "structure_fields");
  for (const [name, expected] of Object.entries(DEFAULT_CATALOG.structure_fields)) {
    const field = catalog.structure_fields[name];
    sameKeys(field, ["shift", "bits"], `structure_fields.${name}`);
    integer(field.shift, expected.shift, expected.shift, `${name}.shift`);
    integer(field.bits, expected.bits, expected.bits, `${name}.bits`);
  }
  sameKeys(catalog.bit_fields, Object.keys(DEFAULT_CATALOG.bit_fields), "bit_fields");
  for (const [name, expected] of Object.entries(DEFAULT_CATALOG.bit_fields)) {
    const field = catalog.bit_fields[name];
    sameKeys(field, ["shift", "bits", "signed"], `bit_fields.${name}`);
    if (field.shift !== expected.shift || field.bits !== expected.bits || field.signed !== expected.signed) throw new Error("Packed layout requires a new schema version.");
  }
  for (const [label, table] of [["phases", catalog.phases], ["flags", catalog.flags]]) {
    if (!table || typeof table !== "object" || Array.isArray(table)) throw new Error(`Invalid ${label}.`);
    const values = /* @__PURE__ */ new Set();
    for (const [name, id] of Object.entries(table)) {
      if (!/^[A-Z][A-Z_0-9]*$/.test(name)) throw new Error(`Invalid ${label} symbol.`);
      integer(id, label === "phases" ? 0 : 1, 15, name);
      if (values.has(id) || label === "flags" && (id & id - 1) !== 0) throw new Error(`Invalid ${label} value.`);
      values.add(id);
    }
    for (const [name, id] of Object.entries(DEFAULT_CATALOG[label])) {
      if (table[name] !== id) throw new Error(`Changing existing ${label} requires a new schema version.`);
    }
    if (label === "flags" && Object.keys(table).length !== Object.keys(DEFAULT_CATALOG.flags).length) throw new Error("Invalid flags.");
  }
  if (!Array.isArray(catalog.cold_fields) || catalog.cold_fields.length !== DEFAULT_CATALOG.cold_fields.length || Array.from(catalog.cold_fields).some((name, i) => name !== DEFAULT_CATALOG.cold_fields[i])) throw new Error("Cold table offsets require a new schema version.");
  if (!Array.isArray(catalog.materials) || !catalog.materials.length) throw new Error("materials must be a nonempty array.");
  const records = /* @__PURE__ */ new Map(), names = /* @__PURE__ */ new Set();
  for (const record of catalog.materials) {
    sameKeys(record, ["id", "name", "default_thermal", "color", "properties"], "Material");
    integer(record.id, 0, 255, "material.id");
    if (typeof record.name !== "string" || !/^[a-z][a-z_0-9]*$/.test(record.name)) throw new Error("Invalid material name.");
    if (records.has(record.id) || names.has(record.name)) throw new Error("Duplicate material ID or name.");
    if (typeof record.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(record.color)) throw new Error("Invalid material color.");
    integer(record.default_thermal, 0, 255, "default_thermal");
    sameKeys(record.properties, catalog.cold_fields, "Material properties");
    for (const [name, property] of Object.entries(record.properties)) integer(property, 0, name === "optical" ? 4294967295 : 255, name);
    if (!Object.values(catalog.phases).includes(record.properties.default_phase)) throw new Error("Undefined default phase.");
    if (![0, 1].includes(record.properties.oxidizer)) throw new Error("oxidizer must be 0 or 1.");
    if (record.properties.softening && !record.properties.cohesion) throw new Error("Softening requires nonzero cohesion.");
    records.set(record.id, record);
    names.add(record.name);
  }
  for (const builtin2 of DEFAULT_CATALOG.materials) {
    if (records.get(builtin2.id)?.name !== builtin2.name) throw new Error("Changing existing material IDs requires a new schema version.");
  }
  const up = (p) => [p.boils_into || p.melts_into, p.boils_into ? p.boil_point : p.melt_point];
  const down = (p) => [p.freezes_into || p.condenses_into, p.freezes_into ? p.freeze_point : p.condense_point];
  for (const record of records.values()) {
    const p = record.properties;
    for (const name of ["melts_into", "boils_into", "freezes_into", "condenses_into", "burns_into", "smoke_product"]) {
      if (!records.has(p[name])) throw new Error(`Undefined target ${record.name}.${name}.`);
    }
    for (const [threshold, target] of [["melt_point", "melts_into"], ["boil_point", "boils_into"], ["freeze_point", "freezes_into"], ["condense_point", "condenses_into"]]) {
      if (p[target] && !p[threshold]) throw new Error("Transition target requires a threshold.");
    }
    if (p.melts_into && p.boils_into || p.freezes_into && p.condenses_into) throw new Error("Only one upward and downward phase interval is supported.");
    if (p.fuel_energy && (!p.flash_point || !p.burns_into || !p.smoke_product)) throw new Error("Incomplete combustion definition.");
    if (p.oxidizer && (p.fuel_energy || p.phase_energy)) throw new Error("Oxidizer must have zero chemical and phase offsets.");
    const upward = up(p), downward = down(p);
    if (upward[0] && downward[0] && downward[1] >= upward[1]) throw new Error("Material phase intervals overlap.");
    for (const [transition, direction] of [[upward, 1], [downward, -1]]) {
      const [id, threshold] = transition;
      if (!id) continue;
      const target = records.get(id).properties;
      const difference = target.phase_energy - p.phase_energy;
      if (difference * direction <= 0) throw new Error("Phase energy must change monotonically.");
      if (direction > 0 && difference !== p[p.boils_into ? "latent_heat_boil" : "latent_heat_melt"]) throw new Error("Declared latent heat must equal the phase energy difference.");
      if (target.fuel_energy !== p.fuel_energy || target.oxidizer !== p.oxidizer) throw new Error("Phase changes must preserve chemical and oxidizer identity.");
      const reverse = direction > 0 ? down(target) : up(target);
      if (reverse[0] && (reverse[0] !== record.id || (direction > 0 ? reverse[1] >= threshold : threshold >= reverse[1]))) {
        throw new Error("Reverse phase edges require original identity and positive hysteresis.");
      }
    }
    if (p.fuel_energy) {
      for (const id of [p.burns_into, p.smoke_product]) {
        const product = records.get(id).properties;
        if (product.fuel_energy || product.oxidizer || product.phase_energy) throw new Error("Combustion products must be inert with zero phase offset.");
      }
    }
  }
}
const registries = /* @__PURE__ */ new WeakSet();
class ValidatedRegistry {
  hash;
  materialIds;
  #catalog;
  #records;
  #cold;
  constructor(catalog, hash) {
    this.hash = hash;
    this.#catalog = catalog;
    this.#records = new Map(catalog.materials.map((record) => [record.id, record]));
    this.materialIds = Object.freeze([...this.#records.keys()].sort((a, b) => a - b));
    this.#cold = new Uint32Array(catalog.capacity * catalog.cold_stride);
    for (const record of catalog.materials) {
      this.#cold.set(catalog.cold_fields.map((name) => record.properties[name]), record.id * catalog.cold_stride);
      Object.freeze(record.properties);
      Object.freeze(record);
    }
    registries.add(this);
    Object.freeze(this);
  }
  has(material2) {
    return this.#records.has(material2);
  }
  material(material2) {
    integer(material2, 0, 255, "material");
    const record = this.#records.get(material2);
    if (!record) throw new Error(`Undefined material: ${material2}`);
    return record;
  }
  toCatalog() {
    return structuredClone(this.#catalog);
  }
  coldTable() {
    return this.#cold.slice();
  }
  extend(materials) {
    return createMaterialRegistry({ ...this.toCatalog(), materials: [...this.toCatalog().materials, ...materials] });
  }
}
function requireRegistry(registry) {
  if (!registries.has(registry)) throw new Error("A validated MaterialRegistry is required.");
}
const builtin = structuredClone(DEFAULT_CATALOG);
validateCatalog(builtin);
const DEFAULT_REGISTRY = new ValidatedRegistry(builtin, MATERIAL_CATALOG_HASH);
async function createMaterialRegistry(value) {
  const catalog = structuredClone(value);
  validateCatalog(catalog);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalCatalog(catalog)));
  const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return new ValidatedRegistry(catalog, hash);
}
const ENERGY_SCALE = 256;
const MAX_ENERGY_Q = 1073741823;
const prop = (v, cold, field) => cold[(v & 255) * COLD_STRIDE + field];
function temperatureQ(voxel, energy, cold) {
  const heat = energy - prop(voxel, cold, COLD_FUEL_ENERGY) * ENERGY_SCALE;
  const phase2 = prop(voxel, cold, COLD_PHASE_ENERGY) * ENERGY_SCALE;
  let temperature = Math.max(0, heat - phase2);
  const boil = prop(voxel, cold, COLD_BOILS_INTO);
  const up = boil || prop(voxel, cold, COLD_MELTS_INTO);
  const upTemperature = prop(voxel, cold, boil ? COLD_BOIL_POINT : COLD_MELT_POINT) * ENERGY_SCALE;
  const freeze = prop(voxel, cold, COLD_FREEZES_INTO);
  const down = freeze || prop(voxel, cold, COLD_CONDENSES_INTO);
  const downTemperature = prop(voxel, cold, freeze ? COLD_FREEZE_POINT : COLD_CONDENSE_POINT) * ENERGY_SCALE;
  if (up && heat >= phase2 + upTemperature) {
    temperature = Math.max(upTemperature, heat - prop(up, cold, COLD_PHASE_ENERGY) * ENERGY_SCALE);
  } else if (down && heat <= phase2 + downTemperature) {
    temperature = Math.min(downTemperature, Math.max(0, heat - prop(down, cold, COLD_PHASE_ENERGY) * ENERGY_SCALE));
  }
  return temperature;
}
function thermalView(voxel, energy, cold) {
  return (voxel & 4294902015 | Math.min(255, Math.floor(temperatureQ(voxel, energy, cold) / ENERGY_SCALE)) << 8) >>> 0;
}
function seedState(values, cold = buildColdTable(), registry = DEFAULT_REGISTRY) {
  const grid = validatePackedCells(values, values.length);
  const energyQ = new Uint32Array(grid.length);
  for (let i = 0; i < grid.length; i += 1) {
    const v = grid[i];
    if (!registry.has(v & 255)) throw new Error("Undefined material in initial state.");
    energyQ[i] = ((v >>> 8 & 255) + prop(v, cold, COLD_PHASE_ENERGY) + prop(v, cold, COLD_FUEL_ENERGY)) * ENERGY_SCALE;
    grid[i] = thermalView(v, energyQ[i], cold);
  }
  return { grid, energyQ };
}
function validateEnergyState(cells, energies, length, cold = buildColdTable(), registry = DEFAULT_REGISTRY) {
  const grid = validatePackedCells(cells, length);
  const energyQ = validatePackedCells(energies, length);
  for (let i = 0; i < length; i += 1) {
    const v = grid[i];
    if (!registry.has(v & 255)) throw new Error("Undefined material in simulation state.");
    const minimum = prop(v, cold, COLD_FUEL_ENERGY) * ENERGY_SCALE;
    if (energyQ[i] < minimum || energyQ[i] > MAX_ENERGY_Q) checkedInteger(energyQ[i], minimum, MAX_ENERGY_Q, `energyQ[${i}]`);
    if (thermalView(v, energyQ[i], cold) !== v) throw new Error("Packed thermal view disagrees with conserved energy.");
  }
  return { grid, energyQ };
}
function exchangeEnergy(a, b, ea, eb, cold) {
  const ta = temperatureQ(a, ea, cold), tb = temperatureQ(b, eb, cold);
  const ca = prop(a, cold, COLD_CONDUCTIVITY), cb = prop(b, cold, COLD_CONDUCTIVITY);
  const k = ca + cb ? Math.floor(2 * ca * cb / (ca + cb)) : 0;
  const difference = Math.abs(ta - tb);
  let flux = Math.floor(difference / 512) * k + Math.floor((difference % 512 * k + 511) / 512);
  flux = Math.min(flux, Math.floor(difference / 2));
  if (ta > tb) {
    flux = Math.min(flux, ea - prop(a, cold, COLD_FUEL_ENERGY) * ENERGY_SCALE, MAX_ENERGY_Q - eb);
    return [ea - flux, eb + flux];
  }
  flux = Math.min(flux, eb - prop(b, cold, COLD_FUEL_ENERGY) * ENERGY_SCALE, MAX_ENERGY_Q - ea);
  return [ea + flux, eb - flux];
}
function phaseMaterial(v, energy, cold) {
  const chemical = prop(v, cold, COLD_FUEL_ENERGY) * ENERGY_SCALE;
  const boil = prop(v, cold, COLD_BOILS_INTO);
  const up = boil || prop(v, cold, COLD_MELTS_INTO);
  if (up) {
    const boundary = chemical + (prop(up, cold, COLD_PHASE_ENERGY) + prop(v, cold, boil ? COLD_BOIL_POINT : COLD_MELT_POINT)) * ENERGY_SCALE;
    if (energy >= boundary) return up;
  }
  const freeze = prop(v, cold, COLD_FREEZES_INTO);
  const down = freeze || prop(v, cold, COLD_CONDENSES_INTO);
  if (down) {
    const boundary = chemical + (prop(down, cold, COLD_PHASE_ENERGY) + prop(v, cold, freeze ? COLD_FREEZE_POINT : COLD_CONDENSE_POINT)) * ENERGY_SCALE;
    if (energy <= boundary) return down;
  }
  return v & 255;
}
function rewriteMaterial(voxel, material2, energy, cold) {
  const packed = (voxel & 4043243520 | material2 | prop(material2, cold, COLD_DEFAULT_PHASE) << PHASE_SHIFT) >>> 0;
  return thermalView(packed, energy, cold);
}
function energyLedger(state, cold = buildColdTable()) {
  let sensibleQ = 0n, latentQ = 0n, chemicalQ = 0n;
  for (let i = 0; i < state.grid.length; i += 1) {
    const chemical = prop(state.grid[i], cold, COLD_FUEL_ENERGY) * ENERGY_SCALE;
    const sensible = temperatureQ(state.grid[i], state.energyQ[i], cold);
    sensibleQ += BigInt(sensible);
    chemicalQ += BigInt(chemical);
    latentQ += BigInt(state.energyQ[i] - chemical - sensible);
  }
  return { sensibleQ, latentQ, chemicalQ, totalQ: sensibleQ + latentQ + chemicalQ };
}
const PRESSURE_MASK = 4294901760;
const MOVED = 16384;
function fluidKind(packed) {
  const phase2 = packed >>> 24 & 15;
  return phase2 === 4 || phase2 === 5 ? 1 : phase2 === 2 || phase2 === 3 || phase2 === 7 ? 2 : 0;
}
function updatePressure(grid, energy, words, width, height, rules) {
  const count = grid.length, kinds = Uint8Array.from(grid, fluidKind), seen = new Uint8Array(count);
  const result = words.slice(), queue = new Uint32Array(count);
  const adjacent = (i) => [
    i >= width ? i - width : -1,
    i % width ? i - 1 : -1,
    i % width + 1 < width ? i + 1 : -1,
    i + width < count ? i + width : -1
  ];
  const relax = (i, target) => {
    const old = words[i] >>> 16, delta = Math.min(65535, target) - old;
    result[i] = (old + Math.sign(delta) * Math.ceil(Math.abs(delta) / 4)) * 65536;
  };
  for (const kind of [1, 2]) for (let root = 0; root < count; root += 1) {
    if (kinds[root] !== kind || seen[root]) continue;
    let tail = 1, sum = 0, top = height, headPressure = 0;
    queue[0] = root;
    seen[root] = 1;
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const i = queue[cursor];
      if (kind === 1) sum += Math.min(66559, Math.floor((Math.floor(rules.temperature(grid[i], energy[i]) / 256) + 64) * 1024 / 84));
      else top = Math.min(top, Math.floor(i / width));
      for (const j of adjacent(i)) {
        if (j < 0) continue;
        if (kind === 2 && kinds[j] === 1) headPressure = Math.max(headPressure, result[j] >>> 16);
        if (kinds[j] === kind && !seen[j]) {
          seen[j] = 1;
          queue[tail++] = j;
        }
      }
    }
    const gasTarget = Math.max(0, Math.floor(sum / tail) - 1024);
    for (let cursor = 0; cursor < tail; cursor += 1) {
      const i = queue[cursor];
      relax(i, kind === 1 ? gasTarget : headPressure + (Math.floor(i / width) - top + 1) * Math.max(1, Math.ceil(rules.material(grid[i]).density / 64)) * 16);
    }
  }
  return result;
}
function pressureLoad(words, i, width) {
  const p = (j) => words[j] >>> 16;
  return Math.abs((i % width ? p(i - 1) : 0) - (i % width + 1 < width ? p(i + 1) : 0)) + Math.abs((i >= width ? p(i - width) : 0) - (i + width < words.length ? p(i + width) : 0));
}
const INTEGRITY_MASK = STRUCTURE_INTEGRITY_MASK;
const BOND_BITS = Object.freeze([STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_RIGHT_MASK, STRUCTURE_BOND_UP_MASK, STRUCTURE_BOND_DOWN_MASK]);
const ANCHOR = STRUCTURE_ANCHOR_MASK;
const FRESH = STRUCTURE_FRESH_MASK;
const COMPLETE_MASK = STRUCTURE_COMPLETE_MASK, INTERNAL_MASK = STRUCTURE_INTERNAL_MASK;
const OPPOSITE = [1, 0, 3, 2];
const registryRules = /* @__PURE__ */ new WeakMap();
function rulesForRegistry(registry) {
  requireRegistry(registry);
  let rules = registryRules.get(registry);
  if (!rules) {
    rules = new StructuralRules(registry.materialIds.map((id) => {
      const p = registry.material(id).properties;
      return { id, density: p.density, cohesion: p.cohesion, softening: p.softening };
    }), registry);
    registryRules.set(registry, rules);
  }
  return rules;
}
function createPhysicsState(cells, width, height, registry) {
  const state = seedState(validatePackedCells(cells, validateDimensions(width, height)), registry.coldTable(), registry);
  return { ...state, structure: seedStructure(state.grid, width, height, rulesForRegistry(registry)) };
}
function rewrittenStructure(before, after, word, rules) {
  if (!rules.eligible(after)) return fluidKind(after) ? (word & PRESSURE_MASK) >>> 0 : 0;
  return !rules.eligible(before) || (before & 255) !== (after & 255) ? INTEGRITY_MASK | FRESH : word;
}
function cloneStructure(state) {
  return { grid: state.grid.slice(), energyQ: state.energyQ.slice(), structure: state.structure.slice() };
}
class StructuralRules {
  #records;
  #cold;
  #registry;
  constructor(materials, registry) {
    if (!Array.isArray(materials) || !materials.length) throw new Error("Structural rules require material records.");
    const records = {};
    for (const row of materials) {
      if (!row || typeof row !== "object") throw new Error("Invalid structural material.");
      for (const name of ["id", "density", "cohesion", "softening"]) checkedInteger(row[name], 0, 255, name);
      if (Object.hasOwn(records, row.id)) throw new Error("Duplicate structural material ID.");
      if (!row.cohesion && row.softening) throw new Error("Noncohesive material cannot have a softening threshold.");
      records[row.id] = Object.freeze({ id: row.id, density: row.density, cohesion: row.cohesion, softening: row.softening });
    }
    if (registry.materialIds.length !== materials.length || registry.materialIds.some((id) => !Object.hasOwn(records, id))) {
      throw new Error("Structural and thermal registries must contain the same material IDs.");
    }
    this.#records = Object.freeze(records);
    this.#cold = registry.coldTable();
    this.#registry = registry;
    Object.freeze(this);
  }
  material(voxel) {
    const row = this.#records[voxel & 255];
    if (!row) throw new Error("Undefined structural material.");
    return row;
  }
  eligible(voxel) {
    const row = this.material(voxel), phase2 = voxel >>> 24 & 15;
    return row.cohesion > 0 && (phase2 === PHASE_SOLID || phase2 === PHASE_FROZEN);
  }
  validate(cells, energy, count) {
    return validateEnergyState(cells, energy, count, this.#cold, this.#registry);
  }
  temperature(voxel, energy) {
    return temperatureQ(voxel, energy, this.#cold);
  }
}
function neighbors(index, width, height) {
  const x = index % width, y = Math.floor(index / width);
  return [
    x ? index - 1 : -1,
    x + 1 < width ? index + 1 : -1,
    y ? index - width : -1,
    y + 1 < height ? index + width : -1
  ];
}
function normalizeBonds(cells, words, width, height, rules) {
  const count = validateDimensions(width, height);
  const grid = validatePackedCells(cells, count), structure = validatePackedCells(words, count);
  const output = new Uint32Array(count), active = new Uint8Array(count);
  for (let i = 0; i < count; i += 1) {
    if ((structure[i] & ~INTERNAL_MASK) !== 0) throw new Error("Reserved structural bits must be zero.");
    if (rules.eligible(grid[i])) {
      output[i] = structure[i] & (INTEGRITY_MASK | ANCHOR);
      if (structure[i] & INTEGRITY_MASK) active[i] = 1;
    } else if (fluidKind(grid[i])) output[i] = structure[i] & PRESSURE_MASK;
  }
  for (let i = 0; i < count; i += 1) {
    if (!active[i]) continue;
    const adjacent = neighbors(i, width, height);
    for (const direction of [1, 3]) {
      const j = adjacent[direction];
      if (j < 0 || !active[j]) continue;
      const reciprocal = structure[i] & BOND_BITS[direction] && structure[j] & BOND_BITS[OPPOSITE[direction]];
      if (reciprocal || (structure[i] | structure[j]) & FRESH) {
        output[i] |= BOND_BITS[direction];
        output[j] |= BOND_BITS[OPPOSITE[direction]];
      }
    }
  }
  return output;
}
function seedStructure(cells, width, height, rules, anchors = []) {
  const grid = validatePackedCells(cells, validateDimensions(width, height));
  const words = Uint32Array.from(grid, (cell) => rules.eligible(cell) ? 255 | FRESH : 0);
  for (const value of anchors) {
    const index = checkedInteger(value, 0, grid.length - 1, "anchor index");
    if (!words[index]) throw new Error("Only cohesive solid/frozen cells can be anchored.");
    words[index] |= ANCHOR;
  }
  return normalizeBonds(grid, words, width, height, rules);
}
function validateStructure(state, width, height, rules, completed = true) {
  const count = validateDimensions(width, height);
  const result = rules.validate(state.grid, state.energyQ, count);
  const words = validatePackedCells(state.structure, count);
  if (words.some((word) => (word & ~(completed ? COMPLETE_MASK : INTERNAL_MASK)) !== 0)) throw new Error("Structural state contains reserved or pending bits.");
  if (completed) {
    const normalized = normalizeBonds(result.grid, words, width, height, rules);
    if (normalized.some((word, index) => word !== words[index])) throw new Error("Structural bonds must be reciprocal, in bounds, and between intact cohesive cells.");
  } else if (words.some((word, i) => (word & 49151) !== 0 && !rules.eligible(result.grid[i]) || (word & PRESSURE_MASK) !== 0 && !fluidKind(result.grid[i]))) throw new Error("Invalid mechanical state for material phase.");
  return { ...result, structure: words };
}
function planStructure(input, width, height, rules) {
  const { grid, energyQ, structure } = validateStructure(input, width, height, rules);
  const count = grid.length;
  const active = (index, words = structure) => (words[index] & INTEGRITY_MASK) !== 0;
  const bound = (index, words = structure) => neighbors(index, width, height).filter((neighbor, direction) => neighbor >= 0 && (words[index] & BOND_BITS[direction]) !== 0);
  const blockedByGrain = (source, target) => (structure[target] & ANCHOR) !== 0 || rules.material(grid[source]).density <= rules.material(grid[target]).density;
  const distances = Array(count).fill(-1), loads = Array(count).fill(0), reactions = Array(count).fill(0);
  const order = [];
  for (let i = 0; i < count; i += 1) {
    if (!active(i)) continue;
    if (structure[i] & ANCHOR || i + width >= count || !active(i + width) && blockedByGrain(i, i + width)) {
      distances[i] = 0;
      order.push(i);
    }
  }
  for (let head = 0; head < order.length; head += 1) {
    const index = order[head], followers = new Set(bound(index));
    if (index >= width && active(index - width)) followers.add(index - width);
    for (const next of [...followers].sort((a, b) => a - b)) {
      if (distances[next] !== -1) continue;
      distances[next] = distances[index] + 1;
      order.push(next);
    }
  }
  let supportedWeight = 0;
  for (const index of order) {
    loads[index] = Math.max(1, Math.ceil(rules.material(grid[index]).density / 64));
    supportedWeight += loads[index];
  }
  for (let cursor = order.length - 1; cursor >= 0; cursor -= 1) {
    const index = order[cursor];
    if (distances[index] === 0) {
      reactions[index] = loads[index];
      continue;
    }
    const candidates = new Set(bound(index));
    if (index + width < count && active(index + width)) candidates.add(index + width);
    const supports = [...candidates].filter((next) => distances[next] === distances[index] - 1).sort((a, b) => a - b);
    if (!supports.length) throw new Error("Supported cell has no load predecessor.");
    const share = Math.floor(loads[index] / supports.length), remainder = loads[index] % supports.length;
    for (let rank = 0; rank < supports.length; rank += 1) loads[supports[rank]] += share + (rank < remainder ? 1 : 0);
  }
  if (reactions.reduce((total, value) => total + value, 0) !== supportedWeight) throw new Error("Support reactions must balance the supported weight exactly.");
  const capacities = Array(count).fill(0), damaged = updatePressure(grid, energyQ, structure, width, height, rules);
  for (let i = 0; i < count; i += 1) {
    if (!active(i)) continue;
    const row = rules.material(grid[i]), integrity = structure[i] & INTEGRITY_MASK, nominal = row.cohesion * 16;
    const remaining = row.softening ? Math.max(0, Math.min(64 * ENERGY_SCALE, (row.softening + 64) * ENERGY_SCALE - rules.temperature(grid[i], energyQ[i]))) : 64 * ENERGY_SCALE;
    capacities[i] = Math.floor(nominal * integrity * remaining / (255 * 64 * ENERGY_SCALE));
    const demand = loads[i] + pressureLoad(damaged, i, width);
    const loss = capacities[i] === 0 ? integrity : demand > capacities[i] ? Math.min(integrity, Math.max(1, Math.floor((demand - capacities[i]) * 255 / nominal))) : 0;
    damaged[i] = damaged[i] & ~INTEGRITY_MASK | integrity - loss;
  }
  const repairedEdges = normalizeBonds(grid, damaged, width, height, rules);
  const parents = new Int32Array(count).fill(-1);
  for (let i = 0; i < count; i += 1) if (active(i, repairedEdges)) parents[i] = i;
  const rootOf = (index) => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = root;
      index = next;
    }
    return root;
  };
  for (let i = 0; i < count; i += 1) {
    if (parents[i] < 0) continue;
    for (const j of bound(i, repairedEdges)) {
      if (j < i) continue;
      const a = rootOf(i), b = rootOf(j);
      parents[Math.max(a, b)] = Math.min(a, b);
    }
  }
  const groups = /* @__PURE__ */ new Map();
  for (let i = 0; i < count; i += 1) {
    if (parents[i] < 0) continue;
    const root = rootOf(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(i);
  }
  const blocked = /* @__PURE__ */ new Set(), dependents = /* @__PURE__ */ new Map();
  for (const root of groups.keys()) dependents.set(root, /* @__PURE__ */ new Set());
  for (const [root, members] of groups) {
    for (const i of members) {
      if (repairedEdges[i] & ANCHOR || i + width >= count) {
        blocked.add(root);
        continue;
      }
      const below = i + width;
      if (parents[below] >= 0) {
        const lower = rootOf(below);
        if (lower !== root) dependents.get(lower).add(root);
      } else if (blockedByGrain(i, below)) blocked.add(root);
    }
  }
  const pending = [...blocked];
  for (let head = 0; head < pending.length; head += 1) {
    for (const next of dependents.get(pending[head])) {
      if (!blocked.has(next)) {
        blocked.add(next);
        pending.push(next);
      }
    }
  }
  const moving = new Uint8Array(count), components = [];
  for (const [id, cells] of groups) {
    const falls = !blocked.has(id);
    if (falls) for (const index of cells) moving[index] = 1;
    components.push(Object.freeze({ id, cells: Object.freeze(cells), moving: falls, anchored: cells.some((i) => (repairedEdges[i] & ANCHOR) !== 0) }));
  }
  const sources = Array.from({ length: count }, (_, index) => index);
  for (let x = 0; x < width; x += 1) {
    let top = -1;
    for (let index = x; index < count; index += width) {
      if (moving[index]) {
        if (top < 0) top = index;
        if (index + width >= count) throw new Error("Moving structure crossed the closed floor.");
        sources[index + width] = index;
      } else if (top >= 0) {
        sources[top] = index;
        top = -1;
      }
    }
  }
  const visits = new Uint8Array(count);
  for (const source of sources) {
    if (visits[source]) throw new Error("Structural transport must be a bijection.");
    visits[source] = 1;
  }
  const finalWords = sources.map((source) => repairedEdges[source]);
  const normalized = normalizeBonds(sources.map((source) => grid[source]), finalWords, width, height, rules);
  if (normalized.some((word, index) => word !== finalWords[index])) throw new Error("Structural transport broke reciprocal bonds.");
  return Object.freeze({
    width,
    height,
    sources: Object.freeze(sources),
    structure: Object.freeze(finalWords),
    loads: Object.freeze(loads),
    capacities: Object.freeze(capacities),
    reactions: Object.freeze(reactions),
    distances: Object.freeze(distances),
    components: Object.freeze(components),
    supportedWeight,
    apply(state, actualWidth, actualHeight) {
      validateDimensions(actualWidth, actualHeight);
      if (actualWidth !== width || actualHeight !== height) throw new Error("Structural plan dimensions changed; recompute for the current geometry.");
      const current = [state.grid, state.energyQ, state.structure].map((values) => validatePackedCells(values, count));
      if ([grid, energyQ, structure].some((values, coordinate) => values.some((value, i) => value !== current[coordinate][i]))) {
        throw new Error("Structural plan input changed; recompute against the current full state.");
      }
      return { grid: Uint32Array.from(sources, (i) => grid[i]), energyQ: Uint32Array.from(sources, (i) => energyQ[i]), structure: Uint32Array.from(finalWords) };
    }
  });
}
const KERNEL_SPECS = [
  {
    "id": "structure",
    "name": "Structural support and transport",
    "source_file": "phase_2e_structure.wgsl",
    "constants": {}
  },
  {
    "id": "vertical0",
    "name": "Vertical gravity phase 0",
    "source_file": "phase_2b_winner.wgsl",
    "constants": {
      "GRAVITY_PHASE": 0
    }
  },
  {
    "id": "vertical1",
    "name": "Vertical gravity phase 1",
    "source_file": "phase_2b_winner.wgsl",
    "constants": {
      "GRAVITY_PHASE": 1
    }
  },
  {
    "id": "impulse",
    "name": "Pressure impulse and damping",
    "source_file": "phase_2f_impulse.wgsl",
    "constants": {}
  },
  {
    "id": "velocity_x0_s0",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 0,
      "MOVE_PHASE": 0,
      "MOVE_SALT": 0
    }
  },
  {
    "id": "velocity_x1_s0",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 0,
      "MOVE_PHASE": 1,
      "MOVE_SALT": 0
    }
  },
  {
    "id": "velocity_y0_s0",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 1,
      "MOVE_PHASE": 0,
      "MOVE_SALT": 0
    }
  },
  {
    "id": "velocity_y1_s0",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 1,
      "MOVE_PHASE": 1,
      "MOVE_SALT": 0
    }
  },
  {
    "id": "velocity_x0_s1",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 0,
      "MOVE_PHASE": 0,
      "MOVE_SALT": 1
    }
  },
  {
    "id": "velocity_x1_s1",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 0,
      "MOVE_PHASE": 1,
      "MOVE_SALT": 1
    }
  },
  {
    "id": "velocity_y0_s1",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 1,
      "MOVE_PHASE": 0,
      "MOVE_SALT": 1
    }
  },
  {
    "id": "velocity_y1_s1",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 1,
      "MOVE_PHASE": 1,
      "MOVE_SALT": 1
    }
  },
  {
    "id": "velocity_x0_s2",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 0,
      "MOVE_PHASE": 0,
      "MOVE_SALT": 2
    }
  },
  {
    "id": "velocity_x1_s2",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 0,
      "MOVE_PHASE": 1,
      "MOVE_SALT": 2
    }
  },
  {
    "id": "velocity_y0_s2",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 1,
      "MOVE_PHASE": 0,
      "MOVE_SALT": 2
    }
  },
  {
    "id": "velocity_y1_s2",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 1,
      "MOVE_PHASE": 1,
      "MOVE_SALT": 2
    }
  },
  {
    "id": "velocity_x0_s3",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 0,
      "MOVE_PHASE": 0,
      "MOVE_SALT": 3
    }
  },
  {
    "id": "velocity_x1_s3",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 0,
      "MOVE_PHASE": 1,
      "MOVE_SALT": 3
    }
  },
  {
    "id": "velocity_y0_s3",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 1,
      "MOVE_PHASE": 0,
      "MOVE_SALT": 3
    }
  },
  {
    "id": "velocity_y1_s3",
    "name": "Conservative velocity transport",
    "source_file": "phase_2f_velocity.wgsl",
    "constants": {
      "MOVE_AXIS": 1,
      "MOVE_PHASE": 1,
      "MOVE_SALT": 3
    }
  },
  {
    "id": "diagonal0_s0",
    "name": "Diagonal fall phase 0 salt 0",
    "source_file": "phase_2b_diagonal_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 0
    }
  },
  {
    "id": "diagonal1_s0",
    "name": "Diagonal fall phase 1 salt 0",
    "source_file": "phase_2b_diagonal_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 0
    }
  },
  {
    "id": "diagonal0_s1",
    "name": "Diagonal fall phase 0 salt 1",
    "source_file": "phase_2b_diagonal_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 1
    }
  },
  {
    "id": "diagonal1_s1",
    "name": "Diagonal fall phase 1 salt 1",
    "source_file": "phase_2b_diagonal_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 1
    }
  },
  {
    "id": "diagonal0_s2",
    "name": "Diagonal fall phase 0 salt 2",
    "source_file": "phase_2b_diagonal_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 2
    }
  },
  {
    "id": "diagonal1_s2",
    "name": "Diagonal fall phase 1 salt 2",
    "source_file": "phase_2b_diagonal_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 2
    }
  },
  {
    "id": "diagonal0_s3",
    "name": "Diagonal fall phase 0 salt 3",
    "source_file": "phase_2b_diagonal_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 3
    }
  },
  {
    "id": "diagonal1_s3",
    "name": "Diagonal fall phase 1 salt 3",
    "source_file": "phase_2b_diagonal_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 3
    }
  },
  {
    "id": "liquid0_s0",
    "name": "Liquid spread phase 0 salt 0",
    "source_file": "phase_2b_liquid_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 0
    }
  },
  {
    "id": "liquid1_s0",
    "name": "Liquid spread phase 1 salt 0",
    "source_file": "phase_2b_liquid_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 0
    }
  },
  {
    "id": "liquid0_s1",
    "name": "Liquid spread phase 0 salt 1",
    "source_file": "phase_2b_liquid_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 1
    }
  },
  {
    "id": "liquid1_s1",
    "name": "Liquid spread phase 1 salt 1",
    "source_file": "phase_2b_liquid_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 1
    }
  },
  {
    "id": "liquid0_s2",
    "name": "Liquid spread phase 0 salt 2",
    "source_file": "phase_2b_liquid_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 2
    }
  },
  {
    "id": "liquid1_s2",
    "name": "Liquid spread phase 1 salt 2",
    "source_file": "phase_2b_liquid_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 2
    }
  },
  {
    "id": "liquid0_s3",
    "name": "Liquid spread phase 0 salt 3",
    "source_file": "phase_2b_liquid_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 3
    }
  },
  {
    "id": "liquid1_s3",
    "name": "Liquid spread phase 1 salt 3",
    "source_file": "phase_2b_liquid_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 3
    }
  },
  {
    "id": "gas_buoyancy0",
    "name": "Gas buoyancy phase 0",
    "source_file": "phase_2b_gas_buoyancy_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0
    }
  },
  {
    "id": "gas_buoyancy1",
    "name": "Gas buoyancy phase 1",
    "source_file": "phase_2b_gas_buoyancy_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1
    }
  },
  {
    "id": "gas_spread0_s0",
    "name": "Gas spread phase 0 salt 0",
    "source_file": "phase_2b_gas_spread_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 0
    }
  },
  {
    "id": "gas_spread1_s0",
    "name": "Gas spread phase 1 salt 0",
    "source_file": "phase_2b_gas_spread_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 0
    }
  },
  {
    "id": "gas_spread0_s1",
    "name": "Gas spread phase 0 salt 1",
    "source_file": "phase_2b_gas_spread_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 1
    }
  },
  {
    "id": "gas_spread1_s1",
    "name": "Gas spread phase 1 salt 1",
    "source_file": "phase_2b_gas_spread_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 1
    }
  },
  {
    "id": "gas_spread0_s2",
    "name": "Gas spread phase 0 salt 2",
    "source_file": "phase_2b_gas_spread_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 2
    }
  },
  {
    "id": "gas_spread1_s2",
    "name": "Gas spread phase 1 salt 2",
    "source_file": "phase_2b_gas_spread_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 2
    }
  },
  {
    "id": "gas_spread0_s3",
    "name": "Gas spread phase 0 salt 3",
    "source_file": "phase_2b_gas_spread_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 0,
      "MOVE_SALT": 3
    }
  },
  {
    "id": "gas_spread1_s3",
    "name": "Gas spread phase 1 salt 3",
    "source_file": "phase_2b_gas_spread_winner.wgsl",
    "constants": {
      "MOVE_PHASE": 1,
      "MOVE_SALT": 3
    }
  },
  {
    "id": "thermal_x0",
    "name": "Thermal x parity 0",
    "source_file": "phase_2a_winner.wgsl",
    "constants": {
      "THERMAL_AXIS": 0,
      "THERMAL_PARITY": 0
    }
  },
  {
    "id": "thermal_x1",
    "name": "Thermal x parity 1",
    "source_file": "phase_2a_winner.wgsl",
    "constants": {
      "THERMAL_AXIS": 0,
      "THERMAL_PARITY": 1
    }
  },
  {
    "id": "thermal_y0",
    "name": "Thermal y parity 0",
    "source_file": "phase_2a_winner.wgsl",
    "constants": {
      "THERMAL_AXIS": 1,
      "THERMAL_PARITY": 0
    }
  },
  {
    "id": "thermal_y1",
    "name": "Thermal y parity 1",
    "source_file": "phase_2a_winner.wgsl",
    "constants": {
      "THERMAL_AXIS": 1,
      "THERMAL_PARITY": 1
    }
  },
  {
    "id": "phase",
    "name": "Phase transitions",
    "source_file": "phase_2c_winner.wgsl",
    "constants": {}
  },
  {
    "id": "combustion",
    "name": "Combustion",
    "source_file": "phase_2d_winner.wgsl",
    "constants": {}
  },
  {
    "id": "normalize",
    "name": "Reciprocal bond normalization",
    "source_file": "phase_2e_normalize.wgsl",
    "constants": {}
  }
];
const SCHEDULES = [["structure", "impulse", "velocity_x0_s0", "velocity_x1_s0", "velocity_y0_s0", "velocity_y1_s0", "vertical0", "vertical1", "diagonal0_s0", "diagonal1_s0", "liquid0_s0", "liquid1_s0", "gas_buoyancy0", "gas_buoyancy1", "gas_spread0_s0", "gas_spread1_s0", "thermal_x0", "thermal_x1", "thermal_y0", "thermal_y1", "phase", "combustion", "normalize"], ["structure", "impulse", "velocity_x0_s1", "velocity_x1_s1", "velocity_y0_s1", "velocity_y1_s1", "vertical0", "vertical1", "diagonal0_s1", "diagonal1_s1", "liquid0_s1", "liquid1_s1", "gas_buoyancy0", "gas_buoyancy1", "gas_spread0_s1", "gas_spread1_s1", "thermal_x0", "thermal_x1", "thermal_y0", "thermal_y1", "phase", "combustion", "normalize"], ["structure", "impulse", "velocity_x0_s2", "velocity_x1_s2", "velocity_y0_s2", "velocity_y1_s2", "vertical0", "vertical1", "diagonal0_s2", "diagonal1_s2", "liquid0_s2", "liquid1_s2", "gas_buoyancy0", "gas_buoyancy1", "gas_spread0_s2", "gas_spread1_s2", "thermal_x0", "thermal_x1", "thermal_y0", "thermal_y1", "phase", "combustion", "normalize"], ["structure", "impulse", "velocity_x0_s3", "velocity_x1_s3", "velocity_y0_s3", "velocity_y1_s3", "vertical0", "vertical1", "diagonal0_s3", "diagonal1_s3", "liquid0_s3", "liquid1_s3", "gas_buoyancy0", "gas_buoyancy1", "gas_spread0_s3", "gas_spread1_s3", "thermal_x0", "thermal_x1", "thermal_y0", "thermal_y1", "phase", "combustion", "normalize"]];
function movementScheduleForTick(tick) {
  return SCHEDULES[tick % 4];
}
const STRUCTURE_WASM = "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AGogAmpBgKACaiEEICwgAGogAmpBgKACaiEAA0AgACAJIAQoAgBBAnRqKAIANgIAIARBBGohBCAAQQRqIQAgIUF/aiIhDQALC0EAIQQLIAQPC0ECCwCIAQRuYW1lAAwLc29sdmVyLndhc20BXwgAC2FiaV92ZXJzaW9uAQZ3ZWlnaHQCDGxlZGdlcl90b3RhbAMPbGVkZ2VyX3NlbnNpYmxlBA9sZWRnZXJfY2hlbWljYWwFCHZhbGlkYXRlBgZsZWRnZXIHBXNvbHZlBxIBAA9fX3N0YWNrX3BvaW50ZXIAdglwcm9kdWNlcnMBDHByb2Nlc3NlZC1ieQEFY2xhbmdWMjIuMS4yIChodHRwczovL2dpdGh1Yi5jb20vbGx2bS9sbHZtLXByb2plY3QgMWFiNDlhOTczZTIxMGU5N2Q2MWU1ZGI2NTU3MTgwZGNiOTJjM2U5OCkAlAEPdGFyZ2V0X2ZlYXR1cmVzCCsLYnVsay1tZW1vcnkrD2J1bGstbWVtb3J5LW9wdCsWY2FsbC1pbmRpcmVjdC1vdmVybG9uZysKbXVsdGl2YWx1ZSsPbXV0YWJsZS1nbG9iYWxzKxNub250cmFwcGluZy1mcHRvaW50Kw9yZWZlcmVuY2UtdHlwZXMrCHNpZ24tZXh0";
const TABLE_WORDS = 256 * (24 + 12), FIELD_COUNT = 15;
let solver;
let unavailable = false;
const tables = /* @__PURE__ */ new WeakMap();
function solverTables(registry) {
  let table = tables.get(registry);
  if (table) return table;
  table = new Uint32Array(TABLE_WORDS);
  table.set(registry.coldTable());
  for (const id of registry.materialIds) {
    const offset = id * COLD_STRIDE, target = 256 * COLD_STRIDE + id * 12;
    table[target] = 1;
    table[target + 1] = table[offset + COLD_PHASE_ENERGY] * 256;
    table[target + 2] = table[offset + COLD_FUEL_ENERGY] * 256;
    const boil = table[offset + COLD_BOILS_INTO], freeze = table[offset + COLD_FREEZES_INTO];
    table[target + 3] = boil || table[offset + COLD_MELTS_INTO] || 256;
    table[target + 4] = table[offset + (boil ? COLD_BOIL_POINT : COLD_MELT_POINT)] * 256;
    table[target + 5] = freeze || table[offset + COLD_CONDENSES_INTO] || 256;
    table[target + 6] = table[offset + (freeze ? COLD_FREEZE_POINT : COLD_CONDENSE_POINT)] * 256;
  }
  tables.set(registry, table);
  return table;
}
function getSolver() {
  if (!solver && !unavailable) {
    try {
      const bytes = Uint8Array.from(atob(STRUCTURE_WASM), (char) => char.charCodeAt(0));
      const module = new WebAssembly.Module(bytes);
      if (WebAssembly.Module.imports(module).length) throw new Error("Structural solver must have no host imports.");
      solver = new WebAssembly.Instance(module).exports;
    } catch {
      unavailable = true;
    }
  }
  if (solver && solver.abi_version() !== 1) throw new Error("Unsupported structural solver ABI.");
  return solver;
}
function validatedWorkspace(input, width, height, registry, ownership = "public") {
  const count = validateDimensions(width, height);
  requireRegistry(registry);
  const engine = getSolver();
  if (!engine) return { state: validateStructure(input, width, height, rulesForRegistry(registry)) };
  const state = ownership !== "public" ? input : { grid: validatePackedCells(input.grid, count), energyQ: validatePackedCells(input.energyQ, count), structure: validatePackedCells(input.structure, count) };
  const base = Number(engine.__heap_base.value);
  const needed = base + (TABLE_WORDS + FIELD_COUNT * count) * 4;
  if (needed > 4294967295) throw new Error("World exceeds compiled planner linear memory limit.");
  if (engine.memory.buffer.byteLength < needed) engine.memory.grow(Math.ceil((needed - engine.memory.buffer.byteLength) / 65536));
  const storage = new Uint32Array(engine.memory.buffer, base, TABLE_WORDS + FIELD_COUNT * count);
  storage.set(solverTables(registry));
  storage.set(state.grid, TABLE_WORDS);
  storage.set(state.energyQ, TABLE_WORDS + count);
  storage.set(state.structure, TABLE_WORDS + count * 2);
  if (ownership !== "committed" && engine.validate(width, height, base)) {
    validateStructure(state, width, height, rulesForRegistry(registry));
    throw new Error("Compiled complete-state validator disagrees with the reference.");
  }
  return { state, engine, storage };
}
function validateCompiledStructure(input, width, height, registry) {
  return validatedWorkspace(input, width, height, registry).state;
}
function validateOwnedStructure(input, width, height, registry) {
  return validatedWorkspace(input, width, height, registry, "owned").state;
}
function compiledTransportInto(input, width, height, registry, sources, structure) {
  const { state, engine, storage } = validatedWorkspace(input, width, height, registry, "committed");
  if (!engine || !storage) {
    const plan = planStructure(state, width, height, rulesForRegistry(registry));
    sources.set(plan.sources);
    structure.set(plan.structure);
    return;
  }
  const status = engine.solve(width, height, Number(engine.__heap_base.value));
  if (status) throw new Error(`Global structural solver invariant failed: ${status}`);
  const count = width * height;
  sources.set(storage.subarray(TABLE_WORDS + count * 3, TABLE_WORDS + count * 4));
  structure.set(storage.subarray(TABLE_WORDS + count * 4, TABLE_WORDS + count * 5));
}
function compiledStructuralPlan(input, width, height, registry, committed = false) {
  const { state, engine, storage } = validatedWorkspace(input, width, height, registry, committed ? "committed" : "public");
  if (!engine || !storage) {
    const plan = planStructure(state, width, height, rulesForRegistry(registry));
    return { sources: Uint32Array.from(plan.sources), structure: Uint32Array.from(plan.structure), apply: () => plan.apply(state, width, height) };
  }
  const count = width * height;
  const status = engine.solve(width, height, Number(engine.__heap_base.value));
  if (status) throw new Error(`Global structural solver invariant failed: ${status}`);
  const sources = storage.slice(TABLE_WORDS + count * 3, TABLE_WORDS + count * 4);
  const structure = storage.slice(TABLE_WORDS + count * 4, TABLE_WORDS + count * 5);
  return { sources, structure, apply() {
    return { grid: Uint32Array.from(sources, (i) => state.grid[i]), energyQ: Uint32Array.from(sources, (i) => state.energyQ[i]), structure: structure.slice() };
  } };
}
const SPECS = new Map(KERNEL_SPECS.map((spec) => [spec.id, spec]));
const coldReferences = /* @__PURE__ */ new WeakMap();
function validateCold(cold, registry) {
  rulesForRegistry(registry);
  let expected = coldReferences.get(registry);
  if (!expected) {
    expected = registry.coldTable();
    coldReferences.set(registry, expected);
  }
  if (!cold || cold.length !== expected.length || expected.some((value, i) => cold[i] !== value)) throw new Error("Cold table must match the supplied validated registry.");
  return expected;
}
const material = (v) => v & MATERIAL_MASK;
const phase = (v) => v >>> PHASE_SHIFT & PHASE_MASK;
const structural = (p) => p === PHASE.SOLID || p === PHASE.FROZEN;
const liquid = (p) => p === PHASE.LIQUID || p === PHASE.VISCOUS || p === PHASE.MOLTEN;
const falling = (p) => p === PHASE.POWDER || liquid(p);
const gas = (p) => p === PHASE.GAS || p === PHASE.PLASMA;
function hashPair(x, y, salt) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1442695041) >>> 0;
  h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0;
  return (h ^ h >>> 16) >>> 0;
}
function runCpuTick(state, width, height, cold, tick, observer, registry = DEFAULT_REGISTRY, committed = false) {
  checkedInteger(tick, 0, Number.MAX_SAFE_INTEGER, "tick");
  cold = validateCold(cold, registry);
  const rules = rulesForRegistry(registry);
  let current = state;
  let spare;
  for (const passId of movementScheduleForTick(tick)) {
    const plan = passId === "structure" && observer ? planStructure(current, width, height, rules) : void 0;
    if (plan) current = plan.apply(current, width, height);
    else if (passId === "structure") current = compiledStructuralPlan(current, width, height, registry, committed).apply();
    else {
      spare ??= { grid: new Uint32Array(current.grid.length), energyQ: new Uint32Array(current.grid.length), structure: new Uint32Array(current.grid.length) };
      const next = runValidatedCpuPass(current, width, height, cold, SPECS.get(passId), rules, spare);
      if (passId !== "normalize") spare = current;
      current = next;
    }
    observer?.(passId, cloneStructure(current), plan);
  }
  return current;
}
function runValidatedCpuPass(state, width, height, cold, spec, rules, reusable) {
  if (spec.id === "normalize") return { ...state, structure: normalizeBonds(state.grid, state.structure, width, height, rules) };
  const input = state.grid;
  const inputEnergy = state.energyQ;
  const inputStructure = state.structure;
  const output = reusable?.grid ?? input.slice();
  const outputEnergy = reusable?.energyQ ?? inputEnergy.slice();
  const outputStructure = reusable?.structure ?? inputStructure.slice();
  if (reusable) {
    output.set(input);
    outputEnergy.set(inputEnergy);
    outputStructure.set(inputStructure);
  }
  const finish = () => ({ grid: output, energyQ: outputEnergy, structure: outputStructure });
  const prop2 = (voxel, field) => cold[material(voxel) * COLD_STRIDE + field];
  const density = (v) => prop2(v, COLD_DENSITY);
  const bound = (index) => rules.eligible(input[index]) && (inputStructure[index] & (ANCHOR | INTEGRITY_MASK)) !== 0;
  const canFall = (source, target) => (falling(phase(input[source])) || structural(phase(input[source]))) && !bound(source) && !bound(target) && density(input[source]) > density(input[target]);
  const swap = (a, b) => {
    output[a] = input[b];
    output[b] = input[a];
    outputEnergy[a] = inputEnergy[b];
    outputEnergy[b] = inputEnergy[a];
    outputStructure[a] = inputStructure[b];
    outputStructure[b] = inputStructure[a];
  };
  const hasFall = (x, y) => y < height - 1 && (canFall(y * width + x, (y + 1) * width + x) || x > 0 && canFall(y * width + x, (y + 1) * width + x - 1) || x < width - 1 && canFall(y * width + x, (y + 1) * width + x + 1));
  const gasRank = (index) => Math.floor(temperatureQ(input[index], inputEnergy[index], cold) / ENERGY_SCALE) * 2 - density(input[index]);
  const canRise = (source, target) => {
    const v = input[source], other = input[target];
    return material(v) !== MAT.AIR && gas(phase(v)) && !structural(phase(other)) && (material(other) === MAT.AIR || gas(phase(other))) && gasRank(source) > gasRank(target) + 16;
  };
  const pairPhase = spec.constants.MOVE_PHASE ?? spec.constants.GRAVITY_PHASE ?? 0;
  const salt = spec.constants.MOVE_SALT ?? 0;
  const velocity = (index, axis) => (input[index] >>> 16 + axis * 4 & 15 ^ 8) - 8;
  if (spec.source_file === "phase_2f_impulse.wgsl") {
    for (let i = 0; i < input.length; i += 1) {
      let vx = 0, vy = 0;
      if (!bound(i)) {
        const own = inputStructure[i] >>> 16;
        const head = fluidKind(input[i]) === 2 ? Math.max(1, Math.ceil(density(input[i]) / 64)) * 16 : 0;
        const p = (j, correction) => j < 0 || !fluidKind(input[j]) ? own : (inputStructure[j] >>> 16) + correction;
        const fx = p(i % width ? i - 1 : -1, 0) - p(i % width + 1 < width ? i + 1 : -1, 0);
        const fy = p(i >= width ? i - width : -1, head) - p(i + width < input.length ? i + width : -1, -head);
        const impulse = (old, force) => Math.max(-4, Math.min(4, old - Math.sign(old) + Math.max(-4, Math.min(4, Math.trunc(force / 64)))));
        vx = impulse(velocity(i, 0), fx);
        vy = impulse(velocity(i, 1), fy);
      }
      output[i] = input[i] & 4278255615 | (vx & 15) << 16 | (vy & 15) << 20;
    }
    return finish();
  }
  if (spec.source_file === "phase_2f_velocity.wgsl") {
    const axis = spec.constants.MOVE_AXIS ?? 0, stride = axis ? width : 1;
    for (let y = axis ? pairPhase : 0; y < height; y += axis ? 2 : 1) {
      for (let x = axis ? 0 : pairPhase; x < width; x += axis ? 1 : 2) {
        if (axis ? y + 1 >= height : x + 1 >= width) continue;
        const a = y * width + x, b = a + stride;
        const request = (s, t, sign) => !bound(s) && !bound(t) && fluidKind(input[t]) !== 0 && velocity(s, axis) * sign > salt;
        if (((inputStructure[a] | inputStructure[b]) & MOVED) === 0 && (request(a, b, 1) || request(b, a, -1))) {
          swap(a, b);
          if (!pairPhase) {
            outputStructure[a] |= MOVED;
            outputStructure[b] |= MOVED;
          }
        }
      }
    }
    if (pairPhase) for (let i = 0; i < input.length; i += 1) outputStructure[i] &= ~MOVED;
    return finish();
  }
  if (spec.source_file === "phase_2b_winner.wgsl" || spec.source_file === "phase_2b_gas_buoyancy_winner.wgsl") {
    for (let y = pairPhase; y < height - 1; y += 2) {
      for (let x = 0; x < width; x += 1) {
        const upper = y * width + x;
        const lower = upper + width;
        if (spec.source_file === "phase_2b_winner.wgsl" ? canFall(upper, lower) : canRise(lower, upper)) swap(upper, lower);
      }
    }
    return finish();
  }
  if (spec.source_file === "phase_2b_diagonal_winner.wgsl") {
    for (let y = pairPhase; y < height - 1; y += 2) {
      for (let left = 0; left < width - 1; left += 2) {
        const rightward = (hashPair(left, y, salt) & 1) === 0;
        const sx = rightward ? left : left + 1;
        const dx = rightward ? left + 1 : left;
        const source = y * width + sx;
        const target = (y + 1) * width + dx;
        if (!canFall(source, source + width) && canFall(source, target)) swap(source, target);
      }
    }
    return finish();
  }
  if (spec.source_file === "phase_2b_liquid_winner.wgsl" || spec.source_file === "phase_2b_gas_spread_winner.wgsl") {
    for (let y = 0; y < height; y += 1) {
      for (let x = pairPhase; x < width - 1; x += 2) {
        const left = y * width + x;
        const right = left + 1;
        if (spec.source_file === "phase_2b_liquid_winner.wgsl") {
          const canSpread = (v, dst) => liquid(phase(v)) && !structural(phase(dst)) && (phase(dst) === PHASE.GAS || material(dst) === MAT.AIR) && density(v) > density(dst);
          const leftCan = !hasFall(x, y) && canSpread(input[left], input[right]);
          const rightCan = !hasFall(x + 1, y) && canSpread(input[right], input[left]);
          if (leftCan || rightCan) swap(left, right);
        } else {
          const leftwardSource = (hashPair(x, y, salt) & 1) === 0;
          const source = leftwardSource ? left : right;
          const target = leftwardSource ? right : left;
          const v = input[source], dst = input[target];
          const blocked = y === 0 || !canRise(source, source - width);
          const canSpread = material(v) !== MAT.AIR && gas(phase(v)) && !structural(phase(dst)) && (material(dst) === MAT.AIR || gas(phase(dst)) && gasRank(source) > gasRank(target) + 16);
          if (blocked && canSpread) swap(source, target);
        }
      }
    }
    return finish();
  }
  const neighbors2 = (index) => {
    const x = index % width, y = Math.floor(index / width);
    return [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1
    ];
  };
  if (spec.source_file === "phase_2a_winner.wgsl") {
    const axis = spec.constants.THERMAL_AXIS ?? 0, parity = spec.constants.THERMAL_PARITY ?? 0;
    for (let y = axis ? parity : 0; y < height; y += axis ? 2 : 1) {
      for (let x = axis ? 0 : parity; x < width; x += axis ? 1 : 2) {
        if (!axis && x + 1 >= width || axis && y + 1 >= height) continue;
        const a = y * width + x, b = a + (axis ? width : 1);
        if (material(input[a]) === material(input[b]) && inputEnergy[a] === inputEnergy[b]) continue;
        [outputEnergy[a], outputEnergy[b]] = exchangeEnergy(input[a], input[b], inputEnergy[a], inputEnergy[b], cold);
        output[a] = thermalView(input[a], outputEnergy[a], cold);
        output[b] = thermalView(input[b], outputEnergy[b], cold);
      }
    }
    return finish();
  }
  if (spec.source_file === "phase_2c_winner.wgsl") {
    for (let index = 0; index < input.length; index += 1) {
      const next = phaseMaterial(input[index], inputEnergy[index], cold);
      if (next !== material(input[index])) {
        output[index] = rewriteMaterial(input[index], next, inputEnergy[index], cold);
        outputStructure[index] = rewrittenStructure(input[index], output[index], inputStructure[index], rules);
      }
    }
    return finish();
  }
  if (spec.source_file !== "phase_2d_winner.wgsl") throw new Error(`No CPU implementation for ${spec.source_file}`);
  const priorityNeighbors = (index) => {
    const all = neighbors2(index);
    const order = (index % width + Math.floor(index / width) & 1) === 0 ? [2, 1, 3, 0] : [0, 2, 1, 3];
    return order.map((direction) => all[direction]).filter((neighbor) => neighbor >= 0);
  };
  const burningFuel = (index) => prop2(input[index], COLD_FUEL_ENERGY) > 0 && temperatureQ(input[index], inputEnergy[index], cold) > prop2(input[index], COLD_FLASH_POINT) * ENERGY_SCALE;
  const chosenAir = (index) => priorityNeighbors(index).find((neighbor) => prop2(input[neighbor], COLD_OXIDIZER) === 1);
  const chosenFuel = (index) => priorityNeighbors(index).find((neighbor) => burningFuel(neighbor) && chosenAir(neighbor) === index);
  const product = (index, nextMaterial, energy) => {
    outputEnergy[index] = energy;
    output[index] = rewriteMaterial(input[index], nextMaterial, energy, cold);
    outputStructure[index] = rewrittenStructure(input[index], output[index], inputStructure[index], rules);
  };
  for (let index = 0; index < input.length; index += 1) {
    const v = input[index], m = material(v);
    if (burningFuel(index)) {
      const air = chosenAir(index);
      if (air !== void 0 && chosenFuel(air) === index) {
        const transfer = Math.min(Math.floor(prop2(v, COLD_FUEL_ENERGY) * ENERGY_SCALE / 2), MAX_ENERGY_Q - inputEnergy[air]);
        product(index, prop2(v, COLD_BURNS_INTO), inputEnergy[index] - transfer);
      }
    } else if (prop2(v, COLD_OXIDIZER) === 1) {
      const chosen = chosenFuel(index);
      if (chosen !== void 0) {
        const transfer = Math.min(Math.floor(prop2(input[chosen], COLD_FUEL_ENERGY) * ENERGY_SCALE / 2), MAX_ENERGY_Q - inputEnergy[index]);
        product(index, prop2(input[chosen], COLD_SMOKE_PRODUCT), inputEnergy[index] + transfer);
      }
    } else if (m === MAT.FIRE) {
      const adjacent = neighbors2(index).filter((neighbor) => neighbor >= 0);
      if (!adjacent.some((neighbor) => prop2(input[neighbor], COLD_FUEL_ENERGY) > 0) || adjacent.some((neighbor) => material(input[neighbor]) === MAT.WATER) || temperatureQ(v, inputEnergy[index], cold) < 80 * ENERGY_SCALE) {
        product(index, MAT.SMOKE, inputEnergy[index]);
      }
    }
  }
  return finish();
}
function inspectPass(before, after, cold, tick, passId, structure) {
  const changes = [];
  for (let i = 0; i < before.grid.length; i += 1) {
    if (before.grid[i] !== after.grid[i] || before.energyQ[i] !== after.energyQ[i] || before.structure[i] !== after.structure[i]) {
      changes.push(Object.freeze({ index: i, beforePacked: before.grid[i], afterPacked: after.grid[i], beforeEnergyQ: before.energyQ[i], afterEnergyQ: after.energyQ[i], beforeStructure: before.structure[i], afterStructure: after.structure[i] }));
    }
  }
  return Object.freeze({
    tick,
    passId,
    changes: Object.freeze(changes),
    structure,
    before: Object.freeze(energyLedger(before, cold)),
    after: Object.freeze(energyLedger(after, cold))
  });
}
function validateSnapshot(snapshot, registry = DEFAULT_REGISTRY) {
  requireRegistry(registry);
  const keys = ["schemaVersion", "rulesVersion", "materialCatalogHash", "width", "height", "tick", "packedCells", "energyQ", "structure"];
  if (!snapshot || Object.keys(snapshot).length !== keys.length || keys.some((key) => !Object.hasOwn(snapshot, key))) {
    throw new Error("Snapshot contains missing or unexpected fields.");
  }
  if (snapshot.schemaVersion !== SCHEMA_VERSION || snapshot.rulesVersion !== RULES_VERSION || snapshot.materialCatalogHash !== registry.hash) {
    throw new Error("Incompatible snapshot version or material catalog.");
  }
  checkedInteger(snapshot.tick, 0, Number.MAX_SAFE_INTEGER, "tick");
  validateDimensions(snapshot.width, snapshot.height);
  return validateStructure({ grid: snapshot.packedCells, energyQ: snapshot.energyQ, structure: snapshot.structure }, snapshot.width, snapshot.height, rulesForRegistry(registry));
}
function packVoxel(material2, thermal = defaultThermal(material2), kineticX = 0, kineticY = 0, phase2 = defaultPhase(material2), flags = 0) {
  checkedInteger(material2, 0, 255, "material");
  checkedInteger(thermal, 0, 255, "thermal");
  checkedInteger(kineticX, -8, 7, "kineticX");
  checkedInteger(kineticY, -8, 7, "kineticY");
  checkedInteger(phase2, 0, 15, "phase");
  checkedInteger(flags, 0, 15, "flags");
  return (material2 & 255 | (thermal & 255) << THERMAL_SHIFT | (kineticX & 15) << KINETIC_X_SHIFT | (kineticY & 15) << KINETIC_Y_SHIFT | (phase2 & 15) << PHASE_SHIFT | (flags & 15) << FLAGS_SHIFT) >>> 0;
}
function unpackVoxel(packed) {
  const kx = packed >> KINETIC_X_SHIFT & 15;
  const ky = packed >> KINETIC_Y_SHIFT & 15;
  return {
    material: packed & 255,
    thermal: packed >> THERMAL_SHIFT & 255,
    kineticX: (kx ^ 8) - 8 | 0,
    kineticY: (ky ^ 8) - 8 | 0,
    phase: packed >> PHASE_SHIFT & 15,
    flags: packed >> FLAGS_SHIFT & 15
  };
}
function defaultPhase(material2) {
  return MAT_PHASE[material2] ?? PHASE.SOLID;
}
function defaultThermal(material2) {
  return MAT_THERMAL[material2] ?? 20;
}
function materialName(material2) {
  return MATERIAL_NAMES[material2] ?? `material-${material2}`;
}
function createStateSpaceField(width, height, fillMaterial = MAT.AIR, registry = DEFAULT_REGISTRY) {
  return new CpuStateSpaceField(width, height, fillMaterial, registry);
}
class FieldState {
  width;
  height;
  registry;
  cells;
  energies;
  bonds;
  initialEnergyQ = 0n;
  editEnergyQ = 0n;
  coldTable;
  tickCount = 0;
  busy = false;
  closed = false;
  constructor(width, height, fillMaterial, registry) {
    validateDimensions(width, height);
    requireRegistry(registry);
    registry.material(fillMaterial);
    this.width = width;
    this.height = height;
    this.registry = registry;
    Object.defineProperties(this, { width: { writable: false }, height: { writable: false }, registry: { writable: false } });
    this.coldTable = registry.coldTable();
    this.cells = new Uint32Array(width * height);
    this.energies = new Uint32Array(width * height);
    this.bonds = new Uint32Array(width * height);
    this.clear(fillMaterial);
  }
  ensureAvailable(mutation = true) {
    if (this.busy) throw new Error("A step is in progress; await it before accessing the field.");
    if (mutation && this.closed) throw new Error("Field is closed.");
  }
  /** Invalidate backend copies before any committed coordinates are changed. */
  stateChanged() {
  }
  close() {
    if (this.closed) return;
    this.ensureAvailable();
    this.closed = true;
  }
  get grid() {
    this.ensureAvailable(false);
    return this.cells.slice();
  }
  get energyQ() {
    this.ensureAvailable(false);
    return this.energies.slice();
  }
  get structure() {
    this.ensureAvailable(false);
    return this.bonds.slice();
  }
  /** Copy the committed coordinates into independent caller-owned storage. */
  copyStateInto(target) {
    this.ensureAvailable(false);
    const [grid, energyQ, structure] = stateCopyTargets(target, this.width * this.height);
    this.ensureAvailable(false);
    Uint32Array.prototype.set.call(grid, this.cells);
    Uint32Array.prototype.set.call(energyQ, this.energies);
    Uint32Array.prototype.set.call(structure, this.bonds);
    return this.tickCount;
  }
  energyLedger() {
    this.ensureAvailable(false);
    return energyLedger({ grid: this.cells, energyQ: this.energies }, this.coldTable);
  }
  energyBalance() {
    const currentQ = this.energyLedger().totalQ;
    return {
      initialQ: this.initialEnergyQ,
      externalQ: this.editEnergyQ,
      currentQ,
      driftQ: currentQ - this.initialEnergyQ - this.editEnergyQ
    };
  }
  get tick() {
    this.ensureAvailable(false);
    return this.tickCount;
  }
  clear(material2 = MAT.AIR) {
    this.ensureAvailable();
    const record = this.registry.material(material2);
    const state = createPhysicsState(new Uint32Array(this.width * this.height).fill(packVoxel(material2, record.default_thermal, 0, 0, record.properties.default_phase)), this.width, this.height, this.registry);
    this.stateChanged();
    this.cells = state.grid;
    this.energies = state.energyQ;
    this.bonds = state.structure;
    this.tickCount = 0;
    this.initialEnergyQ = this.energyLedger().totalQ;
    this.editEnergyQ = 0n;
  }
  setCell(x, y, material2, thermal, flags = 0) {
    this.ensureAvailable();
    checkedInteger(x, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "x");
    checkedInteger(y, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "y");
    const record = this.registry.material(material2);
    const dose = thermal === void 0 ? record.default_thermal : thermal;
    checkedInteger(dose, 0, 255, "thermal");
    checkedInteger(flags, 0, 15, "flags");
    if (!this.inside(x, y)) return;
    const state = seedState(Uint32Array.of(packVoxel(material2, dose, 0, 0, record.properties.default_phase, flags)), this.coldTable, this.registry);
    const index = this.index(x, y);
    this.stateChanged();
    this.editEnergyQ += BigInt(state.energyQ[0]) - BigInt(this.energies[index]);
    this.cells[index] = state.grid[0];
    this.energies[index] = state.energyQ[0];
    this.bonds[index] = rulesForRegistry(this.registry).eligible(this.cells[index]) ? INTEGRITY_MASK | FRESH : 0;
    this.normalizeStructure();
  }
  setEnergy(x, y, energyQ) {
    this.ensureAvailable();
    checkedInteger(x, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "x");
    checkedInteger(y, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "y");
    checkedInteger(energyQ, 0, MAX_ENERGY_Q, "energyQ");
    if (!this.inside(x, y)) return;
    const index = this.index(x, y);
    const value = thermalView(this.cells[index], energyQ, this.coldTable);
    validateEnergyState([value], [energyQ], 1, this.coldTable, this.registry);
    this.stateChanged();
    this.editEnergyQ += BigInt(energyQ) - BigInt(this.energies[index]);
    this.cells[index] = value;
    this.energies[index] = energyQ;
  }
  normalizeStructure() {
    this.bonds = normalizeBonds(this.cells, this.bonds, this.width, this.height, rulesForRegistry(this.registry));
  }
  setAnchor(x, y, anchored = true) {
    this.ensureAvailable();
    checkedInteger(x, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "x");
    checkedInteger(y, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "y");
    if (typeof anchored !== "boolean") throw new Error("anchored must be a boolean.");
    if (!this.inside(x, y)) return;
    const index = this.index(x, y);
    if (!rulesForRegistry(this.registry).eligible(this.cells[index])) throw new Error("Only cohesive solid/frozen cells can be anchored.");
    this.stateChanged();
    this.bonds[index] = this.bonds[index] & ~ANCHOR | (anchored ? ANCHOR : 0);
  }
  setIntegrity(x, y, integrity, options = {}) {
    this.ensureAvailable();
    checkedInteger(x, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "x");
    checkedInteger(y, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "y");
    checkedInteger(integrity, 0, INTEGRITY_MASK, "integrity");
    if (options.weld !== void 0 && typeof options.weld !== "boolean") throw new Error("weld must be a boolean.");
    if (!this.inside(x, y)) return;
    const index = this.index(x, y);
    if (!rulesForRegistry(this.registry).eligible(this.cells[index])) throw new Error("Only cohesive solid/frozen cells can have integrity.");
    this.stateChanged();
    this.bonds[index] = this.bonds[index] & ~INTEGRITY_MASK | integrity | (options.weld && integrity ? FRESH : 0);
    this.normalizeStructure();
  }
  inspectStructure() {
    this.ensureAvailable(false);
    return planStructure({ grid: this.cells, energyQ: this.energies, structure: this.bonds }, this.width, this.height, rulesForRegistry(this.registry));
  }
  paintCircle(x, y, radius, material2, thermal, flags = 0) {
    this.ensureAvailable();
    for (const value of [x, y, radius]) {
      if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error("Invalid paint geometry.");
    }
    if (radius < 0) throw new Error("Paint radius must be nonnegative.");
    const record = this.registry.material(material2);
    const state = seedState(Uint32Array.of(packVoxel(material2, thermal === void 0 ? record.default_thermal : thermal, 0, 0, record.properties.default_phase, flags)), this.coldTable, this.registry);
    const r2 = radius * radius;
    this.stateChanged();
    for (let py = Math.max(0, Math.floor(y - radius)); py <= Math.min(this.height - 1, Math.ceil(y + radius)); py += 1) {
      for (let px = Math.max(0, Math.floor(x - radius)); px <= Math.min(this.width - 1, Math.ceil(x + radius)); px += 1) {
        const dx = px - x;
        const dy = py - y;
        if (dx * dx + dy * dy <= r2) {
          const index = this.index(px, py);
          this.editEnergyQ += BigInt(state.energyQ[0]) - BigInt(this.energies[index]);
          this.cells[index] = state.grid[0];
          this.energies[index] = state.energyQ[0];
          this.bonds[index] = rulesForRegistry(this.registry).eligible(this.cells[index]) ? INTEGRITY_MASK | FRESH : 0;
        }
      }
    }
    this.normalizeStructure();
  }
  sample(x, y) {
    this.ensureAvailable(false);
    const index = this.index(this.clampX(x), this.clampY(y));
    const voxel = unpackVoxel(this.cells[index]);
    return {
      material: voxel.material,
      materialName: this.registry.material(voxel.material).name,
      thermal: voxel.thermal,
      energyQ: this.energies[index],
      temperatureQ: temperatureQ(this.cells[index], this.energies[index], this.coldTable),
      phase: voxel.phase,
      flags: voxel.flags,
      pressureQ: this.bonds[index] >>> 16,
      velocityX: voxel.kineticX,
      velocityY: voxel.kineticY,
      structure: this.bonds[index],
      integrity: this.bonds[index] & INTEGRITY_MASK,
      anchored: (this.bonds[index] & ANCHOR) !== 0,
      bonds: this.bonds[index] & BOND_BITS.reduce((a, b) => a | b, 0)
    };
  }
  materialAt(x, y) {
    this.ensureAvailable(false);
    return this.cells[this.index(this.clampX(x), this.clampY(y))] & 255;
  }
  thermalAt(x, y) {
    this.ensureAvailable(false);
    return this.cells[this.index(this.clampX(x), this.clampY(y))] >> THERMAL_SHIFT & 255;
  }
  snapshot() {
    this.ensureAvailable(false);
    return {
      width: this.width,
      height: this.height,
      grid: new Uint32Array(this.cells),
      energyQ: this.energies.slice(),
      structure: this.bonds.slice(),
      tick: this.tickCount
    };
  }
  packedSnapshot() {
    this.ensureAvailable(false);
    return {
      schemaVersion: SCHEMA_VERSION,
      rulesVersion: RULES_VERSION,
      materialCatalogHash: this.registry.hash,
      width: this.width,
      height: this.height,
      tick: this.tickCount,
      packedCells: Array.from(this.cells),
      energyQ: Array.from(this.energies),
      structure: Array.from(this.bonds)
    };
  }
  restore(snapshot) {
    this.ensureAvailable();
    const state = validateSnapshot(snapshot, this.registry);
    if (snapshot.width !== this.width || snapshot.height !== this.height) throw new Error("Snapshot dimensions differ from the field.");
    this.stateChanged();
    this.cells = state.grid;
    this.energies = state.energyQ;
    this.bonds = state.structure;
    this.initialEnergyQ = this.energyLedger().totalQ;
    this.editEnergyQ = 0n;
    this.tickCount = snapshot.tick;
  }
  commitState(state, tick) {
    const validated = validateCompiledStructure(state, this.width, this.height, this.registry);
    this.adoptState(validated, tick);
  }
  /** Private continuation: take ownership only after complete-state validation. */
  adoptState(state, tick) {
    this.stateChanged();
    this.cells = state.grid;
    this.energies = state.energyQ;
    this.bonds = state.structure;
    this.tickCount = tick;
  }
  index(x, y) {
    return y * this.width + x;
  }
  inside(x, y) {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }
  clampX(x) {
    if (!Number.isFinite(x) || Math.abs(x) > Number.MAX_SAFE_INTEGER) throw new Error("Sample x must be finite and within the safe numeric range.");
    return Math.max(0, Math.min(this.width - 1, Math.floor(x)));
  }
  clampY(y) {
    if (!Number.isFinite(y) || Math.abs(y) > Number.MAX_SAFE_INTEGER) throw new Error("Sample y must be finite and within the safe numeric range.");
    return Math.max(0, Math.min(this.height - 1, Math.floor(y)));
  }
}
class CpuStateSpaceField extends FieldState {
  step(ticks = 1, options = {}) {
    this.ensureAvailable();
    checkedInteger(ticks, 0, Number.MAX_SAFE_INTEGER - this.tickCount, "ticks");
    if (options.inspect !== void 0 && typeof options.inspect !== "boolean") throw new Error("inspect must be a boolean.");
    let state = { grid: this.cells, energyQ: this.energies, structure: this.bonds };
    const reports = [];
    for (let index = 0; index < ticks; index += 1) {
      let before = state;
      const observer = options.inspect ? (passId, after, plan) => {
        reports.push(inspectPass(before, after, this.coldTable, this.tickCount + index, passId, plan));
        before = after;
      } : void 0;
      state = runCpuTick(state, this.width, this.height, this.coldTable, this.tickCount + index, observer, this.registry, index === 0);
    }
    this.commitState(state, this.tickCount + ticks);
    return Object.freeze(reports);
  }
}
const COMMON_SHADER = "// Generated by python -m engine.generate; edit engine/materials.json.\nconst SCHEMA_VERSION: u32 = 4u;\nconst MATERIAL_BITS: u32 = 8u;\nconst MATERIAL_SHIFT: u32 = 0u;\nconst MATERIAL_MASK: u32 = 255u;\nconst THERMAL_BITS: u32 = 8u;\nconst THERMAL_SHIFT: u32 = 8u;\nconst THERMAL_MASK: u32 = 255u;\nconst KINETIC_X_BITS: u32 = 4u;\nconst KINETIC_X_SHIFT: u32 = 16u;\nconst KINETIC_X_MASK: u32 = 15u;\nconst KINETIC_Y_BITS: u32 = 4u;\nconst KINETIC_Y_SHIFT: u32 = 20u;\nconst KINETIC_Y_MASK: u32 = 15u;\nconst PHASE_BITS: u32 = 4u;\nconst PHASE_SHIFT: u32 = 24u;\nconst PHASE_MASK: u32 = 15u;\nconst FLAGS_BITS: u32 = 4u;\nconst FLAGS_SHIFT: u32 = 28u;\nconst FLAGS_MASK: u32 = 15u;\nconst STRUCTURE_INTEGRITY_MASK: u32 = 255u;\nconst STRUCTURE_BOND_LEFT_MASK: u32 = 256u;\nconst STRUCTURE_BOND_RIGHT_MASK: u32 = 512u;\nconst STRUCTURE_BOND_UP_MASK: u32 = 1024u;\nconst STRUCTURE_BOND_DOWN_MASK: u32 = 2048u;\nconst STRUCTURE_ANCHOR_MASK: u32 = 4096u;\nconst STRUCTURE_FRESH_MASK: u32 = 8192u;\nconst STRUCTURE_MOVED_MASK: u32 = 16384u;\nconst STRUCTURE_PRESSURE_MASK: u32 = 4294901760u;\nconst STRUCTURE_COMPLETE_MASK: u32 = 4294909951u;\nconst STRUCTURE_INTERNAL_MASK: u32 = 4294934527u;\nconst MAT_AIR: u32 = 0u;\nconst MAT_STONE: u32 = 1u;\nconst MAT_WATER: u32 = 2u;\nconst MAT_SAND: u32 = 3u;\nconst MAT_FIRE: u32 = 4u;\nconst MAT_METAL: u32 = 5u;\nconst MAT_OIL: u32 = 6u;\nconst MAT_WOOD: u32 = 7u;\nconst MAT_ICE: u32 = 8u;\nconst MAT_STEAM: u32 = 9u;\nconst MAT_LAVA: u32 = 10u;\nconst MAT_GLASS: u32 = 11u;\nconst MAT_PLAYER: u32 = 12u;\nconst MAT_ASH: u32 = 13u;\nconst MAT_SMOKE: u32 = 14u;\nconst MAT_OIL_VAPOR: u32 = 15u;\nconst MAT_MOLTEN_METAL: u32 = 16u;\nconst MAT_MOLTEN_GLASS: u32 = 17u;\nconst PHASE_SOLID: u32 = 0u;\nconst PHASE_POWDER: u32 = 1u;\nconst PHASE_LIQUID: u32 = 2u;\nconst PHASE_VISCOUS: u32 = 3u;\nconst PHASE_GAS: u32 = 4u;\nconst PHASE_PLASMA: u32 = 5u;\nconst PHASE_FROZEN: u32 = 6u;\nconst PHASE_MOLTEN: u32 = 7u;\nconst PHASE_BURNING: u32 = 8u;\nconst PHASE_CONDENSING: u32 = 9u;\nconst PHASE_EVAPORATING: u32 = 10u;\nconst PHASE_SUBLIMATING: u32 = 11u;\nconst FLAG_BURNING: u32 = 1u;\nconst FLAG_CONDUCTING: u32 = 2u;\nconst FLAG_PRESSURIZED: u32 = 4u;\nconst FLAG_PLAYER_OWNED: u32 = 8u;\n\nstruct VoxelState {\n    material: u32,\n    thermal: u32,\n    kinetic_x: i32,\n    kinetic_y: i32,\n    phase: u32,\n    flags: u32,\n}\n\noverride GRID_WIDTH: u32 = 256u;\noverride GRID_HEIGHT: u32 = 256u;\n\n\n// Seed 2: Branchless optimized pack/unpack\n// Uses bitwise tricks to avoid branching for sign extension.\n\nfn pack_voxel(mat: u32, thermal: u32, kx: i32, ky: i32, phase: u32, flags: u32) -> u32 {\n    // Single expression pack — compiler can fuse these\n    return ((mat & MATERIAL_MASK) << MATERIAL_SHIFT)\n         | ((thermal & THERMAL_MASK) << THERMAL_SHIFT)\n         | ((u32(kx) & KINETIC_X_MASK) << KINETIC_X_SHIFT)\n         | ((u32(ky) & KINETIC_Y_MASK) << KINETIC_Y_SHIFT)\n         | ((phase & PHASE_MASK) << PHASE_SHIFT)\n         | ((flags & FLAGS_MASK) << FLAGS_SHIFT);\n}\n\nfn unpack_voxel(packed: u32) -> VoxelState {\n    var state: VoxelState;\n    state.material = (packed >> MATERIAL_SHIFT) & MATERIAL_MASK;\n    state.thermal = (packed >> THERMAL_SHIFT) & THERMAL_MASK;\n\n    // Branchless sign extension: (val ^ 0x8) - 0x8 converts 4-bit unsigned to signed\n    let kx_raw = (packed >> KINETIC_X_SHIFT) & KINETIC_X_MASK;\n    let ky_raw = (packed >> KINETIC_Y_SHIFT) & KINETIC_Y_MASK;\n    state.kinetic_x = i32((kx_raw ^ 0x8u) - 0x8u);\n    state.kinetic_y = i32((ky_raw ^ 0x8u) - 0x8u);\n\n    state.phase = (packed >> PHASE_SHIFT) & PHASE_MASK;\n    state.flags = (packed >> FLAGS_SHIFT) & FLAGS_MASK;\n    return state;\n}\n\nfn exchange_thermal(a: u32, b: u32) -> vec2<u32> {\n    // Branchless thermal exchange with configurable rate\n    let ta = (a >> THERMAL_SHIFT) & THERMAL_MASK;\n    let tb = (b >> THERMAL_SHIFT) & THERMAL_MASK;\n\n    // Arithmetic shift for signed division\n    let diff = i32(ta) - i32(tb);\n    let transfer = diff >> 2;  // Divide by 4 via shift\n\n    let new_ta = u32(max(min(i32(ta) - transfer, 255), 0));\n    let new_tb = u32(max(min(i32(tb) + transfer, 255), 0));\n\n    let clear_mask = ~(THERMAL_MASK << THERMAL_SHIFT);\n    return vec2<u32>(\n        (a & clear_mask) | (new_ta << THERMAL_SHIFT),\n        (b & clear_mask) | (new_tb << THERMAL_SHIFT)\n    );\n}\n\n// ── Compute entry point ────────────────────────────────────────────\n\n\n\n\n// ca-v3 storage adapter: packed view, conserved energy, persistent structure.\n@group(0) @binding(0) var<storage, read> grid_in: array<u32>;\n@group(0) @binding(1) var<storage, read_write> grid_out: array<u32>;\n@group(0) @binding(2) var<storage, read> cold_table: array<u32>;\n@group(0) @binding(3) var<storage, read> energy_in: array<u32>;\n@group(0) @binding(4) var<storage, read_write> energy_out: array<u32>;\n@group(0) @binding(5) var<storage, read> structure_in: array<u32>;\n@group(0) @binding(6) var<storage, read_write> structure_out: array<u32>;\n@group(0) @binding(7) var<storage, read> structural_plan: array<vec2<u32>>;\n\nconst MAX_ENERGY_Q: u32 = 0x3fffffffu;\nconst NO_MATERIAL: u32 = 256u;\nconst NO_CELL: u32 = 0xffffffffu;\n\nfn io_cold(material: u32, field: u32) -> u32 {\n    return cold_table[material * 24u + field];\n}\n\n// Same logical property layout as Thermodynamics.gpu_table(); this adapter\n// reads the authoritative cold table, so material edits need no shader rewrite.\nfn property(material: u32, field: u32) -> u32 {\n    switch field {\n        case 0u: { return io_cold(material, 1u); }\n        case 1u: { return io_cold(material, 19u) * 256u; }\n        case 2u: { return io_cold(material, 16u) * 256u; }\n        case 3u: {\n            let boil = io_cold(material, 13u);\n            if (boil != 0u) { return boil; }\n            let melt = io_cold(material, 12u);\n            return select(NO_MATERIAL, melt, melt != 0u);\n        }\n        case 4u: {\n            if (io_cold(material, 13u) != 0u) { return io_cold(material, 3u) * 256u; }\n            return io_cold(material, 2u) * 256u;\n        }\n        case 5u: {\n            let freeze = io_cold(material, 14u);\n            if (freeze != 0u) { return freeze; }\n            let condense = io_cold(material, 15u);\n            return select(NO_MATERIAL, condense, condense != 0u);\n        }\n        case 6u: {\n            if (io_cold(material, 14u) != 0u) { return io_cold(material, 8u) * 256u; }\n            return io_cold(material, 9u) * 256u;\n        }\n        case 7u: { return io_cold(material, 17u); }\n        case 8u: { return io_cold(material, 18u); }\n        case 9u: { return io_cold(material, 21u); }\n        case 10u: { return io_cold(material, 4u) * 256u; }\n        default: { return 0u; }\n    }\n}\n\nfn io_state(index: u32) -> vec2<u32> {\n    return vec2<u32>(grid_in[index] & MATERIAL_MASK, energy_in[index]);\n}\n\nfn io_copy(destination: u32, source: u32) {\n    grid_out[destination] = grid_in[source];\n    energy_out[destination] = energy_in[source];\n    structure_out[destination] = structure_in[source];\n}\n\nfn io_write(index: u32, packed: u32, energy: u32) {\n    let temperature = min(255u, temperature_q(vec2<u32>(packed & MATERIAL_MASK, energy)) / 256u);\n    grid_out[index] = (packed & 0xffff00ffu) | (temperature << THERMAL_SHIFT);\n    energy_out[index] = energy;\n    var word = 0u;\n    if (io_fluid(packed)) { word = structure_in[index] & STRUCTURE_PRESSURE_MASK; }\n    if (io_cohesive(packed)) {\n        word = structure_in[index];\n        if (!io_cohesive(grid_in[index]) || (packed & MATERIAL_MASK) != (grid_in[index] & MATERIAL_MASK)) {\n            word = STRUCTURE_INTEGRITY_MASK | STRUCTURE_FRESH_MASK;\n        }\n    }\n    structure_out[index] = word;\n}\n\nfn io_rewrite(packed: u32, material: u32) -> u32 {\n    return (packed & 0xf0ff0000u) | material | (io_cold(material, 20u) << PHASE_SHIFT);\n}\n\nfn io_cohesive(packed: u32) -> bool {\n    let phase = (packed >> PHASE_SHIFT) & PHASE_MASK;\n    return (phase == PHASE_SOLID || phase == PHASE_FROZEN) && io_cold(packed & MATERIAL_MASK, 22u) > 0u;\n}\n\nfn io_bound(index: u32) -> bool {\n    return io_cohesive(grid_in[index]) && (structure_in[index] & (STRUCTURE_INTEGRITY_MASK | STRUCTURE_ANCHOR_MASK)) != 0u;\n}\n\nfn io_fluid(packed: u32) -> bool {\n    let phase = (packed >> PHASE_SHIFT) & PHASE_MASK;\n    return phase == PHASE_GAS || phase == PHASE_PLASMA || phase == PHASE_LIQUID || phase == PHASE_VISCOUS || phase == PHASE_MOLTEN;\n}\n\nfn io_velocity(packed: u32, axis: u32) -> i32 {\n    let nibble = (packed >> (16u + axis * 4u)) & 15u;\n    return i32(nibble ^ 8u) - 8;\n}\n\nfn io_can_fall(source: u32, destination: u32) -> bool {\n    let phase = (grid_in[source] >> PHASE_SHIFT) & PHASE_MASK;\n    let matter = phase == PHASE_SOLID || phase == PHASE_FROZEN || phase == PHASE_POWDER || phase == PHASE_LIQUID || phase == PHASE_VISCOUS || phase == PHASE_MOLTEN;\n    return matter && !io_bound(source) && !io_bound(destination) && io_cold(grid_in[source] & MATERIAL_MASK, 0u) > io_cold(grid_in[destination] & MATERIAL_MASK, 0u);\n}\n\nfn io_apply_structure(index: u32) {\n    let source = structural_plan[index].x;\n    grid_out[index] = grid_in[source];\n    energy_out[index] = energy_in[source];\n    structure_out[index] = structural_plan[index].y;\n}\n\nfn io_normalize_structure(index: u32) {\n    grid_out[index] = grid_in[index];\n    energy_out[index] = energy_in[index];\n    var result = 0u;\n    if (io_fluid(grid_in[index])) { result = structure_in[index] & STRUCTURE_PRESSURE_MASK; }\n    if (io_cohesive(grid_in[index])) {\n        let word = structure_in[index];\n        result = word & (STRUCTURE_INTEGRITY_MASK | STRUCTURE_ANCHOR_MASK);\n        if ((word & STRUCTURE_INTEGRITY_MASK) != 0u) {\n            let x = index % GRID_WIDTH;\n            let y = index / GRID_WIDTH;\n            var adjacent = array<u32, 4>(NO_CELL, NO_CELL, NO_CELL, NO_CELL);\n            if (x > 0u) { adjacent[0] = index - 1u; }\n            if (x + 1u < GRID_WIDTH) { adjacent[1] = index + 1u; }\n            if (y > 0u) { adjacent[2] = index - GRID_WIDTH; }\n            if (y + 1u < GRID_HEIGHT) { adjacent[3] = index + GRID_WIDTH; }\n            let bits = array<u32, 4>(STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_RIGHT_MASK, STRUCTURE_BOND_UP_MASK, STRUCTURE_BOND_DOWN_MASK);\n            let reverse = array<u32, 4>(STRUCTURE_BOND_RIGHT_MASK, STRUCTURE_BOND_LEFT_MASK, STRUCTURE_BOND_DOWN_MASK, STRUCTURE_BOND_UP_MASK);\n            for (var direction = 0u; direction < 4u; direction = direction + 1u) {\n                let neighbor = adjacent[direction];\n                if (neighbor == NO_CELL) { continue; }\n                let other = structure_in[neighbor];\n                if (!io_cohesive(grid_in[neighbor]) || (other & STRUCTURE_INTEGRITY_MASK) == 0u) { continue; }\n                let retained = (word & bits[direction]) != 0u && (other & reverse[direction]) != 0u;\n                if (retained || ((word | other) & STRUCTURE_FRESH_MASK) != 0u) { result = result | bits[direction]; }\n            }\n        }\n    }\n    structure_out[index] = result;\n}\n\n// Shared integer energy law; property() is supplied by the storage adapter.\nfn temperature_q(state: vec2<u32>) -> u32 {\n    let heat = state.y - property(state.x, 2u);\n    let phase_energy = property(state.x, 1u);\n    var temperature = u32(max(0, i32(heat) - i32(phase_energy)));\n    let up = property(state.x, 3u);\n    let up_temperature = property(state.x, 4u);\n    let down = property(state.x, 5u);\n    let down_temperature = property(state.x, 6u);\n    if (up != NO_MATERIAL && heat >= phase_energy + up_temperature) {\n        temperature = u32(max(i32(up_temperature), i32(heat) - i32(property(up, 1u))));\n    } else if (down != NO_MATERIAL && heat <= phase_energy + down_temperature) {\n        temperature = min(down_temperature, u32(max(0, i32(heat) - i32(property(down, 1u)))));\n    }\n    return temperature;\n}\n\nfn phase_material(state: vec2<u32>) -> u32 {\n    let chemical = property(state.x, 2u);\n    let up = property(state.x, 3u);\n    if (up != NO_MATERIAL) {\n        let boundary = chemical + property(up, 1u) + property(state.x, 4u);\n        if (state.y >= boundary) { return up; }\n    }\n    let down = property(state.x, 5u);\n    if (down != NO_MATERIAL) {\n        let boundary = chemical + property(down, 1u) + property(state.x, 6u);\n        if (state.y <= boundary) { return down; }\n    }\n    return state.x;\n}\n\nfn pair_energy(a: vec2<u32>, b: vec2<u32>) -> u32 {\n    let temp_a = temperature_q(a);\n    let temp_b = temperature_q(b);\n    let ca = property(a.x, 0u);\n    let cb = property(b.x, 0u);\n    var conductivity = 0u;\n    if (ca + cb > 0u) { conductivity = 2u * ca * cb / (ca + cb); }\n    let difference = u32(abs(i32(temp_a) - i32(temp_b)));\n    // Avoid overflowing difference * conductivity in u32 arithmetic.\n    var flux = difference / 512u * conductivity + (difference % 512u * conductivity + 511u) / 512u;\n    flux = min(flux, difference / 2u);\n    if (temp_a > temp_b) {\n        flux = min(flux, min(a.y - property(a.x, 2u), MAX_ENERGY_Q - b.y));\n        return a.y - flux;\n    }\n    flux = min(flux, min(b.y - property(b.x, 2u), MAX_ENERGY_Q - a.y));\n    return a.y + flux;\n}\n\n\n";
const KERNEL_SOURCES = Object.freeze({
  "phase_2b_winner.wgsl": "// Conservative vertical matter gravity with phased symmetric density swaps.\n//\n// Movement is limited to disjoint row pairs selected by GRAVITY_PHASE, so a\n// cell can participate in at most one swap per pass and per-material counts are\n// preserved exactly. Gas is handled by separate buoyancy/spread passes.\n\n\nconst COLD_STRIDE: u32 = 24u;\nconst COLD_DENSITY: u32 = 0u;\noverride GRAVITY_PHASE: u32 = 0u;\n\nfn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }\nfn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }\nfn get_phase(p: u32) -> u32 { return (p >> PHASE_SHIFT) & PHASE_MASK; }\n\nfn density_of(mat: u32) -> u32 {\n    return cold_table[mat * COLD_STRIDE + COLD_DENSITY];\n}\n\nfn is_structural(ph: u32) -> bool {\n    return ph == PHASE_SOLID || ph == PHASE_FROZEN;\n}\n\nfn is_vertical_falling_matter(ph: u32) -> bool {\n    return ph == PHASE_SOLID\n        || ph == PHASE_FROZEN\n        || ph == PHASE_POWDER\n        || ph == PHASE_LIQUID\n        || ph == PHASE_VISCOUS\n        || ph == PHASE_MOLTEN;\n}\n\nfn should_swap(upper: u32, lower: u32) -> bool {\n    return io_can_fall(upper, lower);\n}\n\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    let x = gid.x;\n    let y = gid.y;\n    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }\n\n    let idx = get_idx(x, y);\n    let voxel = grid_in[idx];\n\n    if (y < GRID_HEIGHT - 1u && ((y & 1u) == GRAVITY_PHASE)) {\n        let below = grid_in[get_idx(x, y + 1u)];\n        if (should_swap(idx, get_idx(x, y + 1u))) {\n            io_copy(idx, get_idx(x, y + 1u));\n            return;\n        }\n    }\n\n    if (y > 0u && (((y - 1u) & 1u) == GRAVITY_PHASE)) {\n        let above = grid_in[get_idx(x, y - 1u)];\n        if (should_swap(get_idx(x, y - 1u), idx)) {\n            io_copy(idx, get_idx(x, y - 1u));\n            return;\n        }\n    }\n\n    io_copy(idx, idx);\n}\n",
  "phase_2b_diagonal_winner.wgsl": "// Conservative diagonal matter fall.\n//\n// Each pass partitions the grid into disjoint 2x2 cells. One diagonal edge in\n// each block is eligible, chosen by a deterministic hash and MOVE_SALT. This\n// preserves exact per-material counts without atomics.\n\n\nconst COLD_STRIDE: u32 = 24u;\nconst COLD_DENSITY: u32 = 0u;\noverride MOVE_PHASE: u32 = 0u;\noverride MOVE_SALT: u32 = 0u;\n\nfn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }\nfn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }\nfn get_phase(p: u32) -> u32 { return (p >> PHASE_SHIFT) & PHASE_MASK; }\n\nfn density_of(mat: u32) -> u32 {\n    return cold_table[mat * COLD_STRIDE + COLD_DENSITY];\n}\n\nfn is_structural(ph: u32) -> bool {\n    return ph == PHASE_SOLID || ph == PHASE_FROZEN;\n}\n\nfn is_falling_matter(ph: u32) -> bool {\n    return ph == PHASE_POWDER || ph == PHASE_LIQUID || ph == PHASE_VISCOUS || ph == PHASE_MOLTEN;\n}\n\nfn vertical_blocked(x: u32, y: u32, src: u32) -> bool {\n    if (y >= GRID_HEIGHT - 1u) { return true; }\n    return !io_can_fall(get_idx(x, y), get_idx(x, y + 1u));\n}\n\nfn hash_pair(x: u32, y: u32, salt: u32) -> u32 {\n    var h = x * 374761393u + y * 668265263u + salt * 1442695041u;\n    h = (h ^ (h >> 13u)) * 1274126177u;\n    return h ^ (h >> 16u);\n}\n\nfn should_swap(src_x: u32, src_y: u32, dst_x: u32, dst_y: u32) -> bool {\n    let src = grid_in[get_idx(src_x, src_y)];\n    let dst = grid_in[get_idx(dst_x, dst_y)];\n    return vertical_blocked(src_x, src_y, src) && io_can_fall(get_idx(src_x, src_y), get_idx(dst_x, dst_y));\n}\n\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    let x = gid.x;\n    let y = gid.y;\n    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }\n\n    let idx = get_idx(x, y);\n    let voxel = grid_in[idx];\n\n    var upper_y = y;\n    if ((y & 1u) != MOVE_PHASE) {\n        if (y == 0u) {\n            io_copy(idx, idx);\n            return;\n        }\n        upper_y = y - 1u;\n    }\n    if (upper_y >= GRID_HEIGHT - 1u) {\n        io_copy(idx, idx);\n        return;\n    }\n\n    let pair_left = x - (x & 1u);\n    if (pair_left >= GRID_WIDTH - 1u) {\n        io_copy(idx, idx);\n        return;\n    }\n\n    let prefer_right = (hash_pair(pair_left, upper_y, MOVE_SALT) & 1u) == 0u;\n    let src_x = select(pair_left + 1u, pair_left, prefer_right);\n    let dst_x = select(pair_left, pair_left + 1u, prefer_right);\n    let src_y = upper_y;\n    let dst_y = upper_y + 1u;\n    let do_swap = should_swap(src_x, src_y, dst_x, dst_y);\n\n    if (do_swap && x == src_x && y == src_y) {\n        io_copy(idx, get_idx(dst_x, dst_y));\n        return;\n    }\n    if (do_swap && x == dst_x && y == dst_y) {\n        io_copy(idx, get_idx(src_x, src_y));\n        return;\n    }\n\n    io_copy(idx, idx);\n}\n",
  "phase_2b_liquid_winner.wgsl": "// Conservative horizontal liquid spread.\n//\n// Each pass partitions rows into disjoint horizontal pairs. Direction is chosen\n// by a deterministic coordinate hash plus MOVE_SALT to avoid global drift.\n\n\nconst COLD_STRIDE: u32 = 24u;\nconst COLD_DENSITY: u32 = 0u;\noverride MOVE_PHASE: u32 = 0u;\noverride MOVE_SALT: u32 = 0u;\n\nfn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }\nfn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }\nfn get_phase(p: u32) -> u32 { return (p >> PHASE_SHIFT) & PHASE_MASK; }\n\nfn density_of(mat: u32) -> u32 {\n    return cold_table[mat * COLD_STRIDE + COLD_DENSITY];\n}\n\nfn is_structural(ph: u32) -> bool {\n    return ph == PHASE_SOLID || ph == PHASE_FROZEN;\n}\n\nfn is_liquid_like(ph: u32) -> bool {\n    return ph == PHASE_LIQUID || ph == PHASE_VISCOUS || ph == PHASE_MOLTEN;\n}\n\nfn is_falling_matter(ph: u32) -> bool {\n    return ph == PHASE_POWDER || ph == PHASE_LIQUID || ph == PHASE_VISCOUS || ph == PHASE_MOLTEN;\n}\n\nfn has_down_or_diagonal_fall(x: u32, y: u32, src: u32) -> bool {\n    if (y >= GRID_HEIGHT - 1u) { return false; }\n    if (io_can_fall(get_idx(x, y), get_idx(x, y + 1u))) { return true; }\n    if (x > 0u && io_can_fall(get_idx(x, y), get_idx(x - 1u, y + 1u))) { return true; }\n    if (x < GRID_WIDTH - 1u && io_can_fall(get_idx(x, y), get_idx(x + 1u, y + 1u))) { return true; }\n    return false;\n}\n\nfn can_spread_into(src: u32, dst: u32) -> bool {\n    if (!is_liquid_like(get_phase(src)) || is_structural(get_phase(dst))) {\n        return false;\n    }\n    let dst_phase = get_phase(dst);\n    if (dst_phase != PHASE_GAS && get_material(dst) != MAT_AIR) {\n        return false;\n    }\n    return density_of(get_material(src)) > density_of(get_material(dst));\n}\n\nfn hash_pair(x: u32, y: u32, salt: u32) -> u32 {\n    var h = x * 374761393u + y * 668265263u + salt * 1442695041u;\n    h = (h ^ (h >> 13u)) * 1274126177u;\n    return h ^ (h >> 16u);\n}\n\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    let x = gid.x;\n    let y = gid.y;\n    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }\n\n    let idx = get_idx(x, y);\n    let voxel = grid_in[idx];\n\n    var pair_left = x;\n    if (((x + MOVE_PHASE) & 1u) != 0u) {\n        if (x == 0u) {\n            io_copy(idx, idx);\n            return;\n        }\n        pair_left = x - 1u;\n    }\n    if (pair_left >= GRID_WIDTH - 1u) {\n        io_copy(idx, idx);\n        return;\n    }\n\n    let left = grid_in[get_idx(pair_left, y)];\n    let right = grid_in[get_idx(pair_left + 1u, y)];\n    let left_can = !has_down_or_diagonal_fall(pair_left, y, left) && can_spread_into(left, right);\n    let right_can = !has_down_or_diagonal_fall(pair_left + 1u, y, right) && can_spread_into(right, left);\n    let source_left = select(\n        left_can,\n        (hash_pair(pair_left, y, MOVE_SALT) & 1u) == 0u,\n        left_can && right_can,\n    );\n    let src_x = select(pair_left + 1u, pair_left, source_left);\n    let dst_x = select(pair_left, pair_left + 1u, source_left);\n    let src = select(right, left, source_left);\n    let dst = select(left, right, source_left);\n    let do_swap = left_can || right_can;\n\n    if (do_swap && x == src_x) {\n        io_copy(idx, get_idx(dst_x, y));\n        return;\n    }\n    if (do_swap && x == dst_x) {\n        io_copy(idx, get_idx(src_x, y));\n        return;\n    }\n\n    io_copy(idx, idx);\n}\n",
  "phase_2b_gas_buoyancy_winner.wgsl": "// Conservative thermal gas buoyancy.\n//\n// Non-air gas/plasma can rise through air or other gas when its thermal\n// buoyancy rank is sufficiently higher than the upper target.\n\n\nconst COLD_STRIDE: u32 = 24u;\nconst COLD_DENSITY: u32 = 0u;\nconst GAS_RISE_THRESHOLD: i32 = 16;\noverride MOVE_PHASE: u32 = 0u;\n\nfn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }\nfn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }\nfn get_thermal(p: u32) -> u32 { return (p >> THERMAL_SHIFT) & THERMAL_MASK; }\nfn get_phase(p: u32) -> u32 { return (p >> PHASE_SHIFT) & PHASE_MASK; }\n\nfn density_of(mat: u32) -> u32 {\n    return cold_table[mat * COLD_STRIDE + COLD_DENSITY];\n}\n\nfn is_structural(ph: u32) -> bool {\n    return ph == PHASE_SOLID || ph == PHASE_FROZEN;\n}\n\nfn is_gas_like(ph: u32) -> bool {\n    return ph == PHASE_GAS || ph == PHASE_PLASMA;\n}\n\nfn gas_rank(index: u32) -> i32 {\n    let v = grid_in[index];\n    return i32(temperature_q(io_state(index)) / 256u) * 2 - i32(density_of(get_material(v)));\n}\n\nfn can_rise(src_idx: u32, dst_idx: u32) -> bool {\n    let src = grid_in[src_idx];\n    let dst = grid_in[dst_idx];\n    let src_mat = get_material(src);\n    let src_phase = get_phase(src);\n    let dst_phase = get_phase(dst);\n    if (src_mat == MAT_AIR || !is_gas_like(src_phase) || is_structural(dst_phase)) {\n        return false;\n    }\n    if (get_material(dst) != MAT_AIR && !is_gas_like(dst_phase)) {\n        return false;\n    }\n    return gas_rank(src_idx) > gas_rank(dst_idx) + GAS_RISE_THRESHOLD;\n}\n\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    let x = gid.x;\n    let y = gid.y;\n    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }\n\n    let idx = get_idx(x, y);\n    let voxel = grid_in[idx];\n\n    if (y < GRID_HEIGHT - 1u && ((y & 1u) == MOVE_PHASE)) {\n        let lower = grid_in[get_idx(x, y + 1u)];\n        if (can_rise(get_idx(x, y + 1u), idx)) {\n            io_copy(idx, get_idx(x, y + 1u));\n            return;\n        }\n    }\n\n    if (y > 0u && (((y - 1u) & 1u) == MOVE_PHASE)) {\n        let upper = grid_in[get_idx(x, y - 1u)];\n        if (can_rise(idx, get_idx(x, y - 1u))) {\n            io_copy(idx, get_idx(x, y - 1u));\n            return;\n        }\n    }\n\n    io_copy(idx, idx);\n}\n",
  "phase_2b_gas_spread_winner.wgsl": "// Conservative horizontal gas spread.\n//\n// Non-air gas/plasma spreads sideways through air/gas when upward buoyancy is\n// blocked. Pair ownership is disjoint and salted to avoid one-way drift.\n\n\nconst COLD_STRIDE: u32 = 24u;\nconst COLD_DENSITY: u32 = 0u;\nconst GAS_RISE_THRESHOLD: i32 = 16;\noverride MOVE_PHASE: u32 = 0u;\noverride MOVE_SALT: u32 = 0u;\n\nfn get_idx(x: u32, y: u32) -> u32 { return y * GRID_WIDTH + x; }\nfn get_material(p: u32) -> u32 { return (p >> MATERIAL_SHIFT) & MATERIAL_MASK; }\nfn get_thermal(p: u32) -> u32 { return (p >> THERMAL_SHIFT) & THERMAL_MASK; }\nfn get_phase(p: u32) -> u32 { return (p >> PHASE_SHIFT) & PHASE_MASK; }\n\nfn density_of(mat: u32) -> u32 {\n    return cold_table[mat * COLD_STRIDE + COLD_DENSITY];\n}\n\nfn is_structural(ph: u32) -> bool {\n    return ph == PHASE_SOLID || ph == PHASE_FROZEN;\n}\n\nfn is_gas_like(ph: u32) -> bool {\n    return ph == PHASE_GAS || ph == PHASE_PLASMA;\n}\n\nfn gas_rank(index: u32) -> i32 {\n    let v = grid_in[index];\n    return i32(temperature_q(io_state(index)) / 256u) * 2 - i32(density_of(get_material(v)));\n}\n\nfn can_rise_into(src_idx: u32, dst_idx: u32) -> bool {\n    let src = grid_in[src_idx];\n    let dst = grid_in[dst_idx];\n    if (get_material(src) == MAT_AIR || !is_gas_like(get_phase(src)) || is_structural(get_phase(dst))) {\n        return false;\n    }\n    if (get_material(dst) != MAT_AIR && !is_gas_like(get_phase(dst))) {\n        return false;\n    }\n    return gas_rank(src_idx) > gas_rank(dst_idx) + GAS_RISE_THRESHOLD;\n}\n\nfn upward_blocked(x: u32, y: u32, src: u32) -> bool {\n    if (y == 0u) { return true; }\n    return !can_rise_into(get_idx(x, y), get_idx(x, y - 1u));\n}\n\nfn can_spread_into(src_idx: u32, dst_idx: u32) -> bool {\n    let src = grid_in[src_idx];\n    let dst = grid_in[dst_idx];\n    if (get_material(src) == MAT_AIR || !is_gas_like(get_phase(src)) || is_structural(get_phase(dst))) {\n        return false;\n    }\n    if (get_material(dst) == MAT_AIR) {\n        return true;\n    }\n    if (!is_gas_like(get_phase(dst))) {\n        return false;\n    }\n    return gas_rank(src_idx) > gas_rank(dst_idx) + GAS_RISE_THRESHOLD;\n}\n\nfn hash_pair(x: u32, y: u32, salt: u32) -> u32 {\n    var h = x * 374761393u + y * 668265263u + salt * 1442695041u;\n    h = (h ^ (h >> 13u)) * 1274126177u;\n    return h ^ (h >> 16u);\n}\n\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    let x = gid.x;\n    let y = gid.y;\n    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }\n\n    let idx = get_idx(x, y);\n    let voxel = grid_in[idx];\n\n    var pair_left = x;\n    if (((x + MOVE_PHASE) & 1u) != 0u) {\n        if (x == 0u) {\n            io_copy(idx, idx);\n            return;\n        }\n        pair_left = x - 1u;\n    }\n    if (pair_left >= GRID_WIDTH - 1u) {\n        io_copy(idx, idx);\n        return;\n    }\n\n    let source_left = (hash_pair(pair_left, y, MOVE_SALT) & 1u) == 0u;\n    let src_x = select(pair_left + 1u, pair_left, source_left);\n    let dst_x = select(pair_left, pair_left + 1u, source_left);\n    let src = grid_in[get_idx(src_x, y)];\n    let dst = grid_in[get_idx(dst_x, y)];\n    let do_swap = upward_blocked(src_x, y, src) && can_spread_into(get_idx(src_x, y), get_idx(dst_x, y));\n\n    if (do_swap && x == src_x) {\n        io_copy(idx, get_idx(dst_x, y));\n        return;\n    }\n    if (do_swap && x == dst_x) {\n        io_copy(idx, get_idx(src_x, y));\n        return;\n    }\n\n    io_copy(idx, idx);\n}\n",
  "phase_2a_winner.wgsl": "// ca-v2: finite heat exchange across disjoint cardinal pairs.\noverride THERMAL_AXIS: u32 = 0u;\noverride THERMAL_PARITY: u32 = 0u;\n\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }\n    let index = gid.y * GRID_WIDTH + gid.x;\n    let coordinate = select(gid.x, gid.y, THERMAL_AXIS == 1u);\n    let extent = select(GRID_WIDTH, GRID_HEIGHT, THERMAL_AXIS == 1u);\n    let stride = select(1u, GRID_WIDTH, THERMAL_AXIS == 1u);\n    var energy = energy_in[index];\n    if (coordinate >= THERMAL_PARITY) {\n        if ((coordinate - THERMAL_PARITY) % 2u == 0u) {\n            if (coordinate + 1u < extent) { energy = pair_energy(io_state(index), io_state(index + stride)); }\n        } else {\n            energy = pair_energy(io_state(index), io_state(index - stride));\n        }\n    }\n    io_write(index, grid_in[index], energy);\n}\n",
  "phase_2c_winner.wgsl": "// ca-v2: phase changes preserve the complete energy coordinate.\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }\n    let index = gid.y * GRID_WIDTH + gid.x;\n    let material = phase_material(io_state(index));\n    var packed = grid_in[index];\n    if (material != (packed & MATERIAL_MASK)) { packed = io_rewrite(packed, material); }\n    io_write(index, packed, energy_in[index]);\n}\n",
  "phase_2d_winner.wgsl": "// ca-v2: conserved, mutually owned fuel/oxidizer reactions.\nfn neighbor(index: u32, order: u32) -> u32 {\n    let x = index % GRID_WIDTH;\n    let y = index / GRID_WIDTH;\n    var directions = array<u32, 4>(2u, 1u, 3u, 0u);\n    if ((x + y) % 2u != 0u) { directions = array<u32, 4>(0u, 2u, 1u, 3u); }\n    let direction = directions[order];\n    if (direction == 0u && x > 0u) { return index - 1u; }\n    if (direction == 1u && x + 1u < GRID_WIDTH) { return index + 1u; }\n    if (direction == 2u && y > 0u) { return index - GRID_WIDTH; }\n    if (direction == 3u && y + 1u < GRID_HEIGHT) { return index + GRID_WIDTH; }\n    return NO_CELL;\n}\n\nfn burning(state: vec2<u32>) -> bool {\n    return property(state.x, 2u) > 0u && temperature_q(state) > property(state.x, 10u);\n}\n\nfn chosen_air(index: u32) -> u32 {\n    if (!burning(io_state(index))) { return NO_CELL; }\n    for (var order = 0u; order < 4u; order += 1u) {\n        let candidate = neighbor(index, order);\n        if (candidate != NO_CELL) {\n            if (property(io_state(candidate).x, 9u) == 1u) { return candidate; }\n        }\n    }\n    return NO_CELL;\n}\n\nfn chosen_fuel(index: u32) -> u32 {\n    for (var order = 0u; order < 4u; order += 1u) {\n        let candidate = neighbor(index, order);\n        if (candidate != NO_CELL) {\n            if (chosen_air(candidate) == index) { return candidate; }\n        }\n    }\n    return NO_CELL;\n}\n\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }\n    let index = gid.y * GRID_WIDTH + gid.x;\n    let state = io_state(index);\n    var packed = grid_in[index];\n    var energy = state.y;\n    if (burning(state)) {\n        let air = chosen_air(index);\n        if (air != NO_CELL) {\n            if (chosen_fuel(air) == index) {\n                let transfer = min(property(state.x, 2u) / 2u, MAX_ENERGY_Q - energy_in[air]);\n                packed = io_rewrite(packed, property(state.x, 7u));\n                energy = state.y - transfer;\n            }\n        }\n    } else if (property(state.x, 9u) == 1u) {\n        let fuel = chosen_fuel(index);\n        if (fuel != NO_CELL) {\n            let transfer = min(property(io_state(fuel).x, 2u) / 2u, MAX_ENERGY_Q - state.y);\n            packed = io_rewrite(packed, property(io_state(fuel).x, 8u));\n            energy = state.y + transfer;\n        }\n    } else if (state.x == MAT_FIRE) {\n        // Fire marks a local reaction. Its finite heat survives as smoke when\n        // fuel is absent, it cools, or liquid water interrupts the flame.\n        var fuel_near = false;\n        var water_near = false;\n        for (var order = 0u; order < 4u; order += 1u) {\n            let candidate = neighbor(index, order);\n            if (candidate != NO_CELL) {\n                fuel_near = fuel_near || property(io_state(candidate).x, 2u) > 0u;\n                water_near = water_near || io_state(candidate).x == MAT_WATER;\n            }\n        }\n        if (!fuel_near || water_near || temperature_q(state) < 80u * 256u) {\n            packed = io_rewrite(packed, MAT_SMOKE);\n        }\n    }\n    io_write(index, packed, energy);\n}\n",
  "phase_2f_impulse.wgsl": "// Integer pressure impulse. Mechanical damping is separate from thermal energy.\nfn face_pressure(index: u32, other: u32, head: i32) -> i32 {\n    let own = i32(structure_in[index] >> 16u);\n    if (other == NO_CELL || !io_fluid(grid_in[other])) { return own; }\n    return i32(structure_in[other] >> 16u) + head;\n}\n\nfn impulse_velocity(previous: i32, force: i32) -> i32 {\n    // Unit drag; truncation toward zero is identical in WGSL/CPU.\n    return clamp(previous - sign(previous) + clamp(force / 64, -4, 4), -4, 4);\n}\n\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    let x = gid.x; let y = gid.y;\n    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }\n    let i = y * GRID_WIDTH + x;\n    io_copy(i, i);\n    var velocity = vec2<i32>(0, 0);\n    if (!io_bound(i)) {\n        let voxel = grid_in[i];\n        let phase = (voxel >> PHASE_SHIFT) & PHASE_MASK;\n        var head = 0;\n        if (phase == PHASE_LIQUID || phase == PHASE_VISCOUS || phase == PHASE_MOLTEN) {\n            head = i32(max(1u, (io_cold(voxel & MATERIAL_MASK, 0u) + 63u) / 64u) * 16u);\n        }\n        var adjacent = array<u32, 4>(NO_CELL, NO_CELL, NO_CELL, NO_CELL);\n        if (x > 0u) { adjacent[0] = i - 1u; }\n        if (x + 1u < GRID_WIDTH) { adjacent[1] = i + 1u; }\n        if (y > 0u) { adjacent[2] = i - GRID_WIDTH; }\n        if (y + 1u < GRID_HEIGHT) { adjacent[3] = i + GRID_WIDTH; }\n        let fx = face_pressure(i, adjacent[0], 0) - face_pressure(i, adjacent[1], 0);\n        let fy = face_pressure(i, adjacent[2], head) - face_pressure(i, adjacent[3], -head);\n        velocity = vec2<i32>(impulse_velocity(io_velocity(voxel, 0u), fx), impulse_velocity(io_velocity(voxel, 1u), fy));\n    }\n    grid_out[i] = (grid_in[i] & 0xff00ffffu) | ((u32(velocity.x & 15)) << 16u) | ((u32(velocity.y & 15)) << 20u);\n}\n",
  "phase_2f_velocity.wgsl": "// Disjoint pair exchange; pending MOVED bounds each axis to one cell/tick.\noverride MOVE_AXIS: u32 = 0u;\noverride MOVE_PHASE: u32 = 0u;\noverride MOVE_SALT: u32 = 0u;\n\nfn velocity_request(source: u32, destination: u32, direction: i32) -> bool {\n    return !io_bound(source) && !io_bound(destination) && io_fluid(grid_in[destination])\n        && io_velocity(grid_in[source], MOVE_AXIS) * direction > i32(MOVE_SALT);\n}\n\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    let x = gid.x; let y = gid.y;\n    if (x >= GRID_WIDTH || y >= GRID_HEIGHT) { return; }\n    let i = y * GRID_WIDTH + x;\n    let coordinate = select(x, y, MOVE_AXIS == 1u);\n    let extent = select(GRID_WIDTH, GRID_HEIGHT, MOVE_AXIS == 1u);\n    let stride = select(1u, GRID_WIDTH, MOVE_AXIS == 1u);\n    let second = ((coordinate + MOVE_PHASE) & 1u) != 0u;\n    var source = i; var moved = false;\n    if (!(second && coordinate == 0u)) {\n        let first_coordinate = coordinate - select(0u, 1u, second);\n        if (first_coordinate + 1u < extent) {\n            let a = i - select(0u, stride, second); let b = a + stride;\n            if (((structure_in[a] | structure_in[b]) & STRUCTURE_MOVED_MASK) == 0u\n                && (velocity_request(a, b, 1) || velocity_request(b, a, -1))) {\n                source = select(b, a, second); moved = true;\n            }\n        }\n    }\n    io_copy(i, source);\n    if (MOVE_PHASE == 1u) { structure_out[i] = structure_in[source] & ~STRUCTURE_MOVED_MASK; }\n    else if (moved) { structure_out[i] = structure_in[source] | STRUCTURE_MOVED_MASK; }\n}\n",
  "phase_2e_structure.wgsl": "// Apply the host's globally connected, validated structural plan.\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }\n    io_apply_structure(gid.y * GRID_WIDTH + gid.x);\n}\n",
  "phase_2e_normalize.wgsl": "// Close the tick with reciprocal bonds and no pending solidification requests.\n@compute @workgroup_size(16, 16)\nfn tick(@builtin(global_invocation_id) gid: vec3<u32>) {\n    if (gid.x >= GRID_WIDTH || gid.y >= GRID_HEIGHT) { return; }\n    io_normalize_structure(gid.y * GRID_WIDTH + gid.x);\n}\n"
});
class WebGpuField extends FieldState {
  backendInfo;
  #device;
  #pipelines;
  #buffers;
  #groups;
  #staging;
  #readback;
  #planUpload;
  #transport;
  #loss;
  #resident = 0;
  // A regular property is safe to invalidate from FieldState's constructor,
  // before this class's private fields have been initialized.
  uploadState = true;
  stateChanged() {
    this.uploadState = true;
  }
  constructor(width, height, fill, registry, device, layout, pipelines, info) {
    super(width, height, fill, registry);
    this.#device = device;
    this.#pipelines = pipelines;
    this.backendInfo = Object.freeze(info);
    const bytes = width * height * 4;
    this.#readback = { grid: new Uint32Array(width * height), energyQ: new Uint32Array(width * height), structure: new Uint32Array(width * height) };
    this.#planUpload = new Uint32Array(width * height * 2);
    this.#transport = { sources: new Uint32Array(width * height), structure: new Uint32Array(width * height) };
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST;
    this.#buffers = Array.from({ length: 6 }, () => device.createBuffer({ size: bytes, usage }));
    const cold = device.createBuffer({ size: this.coldTable.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.#buffers.push(cold);
    device.queue.writeBuffer(cold, 0, this.coldTable.buffer);
    const plan = device.createBuffer({ size: bytes * 2, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    this.#buffers.push(plan);
    this.#staging = device.createBuffer({ size: bytes * 3, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.#buffers.push(this.#staging);
    const [a, b, ea, eb, sa, sb] = this.#buffers;
    this.#groups = [[a, b, cold, ea, eb, sa, sb, plan], [b, a, cold, eb, ea, sb, sa, plan]].map((buffers) => device.createBindGroup({
      layout,
      entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } }))
    }));
    void device.lost.then((info2) => {
      this.#loss = info2.message || info2.reason;
    });
  }
  close() {
    if (this.closed) return;
    super.close();
    for (const buffer of this.#buffers) buffer.destroy();
    this.#pipelines.clear();
    this.#device.destroy();
  }
  async #readState(current, encoder = this.#device.createCommandEncoder(), owned, finishScope) {
    const bytes = this.width * this.height * 4;
    encoder.copyBufferToBuffer(this.#buffers[current], 0, this.#staging, 0, bytes);
    encoder.copyBufferToBuffer(this.#buffers[current + 2], 0, this.#staging, bytes, bytes);
    encoder.copyBufferToBuffer(this.#buffers[current + 4], 0, this.#staging, bytes * 2, bytes);
    this.#device.queue.submit([encoder.finish()]);
    globalThis.__tickMarks?.push(["submitted", performance.now()]);
    performance.mark("stage:submitted");
    const mapping = this.#staging.mapAsync(GPUMapMode.READ);
    mapping.then(() => {
      globalThis.__tickMarks?.push(["mapped", performance.now()]);
      performance.mark("stage:mapped");
    }, () => {
    });
    const validation = finishScope?.();
    try {
      const [mapped, checked] = await Promise.allSettled([mapping, validation]);
      if (mapped.status === "rejected") throw mapped.reason;
      if (checked.status === "rejected") throw checked.reason;
      if (checked.value) throw new Error(checked.value.message);
      const range = this.#staging.getMappedRange();
      if (owned) {
        owned.grid.set(new Uint32Array(range, 0, bytes / 4));
        owned.energyQ.set(new Uint32Array(range, bytes, bytes / 4));
        owned.structure.set(new Uint32Array(range, bytes * 2, bytes / 4));
        return owned;
      }
      return { grid: new Uint32Array(range.slice(0, bytes)), energyQ: new Uint32Array(range.slice(bytes, bytes * 2)), structure: new Uint32Array(range.slice(bytes * 2, bytes * 3)) };
    } finally {
      if (this.#staging.mapState === "mapped") this.#staging.unmap();
      globalThis.__tickMarks?.push(["copied", performance.now()]);
      performance.mark("stage:copied");
    }
  }
  async step(ticks = 1, options = {}) {
    this.ensureAvailable();
    checkedInteger(ticks, 0, Number.MAX_SAFE_INTEGER - this.tickCount, "ticks");
    const requestedInspect = options.inspect;
    if (requestedInspect !== void 0 && typeof requestedInspect !== "boolean") throw new Error("inspect must be a boolean.");
    const inspect = requestedInspect === true;
    if (this.#loss !== void 0) throw new Error(`WebGPU device lost: ${this.#loss}`);
    if (ticks === 0) return Object.freeze([]);
    this.busy = true;
    this.#device.pushErrorScope("validation");
    let scopeOpen = true;
    const finishScope = () => {
      const result = this.#device.popErrorScope();
      scopeOpen = false;
      result.then(() => {
        globalThis.__tickMarks?.push(["scope", performance.now()]);
        performance.mark("stage:scope");
      }, () => {
      });
      return result;
    };
    try {
      let current = this.#resident;
      if (this.uploadState) {
        this.#device.queue.writeBuffer(this.#buffers[current], 0, this.cells.buffer);
        this.#device.queue.writeBuffer(this.#buffers[current + 2], 0, this.energies.buffer);
        this.#device.queue.writeBuffer(this.#buffers[current + 4], 0, this.bonds.buffer);
      }
      this.uploadState = true;
      let before = { grid: this.cells, energyQ: this.energies, structure: this.bonds };
      const reports = [];
      for (let offset = 0; offset < ticks; offset += 1) {
        if (!inspect) compiledTransportInto(before, this.width, this.height, this.registry, this.#transport.sources, this.#transport.structure);
        globalThis.__tickMarks?.push(["planned", performance.now()]);
        performance.mark("stage:planned");
        const structuralPlan = inspect ? planStructure(before, this.width, this.height, rulesForRegistry(this.registry)) : this.#transport;
        const upload = this.#planUpload;
        for (let i = 0; i < structuralPlan.sources.length; i += 1) {
          upload[i * 2] = structuralPlan.sources[i];
          upload[i * 2 + 1] = structuralPlan.structure[i];
        }
        this.#device.queue.writeBuffer(this.#buffers[7], 0, upload);
        globalThis.__tickMarks?.push(["uploaded", performance.now()]);
        performance.mark("stage:uploaded");
        let encoder = this.#device.createCommandEncoder();
        const batch = inspect ? void 0 : encoder.beginComputePass();
        const schedule = movementScheduleForTick(this.tickCount + offset);
        for (let passIndex = 0; passIndex < schedule.length; passIndex += 1) {
          const passId = schedule[passIndex];
          const pass = batch ?? encoder.beginComputePass();
          pass.setPipeline(this.#pipelines.get(passId));
          pass.setBindGroup(0, this.#groups[current]);
          pass.dispatchWorkgroups(Math.ceil(this.width / 16), Math.ceil(this.height / 16));
          if (inspect) pass.end();
          current = 1 - current;
          if (inspect) {
            this.#device.queue.submit([encoder.finish()]);
            const after = await this.#readState(
              current,
              void 0,
              void 0,
              offset === ticks - 1 && passIndex === schedule.length - 1 ? finishScope : void 0
            );
            reports.push(inspectPass(
              before,
              after,
              this.coldTable,
              this.tickCount + offset,
              passId,
              passId === "structure" ? structuralPlan : void 0
            ));
            before = after;
            encoder = this.#device.createCommandEncoder();
          }
        }
        if (!inspect) {
          batch.end();
          before = await this.#readState(current, encoder, this.#readback, offset === ticks - 1 ? finishScope : void 0);
          before = validateOwnedStructure(before, this.width, this.height, this.registry);
          globalThis.__tickMarks?.push(["validated", performance.now()]);
          performance.mark("stage:validated");
        }
      }
      const state = before;
      if (inspect) this.commitState(state, this.tickCount + ticks);
      else {
        this.#readback = { grid: this.cells, energyQ: this.energies, structure: this.bonds };
        this.adoptState(state, this.tickCount + ticks);
      }
      this.#resident = current;
      this.uploadState = false;
      return Object.freeze(reports);
    } finally {
      try {
        if (scopeOpen) await this.#device.popErrorScope();
      } finally {
        this.busy = false;
      }
    }
  }
}
async function createGpuField(width, height, options = {}) {
  const cells = validateDimensions(width, height);
  const registry = options.registry === void 0 ? DEFAULT_REGISTRY : options.registry;
  const fill = options.fillMaterial === void 0 ? 0 : options.fillMaterial;
  requireRegistry(registry);
  registry.material(fill);
  if (typeof navigator === "undefined" || !navigator.gpu) throw new Error("WebGPU is unavailable; use createStateSpaceField for the CPU backend.");
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) throw new Error("No WebGPU adapter is available.");
  const device = await adapter.requestDevice();
  try {
    if (cells * 8 > device.limits.maxStorageBufferBindingSize || cells * 12 > device.limits.maxBufferSize || Math.max(Math.ceil(width / 16), Math.ceil(height / 16)) > device.limits.maxComputeWorkgroupsPerDimension) {
      throw new Error("Grid exceeds the WebGPU device allocation or dispatch limits.");
    }
    const layout = device.createBindGroupLayout({ entries: [0, 1, 2, 3, 4, 5, 6, 7].map((binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type: [1, 4, 6].includes(binding) ? "storage" : "read-only-storage" }
    })) });
    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
    const modules = /* @__PURE__ */ new Map();
    const pipelines = /* @__PURE__ */ new Map();
    for (const spec of KERNEL_SPECS) {
      let module = modules.get(spec.source_file);
      if (!module) {
        module = device.createShaderModule({ code: COMMON_SHADER + KERNEL_SOURCES[spec.source_file] });
        modules.set(spec.source_file, module);
      }
      const constants = { GRID_WIDTH: width, GRID_HEIGHT: height };
      for (const [name, value] of Object.entries(spec.constants)) {
        if (typeof value !== "number") throw new Error(`Invalid generated pipeline constant: ${name}`);
        constants[name] = value;
      }
      pipelines.set(spec.id, await device.createComputePipelineAsync({
        layout: pipelineLayout,
        compute: { module, entryPoint: "tick", constants }
      }));
    }
    const info = adapter.info;
    return new WebGpuField(
      width,
      height,
      fill,
      registry,
      device,
      layout,
      pipelines,
      { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: info.isFallbackAdapter }
    );
  } catch (error) {
    device.destroy();
    throw error;
  }
}
export {
  DEFAULT_REGISTRY,
  ENERGY_SCALE,
  FLAG,
  MAT,
  MAX_ENERGY_Q,
  PHASE,
  RULES_VERSION,
  SCHEMA_VERSION,
  STRUCTURE_BOND_DOWN_MASK,
  STRUCTURE_BOND_LEFT_MASK,
  STRUCTURE_BOND_RIGHT_MASK,
  STRUCTURE_BOND_UP_MASK,
  STRUCTURE_PRESSURE_MASK,
  createGpuField,
  createMaterialRegistry,
  createPhysicsState,
  createStateSpaceField,
  defaultPhase,
  defaultThermal,
  materialName,
  packVoxel,
  unpackVoxel,
  validateSnapshot
};
