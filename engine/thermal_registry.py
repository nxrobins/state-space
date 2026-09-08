"""Adapt the authoritative material properties to the validated energy law."""

from engine.enthalpy import ENERGY_SCALE, ThermalMaterial, Thermodynamics, Transition


def thermodynamics_from_catalog(catalog: dict) -> Thermodynamics:
    records = []
    by_id = {r["id"]: r for r in catalog["materials"]}
    for record in catalog["materials"]:
        props = record["properties"]
        if props["oxidizer"] not in (0, 1):
            raise ValueError("oxidizer must be 0 or 1")
        up = [(target, threshold, latent) for target, threshold, latent in (
            ("boils_into", "boil_point", "latent_heat_boil"), ("melts_into", "melt_point", "latent_heat_melt")) if props[target]]
        down = [(target, threshold) for target, threshold in (
            ("freezes_into", "freeze_point"), ("condenses_into", "condense_point")) if props[target]]
        if len(up) > 1 or len(down) > 1:
            raise ValueError("A material can have at most one upward and one downward phase interval")
        for target, _, latent in up:
            difference = by_id[props[target]]["properties"]["phase_energy"] - props["phase_energy"]
            if difference != props[latent]:
                raise ValueError("Declared latent heat must equal the phase energy difference")
        records.append(ThermalMaterial(
            id=record["id"], conductivity=props["conductivity"],
            phase_energy_q=props["phase_energy"] * ENERGY_SCALE,
            chemical_energy_q=props["fuel_energy"] * ENERGY_SCALE,
            up=Transition(props[up[0][0]], props[up[0][1]] * ENERGY_SCALE) if up else None,
            down=Transition(props[down[0][0]], props[down[0][1]] * ENERGY_SCALE) if down else None,
            burns_into=props["burns_into"] if props["fuel_energy"] else None,
            gas_product=props["smoke_product"] if props["fuel_energy"] else None,
            oxidizer=bool(props["oxidizer"]), flash_q=props["flash_point"] * ENERGY_SCALE,
        ))
    return Thermodynamics(records)
