/** Shared appearance uniforms. These helpers never write physical state. */
export const TERRAIN_STYLE_UNIFORM = `
struct TerrainStyle {tone:vec4f,lighting:vec4f,rock:vec4f,finish:vec4f,sand:vec4f,ice:vec4f,lamp:vec4f}
@group(0) @binding(12) var<uniform> style:TerrainStyle;
`;

export const TERRAIN_MATERIAL_SHADING = `
fn safeDirection(v:vec3f)->vec3f{return v*inverseSqrt(max(dot(v,v),.000001));}
// Large world-space mineral bands break up repeated texture without new assets.
// Never infer fracture age or weathering history from a stateless material grid.
fn rockVariation(p:vec3f)->vec3f{
 let mass=noise(p*.071);let layers=.5+.5*sin(p.y*.47+noise(p*.19)*2.4);
 let mineral=smoothstep(.56,.79,noise(p*.23+vec3f(5.7,1.3,9.1)));
 let tint=mix(vec3f(.77,.86,.94),vec3f(1.16,1.02,.85),layers*.55+mineral*.45);
 return mix(vec3f(1),tint*(.76+.38*mass),style.finish.w);
}
fn surfaceSpecular(n:vec3f,view:vec3f,light:vec3f,roughness:f32,f0:vec3f)->vec3f{
 let nl=max(0.,dot(n,light));let nv=max(.01,dot(n,view));let h=safeDirection(view+light);
 let nh=max(0.,dot(n,h));let vh=max(0.,dot(view,h));let a2=pow(max(.08,roughness),4.);
 let d=a2/(3.141593*pow(nh*nh*(a2-1.)+1.,2.));let k=pow(roughness+1.,2.)/8.;
 let g=nv/(nv*(1.-k)+k)*nl/(nl*(1.-k)+k);let fresnel=f0+(1.-f0)*pow(1.-vh,5.);
 return d*g*fresnel/max(4.*nl*nv,.01)*nl;
}
// Visibility remains the existing interpolated vertex samples. No fragment shadow rays.
fn hotSurface(v:Out,n:vec3f,view:vec3f,albedo:vec3f,roughness:f32,f0:vec3f)->vec3f{
 var result=vec3f(0);
 for(var j=0u;j<2u;j++){
  let index=v.hotIndices[j];if(index==0xffffffffu){continue;}
  let source=lights[index];let delta=source.position.xyz-v.world;let d2=dot(delta,delta);
  if(d2<.01||d2>=484.){continue;}let direction=safeDirection(delta);
  // Perturbed normals must not illuminate the back of an opaque geometric face.
  if(dot(v.normal,direction)<=0.){continue;}
  let radiance=source.color.rgb*style.lighting.z*v.hotVisibility[j]*pow(1.-d2/484.,2.)/(1.+d2);
  result+=(albedo*max(0.,dot(n,direction))+surfaceSpecular(n,view,direction,roughness,f0))*radiance;
 }
 return result;
}
`;
