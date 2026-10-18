/** Presentation-only single scattering. Fixed work and no temporal history. */
export const CAVERN_HAZE = `
@group(0) @binding(3) var<storage,read> lights:array<Light>;
@group(0) @binding(4) var sceneDepth:texture_depth_2d;
@group(0) @binding(8) var<uniform> optics:vec4f;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}
fn steam(c:vec3i)->f32{return select(0.,1.,(cell(c)&255u)==9u);}
fn density(p:vec3f)->f32{
 let q=p-.5;let c=vec3i(floor(q));let f=fract(q);let u=f*f*(3.-2.*f);
 let a=mix(mix(steam(c),steam(c+vec3i(1,0,0)),u.x),mix(steam(c+vec3i(0,1,0)),steam(c+vec3i(1,1,0)),u.x),u.y);
 let b=mix(mix(steam(c+vec3i(0,0,1)),steam(c+vec3i(1,0,1)),u.x),mix(steam(c+vec3i(0,1,1)),steam(c+vec3i(1,1,1)),u.x),u.y);
 // Slow world-space drift follows the committed tick, including paused restores.
 let drift=.78+.22*sin(p.x*1.3+sin(p.z*.9)+p.y*1.7+optics.x*.45);
 return .011+.23*mix(a,b,u.z)*drift;
}
fn shadow(origin:vec3f,source:vec3f)->f32{
 if(optics.z>.5){return hierarchyVisibility(origin,source);}
 let delta=source-origin;let distance=length(delta);let ray=delta/max(distance,.0001);
 var c=vec3i(floor(origin));let end=vec3i(floor(source));let step=vec3i(select(vec3f(-1),vec3f(1),ray>=vec3f(0)));
 let inv=1./max(abs(ray),vec3f(.00001));var next=(select(origin-vec3f(c),vec3f(c)+1.-origin,ray>=vec3f(0)))*inv;
 // Source range is 22 cells; 48 grid crossings bound every relevant ray.
 for(var i=0u;i<48u;i++){
  if(all(c==end)){return 1.;}if(opaque(c)>.5){return 0.;}
  let t=min(next.x,min(next.y,next.z));if(t>=distance){return 1.;}
  if(next.x<=next.y&&next.x<=next.z){c.x+=step.x;next.x+=inv.x;}else if(next.y<=next.z){c.y+=step.y;next.y+=inv.y;}else{c.z+=step.z;next.z+=inv.z;}
 }
 return 0.;
}
// A bounded visual plume above the selected physical hot emitter. Gravity is +Y.
fn plume(p:vec3f,source:vec3f)->f32{
 let height=source.y-p.y;let radius=.85+.12*max(height,0.);
 let radial=length(p.xz-source.xz)/radius;
 return (1.-smoothstep(.25,1.,radial))*smoothstep(-.2,.6,height)*(1.-smoothstep(7.,12.,height));
}
fn turbulence(p:vec3f)->vec3f{
 let q=p+vec3f(0,optics.x*1.7,0);
 return vec3f(sin(q.x*2.7+sin(q.z*1.9)+q.y*1.6),sin(q.y*2.1+sin(q.x*2.3)+q.z*.7),cos(q.z*2.5+q.y*1.3+sin(q.x*1.7)));
}
struct Volume{@location(0) scattering:vec4f,@location(1) distance:f32,@location(2) distortion:vec4f}
@fragment fn fragment(@builtin(position) pixel:vec4f)->Volume{
 let size=textureDimensions(sceneDepth);let low=(size+vec2u(3))/4u;
 let uv=pixel.xy/vec2f(low);let at=min(vec2i(uv*vec2f(size)),vec2i(size)-1);
 let depth=textureLoad(sceneDepth,at,0);let ndc=uv*2.-1.;
 let ray=normalize(camera.forward.xyz+camera.right.xyz*(ndc.x*camera.projection.x)-camera.up.xyz*(ndc.y*camera.projection.y));
 let z=camera.projection.w/min(depth-camera.projection.z,-.000001);
 let distance=min(48.,z/max(dot(ray,camera.forward.xyz),.001));
 var chosen=vec2u(0xffffffffu);var power=vec2f(0);
 // Select two sources once per ray, not once per integration sample.
 // A 70-cell regional radius covers the entire 48-cell ray plus the
 // 22-cell light influence. Overflow/outside-world falls back to all sources.
 for(var slot=0u;slot<regionalCount(camera.eye.xyz,true);slot++){
  let k=regionalSource(camera.eye.xyz,true,slot);
  let light=lights[k];if(light.position.w==0.){continue;}
  let along=clamp(dot(light.position.xyz-camera.eye.xyz,ray),0.,distance);
  let delta=light.position.xyz-(camera.eye.xyz+ray*along);let d2=dot(delta,delta);
  let score=max(light.color.x,max(light.color.y,light.color.z))/(1.+d2)*max(0.,1.-sqrt(d2)/22.);
  if(score>power.x){power.y=power.x;chosen.y=chosen.x;power.x=score;chosen.x=k;}else if(score>power.y){power.y=score;chosen.y=k;}
 }
 let step=distance/32.;var transmittance=1.;var scatter=vec3f(0);var bend=vec2f(0);var heatFront=48.;var heatAmount=0.;
 for(var i=0u;i<32u;i++){
  let p=camera.eye.xyz+ray*((f32(i)+.5)*step);let m=cell(vec3i(floor(p)))&255u;
  if(m!=0u&&m!=9u){continue;}
  let extinction=density(p);let transmit=exp(-extinction*step);
  var radiance=vec3f(.026,.043,.063);
  for(var source=0u;source<2u;source++){
   let k=chosen[source];if(k==0xffffffffu){continue;}
   let light=lights[k];let delta=light.position.xyz-p;let d=length(delta);
   if(d<22.){let falloff=pow(max(0.,1.-d/22.),2.)/(1.+.2*d*d);let cosine=dot(ray,delta/max(d,.001));let phase=.6+.6*pow(max(0.,cosine),4.);
    let visible=shadow(p,light.position.xyz);radiance+=light.color.rgb*(falloff*phase*visible);
    if(optics.y>.5){
     let heat=plume(p,light.position.xyz)*clamp(light.color.r/24.,0.,1.)*visible;
     if(heat>.001){
      let waves=turbulence(p);bend+=vec2f(dot(waves,camera.right.xyz),-dot(waves,camera.up.xyz))*heat*step;
      heatFront=min(heatFront,(f32(i)+.5)*step);heatAmount+=heat*step;
     }
    }}
  }
  scatter+=transmittance*(1.-transmit)*radiance;transmittance*=transmit;
 }
 var out:Volume;out.scattering=vec4f(scatter,transmittance);out.distance=distance;
 // UV displacement: capped at six vertical-resolution pixels at 1080p.
 let uvBend=bend*.0012*vec2f(1./(f32(size.x)/f32(size.y)),1.);
 let maximum=6./1080.;let aspect=vec2f(f32(size.x)/f32(size.y),1.);
 out.distortion=vec4f(uvBend*min(1.,maximum/max(length(uvBend*aspect),.000001)),heatFront,heatAmount);return out;
}`;
