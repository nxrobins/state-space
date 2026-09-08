"""Integer thermodynamics reference for ca-v2.

Energy is a conserved cell state; the temperature byte is a derived view.
See ENGINE_CONTRACT.md for the explicit limits of this cellular model.
"""

from dataclasses import dataclass
from types import MappingProxyType

from engine.catalog import integer
from engine.validation import checked_integer, validate_dimensions


ENERGY_SCALE = 256
MAX_ENERGY_Q = 0x3fffffff
NO_MATERIAL = 256
THERMO_STRIDE = 12


@dataclass(frozen=True)
class Transition:
    target: int
    temperature_q: int


@dataclass(frozen=True)
class ThermalMaterial:
    id: int
    conductivity: int = 0
    phase_energy_q: int = 0
    chemical_energy_q: int = 0
    up: Transition | None = None
    down: Transition | None = None
    burns_into: int | None = None
    gas_product: int | None = None
    oxidizer: bool = False
    flash_q: int = 0


@dataclass(frozen=True)
class EnergyLedger:
    sensible_q: int
    latent_q: int
    chemical_q: int

    @property
    def total_q(self) -> int:
        return self.sensible_q + self.latent_q + self.chemical_q


class Thermodynamics:
    """Validated, immutable registry and exact integer heat/reaction laws.

    All cells have unit heat capacity. Conductivity scales a bounded pairwise
    transfer, not a calibrated real-world time step. A phase interval stores
    latent energy at constant temperature; phase identity changes only after
    that interval has completed. Chemical energy cannot conduct as heat.
    """

    def __init__(self, materials):
        try:
            records = tuple(materials)
        except TypeError as error:
            raise ValueError("Thermal registry requires a sequence of materials") from error
        self._validate_materials(records)
        self._materials = MappingProxyType({record.id: record for record in records})

    @property
    def materials(self):
        return self._materials

    @staticmethod
    def _validate_materials(records) -> None:
        if not records or any(not isinstance(record, ThermalMaterial) for record in records):
            raise ValueError("Thermal registry requires ThermalMaterial records")
        ids = set()
        for record in records:
            integer(record.id, 0, 255, "material id")
            if record.id in ids:
                raise ValueError("Duplicate thermal material id")
            ids.add(record.id)
            integer(record.conductivity, 0, 255, "conductivity")
            for name in ("phase_energy_q", "chemical_energy_q", "flash_q"):
                integer(getattr(record, name), 0, MAX_ENERGY_Q, name)
            if record.phase_energy_q + record.chemical_energy_q > MAX_ENERGY_Q:
                raise ValueError("Material energy offsets exceed the representable range")
            if type(record.oxidizer) is not bool or (record.oxidizer and record.chemical_energy_q):
                raise ValueError("Oxidizer must be a boolean and cannot also be fuel")
            for transition in (record.up, record.down):
                if transition is not None:
                    if not isinstance(transition, Transition):
                        raise ValueError("Malformed phase transition")
                    integer(transition.target, 0, 255, "phase target")
                    integer(transition.temperature_q, 1, MAX_ENERGY_Q, "phase threshold")
            for product in (record.burns_into, record.gas_product):
                if product is not None:
                    integer(product, 0, 255, "reaction product")
            if bool(record.chemical_energy_q) != (record.burns_into is not None and record.gas_product is not None):
                raise ValueError("Fuel and its two reaction products must be specified together")
            if not record.chemical_energy_q and (record.burns_into is not None or record.gas_product is not None):
                raise ValueError("Non-fuel cannot define a combustion product")
        by_id = {record.id: record for record in records}
        for record in records:
            for transition, upward in ((record.up, True), (record.down, False)):
                if transition is None:
                    continue
                if transition.target not in by_id:
                    raise ValueError("Undefined phase target")
                target = by_id[transition.target]
                difference = target.phase_energy_q - record.phase_energy_q
                if (upward and difference <= 0) or (not upward and difference >= 0):
                    raise ValueError("Phase energy must change monotonically in the declared direction")
                if target.chemical_energy_q != record.chemical_energy_q:
                    raise ValueError("Phase changes must preserve chemical energy")
                if target.oxidizer != record.oxidizer:
                    raise ValueError("Phase changes must preserve oxidizer identity")
                if max(target.phase_energy_q, record.phase_energy_q) + record.chemical_energy_q + transition.temperature_q > MAX_ENERGY_Q:
                    raise ValueError("Phase interval exceeds the energy range")
                reverse = target.down if upward else target.up
                if reverse is not None:
                    if reverse.target != record.id:
                        raise ValueError("A reverse phase edge must return to its source material")
                    up_threshold = transition.temperature_q if upward else reverse.temperature_q
                    down_threshold = reverse.temperature_q if upward else transition.temperature_q
                    if down_threshold >= up_threshold:
                        raise ValueError("Reverse phase thresholds require a strictly positive hysteresis interval")
            if record.up and record.down and record.down.temperature_q >= record.up.temperature_q:
                raise ValueError("Material phase intervals overlap")
            for product in (record.burns_into, record.gas_product):
                if product is not None:
                    if product not in by_id:
                        raise ValueError("Undefined reaction product")
                    target = by_id[product]
                    if target.chemical_energy_q or target.oxidizer or target.phase_energy_q:
                        raise ValueError("This complete-combustion model requires inert, zero-offset products")
            if record.oxidizer and record.phase_energy_q:
                raise ValueError("This oxidizer model requires zero phase energy")

    def _material(self, material_id: int) -> ThermalMaterial:
        checked_integer(material_id, 0, 255, "material id")
        if material_id not in self.materials:
            raise ValueError(f"Undefined thermal material: {material_id}")
        return self.materials[material_id]

    def _energy(self, material_id: int, energy_q: int) -> ThermalMaterial:
        material = self._material(material_id)
        checked_integer(energy_q, material.chemical_energy_q, MAX_ENERGY_Q, "energy_q")
        return material

    def temperature_q(self, material_id: int, energy_q: int) -> int:
        material = self._energy(material_id, energy_q)
        energy_q = int(energy_q)
        heat = energy_q - material.chemical_energy_q
        temperature = max(0, heat - material.phase_energy_q)
        if material.up and heat >= material.phase_energy_q + material.up.temperature_q:
            target = self.materials[material.up.target]
            temperature = max(material.up.temperature_q, heat - target.phase_energy_q)
        elif material.down and heat <= material.phase_energy_q + material.down.temperature_q:
            target = self.materials[material.down.target]
            temperature = min(material.down.temperature_q, max(0, heat - target.phase_energy_q))
        return temperature

    def temperature_byte(self, material_id: int, energy_q: int) -> int:
        # Clipping applies only to this view; energy_q is never overwritten.
        return min(255, self.temperature_q(material_id, energy_q) // ENERGY_SCALE)

    def ledger(self, materials, energies) -> EnergyLedger:
        materials, energies = self.validate_state(materials, energies)
        chemical = sum(self.materials[m].chemical_energy_q for m in materials)
        sensible = sum(self.temperature_q(m, energy) for m, energy in zip(materials, energies))
        return EnergyLedger(sensible, sum(energies) - chemical - sensible, chemical)

    def validate_state(self, materials, energies, width=None, height=None) -> tuple[tuple[int, ...], tuple[int, ...]]:
        try:
            materials, energies = tuple(materials), tuple(energies)
        except TypeError as error:
            raise ValueError("Material and energy state must be one-dimensional sequences") from error
        if len(materials) != len(energies) or not materials:
            raise ValueError("Material and energy arrays must have equal, nonzero lengths")
        if width is not None or height is not None:
            width, height = validate_dimensions(width, height)
            if len(materials) != width * height:
                raise ValueError("State length differs from grid dimensions")
        for material, energy in zip(materials, energies):
            self._energy(material, energy)
        return tuple(int(m) for m in materials), tuple(int(e) for e in energies)

    def exchange(self, mat_a: int, mat_b: int, energy_a: int, energy_b: int) -> tuple[int, int]:
        """One disjoint pair: bounded, equal and opposite heat transfer."""
        a, b = self._energy(mat_a, energy_a), self._energy(mat_b, energy_b)
        energy_a, energy_b = int(energy_a), int(energy_b)
        temp_a, temp_b = self.temperature_q(mat_a, energy_a), self.temperature_q(mat_b, energy_b)
        conductivity_sum = a.conductivity + b.conductivity
        conductivity = 0 if conductivity_sum == 0 else 2 * a.conductivity * b.conductivity // conductivity_sum
        difference = abs(temp_a - temp_b)
        # Round up sub-Q flux so weak conductors do not stall at degree-sized
        # gaps. Cap at half the gap to prevent crossing temperatures. This is
        # a bounded (<1 Q) numerical bias, not fractional energy creation.
        # Quotient/remainder form also fits u32 in WGSL at MAX_ENERGY_Q.
        flux = difference // 512 * conductivity + (difference % 512 * conductivity + 511) // 512
        flux = min(flux, difference // 2)
        if temp_a > temp_b:
            flux = min(flux, energy_a - a.chemical_energy_q, MAX_ENERGY_Q - energy_b)
            return energy_a - flux, energy_b + flux
        flux = min(flux, energy_b - b.chemical_energy_q, MAX_ENERGY_Q - energy_a)
        return energy_a + flux, energy_b - flux

    def phase(self, material_id: int, energy_q: int) -> int:
        material = self._energy(material_id, energy_q)
        energy_q = int(energy_q)
        for transition, upward in ((material.up, True), (material.down, False)):
            if transition is None:
                continue
            target = self.materials[transition.target]
            boundary = material.chemical_energy_q + target.phase_energy_q + transition.temperature_q
            if (upward and energy_q >= boundary) or (not upward and energy_q <= boundary):
                return target.id
        return material_id

    def burning(self, material_id: int, energy_q: int) -> bool:
        material = self._energy(material_id, energy_q)
        return bool(material.chemical_energy_q and self.temperature_q(material_id, energy_q) > material.flash_q)

    def burn_pair(self, fuel_id: int, air_id: int, fuel_energy: int, air_energy: int) -> tuple[int, int, int, int]:
        fuel, air = self._energy(fuel_id, fuel_energy), self._energy(air_id, air_energy)
        fuel_energy, air_energy = int(fuel_energy), int(air_energy)
        if not air.oxidizer or not self.burning(fuel_id, fuel_energy):
            return fuel_id, air_id, fuel_energy, air_energy
        # The fuel's chemical energy is ALREADY included in fuel_energy.
        # Transfer half to the oxidizer, retaining any amount it cannot hold.
        transfer = min(fuel.chemical_energy_q // 2, MAX_ENERGY_Q - air_energy)
        return fuel.burns_into, fuel.gas_product, fuel_energy - transfer, air_energy + transfer

    @staticmethod
    def _neighbors(index: int, width: int, height: int) -> list[int]:
        x, y = index % width, index // width
        neighbors = [index - 1 if x else -1, index + 1 if x + 1 < width else -1,
                     index - width if y else -1, index + width if y + 1 < height else -1]
        order = (2, 1, 3, 0) if (x + y) % 2 == 0 else (0, 2, 1, 3)
        return [neighbors[direction] for direction in order if neighbors[direction] >= 0]

    def thermal_pass(self, materials, energies, width: int, height: int, axis: int, parity: int) -> tuple[int, ...]:
        materials, energies = self.validate_state(materials, energies, width, height)
        checked_integer(axis, 0, 1, "axis")
        checked_integer(parity, 0, 1, "parity")
        output = list(energies)
        for y in range(parity if axis else 0, height, 2 if axis else 1):
            for x in range(0 if axis else parity, width, 1 if axis else 2):
                if (axis == 0 and x + 1 >= width) or (axis == 1 and y + 1 >= height):
                    continue
                a = y * width + x
                b = a + (width if axis else 1)
                output[a], output[b] = self.exchange(materials[a], materials[b], energies[a], energies[b])
        return tuple(output)

    def reaction_pass(self, materials, energies, width: int, height: int) -> tuple[tuple[int, ...], tuple[int, ...]]:
        materials, energies = self.validate_state(materials, energies, width, height)
        chosen_air = {}
        for i, (material, energy) in enumerate(zip(materials, energies)):
            if self.burning(material, energy):
                chosen_air[i] = next((n for n in self._neighbors(i, width, height) if self.materials[materials[n]].oxidizer), None)
        out_materials, out_energies = list(materials), list(energies)
        for air, material in enumerate(materials):
            if not self.materials[material].oxidizer:
                continue
            fuel = next((n for n in self._neighbors(air, width, height) if chosen_air.get(n) == air), None)
            if fuel is not None:
                out_materials[fuel], out_materials[air], out_energies[fuel], out_energies[air] = self.burn_pair(
                    materials[fuel], material, energies[fuel], energies[air])
        return tuple(out_materials), tuple(out_energies)

    def tick(self, materials, energies, width: int, height: int) -> tuple[tuple[int, ...], tuple[int, ...]]:
        materials, energies = self.validate_state(materials, energies, width, height)
        for axis, parity in ((0, 0), (0, 1), (1, 0), (1, 1)):
            energies = self.thermal_pass(materials, energies, width, height, axis, parity)
        materials = tuple(self.phase(m, e) for m, e in zip(materials, energies))
        return self.reaction_pass(materials, energies, width, height)

    def gpu_table(self) -> tuple[int, ...]:
        table = [0] * (256 * THERMO_STRIDE)
        for material in self.materials.values():
            row = [material.conductivity, material.phase_energy_q, material.chemical_energy_q,
                   material.up.target if material.up else NO_MATERIAL, material.up.temperature_q if material.up else 0,
                   material.down.target if material.down else NO_MATERIAL, material.down.temperature_q if material.down else 0,
                   material.burns_into if material.burns_into is not None else NO_MATERIAL,
                   material.gas_product if material.gas_product is not None else NO_MATERIAL,
                   int(material.oxidizer), material.flash_q, 0]
            table[material.id * THERMO_STRIDE:(material.id + 1) * THERMO_STRIDE] = row
        return tuple(table)
