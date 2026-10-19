/** Conservative cube/clip-plane rejection before expensive vertex lighting. */
export const CELL_FRUSTUM_QUERY=`
fn visibleCell(c:vec3f)->bool{
 let center=c+vec3f(.5)-camera.eye.xyz;
 let horizontal=camera.forward.xyz*camera.projection.x;
 let vertical=camera.forward.xyz*camera.projection.y;
 let planes=array<vec3f,4>(camera.right.xyz-horizontal,-camera.right.xyz-horizontal,camera.up.xyz-vertical,-camera.up.xyz-vertical);
 for(var i=0u;i<4u;i++){
  // Inflate the voxel bounds to keep floating-point edge cases conservative.
  if(dot(center,planes[i])>.501*dot(abs(planes[i]),vec3f(1.))+.0001){return false;}
 }
 return true;
}
`;
export const CELL_FRUSTUM_CULL='if(!visibleCell(c)){out.position=vec4f(2.,2.,2.,1.);return out;}';
