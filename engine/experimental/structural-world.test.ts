import { describe, expect, test } from 'vitest';
import { createStateSpaceStructuralWorld3D as world, validateStructuralSnapshot3D } from './structural-world-core.js';
import { MAT, ENERGY_SCALE, createStateSpaceField3D } from './3d.js';
import { ANCHOR_3D, BONDS_3D, FRESH_3D, structuralNeighbor, solveStructure3D, normalizeStructure3D } from './structural-mechanics.js';
import { seedState } from '../thermal.js';
import { DEFAULT_REGISTRY } from '../registry.js';
import type { StructuralState3D } from './structural-mechanics.js';
const small=()=>world({width:8,height:8,depth:8,chunkSize:4});
const at=(x:number,y:number,z:number)=>x+8*(y+8*z);
const counts=(grid:Uint32Array)=>{const n=new Map<number,number>();for(const v of grid)n.set(v&255,(n.get(v&255)??0)+1);return n;};
const tuples=(s:StructuralState3D)=>Array.from(s.grid,(v,i)=>`${v}:${s.energyQ[i]}`).sort();

describe('M5 structural CPU contract (tiny bounded fixtures)',()=>{
 test('six reciprocal directions and a coherent conservative cross',()=>{
  const w=small();w.setCell(3,3,3,MAT.STONE);
  for(const [x,y,z] of [[2,3,3],[4,3,3],[3,2,3],[3,4,3],[3,3,2],[3,3,4]])w.setCell(x,y,z,MAT.STONE);
  expect(w.sample(3,3,3).bonds).toEqual(Array(6).fill(true));
  const before={grid:w.grid,energyQ:w.energyQ,structure:w.structure},p=w.inspectStructure();
  expect(p.movedCells).toBe(7);expect(new Set(p.sources).size).toBe(512);
  expect(tuples(p.state)).toEqual(tuples(before));expect(counts(p.state.grid)).toEqual(counts(before.grid));
  for(let i=0;i<512;i++)if(p.moving[i])expect(p.sources[i+8]).toBe(i);
  expect(p.state.structure).toEqual(normalizeStructure3D(p.state.grid,p.state.structure,w));
 });
 test('Z-spanning beam transfers load beyond a chunk seam to its anchor',()=>{
  const w=small();for(let z=1;z<=6;z++)w.setCell(3,3,z,MAT.STONE);w.setAnchor(3,3,1,true);
  const p=w.inspectStructure();expect(p.movedCells).toBe(0);expect(p.supportedWeight).toBe(24);
  expect(p.reactions[at(3,3,1)]).toBe(24);
  for(let z=1;z<=6;z++)expect(p.distances[at(3,3,z)]).toBe(z-1);
  w.setCell(3,3,1,MAT.AIR);expect(w.inspectStructure().movedCells).toBe(5);
 });
 test('integer remainder goes to the lowest canonical support index',()=>{
  const w=small();w.setCell(3,3,3,MAT.STONE);
  for(const [x,y,z] of [[2,3,3],[4,3,3],[3,3,2]]){w.setCell(x,y,z,MAT.STONE);w.setAnchor(x,y,z,true);}
  const p=w.inspectStructure();expect(p.supportedWeight).toBe(16);
  expect(p.reactions[at(3,3,2)]).toBe(6);expect(p.reactions[at(2,3,3)]).toBe(5);expect(p.reactions[at(4,3,3)]).toBe(5);
 });
 test('unbonded vertical contact carries load without welding',()=>{
  const w=small();for(let y=3;y<8;y++)w.setCell(3,y,3,MAT.STONE);w.setBond(3,3,3,3,false);
  const p=w.inspectStructure();expect(p.movedCells).toBe(0);expect(p.supportedWeight).toBe(20);
  expect(p.reactions[at(3,7,3)]).toBe(20);expect(p.componentIds[at(3,3,3)]).not.toBe(p.componentIds[at(3,4,3)]);
  w.step();expect(w.sample(3,3,3).bonds[3]).toBe(false);
 });
 test('separate falling components stop at a pin and do not weld on contact',()=>{
  const w=small();w.setCell(3,2,3,MAT.STONE);w.setCell(3,4,3,MAT.STONE);w.setAnchor(3,4,3,true);
  w.step();expect(w.sample(3,3,3).material).toBe(MAT.STONE);expect(w.sample(3,3,3).bonds[3]).toBe(false);
  const p=w.inspectStructure();expect(p.movedCells).toBe(0);w.step();expect(w.sample(3,3,3).bonds[3]).toBe(false);
  expect(w.energyBalance().driftQ).toBe(0n);
 });
 test('stacked distinct free components move together without bonding',()=>{
  const w=small();w.setCell(3,2,3,MAT.STONE);w.setCell(3,3,3,MAT.GLASS);w.setBond(3,2,3,3,false);
  const p=w.inspectStructure();expect(p.movedCells).toBe(2);expect(p.sources[at(3,3,3)]).toBe(at(3,2,3));
  expect(p.sources[at(3,4,3)]).toBe(at(3,3,3));expect(p.state.structure[at(3,3,3)]&BONDS_3D[3]).toBe(0);
 });
 test('closed floor and dense obstacles block components on every Z plane',()=>{
  const w=small();w.setCell(3,7,1,MAT.STONE);w.setCell(3,7,6,MAT.STONE);
  expect(w.inspectStructure().movedCells).toBe(0);
  w.setCell(5,3,2,MAT.ICE,0);w.setCell(5,4,2,MAT.SAND,0);expect(w.inspectStructure().moving[at(5,3,2)]).toBe(0);
 });
 test('thermal capacity reaches zero and failure removes reciprocal bonds',()=>{
  const w=small();w.setCell(3,3,3,MAT.STONE,20);w.setCell(4,3,3,MAT.STONE,20);w.setAnchor(3,3,3,true);
  const cold=w.inspectStructure();expect(cold.capacities[at(3,3,3)]).toBe(3200);
  // Cross the latent plateau as well as the softening interval before solving.
  w.setEnergy(3,3,3,1000*ENERGY_SCALE);expect(w.sample(3,3,3).temperatureQ).toBeGreaterThanOrEqual(244*ENERGY_SCALE);
  const hot=w.inspectStructure();expect(hot.capacities[at(3,3,3)]).toBe(0);
  expect(hot.brokenCells).toBe(1);expect(hot.state.structure[at(3,3,3)]).toBe(ANCHOR_3D);
  expect(hot.moving[at(4,3,3)]).toBe(1);expect(hot.state.structure[at(4,4,3)]&BONDS_3D[0]).toBe(0);
 });
 test('overload damages integrity while preserving matter and energy',()=>{
  const w=small();for(let z=1;z<7;z++)w.setCell(3,3,z,MAT.STONE);w.setAnchor(3,3,1,true);w.setIntegrity(3,3,1,1);
  const p=w.inspectStructure();expect(p.capacities[at(3,3,1)]).toBe(12);expect(p.brokenCells).toBe(1);
  expect(tuples(p.state)).toEqual(tuples({grid:w.grid,energyQ:w.energyQ,structure:w.structure}));
 });
 test('melting clears the pin and freezing seeds new bonds',()=>{
  const w=small();w.setCell(3,4,3,MAT.ICE,0);w.setAnchor(3,4,3,true);w.setEnergy(3,4,3,100*ENERGY_SCALE);
  w.step();expect(w.sample(3,4,3).material).toBe(MAT.WATER);expect(w.sample(3,4,3).structure).toBe(0);
  const frozen=world({width:8,height:8,depth:8,chunkSize:4,fillMaterial:MAT.ICE});
  frozen.setCell(3,7,3,MAT.WATER,0);frozen.setEnergy(3,7,3,0);frozen.step();
  expect(frozen.sample(3,7,3).material).toBe(MAT.ICE);expect(frozen.sample(3,7,3).integrity).toBe(255);
  expect(frozen.sample(3,7,3).bonds.filter(Boolean)).toHaveLength(5);expect(frozen.energyBalance().driftQ).toBe(0n);expect(w.energyBalance().driftQ).toBe(0n);
 });
 test('invalid edits are atomic, including null and a bad late command',()=>{
  const w=small(),before=w.snapshot(),balance=w.energyBalance();
  for(const edits of [null,[null],[{kind:'material',x:2,y:2,z:2,material:MAT.STONE},{kind:'anchor',x:0,y:0,z:0,anchored:true}],new Array(1)]) {
    expect(()=>w.edit(edits as never)).toThrow();expect(w.snapshot()).toEqual(before);expect(w.energyBalance()).toEqual(balance);
  }
  expect(()=>w.step(1,{edits:null} as never)).toThrow();expect(w.tick).toBe(0);
  w.step(0);w.step(0,{edits:undefined});w.step(0,{edits:[]});expect(w.snapshot()).toEqual(before);
 });
 test('snapshot versions, malformed bonds, reserved bits and invalid energies reject atomically',()=>{
  const w=small();w.setCell(3,3,3,MAT.STONE);const before=w.snapshot();
  const invalid=[{...before,rulesVersion:'ca-3d-m1'},createStateSpaceField3D(8,8,8).snapshot(),{...before,extra:1}];
  for(const value of [BONDS_3D[0]|255,FRESH_3D|255,0x10000]){const s=structuredClone(before);s.structure[at(3,3,3)]=value;invalid.push(s);}
  const bad=structuredClone(before);bad.energyQ[0]=-1;invalid.push(bad);
  for(const s of invalid){expect(()=>w.restore(s as never)).toThrow();expect(w.snapshot()).toEqual(before);}
  expect(()=>validateStructuralSnapshot3D(before)).not.toThrow();
 });
 test('public reads and inspection plans are isolated, edits are accounted and restore resets baseline',()=>{
  const w=small(),initial=w.energyBalance().initialQ;w.setCell(3,3,3,MAT.LAVA,240);expect(w.energyBalance().externalQ).not.toBe(0n);
  const saved=w.snapshot();w.grid.fill(0);w.energyQ.fill(0);w.structure.fill(0);w.inspectStructure().state.grid.fill(0);
  expect(w.snapshot()).toEqual(saved);const buffers={grid:new Uint32Array(512),energyQ:new Uint32Array(512),structure:new Uint32Array(512)};
  expect(w.copyStateInto(buffers)).toBe(0);expect(buffers.grid).toEqual(w.grid);
  expect(()=>w.copyStateInto({...buffers,structure:buffers.grid})).toThrow();
  w.restore(saved);expect(w.energyBalance().externalQ).toBe(0n);expect(w.energyBalance().initialQ).not.toBe(initial);expect(w.energyBalance().driftQ).toBe(0n);
 });
 test('partition metadata and odd restart do not change complete trajectories',()=>{
  const a=small();a.setCell(3,2,3,MAT.STONE);a.setCell(4,2,3,MAT.GLASS);a.setCell(5,5,3,MAT.WATER);
  const b=world({width:8,height:8,depth:8,chunkSize:8});b.restore(a.snapshot());a.step(3);const restart=a.snapshot();a.step(9);b.step(12);
  expect({...b.snapshot(),chunkSize:4}).toEqual(a.snapshot());b.restore(restart);b.step(9);expect({...b.snapshot(),chunkSize:4}).toEqual(a.snapshot());expect(b.energyBalance().driftQ).toBe(0n);
 });
 test('odd rectangular and singleton axes have correct boundaries and permutations',()=>{
  for(const g of [{width:1,height:1,depth:1},{width:1,height:5,depth:3},{width:5,height:3,depth:1},{width:3,height:5,depth:7}]) {
    const n=g.width*g.height*g.depth,p=DEFAULT_REGISTRY.material(MAT.STONE),seed=seedState(new Uint32Array(n).fill(MAT.STONE|(20<<8)|(p.properties.default_phase<<24)));
    const state={...seed,structure:normalizeStructure3D(seed.grid,new Uint32Array(n).fill(255|FRESH_3D),g)},plan=solveStructure3D(state,g);
    expect(plan.movedCells).toBe(0);expect(plan.supportedWeight).toBe(n*4);expect(plan.reactions.reduce((a,b)=>a+b,0)).toBe(n*4);
    for(let i=0;i<n;i++)for(let dir=0;dir<6;dir++){const j=structuralNeighbor(i,dir,g);if(j>=0)expect(structuralNeighbor(j,dir^1,g)).toBe(i);}
  }
 });
});
