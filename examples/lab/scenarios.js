// Scene construction only. Every physical edit and solve belongs to the public SDK.
import { MAT, DEFAULT_REGISTRY } from '../../dist/sdk/state-space.js';

const rectangle = (world, x0, y0, x1, y1, material, thermal) => {
  for (let y = y0; y <= y1; y += 1) for (let x = x0; x <= x1; x += 1) world.setCell(x, y, material, thermal);
};
const floor = world => rectangle(world, 0, world.height - 2, world.width - 1, world.height - 1, MAT.STONE, 20);

export const SCENARIOS = Object.freeze([
  { id: 'span', title: 'A span that carries its load', category: 'SUPPORT', width: 40, height: 28, ticks: 16,
    description: 'A bonded metal beam transfers its weight into two stone pillars. Inspect the load paths, then erase a pillar or break a bond.',
    limit: 'Cellular strength and vertical translation. No bending, elastic strain or rotation.',
    build(world) { floor(world); rectangle(world, 7, 14, 7, 25, MAT.STONE, 20); rectangle(world, 32, 14, 32, 25, MAT.STONE, 20); rectangle(world, 7, 13, 32, 13, MAT.METAL, 20); } },
  { id: 'fragment', title: 'A fragment falls as one', category: 'COHESION', width: 40, height: 28, ticks: 12,
    description: 'A metal plate keeps its bonds and shape as it falls. It displaces water when it reaches the pool; separate bodies do not weld on contact.',
    limit: 'One cell of downward translation per tick. Fluids use local density exchange, without a pressure field.',
    build(world) { floor(world); rectangle(world, 12, 3, 20, 5, MAT.METAL, 20); rectangle(world, 1, 22, 38, 25, MAT.WATER, 40); } },
  { id: 'fire', title: 'Fire changes what can stand', category: 'COUPLED PHYSICS', width: 32, height: 24, ticks: 12,
    description: 'A hot wooden pin supports a metal span. Combustion consumes the pin; the span loses its support and falls. Heat, fuel and smoke share the same state.',
    limit: 'Finite cellular fuel and oxidizer. No flame front, radiation, gas pressure or mechanical energy accounting.',
    build(world) { floor(world); rectangle(world, 10, 5, 20, 5, MAT.METAL, 20); world.setCell(15, 6, MAT.WOOD, 255); world.setAnchor(15, 6); world.setIntegrity(15, 6, 0); } },
  { id: 'phase', title: 'Heat changes a structure', category: 'PHASE & ENERGY', width: 32, height: 24, ticks: 8,
    description: 'A metal plate receives a finite heat dose. Melting removes its bonds and the liquid flows. In the cold tray, water freezes and creates new bonds.',
    limit: 'Temperature uses model units, not degrees Celsius. Heat is diffusive; phase transitions preserve the discrete energy ledger.',
    build(world) {
      floor(world); rectangle(world, 3, 3, 9, 4, MAT.METAL, 20);
      for (let y = 3; y <= 4; y += 1) for (let x = 3; x <= 9; x += 1) world.setEnergy(x, y, 800 * 256);
      rectangle(world, 20, 21, 27, 21, MAT.WATER, 0);
      for (let x = 20; x <= 27; x += 1) world.setEnergy(x, 21, 0);
    } },
  { id: 'extension', title: 'A material of your own', category: 'EXTENSION', width: 32, height: 24, ticks: 8,
    description: 'Copper and molten copper come from the SDK example registry. A heated copper strip melts through the existing rules. Copper grit uses material ID 255.',
    limit: 'A registry configures existing physical rules. Adding pressure, rotation or a new reaction law requires an engine extension.',
    customRegistry: true,
    build(world) {
      floor(world); rectangle(world, 5, 4, 13, 4, 18, 20); rectangle(world, 20, 4, 23, 7, 255, 20);
      for (let x = 5; x <= 13; x += 1) world.setEnergy(x, 4, 400 * 256);
    } },
]);

export function scenarioById(id) {
  const scene = SCENARIOS.find(value => value.id === id);
  if (!scene) throw new Error(`Unknown scenario: ${id}`);
  return scene;
}

let extended;
export async function scenarioRegistry(scene) {
  if (!scene.customRegistry) return DEFAULT_REGISTRY;
  if (!extended) {
    const response = await fetch(new URL('../sdk/materials.json', import.meta.url));
    if (!response.ok) throw new Error(`Cannot load extension materials: ${response.status}`);
    extended = await DEFAULT_REGISTRY.extend(await response.json());
  }
  return extended;
}
