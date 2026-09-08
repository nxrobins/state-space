"""Small synthetic materials for testing laws independently of catalog tuning."""

import engine.enthalpy as law


AIR, ICE, WATER, STEAM, METAL, WOOD, OIL, OIL_VAPOR, ASH, SMOKE, STONE, LAVA = range(12)


def model(api=law):
    q = api.ENERGY_SCALE
    material, transition = api.ThermalMaterial, api.Transition
    return api.Thermodynamics([
        material(AIR, conductivity=40, oxidizer=True),
        material(ICE, conductivity=200, up=transition(WATER, 30 * q)),
        material(WATER, conductivity=180, phase_energy_q=15 * q,
                 up=transition(STEAM, 100 * q), down=transition(ICE, 25 * q)),
        material(STEAM, conductivity=90, phase_energy_q=55 * q, down=transition(WATER, 90 * q)),
        material(METAL, conductivity=255),
        material(WOOD, conductivity=60, chemical_energy_q=80 * q, burns_into=ASH, gas_product=SMOKE, flash_q=150 * q),
        material(OIL, conductivity=50, chemical_energy_q=150 * q, burns_into=ASH, gas_product=SMOKE, flash_q=120 * q,
                 up=transition(OIL_VAPOR, 80 * q)),
        material(OIL_VAPOR, conductivity=30, phase_energy_q=30 * q, chemical_energy_q=150 * q,
                 burns_into=ASH, gas_product=SMOKE, flash_q=100 * q, down=transition(OIL, 70 * q)),
        material(ASH, conductivity=50),
        material(SMOKE, conductivity=40),
        material(STONE, conductivity=100, up=transition(LAVA, 220 * q)),
        material(LAVA, conductivity=100, phase_energy_q=30 * q, down=transition(STONE, 210 * q)),
    ])
