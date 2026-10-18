// Bounded public-package smoke: one 4-cubed edit, no ticks or GPU imports.
import assert from 'node:assert/strict';
import { createStateSpaceStructuralWorld3D, MAT } from 'state-space-engine/experimental/3d/structural-world';
import { translateStructuralRegion3D, INTERVENTION_RULES_VERSION_3D } from 'state-space-engine/experimental/3d/interventions';

const world = createStateSpaceStructuralWorld3D({width:4,height:4,depth:4,chunkSize:4});
world.setCell(1,1,1,MAT.STONE,160);
world.setIntegrity(1,1,1,73);
const original = world.snapshot();
const result = translateStructuralRegion3D(original,{cells:[[1,1,1]],path:[[1,0,0]]});
const source = 21, destination = 22;
for (const key of ['packedCells','energyQ','structure']) {
  assert.equal(result.snapshot[key][destination],original[key][source]);
  assert.equal(result.snapshot[key][source],original[key][destination]);
}
assert.deepEqual(world.snapshot(),original);
assert.equal(result.snapshot.tick,0);
assert.equal(result.receipt.externalEnergyQ,0n);
assert.equal(result.receipt.rulesVersion,INTERVENTION_RULES_VERSION_3D);
assert.deepEqual([...result.receipt.editedCells],[source,destination]);
console.log(JSON.stringify({passed:true,entry:'state-space-engine/experimental/3d/interventions',cells:64,physicsTicks:0,gpu:false}));
