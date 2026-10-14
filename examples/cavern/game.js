import { PHASE, MAT, createStateSpaceWorld3D, validateWorldSnapshot } from '../../dist/sdk/state-space-world.js';
import { createLevel, SIZE, DEFAULT_SEED } from './scene.js';

export const GAME_VERSION='volume-cavern-1', Q=256, MAX_TICKS=7200;
const HALF=77, HEIGHT=448, EYE=400;
const solid=v=>[PHASE.SOLID,PHASE.POWDER,PHASE.FROZEN].includes((v>>>24)&15);
const int=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const sum=q=>q.reduce((s,v)=>s+BigInt(v),0n);
export function commandFor(input={},tick){
  const c={tick,moveX:input.moveX??0,moveZ:input.moveZ??0,jump:input.jump??false,tool:input.tool??'none',look:input.look??[256,0,0]};
  if (!Array.isArray(c.look) || c.look.length !== 3) throw new Error('Invalid deterministic game command.');
  c.look = [c.look[0],c.look[1],c.look[2]];
  if(!int(tick,1,MAX_TICKS)||!int(c.moveX,-256,256)||!int(c.moveZ,-256,256)||c.moveX**2+c.moveZ**2>257**2||typeof c.jump!=='boolean'||!['none','carve','freeze'].includes(c.tool)||!Array.isArray(c.look)||c.look.length!==3||!c.look.every(v=>int(v,-256,256))||c.look.reduce((s,v)=>s+v*v,0)<250**2||c.look.reduce((s,v)=>s+v*v,0)>262**2||(input.tick!==undefined&&input.tick!==tick))throw new Error('Invalid deterministic game command.');
  return{...c,look:[...c.look]};
}
export const regionFor=p=>({origin:[p.x,p.y-HEIGHT/2,p.z].map(v=>Math.max(0,Math.min(SIZE-16,Math.floor(v/Q)-8))),size:[16,16,16]});
export function readCell(region,x,y,z){
  if(x<0||y<0||z<0||x>=SIZE||y>=SIZE||z>=SIZE)return MAT.STONE;
  const [a,b,c]=[x,y,z].map((v,i)=>v-region.origin[i]);
  if(a<0||b<0||c<0||a>=region.size[0]||b>=region.size[1]||c>=region.size[2])throw new Error('Gameplay query escaped its bounded neighborhood.');
  return region.grid[a+region.size[0]*(b+region.size[1]*c)];
}
export function raycast(region,eye,look){
  let previous='';
  // 1/32-cell fixed-point samples; max component advances eight Q per sample.
  for(let n=0;n<=160;n++){
    const cell=eye.map((v,i)=>Math.floor((v+Math.trunc(look[i]*n/32))/Q)),key=cell.join(',');if(key===previous)continue;previous=key;
    if(cell.some(v=>v<0||v>=SIZE))return null;
    if(cell.some((v,i)=>v<region.origin[i]||v>=region.origin[i]+region.size[i]))return null;
    const word=readCell(region,...cell),m=word&255;if(m!==MAT.AIR&&m!==MAT.STEAM)return{cell,material:m};
  }
  return null;
}
export function lookAt(player,point){const delta=[point[0]*Q-player.x,point[1]*Q-(player.y-EYE),point[2]*Q-player.z],length=Math.hypot(...delta);return delta.map(v=>Math.round(v/length*256));}
export class CpuTerrain {
  constructor(field=createLevel()){this.field=field;}
  get tick(){return this.field.tick;}
  async step(ticks=1,options={}){return this.field.step(ticks,options);}
  async queryRegion(request){return this.field.queryRegion(request);}
  async snapshot(){return this.field.snapshot();}
  async restore(s){this.field.restore(s);}
}

export class CavernGame {
  constructor(field,seed=DEFAULT_SEED){this.seed=seed;this.field=field;this.player={x:22*Q,y:32*Q,z:31*Q,vy:0,grounded:true,wet:false,jumpHeld:false,cooldown:0,blocked:false};this.status='playing';this.events=[];this.commands=[];this.region=null;this.look=[256,0,0];this.busy=false;this.initialQ=0n;this.externalQ=0n;}
  async initialize(){if(this.busy)throw new Error('Game operation in flight.');this.region=await this.field.queryRegion(regionFor(this.player));this.initialQ=sum((await this.field.snapshot()).chunks.flatMap(c=>c.energyQ));}
  eye(){const p=this.player;return[p.x,p.y-EYE,p.z];}
  target(look=this.look){return raycast(this.region,this.eye(),look);}
  overlaps(x,y,z){for(let cz=Math.floor((z-HALF)/Q);cz<=Math.floor((z+HALF-1)/Q);cz++)for(let cy=Math.floor((y-HEIGHT)/Q);cy<=Math.floor((y-1)/Q);cy++)for(let cx=Math.floor((x-HALF)/Q);cx<=Math.floor((x+HALF-1)/Q);cx++)if(solid(readCell(this.region,cx,cy,cz)))return true;return false;}
  sweep(axis,velocity){const p=this.player,sign=Math.sign(velocity);let remaining=Math.abs(velocity);while(remaining){const distance=Math.min(remaining,Q),start=p[axis];p[axis]=start+distance*sign;if(this.overlaps(p.x,p.y,p.z)){let low=0,high=distance;while(low+1<high){const mid=Math.floor((low+high)/2);p[axis]=start+mid*sign;if(this.overlaps(p.x,p.y,p.z))high=mid;else low=mid;}p[axis]=start+low*sign;return true;}remaining-=distance;}return false;}
  emit(type,extra={}){this.events.push({tick:this.field.tick,type,...extra});}
  edits(command){
    if(command.tool==='none'||this.player.cooldown||this.status==='lost')return[];
    const hit=this.target(command.look);if(!hit)return[];const edits=[];
    for(let z=hit.cell[2]-1;z<=hit.cell[2]+1;z++)for(let y=hit.cell[1]-1;y<=hit.cell[1]+1;y++)for(let x=hit.cell[0]-1;x<=hit.cell[0]+1;x++){
      if(x<1||y<1||z<1||x>=SIZE-1||y>=SIZE-1||z>=SIZE-1)continue;
      const m=readCell(this.region,x,y,z)&255;
      if(command.tool==='carve'&&[MAT.STONE,MAT.GLASS,MAT.SAND,MAT.ICE].includes(m))edits.push({x,y,z,material:MAT.AIR});
      if(command.tool==='freeze'&&[MAT.WATER,MAT.ICE].includes(m))edits.push({x,y,z,energyQ:0});
    }
    if(edits.length){this.player.cooldown=6;this.emit(command.tool==='carve'?'carved':'cooled',{tick:command.tick,cells:edits.length,target:[...hit.cell]});}return edits;
  }
  async step(input={}){
    if(this.busy)throw new Error('Game operation in flight.');const c=commandFor(input,this.field.tick+1);this.busy=true;
    const beforePlayer={...this.player},beforeEvents=this.events.length;
    try{
      const p=this.player;if(p.cooldown)p.cooldown--;const edits=this.edits(c);
      this.region=await this.field.step(1,{edits,region:regionFor(p)});this.look=[...c.look];
      if(this.status!=='lost'){
        if(this.overlaps(p.x,p.y,p.z)){
          let freed=false;for(let d=1;d<=3;d++)if(!this.overlaps(p.x,p.y-d*Q,p.z)){p.y-=d*Q;p.vy=0;freed=true;break;}
          if(!freed){this.status='lost';this.emit('trapped');}
        }
        if(this.status!=='lost'){
          const body=readCell(this.region,Math.floor(p.x/Q),Math.floor((p.y-Q/2)/Q),Math.floor(p.z/Q))&255;p.wet=body===MAT.WATER;
          if(c.jump&&((p.grounded&&!p.jumpHeld)||p.wet))p.vy=p.wet?-65:-115;
          p.vy=Math.min(p.wet?45:150,p.vy+(p.wet?4:8));
          const speed=p.wet?28:48;p.blocked=this.sweep('x',Math.trunc(c.moveX*speed/Q));p.blocked=this.sweep('z',Math.trunc(c.moveZ*speed/Q))||p.blocked;
          const hit=this.sweep('y',p.vy),falling=p.vy>0;if(hit)p.vy=0;p.grounded=(hit&&falling)||this.overlaps(p.x,p.y+1,p.z);
          const under=readCell(this.region,Math.floor(p.x/Q),Math.floor(p.y/Q),Math.floor(p.z/Q))&255;
          if(p.grounded&&under===MAT.ICE&&!this.events.some(e=>e.type==='ice-walk'))this.emit('ice-walk');
          if(this.status==='playing'&&p.x>=40*Q&&p.y<=32*Q+1&&p.z>=29*Q&&p.z<=34*Q&&this.events.some(e=>e.type==='carved')&&this.events.some(e=>e.type==='ice-walk')){this.status='won';this.emit('crossed');}
          if(p.y>61*Q){this.status='lost';this.emit('fell');}
        }
      }
      p.jumpHeld=c.jump;this.commands.push(c);return c;
    }catch(error){this.player=beforePlayer;this.events.length=beforeEvents;throw error;}
    finally{this.busy=false;}
  }
  async snapshot(){if(this.busy)throw new Error('Game operation in flight.');return{version:GAME_VERSION,seed:this.seed,field:await this.field.snapshot(),player:{...this.player},look:[...this.look],status:this.status,events:structuredClone(this.events)};}
  async restore(saved){
    if(this.busy)throw new Error('Game operation in flight.');saved=structuredClone(saved);validateGameSnapshot(saved);this.busy=true;
    try{await this.field.restore(saved.field);this.seed=saved.seed;this.player={...saved.player};this.look=[...saved.look];this.status=saved.status;this.events=structuredClone(saved.events);this.commands=[];this.region=await this.field.queryRegion(regionFor(this.player));this.initialQ=sum(saved.field.chunks.flatMap(c=>c.energyQ));this.externalQ=0n;}
    finally{this.busy=false;}
  }
}
export function validateGameSnapshot(s){
  if(!s||typeof s!=='object'||Object.keys(s).sort().join(',')!=='events,field,look,player,seed,status,version'||s.version!==GAME_VERSION||!int(s.seed,0,0xffffffff)||!['playing','won','lost'].includes(s.status))throw new Error('Incompatible game snapshot.');
  validateWorldSnapshot(s.field);if(s.field.width!==SIZE||s.field.height!==SIZE||s.field.depth!==SIZE||s.field.tick>MAX_TICKS)throw new Error('Invalid game field.');
  const p=s.player,keys='blocked,cooldown,grounded,jumpHeld,vy,wet,x,y,z';
  if(!p||Object.keys(p).sort().join(',')!==keys||![p.x,p.z].every(v=>int(v,HALF,SIZE*Q-HALF))||!int(p.y,HEIGHT,SIZE*Q)||!int(p.vy,-150,150)||!int(p.cooldown,0,6)||!['grounded','wet','jumpHeld','blocked'].every(k=>typeof p[k]==='boolean'))throw new Error('Invalid game player.');
  commandFor({look:s.look},1);
  if(!Array.isArray(s.events)||s.events.length>MAX_TICKS*2||Array.from(s.events).some(e=>!e||!int(e.tick,0,s.field.tick)||!['carved','cooled','ice-walk','crossed','trapped','fell'].includes(e.type)||Object.values(e).some(v=>v===undefined)))throw new Error('Invalid game events.');
  // Also reject a saved actor inside terrain, before the live field changes.
  const grid=validateWorldSnapshot(s.field).packedCells;
  for(let z=Math.floor((p.z-HALF)/Q);z<=Math.floor((p.z+HALF-1)/Q);z++)for(let y=Math.floor((p.y-HEIGHT)/Q);y<=Math.floor((p.y-1)/Q);y++)for(let x=Math.floor((p.x-HALF)/Q);x<=Math.floor((p.x+HALF-1)/Q);x++)if(s.status==='playing'&&solid(grid[x+SIZE*(y+SIZE*z)]))throw new Error('Saved actor overlaps terrain.');
  return s;
}
/** Route uses the same reach-limited tools and collision as human input. */
export function routeInput(game){
  const t=game.field.tick,p=game.player;let input={};
  if(t<24)input={moveX:256};
  else if(t<48)input={tool:'carve',look:lookAt(p,[29.5,32.5,28.5])};
  else if(t<115)input={look:lookAt(p,[31,32,31])};
  else if(game.status==='playing')input={moveX:256,tool:'freeze',jump:p.blocked||p.wet,look:lookAt(p,[Math.min(35.5,p.x/Q+3),33.5,31])};
  return input;
}
