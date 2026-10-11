"""Actual native GPU presentation must preserve state and use full energy."""
import unittest
import numpy as np

from engine import MaterialRenderer, create_field
from engine.schema import MAT_AIR, MAT_FIRE, MAT_GLASS, MAT_LAVA, MAT_METAL, MAT_SMOKE, MAT_STEAM, MAT_STONE, MAT_WATER


class RenderingTests(unittest.TestCase):
    @staticmethod
    def image(renderer):
        width, height = renderer.output_size
        return np.frombuffer(renderer.read_pixels(), dtype=np.uint8).reshape(height, width, 4)[:, :, :3].astype(np.int16)

    def test_heat_distortion_uses_full_energy_and_preserves_complete_state(self):
        for emitter in (MAT_FIRE, MAT_LAVA):
            with self.subTest(emitter=emitter), create_field(32, 32) as world, MaterialRenderer(32, 32, output_size=(128, 128)) as renderer:
                for y in range(4, 27):
                    for x in range(8, 24):
                        if x % 3:
                            world.set_cell(x, y, MAT_SMOKE, thermal=40)
                for y in range(27, 31):
                    for x in range(10, 22):
                        world.set_cell(x, y, emitter, thermal=255)
                        world.set_energy(x, y, 400 * 256)
                options = {'lighting': False, 'bloom': False, 'water': False, 'haze': False}
                renderer.render(world, distortion=False, **options)
                still = self.image(renderer)
                before = world.snapshot().to_dict()
                if emitter == MAT_FIRE:
                    self.assertEqual((int(world.grid[27 * 32 + 10]) >> 8) & 255, 255)
                renderer.render(world, **options)
                warm = self.image(renderer)
                self.assertEqual(world.snapshot().to_dict(), before)
                self.assertGreater(np.count_nonzero(np.max(np.abs(warm[:104] - still[:104]), axis=2) > 2), 64)
                renderer.render(world, **options)
                np.testing.assert_array_equal(self.image(renderer), warm)
                for y in range(27, 31):
                    for x in range(10, 22):
                        world.set_energy(x, y, 1000 * 256)
                renderer.render(world, distortion=False, **options)
                hotter_still = self.image(renderer)
                renderer.render(world, **options)
                hotter = self.image(renderer)
                if emitter == MAT_FIRE:
                    self.assertEqual((int(world.grid[27 * 32 + 10]) >> 8) & 255, 255)
                self.assertGreater(np.abs(hotter[:104] - hotter_still[:104]).sum(), np.abs(warm[:104] - still[:104]).sum())
                saved = world.snapshot().to_dict()
                world.restore({**saved, 'tick': 60})
                renderer.render(world, distortion=False, **options)
                later_still = self.image(renderer)
                renderer.render(world, **options)
                later = self.image(renderer)
                self.assertFalse(np.array_equal((later - later_still)[:104], (hotter - hotter_still)[:104]))
                # Fire temperatures exceed the saturated byte; full energy drives strength.
                for x in range(32):
                    world.set_cell(x, 18, MAT_STONE)
                renderer.render(world, distortion=False, **options)
                blocked_still = self.image(renderer)
                renderer.render(world, **options)
                np.testing.assert_array_equal(self.image(renderer)[:68], blocked_still[:68])
                np.testing.assert_array_equal(self.image(renderer)[72:76], blocked_still[72:76])
                for y in range(27, 31):
                    for x in range(10, 22):
                        world.set_cell(x, y, MAT_AIR)
                renderer.render(world, distortion=False, **options)
                clear = self.image(renderer)
                renderer.render(world, **options)
                np.testing.assert_array_equal(self.image(renderer), clear)
                renderer.render(world, styled=False)
                plain = self.image(renderer)
                renderer.render(world, styled=False, distortion=False)
                np.testing.assert_array_equal(self.image(renderer), plain)
                self.assertEqual(world.energy_balance().drift_q, 0)

    def test_fire_and_lava_scatter_in_smoke_and_hot_steam_without_bloom(self):
        for material in (MAT_SMOKE, MAT_STEAM):
            for emitter in (MAT_FIRE, MAT_LAVA):
                with self.subTest(material=material, emitter=emitter), create_field(32, 32) as world, MaterialRenderer(32, 32, output_size=(128, 128)) as renderer:
                    for y in range(12, 28):
                        for x in range(14, 24):
                            world.set_cell(x, y, material, thermal=180 if material == MAT_STEAM else 40)
                    for y in range(18, 23):
                        world.set_cell(6, y, emitter, thermal=255)
                        world.set_energy(6, y, 650 * 256)
                    before = world.snapshot().to_dict()
                    renderer.render(world, lighting=False, bloom=False, water=False)
                    unlit = self.image(renderer)
                    renderer.render(world, bloom=False, water=False)
                    lit = self.image(renderer)
                    self.assertGreater(int(lit[82, 74, 0] - unlit[82, 74, 0]), 20)
                    self.assertEqual(world.snapshot().to_dict(), before)
                    renderer.render(world, bloom=False, water=False)
                    np.testing.assert_array_equal(self.image(renderer), lit)
                    # A single-cell opaque divider stops illumination of the volume.
                    for y in range(32):
                        world.set_cell(12, y, MAT_STONE)
                    renderer.render(world, bloom=False, water=False)
                    np.testing.assert_array_equal(self.image(renderer)[82, 74], unlit[82, 74])
                    for y in range(32):
                        world.set_cell(12, y, MAT_AIR)
                    for y in range(18, 23):
                        world.set_cell(6, y, MAT_AIR)
                    renderer.render(world, bloom=False, water=False)
                    np.testing.assert_array_equal(self.image(renderer)[82, 74], unlit[82, 74])
                    self.assertEqual(world.energy_balance().drift_q, 0)

    def test_haze_reconstruction_clips_walls_and_disappears_with_gas(self):
        with create_field(32, 32) as world, MaterialRenderer(32, 32, output_size=(128, 128)) as renderer:
            for y in range(32):
                world.set_cell(12, y, MAT_STONE)
            renderer.render(world, lighting=False, bloom=False)
            clear = self.image(renderer)
            for y in range(10, 25):
                for x in range(13, 22):
                    world.set_cell(x, y, MAT_STEAM, thermal=180)
            before = world.snapshot().to_dict()
            renderer.render(world, lighting=False, bloom=False)
            volume = self.image(renderer)
            np.testing.assert_array_equal(volume[40:100, 44:52], clear[40:100, 44:52])
            self.assertGreater(int(np.abs(volume[48:88, 56:80] - clear[48:88, 56:80]).max()), 10)
            self.assertEqual(world.snapshot().to_dict(), before)
            for y in range(10, 25):
                for x in range(13, 22):
                    world.set_cell(x, y, MAT_AIR)
            renderer.render(world, lighting=False, bloom=False)
            np.testing.assert_array_equal(self.image(renderer), clear)
            self.assertEqual(world.energy_balance().drift_q, 0)

    def test_fire_and_lava_reflections_without_lighting_or_bloom(self):
        for material in (MAT_FIRE, MAT_LAVA):
            with self.subTest(material=material), create_field(64, 64) as world, MaterialRenderer(64, 64, output_size=(256, 256)) as renderer:
                for y in range(32, 60):
                    for x in range(8, 56):
                        world.set_cell(x, y, MAT_WATER, thermal=20)
                for y in range(20, 24):
                    for x in range(20, 32):
                        world.set_cell(x, y, material, thermal=255)
                        world.set_energy(x, y, 650 * 256)
                before = world.snapshot().to_dict()
                renderer.render(world, lighting=False, bloom=False, water=False)
                dry = self.image(renderer)
                renderer.render(world, lighting=False, bloom=False, refraction=False)
                reflected = self.image(renderer)
                self.assertGreater(int((reflected[164:180, 84:124, 0] - dry[164:180, 84:124, 0]).max()), 50)
                self.assertEqual(world.snapshot().to_dict(), before)
                # A sealed water pocket has no exposed mirror surface.
                for x in range(8, 56):
                    world.set_cell(x, 31, MAT_STONE)
                renderer.render(world, lighting=False, bloom=False, refraction=False)
                sealed = self.image(renderer)
                np.testing.assert_array_equal(sealed[164:180, 84:124], dry[164:180, 84:124])
                # Moving the surface must rebuild the mirrored image immediately.
                for x in range(8, 56):
                    world.set_cell(x, 31, MAT_AIR)
                for y in range(32, 36):
                    for x in range(8, 56):
                        world.set_cell(x, y, MAT_AIR)
                changed = world.snapshot().to_dict()
                renderer.render(world, lighting=False, bloom=False, refraction=False)
                moved = self.image(renderer)
                self.assertGreater(int(moved[196:212, 84:124, 0].max()), 50)
                self.assertLess(int(moved[164:176, 84:124, 0].max()), int(reflected[164:176, 84:124, 0].max()) - 50)
                self.assertEqual(world.snapshot().to_dict(), changed)
                for y in range(20, 24):
                    for x in range(20, 32):
                        world.set_cell(x, y, MAT_AIR)
                renderer.render(world, lighting=False, bloom=False, refraction=False)
                removed = self.image(renderer)
                self.assertLess(int(removed[196:212, 84:124, 0].max()), int(moved[196:212, 84:124, 0].max()) - 50)
                self.assertEqual(world.energy_balance().drift_q, 0)

    def test_refraction_reveals_nearest_floor_and_blocks_hidden_terrain(self):
        with create_field(32, 32) as world, MaterialRenderer(32, 32, output_size=(128, 128)) as renderer:
            for y in range(12, 28):
                for x in range(4, 28):
                    world.set_cell(x, y, MAT_WATER, thermal=20)
            for x in range(4, 28):
                world.set_cell(x, 28, MAT_METAL if x % 4 < 2 else MAT_STONE)
            before = world.snapshot().to_dict()
            renderer.render(world, lighting=False, bloom=False, water=False)
            opaque = self.image(renderer)
            renderer.render(world, lighting=False, bloom=False, reflections=False)
            refracted = self.image(renderer)
            self.assertGreater(int(np.abs(refracted[80:108, 24:104] - opaque[80:108, 24:104]).max()), 10)
            self.assertEqual(world.snapshot().to_dict(), before)
            # A nearer solid shelf hides the lower patterned floor completely.
            for x in range(4, 28):
                world.set_cell(x, 22, MAT_STONE)
            renderer.render(world, lighting=False, bloom=False, reflections=False)
            shelf = self.image(renderer)
            for x in range(4, 28):
                world.set_cell(x, 28, MAT_FIRE, thermal=255)
                world.set_energy(x, 28, 650 * 256)
            renderer.render(world, lighting=False, bloom=False, reflections=False)
            np.testing.assert_array_equal(self.image(renderer)[56:80, 28:100], shelf[56:80, 28:100])
            self.assertEqual(world.energy_balance().drift_q, 0)

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
