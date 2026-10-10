"""Actual native GPU presentation must preserve state and use full energy."""
import unittest
import numpy as np

from engine import MaterialRenderer, create_field


class RenderingTests(unittest.TestCase):
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
