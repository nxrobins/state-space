# Tactical rendering

[SDK index](../../SDK.md) · [Current validation and support](../../VALIDATION_STATUS.md)

These APIs are experimental. The support matrix above defines current qualification;
section-specific limits and runtime holds still apply. Historical implementation
steps and acceptance records remain in the [checkpoint history](../../checkpoints/TACTICAL_INTERVENTIONS.md).

- [Experimental tactical rendering boundary](#experimental-tactical-rendering-boundary)

## Experimental tactical rendering boundary

`state-space-engine/experimental/3d/tactical-renderer` provides disposable
presentation caches for committed tactical snapshots and completed previews.
It is separate from existing terrain renderers. Its CPU/mock contract has a
dedicated verification gate; native WGSL, pixel correctness and latency require
future bounded hardware acceptance. It does not add physical rules.

```ts
import {prepareTacticalScene3D, createTacticalRenderer3D}
  from 'state-space-engine/experimental/3d/tactical-renderer';

// Prepare once per published boundary. Decorations require the complete stamp
// from the corresponding committed or ready-preview geometry view.
const scene = prepareTacticalScene3D(snapshot, {
  stamp: geometry.stamp, actors: actorBoxes, overlays: targetingBoxes,
});
const renderer = await createTacticalRenderer3D(device, {
  colorFormat: 'bgra8unorm', depthFormat: 'depth24plus',
});
await renderer.render(scene, camera, {color: colorTexture, depth: depthTexture});
await renderer.close();
```

The host owns the WebGPU device and both textures. Targets must be matching
single-sample, single-mip, two-dimensional render attachments (one layer), no
larger than 8,192 pixels per dimension. Color is `rgba8unorm`, `bgra8unorm` or
`rgba16float`; depth is `depth24plus` or `depth32float`. Every frame clears both.
Device ownership and destroyed-resource validity are checked by WebGPU itself;
those errors fault the renderer. It never destroys the device or host textures.

One voxel is one world unit, +Y is downward, and geometry boxes use integer
coordinates at scale 1,024. Cameras use world-unit eye positions, orthonormal
right/up/forward axes, vertical FOV in radians and explicit near/far distances.
Depth is zero to one. `projectTacticalPoint3D` maps fixed-point points to target
pixels for labels; this visual floating-point calculation is not simulation.

`TACTICAL_CAMERA_WGSL_3D` defines the 96-byte uniform at group 0 binding 0 and
`projectWorld`. Hosts can create compatible vertex pipelines with
`renderer.cameraLayout`. The optional synchronous `render` callback receives
the borrowed pass, camera binding, full scene stamp and target dimensions after
terrain/actors and before overlays. Bind the supplied camera at group 0. Do not
end/retain that pass, submit work, return a value/promise, or reenter rendering.
Use the same depth format and attachment for custom actors/effects. Terrain and
opaque actor boxes write depth; outlined targeting boxes test it without writing.
The host is responsible for its custom pipeline and effects. There is no shared
canvas configuration, transparency ordering or naturalistic postprocessing yet.

The renderer supports finite volumes up to 128 per axis (subject to device
limits), 64 actor boxes and 256 overlays. Faces are generated on the GPU. A new
prepared object triggers uploads and face generation even if it has the same
stamp; the exact same prepared object reuses caches on camera-only frames.
Preparation validates/copies the full snapshot and has no claimed latency bound.
Prepared objects are opaque, local disposable handles, not saves or worker wire
data. Transfer snapshots to the rendering owner and prepare there. Nothing in a
render cache is authoritative, and preparation never steps/support-solves.

At most one frame is outstanding, with one submission/completion boundary and
no internal loop, retry or backlog. Invalid input rejects before writes and
leaves the renderer usable. Encoding/device errors stop it until recreation;
`state()` retains the last successfully completed identity, not a guarantee that
the host target pixels survived a GPU failure. `close()` drains pending work
before freeing caches. A hung GPU cannot be preempted by this API; external
watchdog containment remains required for native acceptance.
