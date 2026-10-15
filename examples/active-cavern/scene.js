import {createStateSpaceActiveWorld3D,MAT} from '../../dist/sdk/state-space-active-world.js';
import {createStateSpaceField3D} from '../../dist/sdk/state-space-3d.js';
import {createLevel as createCrossing,terrainHash} from '../cavern/scene.js';
export const SIZE=128,DEFAULT_SEED=0x5eedcafe,GENERATOR_VERSION='active-cavern-seed-1';
export function createLevel(seed=DEFAULT_SEED){
 if(!Number.isInteger(seed)||seed<0||seed>0xffffffff)throw Error('Invalid cavern seed.');
 const field=createStateSpaceActiveWorld3D({fillMaterial:MAT.STONE}),snapshot=field.snapshot(),e=32,palette=new Map();
 for(const m of [MAT.AIR,MAT.WATER,MAT.ICE,MAT.LAVA]){const c=createStateSpaceField3D(1,1,1,m);c.setCell(0,0,0,m,m===MAT.ICE?5:m===MAT.LAVA?240:20);const s=c.snapshot();palette.set(m,[s.packedCells[0],s.energyQ[0]]);}
 const put=(x,y,z,v,q)=>{const k=Math.floor(x/e)+4*(Math.floor(y/e)+4*Math.floor(z/e)),i=x%e+e*(y%e+e*(z%e));snapshot.chunks[k].packedCells[i]=v;snapshot.chunks[k].energyQ[i]=q;};
 const material=(x,y,z,m)=>put(x,y,z,...palette.get(m));
 // Nine seeded chambers, connected along both horizontal axes, occupy the world.
 for(let z=1;z<127;z++)for(let y=38;y<82;y++)for(let x=1;x<127;x++){
  const cx=x<43?22:x<86?64:106,cz=z<43?22:z<86?64:106,cy=60+terrainHash(cx,0,cz,seed)%7,dx=x-cx,dz=z-cz,dy=y-cy;
  const noise=terrainHash(x>>2,y>>2,z>>2,seed)%97,chamber=dx*dx*2+dz*dz*2+dy*dy*5<560+noise;
  const corridor=y>=57&&y<=63&&x>=20&&x<=108&&z>=20&&z<=108&&(Math.min(Math.abs(x-22),Math.abs(x-64),Math.abs(x-106))<=2||Math.min(Math.abs(z-22),Math.abs(z-64),Math.abs(z-106))<=2);
  if(chamber||corridor)material(x,y,z,MAT.AIR);
 }
 // The authored dam/freezing challenge is translated to the central XYZ seams.
 const crossing=createCrossing(seed).snapshot();
 for(let z=16;z<48;z++)for(let y=16;y<48;y++)for(let x=16;x<48;x++){
  const k=Math.floor(x/e)+2*(Math.floor(y/e)+2*Math.floor(z/e)),i=x%e+e*(y%e+e*(z%e)),c=crossing.chunks[k];put(x+32,y+32,z+32,c.packedCells[i],c.energyQ[i]);
 }
 // Finite offscreen interactions demonstrate activity independent of the camera.
 for(let z=102;z<=108;z++)for(let x=19;x<=25;x++)for(let y=55;y<=58;y++)material(x,y,z,MAT.WATER);
 for(let z=20;z<=24;z++)for(let x=104;x<=108;x++)material(x,68,z,MAT.LAVA);
 for(let z=104;z<=108;z++)for(let x=104;x<=108;x++)material(x,65,z,MAT.ICE);
 field.restore(snapshot);return field;
}
