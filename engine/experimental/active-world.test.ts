import {describe,it,expect} from 'vitest';
import {createStateSpaceActiveWorld3D,validateActiveWorldSnapshot,MAT} from './active-world.js';
import {createStateSpaceWorld3D} from './world.js';
import {createGpuActiveWorld3D} from './active-world-gpu.js';
describe('M4 active world contract',()=>{
 it('rejects invalid diagnostic intervals before creating a GPU context',async()=>{
  for(const activityReadbackInterval of [-1,.5,3601,NaN,Infinity]){
   await expect(createGpuActiveWorld3D({activityReadbackInterval})).rejects.toThrow(/activity readback interval/);
  }
 });
 it('keeps M3 bounds and a separate versioned snapshot envelope',()=>{
  expect(()=>createStateSpaceWorld3D({width:128})).toThrow();
  for(const options of [{width:129},{chunkSize:2},{width:63},{width:128,height:128,depth:128,chunkSize:4}])expect(()=>createStateSpaceActiveWorld3D(options)).toThrow();
  const m3=createStateSpaceWorld3D({width:8,height:8,depth:8,chunkSize:4}),m4=createStateSpaceActiveWorld3D({width:8,height:8,depth:8,chunkSize:4});
  expect(()=>m4.restore(m3.snapshot())).toThrow();expect(()=>m3.restore(m4.snapshot())).toThrow();
 });
 it('retains exact material law and repartitioned restart',()=>{
  const options={width:16,height:16,depth:16,chunkSize:8},a=createStateSpaceActiveWorld3D(options),b=createStateSpaceWorld3D(options),c=createStateSpaceActiveWorld3D({...options,chunkSize:4});
  for(let z=0;z<16;z++)for(let x=0;x<16;x++)for(const y of [6,7,8,9]){const m=[MAT.SAND,MAT.WATER,MAT.STEAM,MAT.LAVA][(x+y+z)%4];a.setCell(x,y,z,m,20);b.setCell(x,y,z,m,20);}
  a.step(3);b.step(3);c.restore(a.snapshot());a.step(29);b.step(29);c.step(29);
  expect(a.grid).toEqual(b.grid);expect(a.energyQ).toEqual(b.energyQ);expect(c.grid).toEqual(a.grid);expect(c.energyQ).toEqual(a.energyQ);expect(a.energyBalance().driftQ).toBe(0n);
 });
 it('validates whole edits and snapshots before mutation',()=>{
  const w=createStateSpaceActiveWorld3D({width:8,height:8,depth:8,chunkSize:4});w.setCell(3,3,3,MAT.WATER);const before=w.snapshot(),balance=w.energyBalance();
  const invalid=[{edits:null},{edits:new Array(1)},{edits:[{x:3,y:3,z:3,energyQ:5},{x:8,y:3,z:3,material:1}]}];
  for(const options of invalid){expect(()=>w.step(1,options as never)).toThrow();expect(w.snapshot()).toEqual(before);expect(w.energyBalance()).toEqual(balance);}
  for(const state of [{...before,worldVersion:'finite-chunks-1'},{...before,chunks:new Array(8)},{...before,tick:-1}]){expect(()=>w.restore(state)).toThrow();expect(w.snapshot()).toEqual(before);}
 });
 it('keeps public reads owned and activity out of portable state',()=>{
  const w=createStateSpaceActiveWorld3D({width:8,height:8,depth:8,chunkSize:4});w.setCell(3,3,3,MAT.WATER);const s=w.snapshot(),flat=validateActiveWorldSnapshot(s);flat.packedCells.fill(0);s.chunks[0].energyQ.fill(0);
  expect(w.sample(3,3,3).material).toBe(MAT.WATER);expect(Object.keys(w.snapshot()).sort()).toEqual(['schemaVersion','worldVersion','rulesVersion','materialCatalogHash','width','height','depth','chunkSize','tick','chunks'].sort());
 });
});
