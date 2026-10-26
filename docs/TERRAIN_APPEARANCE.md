# Reusable terrain materials, exposure and direct lighting

This increment adds an opt-in `geological` profile and validated style controls to
the shared chunked 3D renderer. Static checks and the focused CPU/mock regressions
pass, but it has not been visually accepted or measured on a native GPU. The
workstation incident hold remains active. Preset values are initial tuning values,
not a claim of a measured image-quality or performance improvement.

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
profile's defaults; an omitted profile selects `classic`. To change one field of
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
`classic`; the application owns persistence when replacing a renderer. Styles
are deliberately absent from physical snapshots and replay commands.

## Profiles and controls

`classic` is the default and retains the previous material/light tuning and
vertex-lit hot sources. `geological` enables broad world-space mineral variation,
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
`setStyle({})` restores the classic defaults.

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

Structural Cavern exposes **Style · Classic / Geological** and an exposure slider
through the public renderer API. Changes pause playback, preserve the current
physical tick, and re-present it. Reset recreates the renderer with the selected
style. Benchmark reports include complete resolved style settings outside timed
frames. Existing application startup stays classic until the user selects the
new profile; diagnostic appearance remains separately selectable.

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
