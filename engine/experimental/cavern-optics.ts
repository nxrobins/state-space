/** Bounded, presentation-only rays through the committed material grid. */
export const CAVERN_OPTICS = `
@group(0) @binding(8) var<uniform> optics:vec4f;
struct OpticalRay {point:vec3f,normal:vec3f,word:u32,water:f32,ice:f32,distance:f32,hit:bool}
fn dielectric(m:u32)->bool{return m==2u||m==8u;}
fn ior(m:u32)->f32{if(m==2u){return 1.333;}if(m==8u){return 1.31;}return 1.;}
// Exact cell boundary traversal for visibility, with a hard 64-cell/40-voxel
// budget. Four subsequent dielectric interfaces permit exit refraction and
// total internal reflection; exhausting a budget returns the dark environment.
fn opticalRay(origin:vec3f,direction:vec3f)->OpticalRay{
 var result:OpticalRay;result.point=origin;result.normal=vec3f(0,1,0);result.word=0u;result.water=0.;result.ice=0.;result.distance=0.;result.hit=false;
 var p=origin;var d=direction;var interfaces=0u;
 for(var step=0u;step<64u;step++){
  let c=vec3i(floor(p));if(any(c<vec3i(0))||any(c>=vec3i(SHAPE))){break;}
  let word=cell(c);let m=word&255u;
  if(m!=0u&&m!=9u&&!dielectric(m)){result.point=p;result.word=word;result.hit=true;break;}
  let boundary=vec3f(c)+select(vec3f(0),vec3f(1),d>=vec3f(0));
  let safe=select(vec3f(1),d,abs(d)>vec3f(.000001));
  let times=select(vec3f(1e6),max((boundary-p)/safe,vec3f(0)),abs(d)>vec3f(.000001));
  var axis=0u;if(times.y<times.x){axis=1u;}if(times.z<times[axis]){axis=2u;}
  let travel=times[axis];if(result.distance+travel>40.){break;}
  if(m==2u){result.water+=travel;}if(m==8u){result.ice+=travel;}result.distance+=travel;
  var normal=vec3f(0);normal[axis]=-sign(d[axis]);
  let crossing=p+d*travel;let next=vec3i(floor(crossing-normal*.001));let nextMaterial=cell(next)&255u;
  if((dielectric(m)||dielectric(nextMaterial))&&ior(m)!=ior(nextMaterial)&&(nextMaterial==0u||nextMaterial==9u||dielectric(nextMaterial))){
   if(interfaces>=4u){break;}interfaces++;
   let bent=refract(d,normal,ior(m)/ior(nextMaterial));
   if(dot(bent,bent)<.000001){d=reflect(d,normal);p=crossing+normal*.001;}
   else{d=normalize(bent);p=crossing-normal*.001;}
  }else{p=crossing-normal*.001;}
  result.normal=normal;
 }
 return result;
}
fn rayColor(ray:OpticalRay)->vec3f{
 var color=vec3f(.028,.045,.06);
 if(ray.hit){
  let m=ray.word&255u;let p=ray.point;let n=ray.normal;
  var uv=p.xy;if(abs(n.x)>.5){uv=p.zy;}if(abs(n.y)>.5){uv=p.xz;}
  let rock=textureSampleLevel(rockColor,rockSampler,uv*.28,1.5).rgb;
  var albedo=rock*vec3f(.44,.48,.51);if(m==3u){albedo=vec3f(.43,.31,.16);}if(m==11u){albedo=vec3f(.1,.19,.2);}
  let toLamp=camera.eye.xyz+camera.up.xyz*.35+camera.right.xyz*.35-p;
  var irradiance=vec3f(.065,.095,.135)+vec3f(1.,.87,.69)*max(0.,dot(n,normalize(toLamp)))*24./(3.+dot(toLamp,toLamp));
  // Secondary surfaces use bounded unshadowed direct illumination. The ray
  // itself still stops at the first opaque voxel, including offscreen ones.
  for(var k=0u;k<CHUNKS;k++){
   let light=lights[k];let d=light.position.xyz-p;let d2=dot(d,d);
   if(light.position.w>0.&&d2>.01&&d2<484.){irradiance+=light.color.rgb*max(0.,dot(n,normalize(d)))*pow(1.-d2/484.,2.)/(1.+d2);}
  }
  color=albedo*irradiance;
  if(m==10u||m==17u){let hot=clamp((f32((ray.word>>8u)&255u)-170.)/85.,0.,1.);let crust=smoothstep(.39,.64,noise(p*2.9)+noise(p*9.7)*.12);color+=mix(vec3f(2.8,.18,.008),vec3f(.04,.009,.003),crust)*hot;}
  color=mix(color,vec3f(.028,.045,.06),1.-exp(-ray.distance*.012));
 }
 let absorption=exp(-vec3f(.24,.075,.035)*ray.water-vec3f(.13,.045,.025)*ray.ice);
 return color*absorption+vec3f(.018,.07,.09)*(1.-absorption);
}
fn waterIce(v:Out,view:vec3f)->vec3f{
 let frozen=(v.word&255u)==8u;let front=dot(view,v.normal)>=0.;let geometric=select(-v.normal,v.normal,front);
 let p=v.world;let time=optics.x;var normal=geometric;
 if(!frozen){
  let waves=vec3f(cos(p.x*2.3+p.z*.7+time*1.3)*.055,cos(p.y*2.1+p.x*.4+time)*.035,sin(p.z*2.7-p.x*.6-time*1.1)*.045);
  normal=normalize(geometric+waves-geometric*dot(geometric,waves));
 }else{
  let ripple=vec3f(noise(p*4.1),noise(p.zxy*4.1),noise(p.yzx*4.1))-.5;
  normal=normalize(geometric+(ripple-geometric*dot(geometric,ripple))*.08);
 }
 let materialIor=select(1.333,1.31,frozen);let eta=select(materialIor,1./materialIor,front);
 let transmitted=refract(-view,normal,eta);let tir=dot(transmitted,transmitted)<.000001;
 let f0=pow((materialIor-1.)/(materialIor+1.),2.);
 let fresnel=select(f0+(1.-f0)*pow(1.-max(0.,dot(view,normal)),5.),1.,tir);
 let reflected=rayColor(opticalRay(p+geometric*.004,normalize(reflect(-view,normal))));
 var through=vec3f(0);if(!tir){through=rayColor(opticalRay(p-geometric*.004,normalize(transmitted)));}
 var color=mix(through,reflected,fresnel);
 // Fine static inclusions and frosted edges distinguish frozen water without
 // changing its physical surface or requiring a persistent visual state.
 if(frozen){
  let crack=pow(1.-abs(2.*noise(p*3.7)-1.),38.);
  let edge=1.-smoothstep(0.,.12,min(min(v.uv.x,1.-v.uv.x),min(v.uv.y,1.-v.uv.y)));
  let frost=clamp(crack*.4+edge*.12+pow(noise(p*17.),8.)*.3,0.,.65);
  color=mix(color,vec3f(.4,.58,.64)*v.irradiance,frost);
 }
 let lamp=normalize(camera.eye.xyz+camera.up.xyz*.35+camera.right.xyz*.35-p);
 let halfVector=normalize(view+lamp);let highlight=pow(max(0.,dot(normal,halfVector)),select(260.,120.,frozen));
 color+=vec3f(1.,.87,.69)*highlight*v.surface.z*.35;
 return color;
}
`;
