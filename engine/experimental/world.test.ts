import { describe,it,expect } from 'vitest';
import { createStateSpaceWorld3D,validateWorldSnapshot,MAT } from './world.js';
import { createStateSpaceField3D,MAX_CELLS_3D } from './3d.js';
describe('finite chunked 3D worlds',()=>{
  it('keeps M1 bounds and rejects incompatible and incomplete worlds',()=>{
    expect(MAX_CELLS_3D).toBe(32768);expect(()=>createStateSpaceField3D(64,64,64)).toThrow();
    for(const options of [{width:65},{chunkSize:3},{width:63},{chunkSize:2},{width:undefined,height:0}])expect(()=>createStateSpaceWorld3D(options)).toThrow();
    const w=createStateSpaceWorld3D({width:8,height:8,depth:8,chunkSize:4}),before=w.snapshot();
    for(const value of [{...before,width:undefined},{...before,chunks:new Array(8)},{...before,worldVersion:'other'},{...before,rulesVersion:'ca-v4'},{...before,chunks:before.chunks.slice(1)},createStateSpaceField3D(8,8,8).snapshot()]){
      expect(()=>w.restore(value as typeof before)).toThrow();expect(w.snapshot()).toEqual(before);
    }
  });
  it('matches the volume reference through all seams and re-partitioned restarts',()=>{
    const a=createStateSpaceWorld3D({width:8,height:8,depth:8,chunkSize:4}),b=createStateSpaceWorld3D({width:8,height:8,depth:8,chunkSize:2}),ref=createStateSpaceField3D(8,8,8);
    for(let z=0;z<8;z++)for(let y=0;y<8;y++)for(let x=0;x<8;x++){
      const m=[MAT.AIR,MAT.WATER,MAT.SAND,MAT.ICE,MAT.STEAM,MAT.LAVA][(x+3*y+5*z)%6],t=(x*29+y*11+z*17)%256;
      a.setCell(x,y,z,m,t);ref.setCell(x,y,z,m,t);
    }
    a.restore(a.snapshot());ref.restore(ref.snapshot());a.step(3);ref.step(3);b.restore(a.snapshot());
    a.step(29);b.step(29);ref.step(29);
    expect(validateWorldSnapshot(a.snapshot())).toEqual(ref.snapshot());expect(validateWorldSnapshot(b.snapshot())).toEqual(ref.snapshot());expect(a.energyBalance().driftQ).toBe(0n);
  });
  it('accounts external edits and preflights whole batches before mutation',()=>{
    const w=createStateSpaceWorld3D({width:8,height:8,depth:8,chunkSize:4}),before=w.snapshot();
    for(const edits of [new Array(1),[{x:3,y:3,z:3,material:2},{x:8,y:0,z:0,energyQ:0}],[{x:3,y:3,z:3,energyQ:0},{x:3,y:3,z:3,material:2}]]){
      expect(()=>w.step(1,{edits})).toThrow();expect(w.snapshot()).toEqual(before);
    }
    w.step(0,{edits:[{x:3,y:3,z:3,material:MAT.WATER},{x:4,y:4,z:4,energyQ:123456}]});
    expect(w.energyBalance().externalQ).not.toBe(0n);w.step(17);expect(w.energyBalance().driftQ).toBe(0n);
    w.restore(w.snapshot());expect(w.energyBalance().externalQ).toBe(0n);
  });
  it('rejects null edit batches without changing state, tick or accounting',()=>{
    const w=createStateSpaceWorld3D({width:4,height:4,depth:4,chunkSize:2});
    w.setCell(1,0,1,MAT.SAND);w.setEnergy(2,1,2,123456);w.step(3);
    const before=w.snapshot(),balance=w.energyBalance();
    const options={edits:null} as unknown as Parameters<typeof w.step>[1];
    for(const ticks of [0,1]){
      expect(()=>w.step(ticks,options)).toThrow();
      expect(w.snapshot()).toEqual(before);expect(w.energyBalance()).toEqual(balance);
    }
  });
  it('keeps omitted, undefined and empty edit batches equivalent',()=>{
    const worlds=Array.from({length:3},()=>createStateSpaceWorld3D({width:4,height:4,depth:4,chunkSize:2}));
    for(const w of worlds)w.setCell(1,0,1,MAT.WATER);
    worlds[0].step();worlds[1].step(1,{edits:undefined});worlds[2].step(1,{edits:[]});
    for(const w of worlds){expect(w.snapshot()).toEqual(worlds[0].snapshot());expect(w.energyBalance()).toEqual(worlds[0].energyBalance());}
  });
  it('returns isolated global neighborhoods spanning faces, edges and corners',()=>{
    const w=createStateSpaceWorld3D({width:8,height:8,depth:8,chunkSize:4});
    for(let z=3;z<5;z++)for(let y=3;y<5;y++)for(let x=3;x<5;x++)w.setCell(x,y,z,MAT.STONE,x+y+z);
    const q=w.queryRegion({origin:[3,3,3],size:[2,2,2]});expect([...q.grid].every(v=>(v&255)===MAT.STONE)).toBe(true);q.grid.fill(0);
    const saved=w.snapshot();saved.chunks[0].packedCells.fill(0);expect(w.sample(3,3,3).material).toBe(MAT.STONE);
  });
});
