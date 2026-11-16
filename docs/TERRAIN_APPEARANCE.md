# Reusable terrain materials, exposure and direct lighting

The shared chunked 3D renderer uses `cinematic` as its default naturalistic
material style. `classic` and `geological` remain explicit alternatives. The
user selected this default after reviewing actual fixed-scene and full-cavern
GPU comparisons. Native still-image evidence is recorded below; whole-frame
performance and moving-camera behavior have not been qualified by those captures.

## Use from an application

```ts
import type {
  TerrainRenderer,
  TerrainStyleOptions,
} from 'state-space-engine/experimental/3d/structural-world/gpu';

async function styleTerrain(renderer: TerrainRenderer) {
  if (!renderer.setStyle || !renderer.setAppearance) return;
  const options: TerrainStyleOptions = {
    profile: 'geological',
    tone: { exposureEV: -0.25 },
    lighting: { lampIntensity: 0.7 },
    materials: { rockTint: [0.36, 0.4, 0.43] },
  };
  await renderer.setStyle(options);
  await renderer.setAppearance('naturalistic');
  return renderer.inspectStyle?.();
}
```

The same optional API is available on the chunked M3, M4 and M5 GPU renderers.
The unchunked M1/M2 renderer retains its diagnostic-only capabilities. Types are
exported through all four existing GPU package entries. No package entry or
physical material catalog is added.

`setStyle` replaces the complete style. Omitted groups and fields use the selected
profile's defaults; an omitted profile selects `cinematic`. To change one field of
an existing customized style, first obtain the complete `inspectStyle()` result
and pass a modified copy. Inputs and inspection results are independently owned.
Unknown fields, getters, hidden fields, malformed colors and out-of-range or
non-finite numbers reject before publication. Calls use the existing exclusive
field-operation boundary, including closed/busy/fault handling.

Style can be set before naturalistic resources are created. Setting or inspecting
it does not allocate a GPU device, draw, step physics or submit a command buffer.
The next naturalistic presentation uploads one 112-byte uniform when needed.
The setting survives diagnostic/naturalistic switches, lighting-cache switches,
resize and physical snapshot restore. A newly created renderer starts with
`cinematic`; the application owns persistence when replacing a renderer. Styles
are deliberately absent from physical snapshots and replay commands.

## Profiles and controls

`cinematic` is the default: quieter rock texture contrast, directional ambient
fill, softer distant/wet rock normals, calmer water and continuous ice frost.
`classic` retains the previous material/light tuning and vertex-lit hot sources.
`geological` enables broad world-space mineral variation,
cooler basalt, stronger wet/dry separation, restrained bloom and lower exposure.
It also evaluates the camera lamp and up to two selected hot sources against
the fragment's material normal and roughness. Historical pixel identity is not
asserted for this revision; same-state A/B and restore comparisons remain gates.

Colors below are linear RGB multipliers in `[0, 1]`, not sRGB hex colors. Intensities
are artistic radiance multipliers, not physical light or heat units.

| Group | Field | Range / meaning |
| --- | --- | --- |
| `tone` | `exposureEV` | -4 to 4 stops; +1 doubles radiance before the existing tone map |
| `tone` | `bloomStrength` | 0 to 1; 0 disables the bloom contribution |
| `tone` | `bloomThreshold` | 0.01 to 16, scene-linear threshold before exposure |
| `lighting` | `ambientIntensity`, `lampIntensity`, `emissiveIntensity` | 0 to 4 times the existing lighting contributions |
| `lighting` | `lampColor` | Linear RGB camera-lamp tint |
| `materials` | `rockTint`, `sandTint`, `iceTint` | Linear RGB multipliers; ice tint affects frost/inclusions |
| `materials` | `rockTextureScale` | 0.05 to 4 texture repeats per voxel unit |
| `materials` | `rockNormalStrength` | 0 to 2; 0 restores the geometric rock normal |
| `materials` | `rockRoughness` | 0.25 to 2 times sampled roughness, clamped to 0.58–0.96 for dry rock |
| `materials` | `wetDarkening` | 0 to 0.9, fraction of rock albedo removed next to water |
| `materials` | `wetRoughness` | 0.08 to 1 |
| `materials` | `macroVariation` | 0 to 1, world-space mineral color variation |
| `materials` | `frostStrength` | 0 to 2, existing ice frost/inclusion mask strength |

The geological defaults use exposure -0.25 EV, bloom 0.07 with threshold 1.5,
ambient 0.72 and lamp 0.7. These can be adjusted independently of the profile.
`setStyle({})` restores the Cinematic defaults, including -0.5 EV exposure.
`setStyle({ profile: 'classic' })` explicitly restores Classic, including 0 EV.

## Lighting and material boundary

The existing physical grid remains read-only in the appearance passes. Geometry,
collision, meshing, material IDs, thermal transport, mechanical rules, timestep,
solver tolerances and conservation accounting are unchanged. Mineral bands and
wet shading are presentation; they do not claim new geological or wetness state.
This increment does not infer fresh fracture age from occupancy.

The two hot sources are chosen at each face center with deterministic source-index
tie-breaking. All corners of the face choose the same source IDs. Their existing
vertex shadow samples are interpolated for fragment lighting; other sources keep
their vertex diffuse contribution. Geometric front-face checks stop perturbed
normals from lighting opaque back faces. The shader adds a GGX specular response
for selected hot sources without new fragment visibility rays or larger ray budgets.

Rock tint/scale/variation, lamp controls and emitter intensity also affect the
existing simplified optical secondary hits. Ice tint affects frost, while water
and ice keep their existing refractive indices and ray budgets. Ambient/emitter
controls apply to volumetric radiance as well. Heat distortion remains driven by
the existing source-temperature approximation, independent of the light-intensity
control. These remain approximate direct-light and single-bounce optics; this
change does not add indirect illumination or a new fluid model.

Costs added: a 112-byte uniform, four interpolator components, a bounded source
selection loop per visible face vertex in geological mode, up to two fragment
light evaluations, and optional broad rock noise. No new texture asset, render
pass, screen-sized history, queue submission, completion boundary or physical
readback is introduced. Native GPU costs and frame times have not been measured.

## Example and evidence

Structural Cavern exposes **Style · Cinematic / Classic / Geological** and an exposure slider
through the public renderer API. Changes pause playback, preserve the current
physical tick, and re-present it. Reset recreates the renderer with the selected
style. Benchmark reports include complete resolved style settings outside timed
frames. Naturalistic application startup now uses Cinematic; diagnostic
appearance remains separately selectable. The SDK still creates diagnostic
renderers until the application selects naturalistic appearance.

Regression cases cover strict validation, input/output ownership, exposure stops,
uniform sharing/upload lifetime, atomic invalid updates, lazy setup, diagnostic
switches, resource cleanup, client tick isolation and reset persistence. They use
pure data and inert GPU/DOM objects, not a browser or native device. The installed
package checker also exercises the new public declaration surface.

The explicitly approved focused CPU/mock suite passed **28 tests across four
files**: terrain style (5), lighting cache (7), cavern appearance (7), and the
structural client (9). Execution followed a 30-second quiet window with sampled
host CPU at or below 30% and at least 8 GiB available memory. The unchanged
supervisor enforced a 6% process-tree CPU cap, 4 GiB memory limit and 30-second
deadline, with one concurrent test worker and an independent watchdog. Vitest
reported 1.40 seconds; the supervisor completed in 5.13 seconds and recorded a
peak job memory of 256.92 MiB. All 377 pinned source hashes remained unchanged.

These results validate CPU logic and mocked resource/client behavior. The
installed-package workload, native shader compilation, pixels, runtime physics
equivalence and GPU performance remain unverified and held. No browser or GPU
workload ran during this check.

The [verification receipt](checkpoints/TERRAIN_APPEARANCE.json) records the focused
test result and retained local supervisor/provenance paths, plus passing SDK build,
type checking, structural lint, formatting, Python lint, example syntax checks,
and public style declarations under both TypeScript 7 and TypeScript 6. Its source
audit finds 380 other tracked engine files byte-identical to the base revision;
the five GPU wrappers/barrels differ only in style types and serialized renderer
forwarding. The existing mesh compute shader is unchanged. The safety hold has
`blockRecovery: true`, the original incident identity, no unused recovery permit,
and no remaining execution lock. Its `lastRecovery` metadata records this approved
CPU run; the earlier byte-identical static-review receipt remains preserved.

After a separately reviewed bounded runtime stage is permitted, compare one
small fixed scene under both profiles: dry/wet rock, sand, ice, a visible hot
source and an occluded source. Check lamp/emitter disabling, extreme exposure,
pause/restore stability, A/B round trips, cache/reference mode, resize and cleanup.
Compare complete physical state and energy ledgers, then measure whole-frame cost
including source selection. Do not treat the earlier cavern receipts as acceptance
of these shaders or relax the existing hold to run them.

## Cinematic material pass (2026-11-15)

`renderer.setStyle({ profile: 'cinematic' })` explicitly selects the default
presentation profile. Structural Cavern's Style button cycles Cinematic,
Classic and Geological; `?size=32&style=classic` opts into the previous look.
Changing style pauses playback and reset retains it. The Living Cavern inherits
the same Cinematic default from the shared renderer without a style override.

The new treatment compresses the rock photograph's luminance contrast while
retaining its hue and shared world-space mineral variation. Directional ambient
fill gives upward-facing shelves a cooler tint and undersides a subdued warm
fill; this is an artistic approximation, not indirect light or sky visibility.
Fine rock normals fade with screen footprint and soften beside water. Sand uses
less fine-grain contrast. Water has longer, lower-amplitude normal waves, while
ice uses world-space inclusions and cloudy frost instead of outlining every
voxel face. Geometry, material identity and physical state are unchanged.

Primary and optical rock hits share the new color treatment and oriented texture
projection. Optical hits also use adjacent water for wet darkening. Their direct
lighting remains the existing unshadowed approximation. Existing reflection,
refraction and shadow traversal budgets are unchanged. No new texture asset,
render pass, resource binding, history buffer, command submission or CPU readback
is introduced. The 112-byte style uniform uses profile selector 2 for Cinematic
(Classic 0, Geological 1). Secondary rock hits add six neighboring grid reads;
additional shading arithmetic has not been timed on a GPU.

Initial tuning: exposure -0.5 EV, bloom 0.045 with threshold 1.8, ambient 0.8,
lamp 0.9, rock texture scale 0.18, rock normal strength 0.55, wet roughness 0.22
and frost strength 0.7. These are proposed settings, not measured improvements.
Existing overrides, including zero light intensities, zero mineral variation,
zero rock-normal strength and zero frost, retain their meanings.

The focused CPU/mock suite passed **32 tests across four files**, covering style
serialization and uniforms, shared resource uploads, lighting and client
selection/reset without physics advancement. Its supervised receipt is retained
at `dist/verification/cinematic-cpu-20261115-attempt2/report.json`; the earlier
sandbox launch failure is retained separately.

On 2026-11-15 the user explicitly authorized lifting the GPU hold for an actual
Classic/Cinematic comparison. The original hold was archived byte-for-byte at
`dist/verification/hold-releases/20261115-cinematic/safety-hold.before.json`,
with the authorization and original hash in `release.json`. The earlier hold
statements above describe historical checks. Release records permission to run;
it does not establish the cause of the original incident. Existing containment,
health checks and independent watchdogs remain enabled.

Native comparison **passed on NVIDIA GeForce RTX 4090** using the production
renderer, a fixed 16 x 8 x 16 authored material scene, identical camera and
768 x 432 viewport, reference lighting and heat distortion disabled. Three
frames selected the unmodified preset defaults in order: Classic, Cinematic,
Classic. No physical world or animation loop was created. All 8192 input grid
bytes matched after every frame, and the first and last PNGs were byte-identical.
Decoded pixels independently confirmed the Classic round trip, a different
Cinematic image, opaque alpha, and nonempty rendered content. Native pipelines
compiled, no browser/device errors were recorded, and browser shutdown plus
the 30-second, 12% CPU / 8 GiB supervised run completed successfully.

Actual PNGs, source/bundle hashes, resolved settings and verification results
are retained under `dist/visual-previews/cinematic/real/attempt-02/`;
`attempt-02-supervisor/report.json` records containment. The first attempt's
fixture-loader/readback failure is preserved in `attempt-01/`; it produced no
comparison images. This evidence covers the fixed material scene and style
round trip. Resize/restore, moving-camera aliasing, runtime physics equivalence
and whole-frame GPU performance remain unverified.

The subsequent full-cavern comparison also passed on the same hardware. It uses
the unchanged `examples/active-cavern/scene.js` generator (`active-cavern-seed-1`,
seed 1592642302), all 128 x 128 x 128 cells in 64 storage chunks, and the
application's initial player eye position and Crossing/Lava view angles. Each
view captures Classic, Cinematic and Classic again at 1280 x 720, tick zero,
with reference lighting, fog and heat distortion enabled. The production
renderer and generator dependencies are bundled from current source; the
capture harness runs no physics steps or animation loop.

All six frames retained the complete 8 MiB input grid. Each view's Classic
round trip was byte- and pixel-identical; Cinematic differs visibly in both.
Native rendering and supervised cleanup passed without reported browser or
device errors. The actual PNGs, source hashes, camera/settings records and
decoded-image verification are in
`dist/visual-previews/cinematic/full-cavern/attempt-01/`; the corresponding
`attempt-01-supervisor/report.json` records the bounded run. This adds native
still-image evidence for the full scene, without qualifying animation,
whole-frame performance or simulation/replay behavior.

After the user selected Cinematic as the standard look, the shared resolver and
Structural Cavern startup default were changed to `cinematic`. Preset values
and shader code are the same as the reviewed captures. Classic and Geological
remain explicit choices; an empty style resets to Cinematic. The SDK was rebuilt,
type checking, structural lint and changed-file formatting passed, and all
**32 focused CPU/mock tests** passed again with startup, default overrides,
style switching, reset persistence and failure atomicity covered. The receipt
is `dist/verification/cinematic-default-20261115-cpu/report.json`. This default
selection change did not rerun the native captures above.
