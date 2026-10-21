# State Space SDK

Start with [installation and a complete external client](sdk/core.md#install-and-run-an-external-client).
The public v0.4 2D API and experimental 3D families have distinct rules and save
formats. See [current support and validation](VALIDATION_STATUS.md) before choosing
a backend, and the [state and energy contract](../ENGINE_CONTRACT.md) for invariants.

From a development checkout, the bounded CPU/package path is:

```sh
uv sync --locked
npm ci
npm run build:sdk
npm run test:smoke
npm run verify:packages
```

The package check installs built artifacts in independent projects. Packages are
built locally; this repository does not publish to npm or PyPI automatically.
For host-specific setup and runtime limits, use the [macOS guide](MACOS.md).

## Choose an API family

| Family | Purpose | Starting point |
| --- | --- | --- |
| Core 2D | Shared CPU, WebGPU and native state/energy contract | [Installation, fields and custom materials](sdk/core.md) |
| M1–M5 3D | Finite, active and structural worlds with separate versioned contracts | [Worlds and backends](sdk/worlds.md) |
| Tactical | Speculative edits, game transactions, geometry, provenance and workers over structural worlds | [Sessions and previews](sdk/tactical/sessions.md) |
| Reactive | Catalog-aware materials, bounded CPU evolution, gameplay and worker previews | [Materials and worlds](sdk/reactive/materials.md) |
| Multiphysics foundation | Independent conservation, finite-cuboid and DC reference calculations | [Physical contracts and release gates](MULTIPHYSICS.md) |

A reactive snapshot is not an M5 snapshot. Keep each family's registry, save
schema and rules identity together. Examples consume the public entries listed
in [package.json](../package.json); their internal geometry and scene identities
are private to the corresponding bundle.

## Reference guides

<a id="install-and-run-an-external-client"></a>
<a id="python-field"></a>
<a id="browser-and-node-fields"></a>
<a id="extend-materials-without-forking-physics"></a>
<a id="inspect-behavior-and-accounting"></a>
<a id="cohesion-breakage-and-bulk-creation"></a>
<a id="build-metadata-and-source-checks"></a>
### [Install and use the core SDK](sdk/core.md)

[Install and run an external client](sdk/core.md#install-and-run-an-external-client) · [Python field](sdk/core.md#python-field) · [Browser and Node fields](sdk/core.md#browser-and-node-fields) · [Extend materials without forking physics](sdk/core.md#extend-materials-without-forking-physics) · [Inspect behavior and accounting](sdk/core.md#inspect-behavior-and-accounting) · [Cohesion, breakage and bulk creation](sdk/core.md#cohesion-breakage-and-bulk-creation) · [Build metadata and source checks](sdk/core.md#build-metadata-and-source-checks)

<a id="experimental-finite-3d-worlds"></a>
<a id="experimental-active-3d-worlds"></a>
<a id="experimental-3d-latency-diagnostics"></a>
<a id="optional-naturalistic-terrain-appearance"></a>
<a id="optional-resident-3d-gameplay"></a>
<a id="experimental-m5-structural-worlds"></a>
### [3D worlds, rendering and resident gameplay](sdk/worlds.md)

[Experimental finite 3D worlds](sdk/worlds.md#experimental-finite-3d-worlds) · [Experimental active 3D worlds](sdk/worlds.md#experimental-active-3d-worlds) · [Experimental 3D latency diagnostics](sdk/worlds.md#experimental-3d-latency-diagnostics) · [Optional naturalistic terrain appearance](sdk/worlds.md#optional-naturalistic-terrain-appearance) · [Optional resident 3D gameplay](sdk/worlds.md#optional-resident-3d-gameplay) · [Experimental M5 structural worlds](sdk/worlds.md#experimental-m5-structural-worlds)

<a id="reactive-material-definitions-and-portable-blocks-build-36"></a>
<a id="exact-local-reactive-cycles-build-37"></a>
<a id="conservative-reactive-movement-build-38"></a>
<a id="bounded-reactive-structural-mechanics-build-39"></a>
<a id="owned-reactive-worlds-build-40"></a>
<a id="existing-matter-control-in-reactive-worlds-build-41"></a>
<a id="saved-temporary-holds-in-reactive-worlds-build-42"></a>
<a id="conservative-reactive-reservoirs-build-43"></a>
### [Reactive materials and worlds](sdk/reactive/materials.md)

[Reactive material definitions and portable blocks](sdk/reactive/materials.md#reactive-material-definitions-and-portable-blocks) · [Exact local reactive cycles](sdk/reactive/materials.md#exact-local-reactive-cycles) · [Conservative reactive movement](sdk/reactive/materials.md#conservative-reactive-movement) · [Bounded reactive structural mechanics](sdk/reactive/materials.md#bounded-reactive-structural-mechanics) · [Owned reactive worlds](sdk/reactive/materials.md#owned-reactive-worlds) · [Existing-matter control in reactive worlds](sdk/reactive/materials.md#existing-matter-control-in-reactive-worlds) · [Saved temporary holds in reactive worlds](sdk/reactive/materials.md#saved-temporary-holds-in-reactive-worlds) · [Conservative reactive reservoirs](sdk/reactive/materials.md#conservative-reactive-reservoirs)

<a id="atomic-reactive-ability-previews-build-44"></a>
<a id="reactive-gameplay-queries-build-45"></a>
<a id="executed-reactive-motion-build-46"></a>
<a id="reactive-bodies-and-terrain-response-build-47"></a>
<a id="controlled-translation-and-actor-transactions-build-48"></a>
<a id="reactive-actor-groups-and-peer-aware-movement-build-49"></a>
<a id="reactive-material-transport-planning-and-continuity-build-50"></a>
<a id="atomic-reactive-transport-abilities-build-51"></a>
### [Reactive sessions and gameplay](sdk/reactive/gameplay.md)

[Atomic reactive ability previews](sdk/reactive/gameplay.md#atomic-reactive-ability-previews) · [Reactive gameplay queries](sdk/reactive/gameplay.md#reactive-gameplay-queries) · [Executed reactive motion](sdk/reactive/gameplay.md#executed-reactive-motion) · [Reactive bodies and terrain response](sdk/reactive/gameplay.md#reactive-bodies-and-terrain-response) · [Controlled translation and actor transactions](sdk/reactive/gameplay.md#controlled-translation-and-actor-transactions) · [Reactive actor groups and peer-aware movement](sdk/reactive/gameplay.md#reactive-actor-groups-and-peer-aware-movement) · [Reactive material transport planning and continuity](sdk/reactive/gameplay.md#reactive-material-transport-planning-and-continuity) · [Atomic reactive transport abilities](sdk/reactive/gameplay.md#atomic-reactive-transport-abilities)

<a id="reactive-worker-previews-builds-5253"></a>
<a id="reactive-worker-observations-build-53"></a>
<a id="reactive-worker-state-observation"></a>
### [Reactive workers and observations](sdk/reactive/workers.md)

[Reactive worker previews](sdk/reactive/workers.md#reactive-worker-previews) · [Reactive worker observations](sdk/reactive/workers.md#reactive-worker-observations) · [Reactive worker state observation](sdk/reactive/workers.md#reactive-worker-state-observation)

<a id="experimental-material-interventions"></a>
<a id="experimental-tactical-sessions"></a>
<a id="temporary-holds-and-accounted-heat"></a>
<a id="conservative-finite-reservoirs"></a>
<a id="tactical-sdk-verification"></a>
<a id="supersedable-targeting-previews"></a>
<a id="tactical-application-reference-build-26"></a>
<a id="private-branch-storage"></a>
### [Tactical sessions and previews](sdk/tactical/sessions.md)

[Experimental material interventions](sdk/tactical/sessions.md#experimental-material-interventions) · [Experimental tactical sessions](sdk/tactical/sessions.md#experimental-tactical-sessions) · [Temporary holds and accounted heat](sdk/tactical/sessions.md#temporary-holds-and-accounted-heat) · [Conservative finite reservoirs](sdk/tactical/sessions.md#conservative-finite-reservoirs) · [Tactical SDK verification](sdk/tactical/sessions.md#tactical-sdk-verification) · [Supersedable targeting previews](sdk/tactical/sessions.md#supersedable-targeting-previews) · [Tactical application reference](sdk/tactical/sessions.md#tactical-application-reference) · [Private branch storage](sdk/tactical/sessions.md#private-branch-storage)

<a id="gameplay-geometry-views"></a>
<a id="kinematic-bodies-and-material-exposure"></a>
<a id="endpoint-change-reports"></a>
<a id="actor-movement-and-air-assistance"></a>
<a id="saved-material-transport-experimental"></a>
<a id="terrain-driven-actor-peer-contacts-build-35"></a>
<a id="chamber-wind-and-translation-continuity-build-34"></a>
### [Tactical geometry, actors and transport](sdk/tactical/geometry.md)

[Gameplay geometry views](sdk/tactical/geometry.md#gameplay-geometry-views) · [Kinematic bodies and material exposure](sdk/tactical/geometry.md#kinematic-bodies-and-material-exposure) · [Endpoint change reports](sdk/tactical/geometry.md#endpoint-change-reports) · [Actor movement and air assistance](sdk/tactical/geometry.md#actor-movement-and-air-assistance) · [Saved material transport (experimental)](sdk/tactical/geometry.md#saved-material-transport-experimental) · [Terrain-driven actor peer contacts](sdk/tactical/geometry.md#terrain-driven-actor-peer-contacts) · [Chamber wind and translation continuity](sdk/tactical/geometry.md#chamber-wind-and-translation-continuity)

<a id="observed-cpu-motion"></a>
<a id="observed-movement-within-a-physical-tick"></a>
<a id="tactical-path-journals-and-per-tick-game-input"></a>
<a id="moving-supports-and-debris-contacts"></a>
<a id="terrain-driven-actor-displacement"></a>
<a id="ordered-action-boundary-journals"></a>
<a id="conservative-translation-observations-build-14-runtime-validation-pending"></a>
<a id="actors-during-translations-build-15-runtime-validation-pending"></a>
<a id="bounded-actor-groups-build-16-runtime-validation-pending"></a>
### [Tactical motion and action history](sdk/tactical/motion.md)

[Observed CPU motion](sdk/tactical/motion.md#observed-cpu-motion) · [Observed movement within a physical tick](sdk/tactical/motion.md#observed-movement-within-a-physical-tick) · [Tactical path journals and per-tick game input](sdk/tactical/motion.md#tactical-path-journals-and-per-tick-game-input) · [Moving supports and debris contacts](sdk/tactical/motion.md#moving-supports-and-debris-contacts) · [Terrain-driven actor displacement](sdk/tactical/motion.md#terrain-driven-actor-displacement) · [Ordered action-boundary journals](sdk/tactical/motion.md#ordered-action-boundary-journals) · [Conservative translation observations (runtime validation pending)](sdk/tactical/motion.md#conservative-translation-observations-runtime-validation-pending) · [Actors during translations (runtime validation pending)](sdk/tactical/motion.md#actors-during-translations-runtime-validation-pending) · [Bounded actor groups (runtime validation pending)](sdk/tactical/motion.md#bounded-actor-groups-runtime-validation-pending)

<a id="worker-owned-targeting-previews"></a>
<a id="committed-worker-geometry-batches"></a>
<a id="worker-reports-for-a-committed-action"></a>
<a id="captured-worker-motion"></a>
<a id="captured-worker-paths"></a>
<a id="ready-preview-geometry-build-24"></a>
<a id="worker-action-histories-build-25"></a>
### [Tactical workers](sdk/tactical/workers.md)

[Worker-owned targeting previews](sdk/tactical/workers.md#worker-owned-targeting-previews) · [Committed worker geometry batches](sdk/tactical/workers.md#committed-worker-geometry-batches) · [Worker reports for a committed action](sdk/tactical/workers.md#worker-reports-for-a-committed-action) · [Captured worker motion](sdk/tactical/workers.md#captured-worker-motion) · [Captured worker paths](sdk/tactical/workers.md#captured-worker-paths) · [Ready preview geometry](sdk/tactical/workers.md#ready-preview-geometry) · [Worker action histories](sdk/tactical/workers.md#worker-action-histories)

<a id="experimental-tactical-rendering-boundary"></a>
### [Tactical rendering](sdk/tactical/rendering.md)

[Experimental tactical rendering boundary](sdk/tactical/rendering.md#experimental-tactical-rendering-boundary)

<a id="reactive-chamber-reference-application"></a>
## Reference application

The [reactive chamber](../examples/reactive-chamber/README.md) connects the public
reactive-materials entry point to a real browser Worker, registry-aware WebGPU
presentation, and versioned command replay. Heating its wooden connector drives
combustion, platform settlement, and actor footing changes through the existing
CPU reactive kernels. Preview/discard/commit, exact energy/resource accounting,
and verified save import share one complete publication boundary.

Build with `npm run build:reactive-chamber` after `npm run build:sdk`. The bounded
native macOS acceptance stage is `npm run verify:macos -- --stage chamber-visible`.
The selector includes the 8³ chamber and six fixed 16³ scenes, including the
[opt-in thermal material pack](sdk/reactive/materials.md#thermal-material-pack-v1).
Each has one actor; it does not extend M5 snapshot schemas or imply
large-world/GPU reactive physics qualification.

For repository ownership, checks and change placement, read the
[contributor guide](../CONTRIBUTING.md) and [architecture map](ARCHITECTURE.md).
