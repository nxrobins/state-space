/** Integer-only ca-3d-m1 kernel. Each invocation owns exactly one output cell. */
export const VOLUME_SHADER = `
struct Params { shape: vec4u, rule: vec4u, tick: vec4u }
@group(0) @binding(0) var<storage, read> cells: array<u32>;
@group(0) @binding(1) var<storage, read> energies: array<u32>;
@group(0) @binding(2) var<storage, read_write> nextCells: array<u32>;
@group(0) @binding(3) var<storage, read_write> nextEnergies: array<u32>;
@group(0) @binding(4) var<storage, read> cold: array<u32>;
@group(0) @binding(5) var<uniform> p: Params;
const MAX_Q = 0x3fffffffu;
fn prop(v: u32, f: u32) -> u32 { return cold[(v & 255u) * 24u + f]; }
fn temperature(v: u32, q: u32) -> u32 {
  let heat = q - prop(v,16u)*256u; let latent = prop(v,19u)*256u;
  var t = max(0, i32(heat)-i32(latent));
  let boil = prop(v,13u); let up = select(prop(v,12u),boil,boil!=0u);
  let ut = prop(v,select(2u,3u,boil!=0u))*256u;
  let freeze = prop(v,14u); let down = select(prop(v,15u),freeze,freeze!=0u);
  let dt = prop(v,select(9u,8u,freeze!=0u))*256u;
  if (up!=0u && heat>=latent+ut) { t=max(i32(ut),i32(heat)-i32(prop(up,19u)*256u)); }
  else if (down!=0u && heat<=latent+dt) { t=min(i32(dt),max(0,i32(heat)-i32(prop(down,19u)*256u))); }
  return u32(t);
}
fn thermal(v:u32,q:u32)->u32 { return (v&0xffff00ffu)|(min(255u,temperature(v,q)/256u)<<8u); }
fn transition(v:u32,q:u32)->u32 {
  let chemical=prop(v,16u)*256u;
  let boil=prop(v,13u); let up=select(prop(v,12u),boil,boil!=0u);
  if(up!=0u && q>=chemical+(prop(up,19u)+prop(v,select(2u,3u,boil!=0u)))*256u) {return up;}
  let freeze=prop(v,14u); let down=select(prop(v,15u),freeze,freeze!=0u);
  if(down!=0u && q<=chemical+(prop(down,19u)+prop(v,select(9u,8u,freeze!=0u)))*256u) {return down;}
  return v&255u;
}
fn pairEnergy(a:u32,b:u32,ea:u32,eb:u32)->u32 {
  let ta=temperature(a,ea); let tb=temperature(b,eb);
  let ca=prop(a,1u); let cb=prop(b,1u); var k=0u;
  if(ca+cb>0u){k=2u*ca*cb/(ca+cb);}
  let diff=u32(abs(i32(ta)-i32(tb)));
  var flux=min(diff/512u*k+(diff%512u*k+511u)/512u,diff/2u);
  if(ta>tb){flux=min(flux,min(ea-prop(a,16u)*256u,MAX_Q-eb)); return ea-flux;}
  flux=min(flux,min(eb-prop(b,16u)*256u,MAX_Q-ea)); return ea+flux;
}
fn phase(v:u32)->u32{return (v>>24u)&15u;}
fn fixed(v:u32)->bool{return phase(v)==0u||phase(v)==6u;}
fn liquid(v:u32)->bool{let s=phase(v);return s==2u||s==3u||s==7u;}
fn falling(v:u32)->bool{return phase(v)==1u||liquid(v);}
fn gas(v:u32)->bool{return phase(v)==4u;}
fn fall(s:u32,t:u32)->bool{return falling(cells[s])&&!fixed(cells[s])&&!fixed(cells[t])&&prop(cells[s],0u)>prop(cells[t],0u);}
fn rank(i:u32)->i32{return i32(temperature(cells[i],energies[i])/256u)*2-i32(prop(cells[i],0u));}
fn rise(s:u32,t:u32)->bool{return (cells[s]&255u)!=0u&&gas(cells[s])&&gas(cells[t])&&rank(s)>rank(t)+16;}
fn index(c:vec3i)->u32{return u32(c.x)+p.shape.x*(u32(c.y)+p.shape.y*u32(c.z));}
fn inside(c:vec3i)->bool{return all(c>=vec3i(0))&&all(c<vec3i(p.shape.xyz));}
fn hasFall(i:u32,c:vec3i)->bool{
  if(c.y+1>=i32(p.shape.y)){return false;}
  let b=c+vec3i(0,1,0); if(fall(i,index(b))){return true;}
  let offsets=array<vec3i,4>(vec3i(1,0,0),vec3i(-1,0,0),vec3i(0,0,1),vec3i(0,0,-1));
  for(var k=0u;k<4u;k++){let t=b+offsets[k];if(inside(t)&&fall(i,index(t))){return true;}}
  return false;
}
fn spread(s:u32,t:u32)->bool{return liquid(cells[s])&&gas(cells[t])&&prop(cells[s],0u)>prop(cells[t],0u);}
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3u){
  let i=id.x; if(i>=p.shape.w){return;}
  let v=cells[i]; let q=energies[i]; var outV=v;var outQ=q;
  let kind=p.rule.x;
  if(kind==6u){let m=transition(v,q);if(m!=(v&255u)){outV=thermal((v&0xf0ff0000u)|m|(prop(m,20u)<<24u),q);}}
  else {
    let c=vec3i(vec3u(i%p.shape.x,(i/p.shape.x)%p.shape.y,i/(p.shape.x*p.shape.y)));
    let vertical=kind==0u||kind==1u||kind==3u;
    let axis=select(p.rule.y,1u,vertical); let lower=(u32(c[axis])&1u)!=p.rule.z;
    var delta=vec3i(0);delta[axis]=1;
    if(kind==1u){delta[p.rule.y]=i32(p.rule.w);}
    let a=c-select(vec3i(0),delta,lower); let b=a+delta;
    if(inside(a)&&inside(b)){
      let ai=index(a);let bi=index(b);var swap=false;
      if(kind==0u){swap=fall(ai,bi);}
      else if(kind==1u){swap=!fall(ai,index(a+vec3i(0,1,0)))&&fall(ai,bi);}
      else if(kind==2u){swap=(spread(ai,bi)&&!hasFall(ai,a))||(spread(bi,ai)&&!hasFall(bi,b));}
      else if(kind==3u){swap=rise(bi,ai);}
      else if(kind==4u){
        var hash=ai*374761393u+p.rule.y*668265263u+p.tick.x*1442695041u;
        hash=(hash^(hash>>13u))*1274126177u;
        let choose=((hash^(hash>>16u))&1u)==0u;
        let s=select(bi,ai,choose);let t=select(ai,bi,choose);let sy=select(b.y,a.y,choose);
        swap=(cells[s]&255u)!=0u&&gas(cells[s])&&gas(cells[t])&&(sy==0||!rise(s,s-p.shape.x))&&((cells[t]&255u)==0u||rank(s)>rank(t)+16);
      } else if(kind==5u){
        let eq=pairEnergy(cells[ai],cells[bi],energies[ai],energies[bi]);
        outQ=select(eq,energies[ai]+energies[bi]-eq,lower);outV=thermal(v,outQ);
      }
      if(swap){let other=select(bi,ai,lower);outV=cells[other];outQ=energies[other];}
    }
  }
  nextCells[i]=outV;nextEnergies[i]=outQ;
}
`;

/** Bounded edits/readback, separate from the immutable physics passes. */
export const ACCESS_SHADER = VOLUME_SHADER.slice(0, VOLUME_SHADER.indexOf('@compute')) + `
@group(0) @binding(6) var<storage, read> edits:array<vec4u>;
@group(0) @binding(7) var<storage, read_write> results:array<u32>;
@compute @workgroup_size(64) fn edit(@builtin(global_invocation_id) id:vec3u){
  if(id.x>=p.tick.y){return;}let e=edits[id.x];let old=nextEnergies[e.x];
  if(e.y==0u){nextCells[e.x]=e.z;nextEnergies[e.x]=e.w;}
  else{nextCells[e.x]=thermal(nextCells[e.x],e.w);nextEnergies[e.x]=e.w;}
  results[id.x*2u]=old;results[id.x*2u+1u]=e.w;
}
@compute @workgroup_size(64) fn query(@builtin(global_invocation_id) id:vec3u){
  let i=id.x;let size=p.rule.xyz; if(i>=size.x*size.y*size.z){return;}
  let c=p.tick.xyz+vec3u(i%size.x,(i/size.x)%size.y,i/(size.x*size.y));
  results[i]=cells[index(vec3i(c))];
}
`;

/** Storage partitioning changes addresses only; pair ownership and hashing stay global. */
export function chunkShaders(edge:number) {
  if (!edge) return {physics:VOLUME_SHADER,access:ACCESS_SHADER};
  const mapping=`
const EDGE=${edge}u;
fn linear(c:vec3i)->u32{return u32(c.x)+p.shape.x*(u32(c.y)+p.shape.y*u32(c.z));}
fn index(c:vec3i)->u32{
 let u=vec3u(c);let n=p.shape.xyz/EDGE;let k=u/EDGE;let local=u%EDGE;
 return (k.x+n.x*(k.y+n.y*k.z))*EDGE*EDGE*EDGE+local.x+EDGE*(local.y+EDGE*local.z);
}
fn coordinate(i:u32)->vec3i{
 let n=p.shape.xyz/EDGE;let k=i/(EDGE*EDGE*EDGE);let local=i%(EDGE*EDGE*EDGE);
 return vec3i(vec3u(k%n.x,(k/n.x)%n.y,k/(n.x*n.y))*EDGE+vec3u(local%EDGE,(local/EDGE)%EDGE,local/(EDGE*EDGE)));
}
`;
  const translate=(code:string)=>code
    .replace('fn index(c:vec3i)->u32{return u32(c.x)+p.shape.x*(u32(c.y)+p.shape.y*u32(c.z));}',mapping)
    .replace('let c=vec3i(vec3u(i%p.shape.x,(i/p.shape.x)%p.shape.y,i/(p.shape.x*p.shape.y)));','let c=coordinate(i);')
    .replace('var hash=ai*374761393u','var hash=linear(a)*374761393u')
    .replace('!rise(s,s-p.shape.x)','!rise(s,index(select(b,a,choose)+vec3i(0,-1,0)))');
  const dirty=`
@group(0) @binding(6) var<storage,read_write> dirty:array<atomic<u32>>;
fn mark(c:vec3i){
 let n=p.shape.xyz/EDGE;let k=vec3u(c)/EDGE;
 atomicStore(&dirty[k.x+n.x*(k.y+n.y*k.z)],1u);
}
fn changed(c:vec3i){
 mark(c);
 for(var axis=0u;axis<3u;axis++){
  var t=c;t[axis]-=1;
  if(inside(t)&&u32(c[axis])%EDGE==0u){mark(t);}
  t=c;t[axis]+=1;
  if(inside(t)&&u32(t[axis])%EDGE==0u){mark(t);}
 }
}
`;
  const physics=translate(VOLUME_SHADER).replace('@compute @workgroup_size(64) fn main',dirty+'\n@compute @workgroup_size(64) fn main')
    .replace('nextCells[i]=outV;nextEnergies[i]=outQ;','if((v&255u)!=(outV&255u)){changed(coordinate(i));}\n  nextCells[i]=outV;nextEnergies[i]=outQ;');
  return {physics,access:translate(ACCESS_SHADER)};
}
