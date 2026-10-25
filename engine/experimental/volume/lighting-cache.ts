/// <reference types="@webgpu/types" />
/** Presentation caches only. The simulation grid and mesh invalidation are read-only. */
import { LIGHT_LIST_QUERIES } from './light-list.js';

export const LIGHT_REGION_EDGE = 8;
export const LIGHT_REGION_CAPACITY = 64;

export function lightingCacheLayout(shape: readonly number[]) {
  if (shape.length !== 3 || shape.some((n) => !Number.isSafeInteger(n) || n < 1 || n > 128)) {
    throw Error('Lighting cache requires positive integer dimensions within a 128-cubed world.');
  }
  let offset = 0;
  const levels: { span: number; shape: number[]; offset: number; count: number }[] = [];
  for (let span = 4; ; span *= 2) {
    const size = shape.map((n) => Math.ceil(n / span)),
      count = size.reduce((a, b) => a * b, 1);
    levels.push({ span, shape: size, offset, count });
    offset += count;
    if (count === 1) break;
  }
  const regionShape = shape.map((n) => Math.ceil(n / LIGHT_REGION_EDGE));
  return {
    levels,
    hierarchyWords: offset,
    regionShape,
    regionCount: regionShape.reduce((a, b) => a * b, 1),
    regionStride: 2 * (LIGHT_REGION_CAPACITY + 1),
  };
}

/** Conservative point/AABB test, also used by the non-GPU regression fixtures. */
export function lightIntersectsRegion(
  position: readonly number[],
  region: readonly number[],
  radius: number,
) {
  return (
    position.reduce((sum, p, axis) => {
      const low = region[axis] * LIGHT_REGION_EDGE,
        high = low + LIGHT_REGION_EDGE;
      const d = Math.max(low - p, 0, p - high);
      return sum + d * d;
    }, 0) <=
    radius * radius
  );
}

const vector = (values: readonly number[]) => `vec3u(${values.map((n) => `${n}u`).join(',')})`;

// Keep A independent of experimental cache bindings and traversal code. These
// functions preserve the existing full-source/cell-by-cell reference paths.
export const REFERENCE_LIGHTING_QUERIES =
  LIGHT_LIST_QUERIES +
  `
fn emptyVisibilitySpan(c:vec3i,mask:u32)->u32{return 1u;}
fn regionalCount(p:vec3f,wide:bool)->u32{return allLightCount();}
fn regionalSource(p:vec3f,wide:bool,slot:u32)->u32{return allLightSource(slot);}
fn hierarchyVisibility(origin:vec3f,source:vec3f)->f32{return 1.;}
`;

/** Shared by surface shadows, optical traversal and volumetric shadows. */
export function lightingCacheQueries(shape: readonly number[]) {
  const layout = lightingCacheLayout(shape),
    levels = layout.levels;
  return (
    LIGHT_LIST_QUERIES +
    `
@group(0) @binding(9) var<storage,read> visibilityNodes:array<u32>;
@group(0) @binding(10) var<storage,read> regionalLights:array<u32>;
const VIS_SHAPES=array<vec3u,${levels.length}>(${levels.map((l) => vector(l.shape)).join(',')});
const VIS_OFFSETS=array<u32,${levels.length}>(${levels.map((l) => `${l.offset}u`).join(',')});
const LIGHT_REGIONS=${vector(layout.regionShape)};
// mask 1: shadow occluders; mask 2: anything except air/steam (optical interfaces).
fn emptyVisibilitySpan(c:vec3i,mask:u32)->u32{
 if(optics.z<.5||any(c<vec3i(0))||any(c>=vec3i(SHAPE))){return 1u;}
 for(var level=${levels.length}u;level>0u;){level--;let span=4u<<level;
  let q=vec3u(c)/span;let s=VIS_SHAPES[level];
  // Partial top nodes of rectangular worlds must not skip the closed boundary.
  if(all((q+vec3u(1))*span<=SHAPE)&&(visibilityNodes[VIS_OFFSETS[level]+q.x+s.x*(q.y+s.y*q.z)]&mask)==0u){return span;}
 }
 return 1u;
}
fn regionOffset(p:vec3f,wide:bool)->u32{
 if(any(p<vec3f(0))||any(p>=vec3f(SHAPE))){return 0xffffffffu;}
 let q=vec3u(floor(p))/${LIGHT_REGION_EDGE}u;
 return (q.x+LIGHT_REGIONS.x*(q.y+LIGHT_REGIONS.y*q.z))*${layout.regionStride}u+select(0u,${LIGHT_REGION_CAPACITY + 1}u,wide);
}
fn regionalCount(p:vec3f,wide:bool)->u32{
 if(optics.z<.5){return allLightCount();}let at=regionOffset(p,wide);
 if(at==0xffffffffu){return allLightCount();}let count=regionalLights[at];
 return select(count,allLightCount(),count>${LIGHT_REGION_CAPACITY}u);
}
fn regionalSource(p:vec3f,wide:bool,slot:u32)->u32{
 if(optics.z<.5){return allLightSource(slot);}let at=regionOffset(p,wide);
 if(at==0xffffffffu){return allLightSource(slot);}
 if(regionalLights[at]>${LIGHT_REGION_CAPACITY}u){return allLightSource(slot);}
 return regionalLights[at+1u+slot];
}
fn visibilityBoundary(p:vec3f,d:vec3f,span:u32)->vec3f{
 let size=f32(span);let low=floor(p/size)*size;
 let boundary=low+select(vec3f(0),vec3f(size),d>=vec3f(0));
 let safe=select(vec3f(1),d,abs(d)>vec3f(.000001));
 return select(vec3f(1e6),max((boundary-p)/safe,vec3f(0)),abs(d)>vec3f(.000001));
}
fn hierarchyVisibility(origin:vec3f,source:vec3f)->f32{
 let delta=source-origin;let distance=length(delta);if(distance<.0001){return 1.;}
 let direction=delta/distance;let end=vec3i(floor(source));var traveled=0.;var p=origin;
 // At most 384 cell crossings in the supported volume. Exhaustion is opaque.
 for(var visit=0u;visit<512u;visit++){
  let c=vec3i(floor(p));if(all(c==end)){return 1.;}
  let span=emptyVisibilitySpan(c,1u);if(span==1u&&opaque(c)>.5){return 0.;}
  let times=visibilityBoundary(p,direction,span);let step=min(times.x,min(times.y,times.z));
  if(traveled+step>=distance){return 1.;}
  traveled+=step+.0001;p=origin+direction*traveled;
 }
 return 0.;
}
`
  );
}

export function lightingCacheCompute(common: string, shape: readonly number[], edge: number) {
  const layout = lightingCacheLayout(shape),
    chunks = shape.reduce((a, b) => a * b, 1) / edge ** 3;
  if (
    !Number.isSafeInteger(edge) ||
    edge < 1 ||
    edge > 32 ||
    edge & (edge - 1) ||
    shape.some((n) => n % edge) ||
    chunks > 512
  ) {
    throw Error('Invalid lighting cache storage partition.');
  }
  const declarations =
    common +
    `
@group(0) @binding(3) var<storage,read_write> lights:array<Light>;
@group(0) @binding(4) var<storage,read> rebuilt:array<u32>;
@group(0) @binding(5) var<storage,read_write> candidates:array<u32>;
@group(0) @binding(6) var<storage,read_write> candidateCounts:array<atomic<u32>>;
@group(0) @binding(7) var<storage,read_write> cacheFlags:array<atomic<u32>>;
@group(0) @binding(8) var<uniform> force:vec4u;
@group(0) @binding(9) var<storage,read_write> hierarchy:array<u32>;
@group(0) @binding(10) var<storage,read_write> regions:array<u32>;
fn rebuildChunk(k:u32)->bool{return force.x!=0u||rebuilt[k]!=0u;}
`;
  const candidates =
    declarations +
    `
var<workgroup> candidateLength:atomic<u32>;
@compute @workgroup_size(64) fn candidatesMain(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
 let k=group.x;let changed=rebuildChunk(k);
 if(changed){
 for(var local=lane;local<EDGE*EDGE*EDGE;local+=64u){let i=k*EDGE*EDGE*EDGE+local;let m=grid[i]&255u;
  if(m!=10u&&m!=17u){continue;}let c=vec3i(coordinate(i));var exposed=false;
  for(var face=0u;face<6u;face++){let n=cell(c+normals[face])&255u;exposed=exposed||n==0u||n==9u;}
  if(exposed){let slot=atomicAdd(&candidateLength,1u);candidates[k*EDGE*EDGE*EDGE+slot]=i;}
 }
 }
 workgroupBarrier();
 if(lane==0u&&changed){atomicStore(&candidateCounts[k],atomicLoad(&candidateLength));}
}`;
  const emitters =
    declarations +
    `
var<workgroup> best:array<u32,64>;var<workgroup> power:array<u32,64>;var<workgroup> amount:array<u32,64>;
@compute @workgroup_size(64) fn emittersMain(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) group:vec3u){
 let k=group.x;var selected=0xffffffffu;var heat=0u;var count=0u;
 // Temperature-only changes do not set mesh dirty flags. Read all exposed
 // candidates each presentation, including those currently below threshold.
 for(var slot=lane;slot<atomicLoad(&candidateCounts[k]);slot+=64u){
  let i=candidates[k*EDGE*EDGE*EDGE+slot];let t=(grid[i]>>8u)&255u;
  if(t>170u){count++;if(t>heat||(t==heat&&i<selected)){heat=t;selected=i;}}
 }
 best[lane]=selected;power[lane]=heat;amount[lane]=count;workgroupBarrier();
 for(var stride=32u;stride>0u;stride/=2u){if(lane<stride){let b=lane+stride;amount[lane]+=amount[b];if(power[b]>power[lane]||(power[b]==power[lane]&&best[b]<best[lane])){best[lane]=best[b];power[lane]=power[b];}}workgroupBarrier();}
 if(lane==0u){var out:Light;out.position=vec4f(0);out.color=vec4f(0);if(amount[0]>0u){out.position=vec4f(vec3f(coordinate(best[0]))+.5,1.);let hot=f32(power[0]-170u)/85.;out.color=vec4f(vec3f(1.,.22+.22*hot,.035)*hot*(10.+min(f32(amount[0]),24.)*2.),1.);}
  if(force.x!=0u||any(lights[k].position!=out.position)){atomicStore(&cacheFlags[1],1u);}lights[k]=out;
 }
}`;
  const leaf = layout.levels[0];
  const leaves =
    declarations +
    `
@compute @workgroup_size(64) fn leavesMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=${leaf.count}u){return;}let dims=${vector(leaf.shape)};
 let q=vec3u(id.x%dims.x,(id.x/dims.x)%dims.y,id.x/(dims.x*dims.y));let base=q*4u;
 // A four-cell leaf can overlap several storage chunks in older tiny worlds.
 let first=base/EDGE;let last=min(base+vec3u(3),SHAPE-vec3u(1))/EDGE;let cn=SHAPE/EDGE;var changed=force.x!=0u;
 for(var z=first.z;z<=last.z;z++){for(var y=first.y;y<=last.y;y++){for(var x=first.x;x<=last.x;x++){
  changed=changed||rebuilt[x+cn.x*(y+cn.y*z)]!=0u;
 }}}
 if(!changed){return;}
 var mask=0u;
 for(var z=0u;z<4u;z++){for(var y=0u;y<4u;y++){for(var x=0u;x<4u;x++){
  let c=base+vec3u(x,y,z);if(any(c>=SHAPE)){continue;}let m=cell(vec3i(c))&255u;
  if(m!=0u&&m!=9u){mask|=2u;if(m!=2u&&m!=8u&&m!=11u){mask|=1u;}}
 }}}
 hierarchy[id.x]=mask;atomicStore(&cacheFlags[0],1u);
}`;
  const parents = layout.levels.slice(1).map((level, i) => {
    const previous = layout.levels[i];
    return (
      declarations +
      `
@compute @workgroup_size(64) fn parentsMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=${level.count}u||atomicLoad(&cacheFlags[0])==0u){return;}
 let dims=${vector(level.shape)};let prev=${vector(previous.shape)};
 let base=vec3u(id.x%dims.x,(id.x/dims.x)%dims.y,id.x/(dims.x*dims.y))*2u;var mask=0u;
 for(var z=0u;z<2u;z++){for(var y=0u;y<2u;y++){for(var x=0u;x<2u;x++){
  let q=base+vec3u(x,y,z);if(all(q<prev)){mask|=hierarchy[${previous.offset}u+q.x+prev.x*(q.y+prev.y*q.z)];}
 }}}
 hierarchy[${level.offset}u+id.x]=mask;
}`
    );
  });
  const regions =
    declarations +
    `
@compute @workgroup_size(64) fn regionsMain(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=${layout.regionCount}u||atomicLoad(&cacheFlags[1])==0u){return;}
 let dims=${vector(layout.regionShape)};let q=vec3u(id.x%dims.x,(id.x/dims.x)%dims.y,id.x/(dims.x*dims.y));
 let low=vec3f(q*${LIGHT_REGION_EDGE}u);let high=low+vec3f(${LIGHT_REGION_EDGE}.);var count=vec2u(0);
 let base=id.x*${layout.regionStride}u;
 // Canonical source order preserves accumulation/tie order. Overflow falls
 // back to the complete source table, never a truncated lighting result.
 for(var k=0u;k<${chunks}u;k++){
  let source=lights[k];if(source.position.w==0.){continue;}
  let delta=max(max(low-source.position.xyz,source.position.xyz-high),vec3f(0));let d2=dot(delta,delta);
  for(var wide=0u;wide<2u;wide++){
   if(d2<=select(484.,4900.,wide==1u)){
    if(count[wide]<${LIGHT_REGION_CAPACITY}u){regions[base+wide*${LIGHT_REGION_CAPACITY + 1}u+1u+count[wide]]=k;}count[wide]++;
   }
  }
 }
 regions[base]=count.x;regions[base+${LIGHT_REGION_CAPACITY + 1}u]=count.y;
}`;
  return { candidates, emitters, leaves, parents, regions, layout };
}

export async function makeLightingCache(
  device: GPUDevice,
  common: string,
  shape: readonly number[],
  edge: number,
  lights: GPUBuffer,
  rebuilt: GPUBuffer,
) {
  const shader = lightingCacheCompute(common, shape, edge),
    layout = shader.layout;
  const chunks = shape.reduce((a, b) => a * b, 1) / edge ** 3,
    owned: GPUBuffer[] = [];
  const buffer = (size: number, usage: GPUBufferUsageFlags = GPUBufferUsage.STORAGE) => {
    const b = device.createBuffer({ size, usage });
    owned.push(b);
    return b;
  };
  try {
    const candidates = buffer(chunks * edge ** 3 * 4),
      counts = buffer(chunks * 4);
    const cacheFlags = buffer(8, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST);
    // Immutable per-mode uniforms: later encodes must not overwrite the force
    // bit seen by an earlier command buffer that has not been submitted yet.
    const steady = buffer(16, GPUBufferUsage.UNIFORM);
    const forced = buffer(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    device.queue.writeBuffer(forced, 0, new Uint32Array([1, 0, 0, 0]));
    const hierarchy = buffer(layout.hierarchyWords * 4),
      regions = buffer(layout.regionCount * layout.regionStride * 4);
    const resources = new Map<number, GPUBuffer>([
      [3, lights],
      [4, rebuilt],
      [5, candidates],
      [6, counts],
      [7, cacheFlags],
      [9, hierarchy],
      [10, regions],
    ]);
    async function pipeline(
      code: string,
      entryPoint: string,
      bindings: number[],
      dispatch: number,
    ) {
      const module = device.createShaderModule({ code });
      const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === 'error');
      if (errors.length) throw Error(errors.map((m) => `${m.lineNum}: ${m.message}`).join('\n'));
      return {
        pipeline: await device.createComputePipelineAsync({
          layout: 'auto',
          compute: { module, entryPoint },
        }),
        bindings,
        dispatch,
        groups: new Map<GPUBuffer, Map<GPUBuffer, GPUBindGroup>>(),
      };
    }
    const stages = [
      await pipeline(shader.candidates, 'candidatesMain', [0, 4, 5, 6, 8], chunks),
      await pipeline(shader.emitters, 'emittersMain', [0, 3, 5, 6, 7, 8], chunks),
      await pipeline(
        shader.leaves,
        'leavesMain',
        [0, 4, 7, 8, 9],
        Math.ceil(layout.levels[0].count / 64),
      ),
    ];
    for (let i = 0; i < shader.parents.length; i++)
      stages.push(
        await pipeline(
          shader.parents[i],
          'parentsMain',
          [7, 9],
          Math.ceil(layout.levels[i + 1].count / 64),
        ),
      );
    stages.push(
      await pipeline(shader.regions, 'regionsMain', [3, 7, 10], Math.ceil(layout.regionCount / 64)),
    );
    let invalidate = true,
      closed = false;
    return {
      hierarchy,
      regions,
      invalidate() {
        if (closed) throw Error('Lighting cache is closed.');
        invalidate = true;
      },
      encode(
        encoder: GPUCommandEncoder,
        grid: GPUBuffer,
        descriptor: GPUComputePassDescriptor = {},
        after?: (pass: GPUComputePassEncoder) => void,
      ) {
        if (closed) throw Error('Lighting cache is closed.');
        const force = invalidate ? forced : steady;
        try {
          // Construct bind groups before opening the pass; a synchronous setup
          // failure must leave invalidation armed for a retry.
          const groups = stages.map((stage) => {
            let byForce = stage.groups.get(grid);
            if (!byForce) {
              byForce = new Map();
              stage.groups.set(grid, byForce);
            }
            let group = byForce.get(force);
            if (!group) {
              group = device.createBindGroup({
                layout: stage.pipeline.getBindGroupLayout(0),
                entries: stage.bindings.map((binding) => ({
                  binding,
                  resource: {
                    buffer: binding === 0 ? grid : binding === 8 ? force : resources.get(binding)!,
                  },
                })),
              });
              byForce.set(force, group);
            }
            return group;
          });
          encoder.clearBuffer(cacheFlags);
          const pass = encoder.beginComputePass(descriptor);
          try {
            stages.forEach((stage, i) => {
              pass.setPipeline(stage.pipeline);
              pass.setBindGroup(0, groups[i]);
              pass.dispatchWorkgroups(stage.dispatch);
            });
            after?.(pass);
          } finally {
            pass.end();
          }
          invalidate = false;
        } catch (error) {
          invalidate = true;
          throw error;
        }
      },
      close() {
        if (closed) return;
        closed = true;
        owned.forEach((b) => b.destroy());
        stages.forEach((s) => s.groups.clear());
      },
    };
  } catch (error) {
    owned.forEach((b) => b.destroy());
    throw error;
  }
}
