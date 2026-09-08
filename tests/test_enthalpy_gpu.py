"""Native GPU differential and long-horizon tests for C3 thermodynamics."""

import random
import unittest

from engine.enthalpy import ENERGY_SCALE as Q, MAX_ENERGY_Q, Thermodynamics, ThermalMaterial
from engine.enthalpy_gpu import EnthalpyGPU, PASSES
from enthalpy_cases import AIR, ICE, WATER, STEAM, METAL, WOOD, OIL, OIL_VAPOR, ASH, SMOKE, LAVA, model


class EnthalpyGPUProperties(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gpu = EnthalpyGPU()
        cls.model = model()

    def check_trace(self, materials, energies, width, height, ticks):
        result = self.gpu.run(self.model, materials, energies, width, height, ticks, trace=True)
        expected_m, expected_e = tuple(materials), tuple(energies)
        budget = sum(energies)
        self.assertEqual(len(result["traces"]), len(PASSES) * ticks)
        for tick, name, actual_m, actual_e in result["traces"]:
            with self.subTest(tick=tick, name=name, width=width, height=height):
                if name.startswith("heat"):
                    axis = 0 if name[5] == "x" else 1
                    expected_e = self.model.thermal_pass(expected_m, expected_e, width, height, axis, int(name[-1]))
                elif name == "phase":
                    expected_m = tuple(self.model.phase(m, e) for m, e in zip(expected_m, expected_e))
                else:
                    expected_m, expected_e = self.model.reaction_pass(expected_m, expected_e, width, height)
                self.assertEqual(actual_m, expected_m)
                self.assertEqual(actual_e, expected_e)
                ledger = self.model.ledger(actual_m, actual_e)
                self.assertEqual(ledger.total_q, budget)
                self.assertGreaterEqual(min(ledger.sensible_q, ledger.latent_q, ledger.chemical_q), 0)
        self.assertEqual(result["materials"], expected_m)
        self.assertEqual(result["energyQ"], expected_e)
        return result

    def test_every_pass_matches_reference_at_all_energy_scales_and_grid_edges(self):
        for width, height in ((1, 1), (1, 7), (7, 1), (3, 5), (17, 19)):
            for seed in (512, 997, 81421):
                rng = random.Random(seed)
                materials = [rng.choice(list(self.model.materials)) for _ in range(width * height)]
                energies = []
                for i, m in enumerate(materials):
                    low = self.model.materials[m].chemical_energy_q
                    high = MAX_ENERGY_Q if seed == 81421 else max(low, 400 * Q)
                    energies.append(rng.randrange(low, high + 1) if i % 5 else high)
                self.check_trace(materials, energies, width, height, 12)

    def test_fractional_heat_exchange_is_positive_and_exact_on_gpu(self):
        result = self.gpu.run(self.model, [METAL, METAL], [20 * Q, 21 * Q], 2, 1, 1, pass_ids=("heat_x0",))
        self.assertEqual(result["energyQ"], (20 * Q + 128, 21 * Q - 128))
        slow = Thermodynamics([ThermalMaterial(0, conductivity=1)])
        result = self.gpu.run(slow, [0, 0], [20 * Q, 21 * Q], 2, 1, 1024)
        self.assertEqual(result["energyQ"], (20 * Q + 128, 20 * Q + 128))

    def test_isolated_phase_boundaries_and_vapor_fuel(self):
        for material, energy in ((ICE, 35 * Q), (ICE, 45 * Q - 1), (ICE, 45 * Q),
                                 (WATER, 25 * Q), (WATER, 25 * Q + 1), (WATER, 155 * Q),
                                 (STEAM, 105 * Q), (OIL, 260 * Q), (OIL_VAPOR, 220 * Q)):
            self.check_trace([material], [energy], 1, 1, 4)

    def test_shared_oxidizer_and_saturated_pair_preserve_every_energy_unit(self):
        result = self.gpu.run(self.model, [WOOD, AIR, WOOD], [335 * Q, 20 * Q, 335 * Q], 3, 1, 1,
                              pass_ids=("combustion",))
        self.assertEqual(result["materials"].count(WOOD), 1)
        self.assertEqual(result["materials"].count(ASH), 1)
        self.assertEqual(result["materials"].count(SMOKE), 1)
        self.assertEqual(sum(result["energyQ"]), 690 * Q)
        saturated = self.gpu.run(self.model, [WOOD, AIR], [335 * Q, MAX_ENERGY_Q - 1], 2, 1, 1,
                                 pass_ids=("combustion",))
        self.assertEqual(saturated["energyQ"], (335 * Q - 1, MAX_ENERGY_Q))

    def test_finite_heater_and_high_conductivity_ring_keep_their_closed_budgets(self):
        finite = self.check_trace([LAVA, AIR], [280 * Q, 20 * Q], 2, 1, 64)
        self.assertLess(finite["energyQ"][0], 280 * Q)
        self.assertGreater(finite["energyQ"][1], 20 * Q)
        ring = self.gpu.run(self.model, [METAL] * 9, [0 if i == 4 else 255 * Q for i in range(9)], 3, 3, 2048)
        self.assertEqual(sum(ring["energyQ"]), 2040 * Q)
        self.assertLessEqual(max(ring["energyQ"]) - min(ring["energyQ"]), 4)

    def test_long_coupled_heat_phase_and_combustion_has_exact_accounting(self):
        width, height = 5, 3
        materials = [METAL] * 15
        energies = [500 * Q] * 15
        for index, material, energy in ((6, WOOD, 335 * Q), (7, AIR, 20 * Q), (8, WATER, 40 * Q)):
            materials[index], energies[index] = material, energy
        # Trace the reactive part, then exercise a long, unobserved GPU command stream.
        self.check_trace(materials, energies, width, height, 16)
        result = self.gpu.run(self.model, materials, energies, width, height, 2048)
        expected_m, expected_e = tuple(materials), tuple(energies)
        for _ in range(2048):
            expected_m, expected_e = self.model.tick(expected_m, expected_e, width, height)
        self.assertEqual(result["materials"], expected_m)
        self.assertEqual(result["energyQ"], expected_e)
        self.assertEqual(sum(result["energyQ"]), sum(energies))
        self.assertNotIn(WOOD, result["materials"])
        self.assertIn(ASH, result["materials"])
        self.assertIn(SMOKE, result["materials"])
        self.assertIn(STEAM, result["materials"])

    def test_restart_preserves_fractional_state_and_zero_tick_is_identity(self):
        materials, energies = (LAVA, METAL, WATER), (280 * Q + 17, 35 * Q + 1, 40 * Q + 39)
        zero = self.gpu.run(self.model, materials, energies, 3, 1, 0)
        self.assertEqual((zero["materials"], zero["energyQ"]), (materials, energies))
        continuous = self.gpu.run(self.model, materials, energies, 3, 1, 35)
        first = self.gpu.run(self.model, materials, energies, 3, 1, 13)
        resumed = self.gpu.run(self.model, first["materials"], first["energyQ"], 3, 1, 22)
        self.assertEqual((continuous["materials"], continuous["energyQ"]), (resumed["materials"], resumed["energyQ"]))

    def test_gpu_counterexample_detects_u32_multiply_overflow(self):
        old = "difference / 512u * conductivity + (difference % 512u * conductivity + 511u) / 512u"
        self.assertEqual(self.gpu.source.count(old), 1)
        mutant = EnthalpyGPU(self.gpu.source.replace(old, "difference * conductivity / 512u"))
        correct = self.gpu.run(self.model, [METAL, METAL], [MAX_ENERGY_Q, 0], 2, 1, 1, pass_ids=("heat_x0",))
        broken = mutant.run(self.model, [METAL, METAL], [MAX_ENERGY_Q, 0], 2, 1, 1, pass_ids=("heat_x0",))
        self.assertNotEqual(broken["energyQ"], correct["energyQ"])
        self.assertEqual(correct["energyQ"], self.model.exchange(METAL, METAL, MAX_ENERGY_Q, 0))


if __name__ == "__main__":
    unittest.main()
