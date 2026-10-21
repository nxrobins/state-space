/// <reference types="@webgpu/types" />
/** Optional presentation only. The physical grid is bound read-only in every pass. */
import type { LatencyProfiler, Trace } from './latency.js';
import { makeLightList } from './light-list.js';
import { CELL_FRUSTUM_QUERY, CELL_FRUSTUM_CULL } from './surface-cull.js';
import { ROCK_TEXTURES } from './rock-textures.js';
import { CAVERN_OPTICS } from './cavern-optics.js';
import { CAVERN_HAZE } from './cavern-haze.js';
import {
  lightingCacheQueries,
  makeLightingCache,
  REFERENCE_LIGHTING_QUERIES,
} from './lighting-cache.js';

export function cavernShaders(
  shape: readonly number[],
  edge: number,
  capacity: number,
  cached = false,
) {
  const chunks = shape.reduce((a, b) => a * b, 1) / edge ** 3;
  const queries = cached ? lightingCacheQueries(shape) : REFERENCE_LIGHTING_QUERIES;
  const common = `
struct Camera {eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,projection:vec4f,shape:vec4u}
struct Light {position:vec4f,color:vec4f}
@group(0) @binding(0) var<storage,read> grid:array<u32>;
@group(0) @binding(2) var<uniform> camera:Camera;
const SHAPE=vec3u(${shape.map((n) => n + 'u').join(',')});const EDGE=${edge}u;const CHUNKS=${chunks}u;
const normals=array<vec3i,6>(vec3i(-1,0,0),vec3i(1,0,0),vec3i(0,-1,0),vec3i(0,1,0),vec3i(0,0,-1),vec3i(0,0,1));
fn coordinate(i:u32)->vec3u{let n=SHAPE/EDGE;let k=i/(EDGE*EDGE*EDGE);let l=i%(EDGE*EDGE*EDGE);return vec3u(k%n.x,(k/n.x)%n.y,k/(n.x*n.y))*EDGE+vec3u(l%EDGE,(l/EDGE)%EDGE,l/(EDGE*EDGE));}
fn index(c:vec3u)->u32{let n=SHAPE/EDGE;let k=c/EDGE;let l=c%EDGE;return (k.x+n.x*(k.y+n.y*k.z))*EDGE*EDGE*EDGE+l.x+EDGE*(l.y+EDGE*l.z);}
fn cell(c:vec3i)->u32{if(any(c<vec3i(0))||any(c>=vec3i(SHAPE))){return 1u;}return grid[index(vec3u(c))];}
fn opaque(c:vec3i)->f32{let m=cell(c)&255u;return select(1.,0.,m==0u||m==9u||m==2u||m==8u||m==11u);}
`;
  const lights =
    common +
    `
@group(0) @binding(3) var<storage,read_write> lights:array<Light>;
var<workgroup> best:array<u32,64>;var<workgroup> power:array<u32,64>;var<workgroup> amount:array<u32,64>;
// One exposed emitter per storage chunk. Fixed work, no atomics or readback.
@compute @workgroup_size(64) fn extract(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
 var selected=0xffffffffu;var heat=0u;var count=0u;
 for(var l=lane;l<EDGE*EDGE*EDGE;l+=64u){
  let i=group.x*EDGE*EDGE*EDGE+l;let v=grid[i];let m=v&255u;let t=(v>>8u)&255u;
  if((m==10u||m==17u)&&t>170u){
   let c=vec3i(coordinate(i));var exposed=false;
   for(var f=0u;f<6u;f++){let n=cell(c+normals[f])&255u;exposed=exposed||n==0u||n==9u;}
   if(exposed){count++;if(t>heat||(t==heat&&i<selected)){heat=t;selected=i;}}
  }
 }
 best[lane]=selected;power[lane]=heat;amount[lane]=count;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){let b=lane+stride;amount[lane]+=amount[b];if(power[b]>power[lane]||(power[b]==power[lane]&&best[b]<best[lane])){best[lane]=best[b];power[lane]=power[b];}}workgroupBarrier();}
 if(lane==0u){var out:Light;out.position=vec4f(0);out.color=vec4f(0);if(amount[0]>0u){out.position=vec4f(vec3f(coordinate(best[0]))+.5,1.);let hot=f32(power[0]-170u)/85.;out.color=vec4f(vec3f(1.,.22+.22*hot,.035)*hot*(10.+min(f32(amount[0]),24.)*2.),1.);}lights[group.x]=out;}
}`;
  const draw =
    common +
    `
@group(0) @binding(1) var<storage,read> faces:array<u32>;
@group(0) @binding(3) var<storage,read> lights:array<Light>;
@group(0) @binding(4) var rockColor:texture_2d<f32>;
@group(0) @binding(5) var rockNormal:texture_2d<f32>;
@group(0) @binding(6) var rockRoughness:texture_2d<f32>;
@group(0) @binding(7) var rockSampler:sampler;
${queries}
struct Out{@builtin(position) position:vec4f,@location(0) world:vec3f,@location(1) normal:vec3f,@location(2) uv:vec2f,@location(3) irradiance:vec3f,@location(4) surface:vec3f,@location(5) @interpolate(flat) word:u32,@location(6) @interpolate(flat) selected:u32}
${CELL_FRUSTUM_QUERY}
// Short bounded voxel rays. Endpoint cells are excluded so emitting lava does
// not occlude itself. Two receiver rays approximate a finite lamp/source size.
fn visibility(p:vec3f,source:vec3f)->f32{
 if(optics.z>.5){return hierarchyVisibility(p,source);}
 let delta=source-p;let distance=length(delta);let steps=min(48u,u32(ceil(distance*1.5)));
 let end=vec3i(floor(source));
 for(var s=1u;s<steps;s++){let q=vec3i(floor(p+delta*(f32(s)/f32(steps))));if(all(q==end)){break;}if(opaque(q)>.5){return 0.;}}
 return 1.;
}
@vertex fn vertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out{
 let face=faces[(vertex/6u)*${capacity}u+instance];let i=face/6u;let f=face%6u;let c=vec3f(coordinate(i));
 var out:Out;${CELL_FRUSTUM_CULL}
 let uvs=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(1,1),vec2f(0,0),vec2f(1,1),vec2f(0,1));let uv=uvs[vertex%6u];
 var local=vec3f(0);switch f{case 0u:{local=vec3f(0,uv.y,uv.x);}case 1u:{local=vec3f(1,uv.y,1-uv.x);}case 2u:{local=vec3f(uv.x,0,1-uv.y);}case 3u:{local=vec3f(uv.x,1,uv.y);}case 4u:{local=vec3f(1-uv.x,uv.y,0);}default:{local=vec3f(uv.x,uv.y,1);}}
 let word=grid[i];if((word&255u)==9u){local=vec3f(.39)+local*.22;}
 let n=vec3f(normals[f]);let world=c+local;let p=world-camera.eye.xyz;let z=dot(p,camera.forward.xyz);
 out.position=vec4f(dot(p,camera.right.xyz)/camera.projection.x,dot(p,camera.up.xyz)/camera.projection.y,camera.projection.z*z+camera.projection.w,z);
 // Corner occlusion samples the exterior of the face, across chunk seams.
 let outside=vec3i(coordinate(i))+normals[f];let side=vec3i(select(vec3f(-1),vec3f(1),local>vec3f(.5)));
 var a=vec3i(0);var b=vec3i(0);if(f<2u){a.y=side.y;b.z=side.z;}else if(f<4u){a.x=side.x;b.z=side.z;}else{a.x=side.x;b.y=side.y;}
 let ao=1.-.22*(opaque(outside+a)+opaque(outside+b)+opaque(outside+a+b));
 var wet=0.;for(var j=0u;j<6u;j++){wet=max(wet,select(0.,1.,(cell(vec3i(coordinate(i))+normals[j])&255u)==2u));}
 let receiver=world+n*.09+(vec3f(.5)-local)*.04;
 var light=vec3f(.065,.095,.135)*(.65+.35*max(0.,-n.y))*ao;
 let lamp=camera.eye.xyz+camera.up.xyz*.35+camera.right.xyz*.35;let ld=lamp-receiver;let distance=length(ld);
 let lampShadow=.5*(visibility(receiver,lamp)+visibility(receiver,lamp+camera.up.xyz*.22));
 let facing=max(0.,dot(n,normalize(ld)));let cone=.45+.55*pow(max(0.,dot(-normalize(ld),camera.forward.xyz)),2.);
 let lampPower=lampShadow*cone*24./(3.+distance*distance);
 light+=vec3f(1.,.87,.69)*facing*lampPower;
 for(var slot=0u;slot<regionalCount(receiver,false);slot++){let k=regionalSource(receiver,false,slot);let source=lights[k];if(source.position.w==0.){continue;}let d=source.position.xyz-receiver;let d2=dot(d,d);if(d2>484.||d2<.01){continue;}let cosine=max(0.,dot(n,normalize(d)));if(cosine<=0.){continue;}let shadow=.5*(visibility(receiver,source.position.xyz)+visibility(receiver,source.position.xyz+vec3f(0,-.3,0)));light+=source.color.rgb*cosine*shadow*pow(1.-d2/484.,2.)/(1.+d2);}
 out.world=world;out.normal=n;out.uv=uv;out.irradiance=light;out.surface=vec3f(ao,wet,lampPower);out.word=word;let cc=coordinate(i);out.selected=select(0u,1u,cc.x+SHAPE.x*(cc.y+SHAPE.y*cc.z)==camera.shape.w);return out;
}
fn hash(p:vec3f)->f32{var q=fract(p*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
fn noise(p:vec3f)->f32{let i=floor(p);let f=fract(p);let u=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3f(1,0,0)),u.x),mix(hash(i+vec3f(0,1,0)),hash(i+vec3f(1,1,0)),u.x),u.y),mix(mix(hash(i+vec3f(0,0,1)),hash(i+vec3f(1,0,1)),u.x),mix(hash(i+vec3f(0,1,1)),hash(i+vec3f(1,1,1)),u.x),u.y),u.z);}
${CAVERN_OPTICS}
@fragment fn fragment(v:Out)->@location(0) vec4f{
 let p=v.world;let broad=noise(p*.43);
 let footprint=max(length(dpdx(p)),length(dpdy(p)));
 let grain=mix(noise(p*9.7),.5,smoothstep(.025,.12,footprint));
 let fine=mix(noise(p*43.7),.5,smoothstep(.005,.03,footprint));
 let strata=sin(p.y*8.+broad*5.+noise(p*1.7)*2.);
 let ridge=noise(p*vec3f(3.7,8.1,3.7));
 let fissure=(1.-smoothstep(.008,.045,abs(fract(p.y*.51+noise(p*.7)*.2)-.5)))*smoothstep(.5,.8,broad);
 let pores=pow(clamp((.48-grain)*3.,0.,1.),2.);
 let vein=pow(1.-abs(2.*noise(p*.83)-1.),32.)*smoothstep(.48,.75,broad);
 let h=grain*.035+ridge*.025+fine*.012+strata*.006-fissure*.015;
 let dx=dpdx(p);let dy=dpdy(p);let sx=cross(dy,v.normal);let sy=cross(v.normal,dx);let det=dot(dx,sx);
 var n=normalize(v.normal-sign(det)*(dpdx(h)*sx+dpdy(h)*sy)/max(abs(det),.000001));
 // World-space face projection preserves texture phase across chunk seams.
 var tangent=vec3f(1,0,0);var bitangent=vec3f(0,sign(v.normal.z),0);
 if(abs(v.normal.x)>.5){tangent=vec3f(0,0,1);bitangent=vec3f(0,-sign(v.normal.x),0);}
 if(abs(v.normal.y)>.5){bitangent=vec3f(0,0,-sign(v.normal.y));}
 let texUV=vec2f(dot(p,tangent),dot(p,bitangent))*.28;
 let rock=textureSample(rockColor,rockSampler,texUV).rgb;
 let detail=textureSample(rockNormal,rockSampler,texUV).xyz*2.-1.;
 let rough=textureSample(rockRoughness,rockSampler,texUV).r;
 let m=v.word&255u;let thermal=f32((v.word>>8u)&255u);let hot=clamp((thermal-170.)/85.,0.,1.);
 var albedo=mix(vec3f(.075,.09,.10),vec3f(.23,.21,.18),broad*.55+vein*.35)*(.65+.5*grain+.18*fine+.06*strata)*(1.-fissure*.27-pores*.6);
 var roughness=.83;var emission=vec3f(0);var f0=vec3f(.045);
 if(m==2u){albedo=vec3f(.018,.085,.11);roughness=.17;f0=vec3f(.02);}
 if(m==3u){albedo=vec3f(.43,.31,.16)*(.8+.3*grain);roughness=.96;}
 if(m==8u){albedo=mix(vec3f(.12,.29,.36),vec3f(.57,.68,.7),pow(grain,4.)*.75);roughness=.24;}
 if(m==11u){albedo=vec3f(.1,.19,.2);roughness=.16;}
 if(m==9u){discard;} // Steam contributes in the volume pass, never to surface depth.
 if(m==10u||m==17u){let crust=smoothstep(.39,.64,noise(p*2.9)+grain*.12);albedo=vec3f(.065,.035,.025);roughness=.68;emission=mix(vec3f(2.8,.18,.008),vec3f(.04,.009,.003),crust)*hot;}
 if(m==1u){albedo=rock*vec3f(.44,.48,.51)*(.85+.25*broad)*mix(1.,.57,v.surface.y);roughness=mix(clamp(rough,.58,.96),.38,v.surface.y);n=normalize(v.normal*max(detail.z,.35)+tangent*detail.x*.55-bitangent*detail.y*.55);}
 let view=normalize(camera.eye.xyz-p);let lamp=normalize(camera.eye.xyz+camera.up.xyz*.35+camera.right.xyz*.35-p);let halfVector=normalize(view+lamp);
 let nl=max(0.,dot(n,lamp));let nv=max(.01,dot(n,view));let nh=max(0.,dot(n,halfVector));let vh=max(0.,dot(view,halfVector));let a2=pow(roughness,4.);let d=a2/(3.141593*pow(nh*nh*(a2-1.)+1.,2.));let k=pow(roughness+1.,2.)/8.;let g=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);let fresnel=f0+(1.-f0)*pow(1.-vh,5.);
 let specular=d*g*fresnel/max(4.*nl*nv,.01)*nl*v.surface.z*vec3f(1.,.87,.69);
 var color=albedo*v.irradiance*(.84+.16*dot(n,v.normal))+specular+emission;
 if(m==2u||m==8u){color=waterIce(v,view);}
 if(v.selected==1u){let border=select(0.,1.,any(v.uv<vec2f(.025))||any(v.uv>vec2f(.975)));color=mix(color,vec3f(.65,.40,.15),border*.65);}
 return vec4f(color,1.);
}`;
  return { common, lights, draw, haze: common + CAVERN_HAZE + queries };
}

const POST = `
@group(0) @binding(0) var color:texture_2d<f32>;
@group(0) @binding(1) var volume:texture_2d<f32>;
@group(0) @binding(2) var volumeDepth:texture_2d<f32>;
@group(0) @binding(3) var sceneDepth:texture_depth_2d;
struct Camera {eye:vec4f,right:vec4f,up:vec4f,forward:vec4f,projection:vec4f,shape:vec4u}
@group(0) @binding(4) var<uniform> camera:Camera;
@group(0) @binding(5) var distortion:texture_2d<f32>;
struct Atmosphere{haze:vec4f,heat:vec4f}
fn viewDistance(p:vec2i)->f32{
 let size=textureDimensions(color);let ndc=(vec2f(p)+.5)/vec2f(size)*2.-1.;
 let ray=vec3f(ndc.x*camera.projection.x,ndc.y*camera.projection.y,1.);
 return min(48.,camera.projection.w/min(textureLoad(sceneDepth,p,0)-camera.projection.z,-.000001)*length(ray));
}
fn hazeAt(p:vec2i)->Atmosphere{
 let size=textureDimensions(color);let low=textureDimensions(volume);let uv=(vec2f(p)+.5)/vec2f(size);
 let ndc=uv*2.-1.;let ray=vec3f(ndc.x*camera.projection.x,ndc.y*camera.projection.y,1.);
 let depth=textureLoad(sceneDepth,p,0);let distance=min(48.,camera.projection.w/min(depth-camera.projection.z,-.000001)*length(ray));
 let q=uv*vec2f(low)-.5;let base=vec2i(floor(q));let f=fract(q);var sum=vec4f(0);var heat=vec4f(0);var weight=0.;
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let at=clamp(base+vec2i(x,y),vec2i(0),vec2i(low)-1);let d=textureLoad(volumeDepth,at,0).r;
  let spatial=select(1.-f.x,f.x,x==1)*select(1.-f.y,f.y,y==1);
  let w=spatial*exp(-abs(d-distance)*4.);sum+=textureLoad(volume,at,0)*w;heat+=textureLoad(distortion,at,0)*w;weight+=w;
 }}
 // A thin foreground object with no matching low-res sample stays clear.
 var out:Atmosphere;out.haze=vec4f(0,0,0,1);out.heat=vec4f(0,0,48,0);
 if(weight>=.00001){out.haze=sum/weight;out.heat=heat/weight;}return out;
}
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}
fn sampleAt(p:vec2i)->vec3f{return textureLoad(color,clamp(p,vec2i(0),vec2i(textureDimensions(color))-1),0).rgb;}
fn refractedAt(c:vec2i,heat:vec4f)->vec3f{
 if(heat.w<.001||viewDistance(c)<=heat.z+.25){return sampleAt(c);}
 let size=vec2i(textureDimensions(color));let q=vec2f(c)+heat.xy*vec2f(size);let base=vec2i(floor(q));
 // Never sample across the canvas edge or pull a closer silhouette into hot air.
 if(any(base<vec2i(0))||any(base+1>=size)){return sampleAt(c);}
 let original=viewDistance(c);let tolerance=max(.65,original*.025);
 for(var y=0;y<2;y++){for(var x=0;x<2;x++){
  let d=viewDistance(base+vec2i(x,y));if(d<=heat.z+.25||abs(d-original)>tolerance){return sampleAt(c);}
 }}
 let f=fract(q);return mix(mix(sampleAt(base),sampleAt(base+vec2i(1,0)),f.x),mix(sampleAt(base+vec2i(0,1)),sampleAt(base+vec2i(1,1)),f.x),f.y);
}
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f{
 let c=vec2i(p.xy);var bloom=vec3f(0);for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){bloom+=max(sampleAt(c+vec2i(x,y)*5)-vec3f(1.2),vec3f(0));}}
 let atmosphere=hazeAt(c);let hdr=(refractedAt(c,atmosphere.heat)*atmosphere.haze.a+atmosphere.haze.rgb+bloom*(.14/9.))*1.65;
 let mapped=clamp((hdr*(2.51*hdr+.03))/(hdr*(2.43*hdr+.59)+.14),vec3f(0),vec3f(1));
 let srgb=select(12.92*mapped,1.055*pow(mapped,vec3f(1./2.4))-.055,mapped>vec3f(.0031308));return vec4f(srgb,1.);
}`;

async function loadRockTextures(device: GPUDevice) {
  const textures: GPUTexture[] = [];
  device.pushErrorScope('validation');
  try {
    const sampler = device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      mipmapFilter: 'linear',
      addressModeU: 'repeat',
      addressModeV: 'repeat',
      maxAnisotropy: 4,
    });
    const module = device.createShaderModule({
      code: `
@group(0) @binding(0) var source:texture_2d<f32>;@group(0) @binding(1) var filtering:sampler;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f{return textureSampleLevel(source,filtering,p.xy*2./vec2f(textureDimensions(source)),0.);}`,
    });
    const pipelines = new Map<GPUTextureFormat, GPURenderPipeline>();
    const encoder = device.createCommandEncoder();
    for (let i = 0; i < ROCK_TEXTURES.length; i++) {
      const image = await createImageBitmap(await (await fetch(ROCK_TEXTURES[i])).blob(), {
        colorSpaceConversion: 'none',
      });
      try {
        if (image.width !== 1024 || image.height !== 1024)
          throw Error('Unexpected bundled rock texture dimensions.');
        const format: GPUTextureFormat = i === 0 ? 'rgba8unorm-srgb' : 'rgba8unorm';
        const texture = device.createTexture({
          size: [1024, 1024],
          mipLevelCount: 11,
          format,
          usage:
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.RENDER_ATTACHMENT,
        });
        textures.push(texture);
        device.queue.copyExternalImageToTexture({ source: image }, { texture }, [1024, 1024]);
        let pipeline = pipelines.get(format);
        if (!pipeline) {
          pipeline = await device.createRenderPipelineAsync({
            layout: 'auto',
            vertex: { module, entryPoint: 'vertex' },
            fragment: { module, entryPoint: 'fragment', targets: [{ format }] },
            primitive: { topology: 'triangle-list' },
          });
          pipelines.set(format, pipeline);
        }
        for (let level = 1; level < 11; level++) {
          const group = device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              {
                binding: 0,
                resource: texture.createView({ baseMipLevel: level - 1, mipLevelCount: 1 }),
              },
              { binding: 1, resource: sampler },
            ],
          });
          const pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: texture.createView({ baseMipLevel: level, mipLevelCount: 1 }),
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          });
          pass.setPipeline(pipeline);
          pass.setBindGroup(0, group);
          pass.draw(3);
          pass.end();
        }
      } finally {
        image.close();
      }
    }
    device.queue.submit([encoder.finish()]);
    await device.queue.onSubmittedWorkDone();
    return { textures, sampler };
  } catch (error) {
    textures.forEach((t) => t.destroy());
    throw error;
  } finally {
    const error = await device.popErrorScope();
    if (error) {
      textures.forEach((t) => t.destroy());
      throw new Error(error.message);
    }
  }
}

export async function makeCavernAppearance(
  device: GPUDevice,
  format: GPUTextureFormat,
  shape: readonly number[],
  edge: number,
  capacity: number,
  faces: GPUBuffer,
  uniform: GPUBuffer,
  rebuilt: GPUBuffer,
) {
  const shaders = cavernShaders(shape, edge, capacity);
  async function module(code: string) {
    const m = device.createShaderModule({ code });
    const errors = (await m.getCompilationInfo()).messages.filter((m) => m.type === 'error');
    if (errors.length) throw Error(errors.map((m) => `${m.lineNum}: ${m.message}`).join('\n'));
    return m;
  }
  const lightModule = await module(shaders.lights),
    postModule = await module(POST);
  const extract = await device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module: lightModule, entryPoint: 'extract' },
  });
  async function surfacePipeline(code: string) {
    const shader = await module(code);
    return device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vertex' },
      fragment: { module: shader, entryPoint: 'fragment', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });
  }
  async function volumePipeline(code: string) {
    const shader = await module(code);
    return device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vertex' },
      fragment: {
        module: shader,
        entryPoint: 'fragment',
        targets: [{ format: 'rgba16float' }, { format: 'r32float' }, { format: 'rgba16float' }],
      },
      primitive: { topology: 'triangle-list' },
    });
  }
  const draw = await surfacePipeline(shaders.draw);
  const post = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: postModule, entryPoint: 'vertex' },
    fragment: { module: postModule, entryPoint: 'fragment', targets: [{ format }] },
    primitive: { topology: 'triangle-list' },
  });
  const haze = await volumePipeline(shaders.haze);
  const rock = await loadRockTextures(device);
  const chunks = shape.reduce((a, b) => a * b, 1) / edge ** 3,
    lights = device.createBuffer({ size: chunks * 32, usage: GPUBufferUsage.STORAGE });
  const lightList = await makeLightList(device, lights, chunks).catch((error) => {
    lights.destroy();
    rock.textures.forEach((t) => t.destroy());
    throw error;
  });
  let cachedAppearance:
    | {
        cache: Awaited<ReturnType<typeof makeLightingCache>>;
        draw: GPURenderPipeline;
        haze: GPURenderPipeline;
      }
    | undefined;
  let cacheSetup: Promise<void> | undefined,
    closed = false,
    lastCached: boolean | undefined,
    activeHaze = haze;
  const opticalUniform = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    }),
    opticalData = new Float32Array(4);
  const bindings = new Map<GPUBuffer, { extract: GPUBindGroup; draw: GPUBindGroup }>();
  let hdr: GPUTexture | undefined,
    volume: GPUTexture | undefined,
    volumeDepth: GPUTexture | undefined,
    distortion: GPUTexture | undefined,
    postGroup: GPUBindGroup,
    hazeGroup: GPUBindGroup,
    width = 0,
    height = 0,
    boundDepth: GPUTexture | undefined;
  const hazeBindings = new Map<GPUBuffer, GPUBindGroup>();
  return {
    async prepareLighting(cached: boolean) {
      if (closed) throw Error('Cavern appearance is closed.');
      if (!cached || cachedAppearance) return;
      // Reference rendering never allocates or compiles the experimental cache.
      // Publish B only after every asynchronous setup operation has succeeded.
      if (!cacheSetup)
        cacheSetup = (async () => {
          const source = cavernShaders(shape, edge, capacity, true);
          const nextDraw = await surfacePipeline(source.draw),
            nextHaze = await volumePipeline(source.haze);
          if (closed) throw Error('Cavern appearance is closed.');
          const cache = await makeLightingCache(
            device,
            source.common,
            shape,
            edge,
            lights,
            rebuilt,
          );
          if (closed) {
            cache.close();
            throw Error('Cavern appearance is closed.');
          }
          cachedAppearance = { cache, draw: nextDraw, haze: nextHaze };
        })().finally(() => {
          cacheSetup = undefined;
        });
      await cacheSetup;
    },
    invalidate: () => cachedAppearance?.cache.invalidate(),
    prepare(
      encoder: GPUCommandEncoder,
      grid: GPUBuffer,
      depth: GPUTexture,
      w: number,
      h: number,
      tick: number,
      heatDistortion: boolean,
      cached: boolean,
      profiler?: LatencyProfiler,
      trace?: Trace,
    ) {
      if (closed) throw Error('Cavern appearance is closed.');
      if (cached && !cachedAppearance) throw Error('Cached lighting has not been prepared.');
      const cache = cachedAppearance?.cache,
        activeDraw = cached ? cachedAppearance!.draw : draw;
      activeHaze = cached ? cachedAppearance!.haze : haze;
      const cacheEntries = [
        { binding: 11, resource: { buffer: lightList.buffer } },
        ...(cached
          ? [
              { binding: 9, resource: { buffer: cache!.hierarchy } },
              { binding: 10, resource: { buffer: cache!.regions } },
            ]
          : []),
      ];
      if (lastCached !== cached) {
        bindings.clear();
        hazeBindings.clear();
        lastCached = cached;
      }
      opticalData[0] = (tick % 36000) / 60;
      opticalData[1] = heatDistortion ? 1 : 0;
      opticalData[2] = cached ? 1 : 0;
      device.queue.writeBuffer(opticalUniform, 0, opticalData);
      if (!hdr || width !== w || height !== h || boundDepth !== depth) {
        hdr?.destroy();
        volume?.destroy();
        volumeDepth?.destroy();
        distortion?.destroy();
        hazeBindings.clear();
        width = w;
        height = h;
        boundDepth = depth;
        const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
        hdr = device.createTexture({ size: [w, h], format: 'rgba16float', usage });
        volume = device.createTexture({
          size: [Math.ceil(w / 4), Math.ceil(h / 4)],
          format: 'rgba16float',
          usage,
        });
        volumeDepth = device.createTexture({
          size: [Math.ceil(w / 4), Math.ceil(h / 4)],
          format: 'r32float',
          usage,
        });
        distortion = device.createTexture({
          size: [Math.ceil(w / 4), Math.ceil(h / 4)],
          format: 'rgba16float',
          usage,
        });
        postGroup = device.createBindGroup({
          layout: post.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: hdr.createView() },
            { binding: 1, resource: volume.createView() },
            { binding: 2, resource: volumeDepth.createView() },
            { binding: 3, resource: depth.createView() },
            { binding: 4, resource: { buffer: uniform } },
            { binding: 5, resource: distortion.createView() },
          ],
        });
      }
      let volumeGroup = hazeBindings.get(grid);
      if (!volumeGroup) {
        volumeGroup = device.createBindGroup({
          layout: activeHaze.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer: grid } },
            { binding: 2, resource: { buffer: uniform } },
            { binding: 3, resource: { buffer: lights } },
            { binding: 4, resource: depth.createView() },
            { binding: 8, resource: { buffer: opticalUniform } },
            ...cacheEntries,
          ],
        });
        hazeBindings.set(grid, volumeGroup);
      }
      hazeGroup = volumeGroup;
      let groups = bindings.get(grid);
      if (!groups) {
        groups = {
          extract: device.createBindGroup({
            layout: extract.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: grid } },
              { binding: 3, resource: { buffer: lights } },
            ],
          }),
          draw: device.createBindGroup({
            layout: activeDraw.getBindGroupLayout(0),
            entries: [
              ...[grid, faces, uniform, lights].map((buffer, binding) => ({
                binding,
                resource: { buffer },
              })),
              ...rock.textures.map((t, i) => ({ binding: i + 4, resource: t.createView() })),
              { binding: 7, resource: rock.sampler },
              { binding: 8, resource: { buffer: opticalUniform } },
              ...cacheEntries,
            ],
          }),
        };
        bindings.set(grid, groups);
      }
      if (cached) {
        cache!.encode(encoder, grid, profiler?.pass(trace, 'lightingCache'), (pass) =>
          lightList.encode(pass),
        );
      } else {
        cache?.invalidate();
        const pass = encoder.beginComputePass(profiler?.pass(trace, 'lighting'));
        pass.setPipeline(extract);
        pass.setBindGroup(0, groups.extract);
        pass.dispatchWorkgroups(chunks);
        lightList.encode(pass);
        pass.end();
      }
      return { view: hdr.createView(), group: groups.draw, draw: activeDraw };
    },
    finish(
      encoder: GPUCommandEncoder,
      view: GPUTextureView,
      profiler?: LatencyProfiler,
      trace?: Trace,
    ) {
      const volumePass = encoder.beginRenderPass({
        ...profiler?.pass(trace, 'volumetrics'),
        colorAttachments: [
          { view: volume!.createView(), loadOp: 'clear', storeOp: 'store' },
          { view: volumeDepth!.createView(), loadOp: 'clear', storeOp: 'store' },
          { view: distortion!.createView(), loadOp: 'clear', storeOp: 'store' },
        ],
      });
      volumePass.setPipeline(activeHaze);
      volumePass.setBindGroup(0, hazeGroup);
      volumePass.draw(3);
      volumePass.end();
      const pass = encoder.beginRenderPass({
        ...profiler?.pass(trace, 'toneAndBloom'),
        colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store' }],
      });
      pass.setPipeline(post);
      pass.setBindGroup(0, postGroup);
      pass.draw(3);
      pass.end();
    },
    close() {
      if (closed) return;
      closed = true;
      hdr?.destroy();
      volume?.destroy();
      volumeDepth?.destroy();
      distortion?.destroy();
      hazeBindings.clear();
      cachedAppearance?.cache.close();
      lights.destroy();
      lightList.close();
      opticalUniform.destroy();
      rock.textures.forEach((t) => t.destroy());
      bindings.clear();
    },
  };
}
