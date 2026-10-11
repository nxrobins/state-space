"""Actual native GPU presentation must preserve state and use full energy."""
import unittest
import numpy as np

from engine import MaterialRenderer, create_field
from engine.schema import MAT_AIR, MAT_FIRE, MAT_GLASS, MAT_LAVA, MAT_METAL, MAT_SMOKE, MAT_STONE, MAT_WATER


class RenderingTests(unittest.TestCase):
    @staticmethod
    def image(renderer):
        width, height = renderer.output_size
        return np.frombuffer(renderer.read_pixels(), dtype=np.uint8).reshape(height, width, 4)[:, :, :3].astype(np.int16)

    def test_fire_and_lava_light_cool_terrain_and_single_cell_wall_blocks(self):
        for source in (MAT_FIRE, MAT_LAVA):
            with self.subTest(source=source), create_field(32, 32) as world, MaterialRenderer(32, 32, output_size=(128, 128)) as renderer:
                world.set_cell(4, 16, source, thermal=255)
                world.set_energy(4, 16, 650 * 256)
                world.set_cell(24, 16, MAT_METAL, thermal=20)
                before = world.snapshot().to_dict()
                renderer.render(world, lighting=False, bloom=False)
                unlit = self.image(renderer)
                renderer.render(world, bloom=False)
                lit = self.image(renderer)
                self.assertGreater(int(lit[66, 98, 0] - unlit[66, 98, 0]), 5)
                self.assertEqual(world.snapshot().to_dict(), before)
                # An opaque wall just one simulation cell wide must stop the ray.
                world.set_cell(16, 16, MAT_STONE)
                blocked_state = world.snapshot().to_dict()
                renderer.render(world, lighting=False, bloom=False)
                unlit_blocked = self.image(renderer)
                renderer.render(world, bloom=False)
                blocked = self.image(renderer)
                np.testing.assert_array_equal(blocked[66, 98], unlit_blocked[66, 98])
                self.assertEqual(world.snapshot().to_dict(), blocked_state)
                world.set_cell(16, 16, MAT_AIR)
                world.set_cell(4, 16, MAT_AIR)
                renderer.render(world, bloom=False)
                np.testing.assert_array_equal(self.image(renderer)[66, 98], unlit[66, 98])
                self.assertEqual(world.energy_balance().drift_q, 0)

    def test_area_light_penumbra_and_transparent_media(self):
        with create_field(64, 64) as world, MaterialRenderer(64, 64, output_size=(256, 256)) as renderer:
            for y in range(20, 44):
                for x in range(8, 11):
                    world.set_cell(x, y, MAT_LAVA, thermal=255)
                    world.set_energy(x, y, 650 * 256)
            for y in range(64):
                world.set_cell(48, y, MAT_METAL, thermal=20)
            renderer.render(world, lighting=False, bloom=False)
            baseline = self.image(renderer)
            renderer.render(world, bloom=False)
            unobstructed = self.image(renderer) - baseline
            for y in range(24, 40):
                world.set_cell(32, y, MAT_STONE)
            before = world.snapshot().to_dict()
            renderer.render(world, bloom=False)
            shadow = self.image(renderer) - baseline
            # Light and full shadow coexist with a partially lit penumbra.
            red = shadow[2::4, 194, 0]
            original_red = unobstructed[2::4, 194, 0]
            self.assertEqual(int(red[32]), 0)
            self.assertGreater(int(red[10]), 3)
            self.assertTrue(np.any((red > 3) & (red < original_red - 3)), 'Area lights must produce partial visibility')
            self.assertEqual(world.snapshot().to_dict(), before)
            for material in (MAT_WATER, MAT_GLASS, MAT_SMOKE):
                for y in range(24, 40):
                    world.set_cell(32, y, material, thermal=20)
                renderer.render(world, bloom=False)
                transmitted = self.image(renderer) - baseline
                self.assertGreater(int(transmitted[130, 194, 0]), int(shadow[130, 194, 0]) + 3)
                self.assertLessEqual(int(transmitted[130, 194, 0]), int(unobstructed[130, 194, 0]))
            self.assertEqual(world.energy_balance().drift_q, 0)

    def test_wide_grid_keeps_emitter_center_out_of_adjacent_wall(self):
        # Absolute 1259.5 rounds to 1260 in half-float storage. A rounded
        # emitter would move into the adjacent wall and bypass its occlusion.
        with create_field(1300, 4) as world, MaterialRenderer(1300, 4, output_size=(1300, 4)) as renderer:
            world.set_cell(1259, 2, MAT_FIRE, thermal=255)
            world.set_energy(1259, 2, 650 * 256)
            world.set_cell(1260, 2, MAT_STONE)
            world.set_cell(1281, 2, MAT_METAL, thermal=20)
            before = world.snapshot().to_dict()
            renderer.render(world, lighting=False, bloom=False)
            unlit = self.image(renderer)[2, 1281]
            renderer.render(world, bloom=False)
            np.testing.assert_array_equal(self.image(renderer)[2, 1281], unlit)
            self.assertEqual(world.snapshot().to_dict(), before)
            world.set_cell(1260, 2, MAT_AIR)
            renderer.render(world, bloom=False)
            self.assertGreater(int(self.image(renderer)[2, 1281, 0] - unlit[0]), 5)
            self.assertEqual(world.energy_balance().drift_q, 0)

    def test_full_energy_glow_and_render_isolation(self):
        with create_field(4, 4, fill_material=5) as world, MaterialRenderer(4, 4, output_size=(64, 64)) as renderer:
            world.set_energy(2, 2, 300 * 256)
            self.assertEqual(world.sample(2, 2)['thermal'], 255)
            before = world.snapshot().to_dict()
            renderer.render(world, styled=False)
            plain = renderer.read_pixels()
            renderer.render(world)
            warm = renderer.read_pixels()
            self.assertNotEqual(plain, warm)
            self.assertEqual(world.snapshot().to_dict(), before)
            world.set_energy(2, 2, 700 * 256)
            self.assertEqual(world.sample(2, 2)['thermal'], 255)
            hotter = world.snapshot().to_dict()
            renderer.render(world)
            hot = renderer.read_pixels()
            self.assertGreater(np.frombuffer(hot, dtype=np.uint8).reshape(-1, 4)[:, :3].sum(),
                               np.frombuffer(warm, dtype=np.uint8).reshape(-1, 4)[:, :3].sum())
            self.assertEqual(world.snapshot().to_dict(), hotter)
            self.assertEqual(world.energy_balance().drift_q, 0)


if __name__ == '__main__':
    unittest.main()
