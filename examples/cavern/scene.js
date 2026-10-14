import { createStateSpaceWorld3D, MAT } from '../../dist/sdk/state-space-world.js';
export const SIZE=64, DEFAULT_SEED=0x5eedcafe, GENERATOR_VERSION='cavern-seed-1';
export function terrainHash(x,y,z,seed){
  let h=(Math.imul(x,374761393)+Math.imul(y,668265263)+Math.imul(z,1442695041)+seed)>>>0;
  h=Math.imul(h^(h>>>13),1274126177)>>>0;return(h^(h>>>16))>>>0;
}
export function createLevel(seed=DEFAULT_SEED){
  if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw new Error('Invalid cavern seed.');
  const field=createStateSpaceWorld3D({fillMaterial:MAT.STONE}),snapshot=field.snapshot(),e=snapshot.chunkSize;
  const palette=new Map();
  for(const m of [MAT.AIR,MAT.STONE,MAT.SAND,MAT.WATER,MAT.ICE,MAT.LAVA,MAT.GLASS]){
    const cell=createStateSpaceWorld3D({width:1,height:1,depth:1,chunkSize:1});cell.setCell(0,0,0,m,m===MAT.LAVA?240:m===MAT.ICE?5:20);const c=cell.snapshot().chunks[0];palette.set(m,[c.packedCells[0],c.energyQ[0]]);
  }
  const put=(x,y,z,m)=>{const k=Math.floor(x/e)+2*(Math.floor(y/e)+2*Math.floor(z/e)),i=x%e+e*(y%e+e*(z%e)),c=snapshot.chunks[k],[v,q]=palette.get(m);c.packedCells[i]=v;c.energyQ[i]=q;};
  // Integer ellipsoids and coarse hashed strata; generator version freezes this formula.
  for(let z=1;z<63;z++)for(let y=1;y<63;y++)for(let x=1;x<63;x++){
    const dx=x-32,dz=z-32,dy=y-26,noise=terrainHash(x>>2,y>>2,z>>2,seed)%97;
    const central=dx*dx*3+dz*dz*3+dy*dy*7<1820+noise;
    const side=(x-12)**2*3+(z-47)**2*4+(y-29)**2*6<440+noise;
    const tunnel=x>7&&x<56&&z>44&&z<50&&y>23&&y<33;
    if(central||side||tunnel)put(x,y,z,MAT.AIR);
    else if(y>38&&y<43&&terrainHash(x>>2,0,z>>2,seed)%7===0)put(x,y,z,MAT.SAND);
  }
  const box=(x0,y0,z0,x1,y1,z1,m)=>{for(let z=z0;z<=z1;z++)for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)put(x,y,z,m);};
  // A guaranteed authored challenge occupies the seeded cavern, across XYZ chunk seams.
  box(17,24,17,46,36,46,MAT.AIR);
  box(16,37,16,47,39,47,MAT.STONE);
  box(17,32,17,27,36,46,MAT.STONE);box(36,32,17,46,36,46,MAT.STONE);
  box(28,35,21,35,36,34,MAT.STONE);
  box(27,26,20,36,34,20,MAT.STONE);
  box(27,26,21,27,34,28,MAT.STONE);box(36,26,21,36,34,28,MAT.STONE);
  box(28,32,35,35,36,35,MAT.STONE);
  box(28,28,28,35,34,28,MAT.STONE);
  box(28,29,21,35,34,27,MAT.WATER);
  box(40,31,39,44,31,43,MAT.GLASS);box(41,30,40,43,30,42,MAT.ICE);
  box(19,31,40,23,31,44,MAT.STONE);box(20,30,41,22,30,43,MAT.LAVA);
  box(40,32,29,43,32,33,MAT.GLASS);
  // Seed-dependent pools and columns provide actual simulation beyond the route.
  for(let z=46;z<50;z++)for(let x=9;x<54;x++)if(terrainHash(x,0,z,seed)%5===0)put(x,29,z,MAT.WATER);
  field.restore(snapshot);return field;
}
