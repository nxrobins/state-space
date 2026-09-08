// Run after installing the npm tarball. No checkout-relative engine imports.
import { readFileSync } from 'node:fs';
import { DEFAULT_REGISTRY, createStateSpaceField } from 'state-space-engine';

const registry = await DEFAULT_REGISTRY.extend(JSON.parse(readFileSync(new URL('./materials.json', import.meta.url), 'utf8')));
const world = createStateSpaceField(8, 7, 0, registry);
for (let x = 0; x < world.width; x += 1) world.setCell(x, 6, 1, 20);
world.setCell(2, 1, 18, 120, 9);
world.setCell(4, 2, 20, 150);
world.setCell(1, 1, 255, 20, 15);
world.setEnergy(2, 1, 120 * 256 + 17);
const initial = world.packedSnapshot();
const passes = world.step(3, { inspect: true });
const saved = world.packedSnapshot();
world.step(2);
const final = world.packedSnapshot();
world.restore(saved);
world.step(2);
if (JSON.stringify(world.packedSnapshot()) !== JSON.stringify(final)) throw new Error('Snapshot continuation differed');
console.log(JSON.stringify({ catalogHash: registry.hash, initial, final, energyQ: world.energyLedger().totalQ.toString(), replayEqual: true,
  passes: passes.map(report => ({ tick: report.tick, passId: report.passId,
    changes: report.changes.map(change => ({ index: change.index, before_packed: change.beforePacked, after_packed: change.afterPacked,
      before_energy_q: change.beforeEnergyQ, after_energy_q: change.afterEnergyQ,
      before_structure: change.beforeStructure, after_structure: change.afterStructure })), deltaQ: (report.after.totalQ - report.before.totalQ).toString() })) }));
world.close();
