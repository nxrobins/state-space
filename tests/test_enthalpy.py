"""C3 physical properties, adversarial registries, and mutation controls."""

import inspect
import random
import types
import unittest
from dataclasses import replace

import numpy as np

import engine.enthalpy as law
from engine.enthalpy import ENERGY_SCALE as Q, MAX_ENERGY_Q, Thermodynamics, ThermalMaterial, Transition
from engine.catalog import load_catalog
from engine.generate import constants
from engine.lint import lint_enthalpy, lint_wgsl
from enthalpy_cases import AIR, ICE, WATER, STEAM, METAL, WOOD, OIL, OIL_VAPOR, ASH, SMOKE, LAVA, model


class EnthalpyProperties(unittest.TestCase):
    def setUp(self):
        self.model = model()

    def test_pairs_conserve_exactly_remain_bounded_and_do_not_invert_temperature(self):
        rng = random.Random(923817)
        for _ in range(6000):
            a, b = rng.sample(list(self.model.materials), 2)
            ea = rng.randrange(self.model.materials[a].chemical_energy_q, MAX_ENERGY_Q + 1)
            eb = rng.randrange(self.model.materials[b].chemical_energy_q, MAX_ENERGY_Q + 1)
            before = self.model.temperature_q(a, ea) - self.model.temperature_q(b, eb)
            na, nb = self.model.exchange(a, b, ea, eb)
            after = self.model.temperature_q(a, na) - self.model.temperature_q(b, nb)
            self.assertEqual(na + nb, ea + eb)
            self.assertGreaterEqual(na, self.model.materials[a].chemical_energy_q)
            self.assertGreaterEqual(nb, self.model.materials[b].chemical_energy_q)
            self.assertLessEqual(max(na, nb), MAX_ENERGY_Q)
            self.assertGreaterEqual(before * after, 0)
            self.assertEqual(self.model.exchange(b, a, eb, ea), (nb, na))

    def test_numpy_inputs_are_converted_before_unsigned_arithmetic(self):
        args = (METAL, METAL, np.uint32(Q), np.uint32(MAX_ENERGY_Q))
        self.assertEqual(self.model.exchange(*args), self.model.exchange(*map(int, args)))
        ledger = self.model.ledger(np.array([METAL, METAL], dtype=np.uint32), np.array([MAX_ENERGY_Q] * 2, dtype=np.uint32))
        self.assertEqual(ledger.total_q, 2 * MAX_ENERGY_Q)

    def test_fractional_exchange_moves_heat_without_rounding_away_energy(self):
        slow = Thermodynamics([ThermalMaterial(0, conductivity=1)])
        a, b = slow.exchange(0, 0, 20 * Q, 21 * Q + 1)
        self.assertEqual((a, b), (20 * Q + 1, 21 * Q))
        a, b = slow.exchange(0, 0, 20 * Q, 22 * Q)
        self.assertEqual((a, b), (20 * Q + 1, 22 * Q - 1))
        self.assertEqual(a + b, 42 * Q)
        a, b = self.model.exchange(METAL, METAL, 20 * Q, 21 * Q)
        self.assertGreater(a, 20 * Q)
        self.assertLess(b, 21 * Q)
        a, b = 20 * Q, 21 * Q
        for _ in range(256):
            a, b = slow.exchange(0, 0, a, b)
        self.assertEqual((a, b), (20 * Q + Q // 2, 20 * Q + Q // 2))

    def test_thermal_byte_is_only_a_view_and_lava_is_finite(self):
        self.assertEqual(self.model.temperature_byte(METAL, 1000 * Q), 255)
        self.assertEqual(self.model.ledger([METAL], [1000 * Q]).total_q, 1000 * Q)
        a, b = self.model.exchange(LAVA, AIR, 280 * Q, 20 * Q)
        self.assertLess(a, 280 * Q)
        self.assertGreater(b, 20 * Q)
        self.assertEqual(a + b, 300 * Q)

    def test_high_conductivity_ring_has_no_clamping_loss(self):
        materials = [METAL] * 9
        energies = tuple((0 if i == 4 else 255 * Q) for i in range(9))
        for _ in range(256):
            for axis, parity in ((0, 0), (0, 1), (1, 0), (1, 1)):
                energies = self.model.thermal_pass(materials, energies, 3, 3, axis, parity)
                self.assertEqual(sum(energies), 2040 * Q)
                self.assertTrue(all(0 <= e <= 255 * Q for e in energies))
        self.assertLessEqual(max(energies) - min(energies), 4)

    def test_latent_plateau_and_reverse_release(self):
        for energy in range(30 * Q, 45 * Q + 1, 17):
            self.assertEqual(self.model.temperature_q(ICE, energy), 30 * Q)
            self.assertEqual(self.model.phase(ICE, energy), ICE)
        self.assertEqual(self.model.phase(ICE, 45 * Q), WATER)
        self.assertEqual(self.model.temperature_q(WATER, 45 * Q), 30 * Q)
        for energy in range(25 * Q + 1, 40 * Q + 1, 17):
            self.assertEqual(self.model.temperature_q(WATER, energy), 25 * Q)
            self.assertEqual(self.model.phase(WATER, energy), WATER)
        self.assertEqual(self.model.phase(WATER, 25 * Q), ICE)
        self.assertEqual(self.model.temperature_q(ICE, 25 * Q), 25 * Q)

    def test_isolated_ice_does_not_melt_then_refreeze_and_discard_heat(self):
        materials, energies = (ICE,), (35 * Q,)
        for _ in range(128):
            materials, energies = self.model.tick(materials, energies, 1, 1)
            self.assertEqual((materials, energies), ((ICE,), (35 * Q,)))
            self.assertEqual(self.model.ledger(materials, energies).latent_q, 5 * Q)

    def test_phase_cycle_closes_with_an_explicit_external_heat_budget(self):
        material, energy, external = ICE, 5 * Q, 0
        visited = {material}
        for delta in [Q] * 170 + [-Q] * 170:
            energy += delta
            external += delta
            material = self.model.phase(material, energy)
            visited.add(material)
            ledger = self.model.ledger([material], [energy])
            self.assertEqual(ledger.total_q, 5 * Q + external)
            self.assertGreaterEqual(min(ledger.sensible_q, ledger.latent_q, ledger.chemical_q), 0)
        self.assertEqual(visited, {ICE, WATER, STEAM})
        self.assertEqual((material, energy, external), (ICE, 5 * Q, 0))

    def test_phase_boundaries_reach_a_fixed_point_without_unforced_cycles(self):
        for initial in self.model.materials.values():
            candidates = {initial.chemical_energy_q, MAX_ENERGY_Q}
            for material in self.model.materials.values():
                for transition in (material.up, material.down):
                    if transition:
                        target = self.model.materials[transition.target]
                        boundary = material.chemical_energy_q + target.phase_energy_q + transition.temperature_q
                        candidates.update((boundary - 1, boundary, boundary + 1))
            for energy in sorted(candidates):
                if energy < initial.chemical_energy_q:
                    continue
                material, seen = initial.id, set()
                for _ in range(16):
                    nxt = self.model.phase(material, energy)
                    if nxt == material:
                        break
                    self.assertNotIn(nxt, seen)
                    seen.add(material)
                    material = nxt
                else:
                    self.fail("Phase state never settled")

    def test_oil_vapor_preserves_chemical_budget_and_condenses_to_oil(self):
        energy = (150 + 30 + 80) * Q
        self.assertEqual(self.model.phase(OIL, energy), OIL_VAPOR)
        self.assertEqual(self.model.ledger([OIL_VAPOR], [energy]).chemical_q, 150 * Q)
        self.assertEqual(self.model.phase(OIL_VAPOR, (150 + 70) * Q), OIL)

    def test_chemical_energy_does_not_diffuse_until_reaction(self):
        self.assertEqual(self.model.exchange(WOOD, METAL, (80 + 20) * Q, 20 * Q), (100 * Q, 20 * Q))
        material, other, a, b = self.model.burn_pair(WOOD, AIR, 335 * Q, 20 * Q)
        self.assertEqual((material, other), (ASH, SMOKE))
        self.assertEqual((a, b), (295 * Q, 60 * Q))
        self.assertEqual(self.model.ledger([material, other], [a, b]).total_q, 355 * Q)
        self.assertGreater(self.model.temperature_q(material, a), 255 * Q)
        self.assertEqual(self.model.temperature_byte(material, a), 255)

    def test_saturated_oxidizer_retains_release_without_u32_wrap(self):
        m, n, a, b = self.model.burn_pair(WOOD, AIR, 335 * Q, MAX_ENERGY_Q - 1)
        self.assertEqual((m, n), (ASH, SMOKE))
        self.assertEqual((a, b), (335 * Q - 1, MAX_ENERGY_Q))
        self.assertEqual(a + b, 335 * Q + MAX_ENERGY_Q - 1)

    def test_one_oxidizer_is_owned_by_one_fuel(self):
        materials, energies = self.model.reaction_pass([WOOD, AIR, WOOD], [335 * Q, 20 * Q, 335 * Q], 3, 1)
        self.assertEqual(materials.count(WOOD), 1)
        self.assertEqual(materials.count(ASH), 1)
        self.assertEqual(materials.count(SMOKE), 1)
        self.assertEqual(sum(energies), 690 * Q)
        frozen = self.model.reaction_pass([WOOD, METAL], [335 * Q, 20 * Q], 2, 1)
        self.assertEqual(frozen, ((WOOD, METAL), (335 * Q, 20 * Q)))

    def test_odd_non_square_pair_passes_preserve_all_energy_and_untouched_edges(self):
        for width, height in ((1, 1), (1, 7), (7, 1), (3, 5), (8, 8), (17, 19)):
            initial = tuple((i * 1723) % 65000 for i in range(width * height))
            for axis, parity in ((0, 0), (0, 1), (1, 0), (1, 1)):
                result = self.model.thermal_pass([METAL] * len(initial), initial, width, height, axis, parity)
                self.assertEqual(sum(result), sum(initial))
                if (axis == 0 and width == 1) or (axis == 1 and height == 1):
                    self.assertEqual(result, initial)

    def test_rejects_invalid_state_before_coercion(self):
        for bad in (-1, MAX_ENERGY_Q + 1, True, 1.5, float("nan"), "7", None):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                self.model.validate_state([METAL], [bad])
        for materials, energies in (([], []), ([255], [0]), ([AIR], []), ([True], [0]), ([[AIR]], [0]), ([WOOD], [1])):
            with self.subTest(materials=materials), self.assertRaises(ValueError):
                self.model.validate_state(materials, energies)


class RegistryAndMutationProperties(unittest.TestCase):
    def test_validated_material_registry_cannot_be_mutated_through_public_api(self):
        registry = model()
        with self.assertRaises(TypeError):
            registry.materials[METAL] = ThermalMaterial(METAL, conductivity=0)
        with self.assertRaises(AttributeError):
            registry.materials = {}
        with self.assertRaises(AttributeError):
            registry.materials[METAL].conductivity = 0

    def test_structural_rules_reject_float_math_display_feedback_and_gpu_range_drift(self):
        self.assertEqual(lint_enthalpy(inspect.getsource(law), "enthalpy.py"), [])
        for source in ("flux = energy / 256", "flux = float(energy)", "flux = energy * 0.5"):
            self.assertTrue(any("SS012" in issue for issue in lint_enthalpy(source, "probe.py")))
        self.assertTrue(any("SS013" in issue for issue in lint_enthalpy("flux = self.temperature_byte(material, energy)", "probe.py")))
        for source in ("const MAX_ENERGY_Q: u32 = 0xffffffffu;", "const THERMO_STRIDE: u32 = 8u;"):
            self.assertTrue(lint_wgsl(source, "probe.wgsl", constants(load_catalog())))

    def test_invalid_registries_fail_closed(self):
        base = model()
        variants = [
            replace(base.materials[WATER], chemical_energy_q=Q),
            replace(base.materials[ICE], up=Transition(255, 30 * Q)),
            replace(base.materials[ICE], up=Transition(WATER, True)),
            replace(base.materials[WATER], down=Transition(ICE, 30 * Q)),
            replace(base.materials[STEAM], down=Transition(ICE, 90 * Q)),
            replace(base.materials[WOOD], burns_into=None),
            replace(base.materials[AIR], oxidizer=1),
            replace(base.materials[ASH], phase_energy_q=Q),
            replace(base.materials[METAL], conductivity=256),
            replace(base.materials[ICE], phase_energy_q=100 * Q),
            replace(base.materials[WOOD], phase_energy_q=MAX_ENERGY_Q),
        ]
        for replacement in variants:
            records = [replacement if m.id == replacement.id else m for m in base.materials.values()]
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                Thermodynamics(records)
        for records in ([], None, [None], [ThermalMaterial(0), ThermalMaterial(0)]):
            with self.subTest(records=records), self.assertRaises(ValueError):
                Thermodynamics(records)

    @staticmethod
    def mutant(old, new):
        source = inspect.getsource(law)
        if source.count(old) != 1:
            raise AssertionError("Mutation target no longer unique")
        namespace = {"__name__": law.__name__}
        exec(compile(source.replace(old, new), "<enthalpy-negative-control>", "exec"), namespace)
        return model(types.SimpleNamespace(**namespace))

    def test_properties_detect_immortal_source_rounding_and_double_counted_fuel(self):
        immortal = self.mutant("return energy_a - flux, energy_b + flux", "return energy_a, energy_b + flux")
        self.assertNotEqual(sum(immortal.exchange(LAVA, AIR, 280 * Q, 20 * Q)), 300 * Q)
        clipped = self.mutant("return energy_a - flux, energy_b + flux", "return min(255 * ENERGY_SCALE, energy_a - flux), energy_b + flux")
        self.assertNotEqual(sum(clipped.exchange(METAL, AIR, 1000 * Q, 20 * Q)), 1020 * Q)
        chemical = self.mutant("fuel_energy - transfer, air_energy + transfer", "fuel_energy + fuel.chemical_energy_q - transfer, air_energy + transfer")
        self.assertNotEqual(sum(chemical.burn_pair(WOOD, AIR, 335 * Q, 20 * Q)[2:]), 355 * Q)

    def test_positive_properties_detect_noop_and_incorrect_latent_plateau(self):
        noop = self.mutant("flux = difference // 512 * conductivity + (difference % 512 * conductivity + 511) // 512", "flux = 0")
        self.assertEqual(noop.exchange(METAL, METAL, 20 * Q, 21 * Q), (20 * Q, 21 * Q))
        self.assertNotEqual(model().exchange(METAL, METAL, 20 * Q, 21 * Q), (20 * Q, 21 * Q))
        plateau = self.mutant("temperature = max(material.up.temperature_q, heat - target.phase_energy_q)", "temperature = heat - material.phase_energy_q")
        self.assertNotEqual(plateau.temperature_q(ICE, 35 * Q), 30 * Q)

    def test_quantization_property_rejects_truncating_weak_heat_flux(self):
        rounded_down = self.mutant("(difference % 512 * conductivity + 511) // 512", "difference % 512 * conductivity // 512")
        records = [replace(m, conductivity=1) for m in rounded_down.materials.values()]
        rounded_down = type(rounded_down)(records)
        self.assertEqual(rounded_down.exchange(METAL, METAL, 20 * Q, 21 * Q), (20 * Q, 21 * Q))


if __name__ == "__main__":
    unittest.main()
