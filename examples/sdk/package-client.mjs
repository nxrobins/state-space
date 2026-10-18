// Executed after installing the tarball in an independent temporary project.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createStateSpaceStructuralWorld3D, MAT} from 'state-space-engine/experimental/3d/structural-world';
const exports=Object.keys(JSON.parse(readFileSync(new URL('./node_modules/state-space-engine/package.json',import.meta.url))).exports);
for(const path of exports)await import('state-space-engine'+(path==='.'?'':path.slice(1)));
const world=createStateSpaceStructuralWorld3D({width:8,height:8,depth:8,chunkSize:4});
world.setCell(3,1,3,MAT.STONE,20);
for(let z=0;z<8;z++)for(let x=0;x<8;x++)world.setCell(x,7,z,MAT.STONE,20);
world.step(3);const saved=world.snapshot();world.step(3);const final=world.snapshot();
world.restore(saved);world.step(3);assert.deepEqual(world.snapshot(),final);
assert.equal(world.energyBalance().driftQ,0n);
assert.equal(final.packedCells[3+8*(6+8*3)]&255,MAT.STONE);
assert.throws(()=>world.restore({...final,rulesVersion:'bad'}));assert.deepEqual(world.snapshot(),final);
console.log(JSON.stringify({exportCount:exports.length,structuralRestartExact:true,positiveFall:true,invalidRestoreAtomic:true,energyDriftQ:'0'}));
