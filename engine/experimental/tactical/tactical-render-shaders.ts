import { DRAW, MESH } from '../3d-renderer.js';
/** Group zero is shared by terrain, decorations and host pipelines. 96-byte uniform. */
export const TACTICAL_CAMERA_WGSL_3D = `
struct Camera { eye:vec4f, right:vec4f, up:vec4f, forward:vec4f, projection:vec4f, shape:vec4u }
@group(0) @binding(0) var<uniform> camera:Camera;
fn projectWorld(world:vec3f)->vec4f {
 let p=world-camera.eye.xyz;let z=dot(p,camera.forward.xyz);
 return vec4f(dot(p,camera.right.xyz)/camera.projection.x,dot(p,camera.up.xyz)/camera.projection.y,camera.projection.z*z+camera.projection.w,z);
}
`;
function replaceOnce(text: string, before: string, after: string) {
  if (text.split(before).length !== 2) throw Error('Terrain shader composition contract changed.');
  return text.replace(before, after);
}
// Preserve the existing exposed-face algorithm and palette; only adapt bindings and projection.
export const TACTICAL_MESH = MESH;
let terrain = replaceOnce(
  DRAW,
  'struct Camera { eye:vec4f, right:vec4f, up:vec4f, forward:vec4f, projection:vec4f, shape:vec4u }',
  '',
);
terrain = replaceOnce(terrain, '@group(0) @binding(2) var<uniform> camera:Camera;', '');
terrain = terrain.replaceAll('@group(0)', '@group(1)');
terrain = replaceOnce(
  terrain,
  'out.position=vec4f(dot(p,camera.right.xyz)/camera.projection.x,dot(p,camera.up.xyz)/camera.projection.y,camera.projection.z*z+camera.projection.w,z);',
  'out.position=projectWorld(c+local);',
);
export const TACTICAL_TERRAIN = TACTICAL_CAMERA_WGSL_3D + terrain;
export const TACTICAL_BOXES =
  TACTICAL_CAMERA_WGSL_3D +
  `
struct Box { minimum:vec4f, size:vec4f, color:vec4f }
@group(1) @binding(0) var<storage,read> boxes:array<Box>;
struct Out { @builtin(position) position:vec4f, @location(0) color:vec4f, @location(1) uv:vec2f }
@vertex fn vertex(@builtin(vertex_index) vertex:u32,@builtin(instance_index) instance:u32)->Out {
 let f=vertex/6u;let uvs=array<vec2f,6>(vec2f(0,0),vec2f(1,0),vec2f(1,1),vec2f(0,0),vec2f(1,1),vec2f(0,1));let uv=uvs[vertex%6u];
 var local=vec3f(0);switch f {
 case 0u:{local=vec3f(0,uv.y,uv.x);}case 1u:{local=vec3f(1,uv.y,1-uv.x);}
 case 2u:{local=vec3f(uv.x,0,1-uv.y);}case 3u:{local=vec3f(uv.x,1,uv.y);}
 case 4u:{local=vec3f(1-uv.x,uv.y,0);}default:{local=vec3f(uv.x,uv.y,1);}}
 let box=boxes[instance];var out:Out;out.position=projectWorld(box.minimum.xyz+local*box.size.xyz);out.color=box.color;out.uv=uv;return out;
}
@fragment fn actor(v:Out)->@location(0) vec4f { return v.color; }
@fragment fn overlay(v:Out)->@location(0) vec4f {
 if(all(v.uv>vec2f(.035))&&all(v.uv<vec2f(.965))){discard;}return v.color;
}
`;
