# Bounded terrain shader and image validation

Status: **terrain shader/image stages prepared offline, not performed**. A
separate [GPU-enabled browser lifecycle pass](GPU_BROWSER_CONTAINMENT.md) is
authorized; it does not implement either terrain stage. The source
baseline is merged PR #73 (`0af27b6c928cc3c5fbda7f66536d8b2ccb0c0cdb`). The
preparation command produces an immutable scene, case list, proposed budgets,
source hashes and preservation evidence. It has no runtime-launch path.

The GPU-enabled startup/normal-close and stalled-CDP cancellation checks have
passed. Supervisor-loss validation failed in the process-inventory observer;
its owned resources were reconciled separately, but the test remains unaccepted.
The native shader/image stages below have not been run.

The current generic native launcher cannot execute this proposal while preserving
the hard hold: the supervisor and both browser leaves reject `blockRecovery: true`.
The existing Chromium launcher also enables unsafe WebGPU and has no probe-only
command surface. Those are implementation prerequisites, not reasons to clear
the hold. This packet is **review-ready, not launch-ready**. A separate
[mode-bound containment launcher](GPU_BROWSER_CONTAINMENT.md) now implements the
narrow authorization and browser-lifecycle scope. It cannot authorize or run
either native stage below.

## Prepare the packet

From the repository root:

```powershell
.venv\Scripts\python.exe -m scripts.prepare_terrain_validation
```

This reads files and Git metadata, creates a fresh directory under
`dist/verification/terrain-native/`, and refuses an existing output directory.
It does not query the GPU, start a server/browser, compile native shaders, issue a
permit, or alter the hold. The default protected checkout is the sibling
`state-space-cpu-performance`; `--protected-worktree` can identify it explicitly.
The generator checks its branch, HEAD, status and tracked/non-ignored file hashes
before and after. Ignored files are never written by this command.

The packet contains:

- `grid.u32le`: exactly 2,048 packed presentation cells / 8,192 bytes.
- `fixture.json`: storage layout, camera, material counts and fixed dimensions.
- `plan.json`: staged workload, hard ceilings, acceptance and explicit missing prerequisites.
- `manifest.json`: source/artifact hashes, incident identity and unchanged-hold evidence.
- `protected-worktree.json`: local preservation manifest for the old checkout.

These files are local evidence; they are not runtime receipts or credentials.
Prepare a new packet after changing sources. A future executable bundle and its
transitive assets must also be hashed and reviewed before authorization.

## The smallest useful sequence

Every row is a separate attempt, with review before advancing. Success never
automatically starts another row. A failure retains its original receipts and
stops the sequence without a retry or increased budget.

| Stage | Work | Pass establishes |
| --- | --- | --- |
| Prerequisite: owned-browser containment | Separately test GPU-disabled blank-browser startup/close, stalled CDP cancellation, and supervisor loss. One case per attempt. | The actual owned browser tree and transport terminate; no native GPU acceptance. |
| A: native shaders | One normal hardware adapter/device; compile five reference-mode modules and create their five pipelines; no queue submissions or canvas. | The bounded surface/haze/post/extraction/light-list pipelines compile on that adapter. |
| B: fixed images | One device, one 384 x 216 canvas, one static 16 x 8 x 16 fixture; three manually advanced frames: classic, geological, classic-return. | The fixture renders, style changes are visible, the classic round trip is stable, and rendering preserves its input grid. |

For A, use the exact production `cavernShaders` output with shape `[16,8,16]`,
edge 4 and per-chunk face capacity 384; the production post shader and
`lightListShader(32)` complete the catalogue. Expose/extract these through a
reviewed static build entry; do not hand-copy WGSL into the test. Pipeline
descriptors must match production, including surface depth, haze MRT formats,
and the selected native canvas format. No texture upload, dispatch, draw,
timestamp query or fallback adapter belongs in A. Cached-mode shaders and the
mesh/mipmap pipelines are outside A; B must validate the additional production
setup it actually uses.

For B, invoke production `makeChunkRenderer` over the authored storage-order
grid and owned dirty buffer. Do not construct a physical world or gameplay
controller. Tick stays zero, reference lighting stays selected, and heat
distortion is disabled for this first material/light comparison. Water/ice
optics and haze remain the production passes. There is no animation loop.

The scene includes a rock floor and wall, dry/wet banks, water, ice, sand, an
exposed emitter and an emitter behind a short wall. It is a presentation fixture,
not a physically evolved snapshot. It deliberately makes no energy-ledger or
world-runtime equivalence claim. Its camera and dimensions cannot be overridden
by a launch argument.

## Budgets for the proposed native attempts

The existing Windows **GPU** supervisor policy is 12% process-tree CPU and
8 GiB job memory. The earlier 6% / 4 GiB limits applied to CPU-only tests.
Preserve the GPU policy, exclusive lease, suspended start, independent watchdog
and live health monitoring. Do not use the uncapped `frames` kind. Neither CPU
containment nor a JavaScript timeout caps GPU execution time.

Each attempt has a **30-second hard deadline**. Browser readiness has 12 seconds,
setup 8 seconds, each host-requested operation 2 seconds, cleanup 3 seconds, and
unacknowledged progress at most 5 seconds after readiness. These overlapping
phase limits must fit inside the hard deadline; they are not additive budgets.
The host must enforce them even when page promises or CDP stop responding.

Require a fresh 30-second quiet window before every launch: sampled host CPU
at most 30%, at least 8 GiB free host memory, GPU utilization at most 15%, GPU
temperature below 65 C, and at least 1 GiB free GPU memory. Missing, malformed or
stale telemetry refuses the attempt. Preserve existing runtime health limits
(including the 75 C GPU stop) and monitor-stall checks. A busy host produces only
a waiting receipt; it does not create an authorization or an automatic retry.

B's ceilings include setup, not just the three rendered frames:

| Resource/work | Maximum | Derivation / limitation |
| --- | ---: | --- |
| Explicit buffers | 128 KiB | Renderer, fixture/dirty grid, light table/list, uniforms and one reusable 8 KiB grid readback buffer; estimated payload 68,336 bytes |
| Explicit texture payload | 32 MiB | Three existing 1024-square rock textures with mipmaps plus small render targets; excludes driver/browser internal allocation |
| Modules / pipelines | 8 / 10 | Production mesh/diagnostic, appearance, light-list and mipmap setup |
| Queue submissions | 7 | One texture/mipmap setup, three presentations, three grid-readback copies |
| Render passes / draw calls | 39 / 132 | 30 mipmap passes; three surface, haze and post passes; at most 32 chunk draws per image |
| Compute dispatch calls / workgroups | 12 / 134 | Reset + meshing + light extraction + collection; only the first frame meshes all 32 chunks |
| `writeBuffer` calls / payload | 12 / 9,440 bytes | Grid, indices, dirty initialization, then camera/optics/style updates |
| External image copies | 3 / 3,145,728 pixels | Existing bundled textures, no downloaded assets |
| Mapped grid payload | 24,576 bytes | Full 8 KiB input comparison after each of three frames |
| PNG / total evidence | 1 MiB each / 16 MiB | Three images, readbacks, finite logs and receipts |

The future runner must count calls, dimensions and payloads **before** forwarding
them to the native device, and refuse a budget overrun. Estimates are not
enforcement. Permit at most one outstanding submission/map. Complete readback,
comparison and durable acknowledgement before allowing the next frame.

## Acceptance and retained output

Retain adapter/browser identities, launch arguments, source/bundle/fixture/WGSL
hashes, compilation messages, actual pipeline descriptors, allocation/work
counters, raw input readbacks, decoded-image hashes, original PNGs, health samples
and cleanup evidence. Record and durably acknowledge each operation's start and
completion; a missing tail means incomplete, never passed. Reconcile exactly
three frames with the manifest, not just a page-supplied success boolean.

Require no shader compilation, validation, uncaptured-device, device-loss,
browser, transport or cleanup errors. Decode all PNGs: dimensions must be
384 x 216, alpha opaque, and at least 16 distinct RGB triples present. Compare
decoded RGBA bytes, not PNG encodings: classic and classic-return must be equal;
geological must differ from classic. After every frame all 2,048 grid words must
equal the original fixture. Styles must equal the fully resolved requested
profiles. Do not compare the dirty buffer to its initial values: the renderer
legitimately consumes those flags.

Visual review is a separate result. Inspect the classic/geological pair for
rock detail, wet/dry distinction, sand/ice separation, highlights, readable
shadows and clipped or black regions. Pixel difference alone is not evidence of
better art direction. A poor-looking but mechanically valid image is retained
for tuning, not labelled visually accepted.

## What must be implemented and reviewed before launch

1. Resolve the execution host. The earlier incident review prefers a separate
   physical GPU host while local freezes remain unexplained. Do not infer that
   passing CPU tests makes this workstation safe for native GPU work.
2. Extend the separately reviewed CPU containment capability to a native scope
   only after execution-host review and authorization. Tie it to incident identity, exact stage,
   source/bundle/browser hashes, arguments, deadline and owned Job. Consume it
   under the real lease and verify it at every leaf. Keep `blockRecovery: true`
   throughout; no generic recovery permit or inherited Job ID bypass.
3. Add a fixed probe transport with a fresh owned browser/profile, one page,
   tiny viewport, normal WebGPU validation, and only approved assets on a
   dedicated loopback server. No `--enable-unsafe-webgpu`, driver timeout
   switches, generic eval/navigation, existing user browser, or demo app startup.
4. Retain the CPU containment negative tests for changed/reused/expired capabilities, altered commands,
   sources or browser arguments, missing telemetry, stage reordering, budget
   overflow, stale locks, lost CDP/journal and cleanup failures. GPU-disabled
   real-browser cancellation was separately authorized; inspect its retained
   results before proposing any adapter work. Native budgets/journals need their
   own additional negative tests.
5. Implement the catalogue/probe entry, call counters, PNG/readback validators,
   host-controlled stage transitions and reviewed durable receipts. Static build
   and mock checks precede authorization of A; reviewed A evidence precedes B.

The existing generic GPU runner must not be invoked with this packet. No generic
hold bypass is included in the containment implementation. This carries forward
the unresolved prerequisites in [the lighting GPU smoke review](checkpoints/CAVERN_LIGHTING_GPU_SMOKE_PLAN.md)
and [the harness evidence](checkpoints/VERIFICATION_HARNESS_REVIEW.md).

Exposure extremes, lamp/emitter disabling, cached/reference comparisons, resize,
physical restore/energy equivalence and GPU frame-time qualification remain later
scopes. Even A+B success does not establish them or resolve the incident. A
watchdog cannot guarantee recovery from a driver, kernel or whole-host hang.
