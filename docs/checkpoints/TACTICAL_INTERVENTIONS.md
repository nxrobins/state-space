# Tactical physics: wishlist implementation and acceptance

## Build 49 success criteria — reactive actor groups and peer-aware movement

Established before implementation against wishlist requirements 2, 3, 4, 5 and 6.
A carried or falling unit must not silently pass through a teammate; explicit
gameplay movement must encounter both current terrain and other actors.

1. Extract shared group-budget, swept-peer and serial movement kernels from the
   existing M5 adapters. Preserve their valid-input semantics, exact arithmetic,
   canonical ID ordering, declared limits and public contracts. Keep all 96
   protected sources unchanged; do not invoke old M5 physical stepping.
2. Expose reactive tick/translation actor-group APIs with separate versioned
   identities and real reactive before/after/path provenance. Evaluate at most
   64 named bodies using one aggregate contact/event/work/carry allowance.
   Validate the complete request first; isolate inputs and outputs.
3. Detect positive swept peer overlap from the actual piecewise realized paths,
   including terrain-clipped carry, delayed pushes and out-and-back travel.
   Use exact rational times, earliest pass/time followed by portable ID ordering,
   and allow tangential/end-only touching. Initial overlaps are explicit.
4. Terrain failure, peer contact or budget exhaustion publishes no partial body
   group. Return original canonical bodies, explicit failure and reexecution
   status; exhausted peer work clears unproven contact prefixes. No implicit
   actor pushing, material edits, damage or collision-policy choices.
5. Add reactive serial group movement using canonical actor ID then X/Z/Y sweeps.
   Commands contain bounded impulses/accelerations; gravity and stored velocity
   are game-owned body state. Require a shared body-step boundary, validate all
   summed speeds before geometry work, and preserve terrain-before-peer tie rules.
   Recompute final footing against terrain/actors and report heat/water exposure.
6. Test actual reactive tick and translation paths on all axes/signs; fractional
   contacts, crush/phase failures, supports, peer ties, budgets, malformed data,
   provenance, isolation, policy rollback and exact JSON continuation. New
   physical fixtures stay at most 125 cells/eight ticks/eight path steps. Compare
   shared M5/reactive movement numerically using edits only.
7. Exercise multiple actors, command/tick groups and explicit peer-aware movement
   through the built public SDK. A rejected peer-conflicting ability preserves
   terrain, actor state, AP and accounting. Resume complete group state exactly.
8. Run the focused suite, every current bounded CPU suite, types, lint, SDK and
   public integration sequentially, stopping on the first failure. Retain all
   receipts and hashes under the unchanged CPU/memory/deadline/watchdog caps.
9. Document deterministic serial ordering and conservative rejection semantics.
   These APIs supply contacts and movement, not full rigid bodies or actor loads.
   Native scheduling, reactive force/transport integration, large-world/runtime
   verification and benchmarks remain further work; legacy demos stay quarantined.

## Build 49 results — bounded actor-group acceptance complete

[Source-bound evidence](tactical-interventions/build-49-2026-10-17/summary.json)
records **1,530 passing selected CPU tests in 53 files**, including 37 new
reactive group/movement cases. Twelve sequential test jobs, full type checking,
lint, SDK compilation and public-package integration passed: 16 final stages.
The first early type check rejected a test fixture's readonly command-input type
as saved JSON data. The fixture now stores owned JSON arrays; the corrected full
type check passed. Its unchanged source hashes allowed reuse for final acceptance.
The failed type receipt and verified cleanup are retained.

Actual reactive tick and translation paths now support bounded multi-actor
reconciliation. Tests cover intermediate and out-and-back peer crossings,
all-axis/sign delayed pushes, exact rational contact times, clipped carries,
chronological/ID ties, tangential touching, initial overlap, phase and crush
failure, aggregate work/carry exhaustion and 64-body validation. No partial group
is accepted after a terrain or peer failure. Serial movement uses ID then X/Z/Y,
stops against current terrain and peers, and reports final support and exposure.

Existing M5 actor/contact regressions passed through the extracted shared
arithmetic. The public-package test used two actors in a 16-cell reactive world,
combined paid translation, tick reconciliation and explicit movement, rejected a
peer-conflicting action without spending AP, and continued complete group saves
identically after restore. Material state/accounting equality against unobserved
execution also passed. No physical rules or save schemas changed.

All 17 quiet-window gates passed, with a maximum launch sample of 19.77% host CPU.
The 6% CPU/4 GiB Job limits, independent watchdog and original deadlines remained
active. SDK compilation took 24.617 supervised seconds. Every workload and named
Job was confirmed cleaned up; the runtime hold and 96 protected sources retain
their previous hashes. No runtime permit was issued.

Evidence binds 284 source files and 133 SDK artifacts. Five prior artifacts
changed: two bundles, reactive public/response declarations, and the existing
actor-movement declaration. The last is a comment-only change: restoring the
moved serial-order comment exactly reproduces its prior SHA256. Five shared/
reactive declarations were added; the other 123 prior SDK artifacts are unchanged.
The tactical browser app/worker bundles and their input manifest were rebuilt;
HTML and CSS remain unchanged. No native browser was launched.

The full wishlist remains incomplete. These checks prove tiny CPU behavior and
package integration, not native responsiveness or large-world performance.
Peer-conflicting terrain movement is explicitly unresolved rather than an
implicit actor push; application policy decides rejection, injury or removal.
Reactive material force/transport, external loads, native scheduling and runtime
validation remain further work. GPU/large-world replay and benchmarks stay held;
legacy demos remain quarantined.

## Build 48 success criteria — controlled translation with actor transactions

Established before implementation against wishlist requirements 1, 2, 4 and 6.
A moved slab must carry existing physical history and its riders, while the game
can reject the entire paid ability if its executed route crushes a unit.

1. Add pure synchronous `reduceCommand` policy with copied game/command/receipt,
   matching before/after domain query accessors and optional translation observation.
   Stage command terrain privately until policy succeeds; branch reads during the
   callback still expose the prior complete boundary. Commands retain their order,
   absolute tick, energy accounting and unchanged physical receipts.
2. Support every existing command kind. Tick reducers remain separate. Rejection,
   invalid returned game, promises and swallowed mutation reentry discard the whole
   branch, including earlier commands/AP. Final validation and same-revision commit
   still govern publication; callbacks cannot mutate private inputs or provenance.
3. Optional branch `translation: {maxEntries?}` uses an independently versioned
   `reactive-translation-motion-1` observation. Default disabled; limit 65,536 entries,
   default 4,096. Count controlled origins, pass headers and segments. Overflow
   clears all captured paths and requires reexecution, without changing translation.
4. Expand the actual complete translation step receipts into linear selected-cell
   paths and displaced-occupant relocations. Check origin correspondence and final
   all-coordinate permutation with explicit cuts/releases. Bind privately to one
   domain, base revision, command boundary and tick; public clones cannot forge it.
   Transfers and other commands provide no swept translation observation.
5. Add `reactive-translation-displacement-1` using the shared exact contact kernel.
   At each cardinal step, carry only on wholly selected upper-face supports;
   stationary support vetoes carry. Preserve actor step/velocity and report requested
   carry versus realized motion. Resolve all axis/sign pushes and causal crushes;
   relocations check destinations without inventing intermediate travel.
6. Bound contact/event/work/carry records. Incomplete responses keep the original
   body and clear partial contacts/carries; invalid budgets reject before work.
   Retained contexts remain historical after later commands, ticks and discard.
   Branch `lastTranslation()` exposes only the latest completed translation boundary,
   returning null after another command/tick; partial jobs never expose new paths.
7. Verify tiny lifts/slides, fractional pushes, blocked carries, displaced powders,
   out-and-back routes, hot/damaged/bonded slabs, explicit cuts/releases, held-cell
   rejection, copy/provenance isolation, late failure, cancellation, exact capture
   budgets, pure-policy guards and snapshot continuation. At most 125 cells/eight
   physical ticks and eight translation steps per new fixture; old M5 stepping trapped.
8. Exercise public-package translation carry in game-owned actor state, atomic AP
   publication, history preservation and resumed continuation. Recheck every current
   bounded suite, types, lint and SDK sequentially; retain failures and hash evidence.
   Keep the 96 protected sources, runtime hold and all resource limits unchanged.
9. Document snapshot staging costs and one-way response. Actor-peer interaction,
   external loads, reactive air transport and responsive native scheduling remain
   further integration work. Native/GPU, large-world replay and benchmarks stay held;
   legacy demos stay quarantined and the full wishlist remains incomplete.

## Build 48 results — bounded CPU acceptance complete

[Source-bound evidence](tactical-interventions/build-48-2026-10-17/summary.json)
records **1,493 passing selected CPU tests in 52 files**, including 38 new
command/actor cases. Eleven test jobs, full type checking, lint, SDK compilation
and public-package integration passed sequentially: 15 final acceptance stages.
The first two attempts stopped on test-fixture errors: an error-message assertion
expected `held` instead of `release the reactive hold`, and restart tests supplied
a save to the initial-state constructor instead of `restore`. Both were corrected;
the failed receipts and verified cleanup remain in the evidence folder.

Controlled translations now carry riders using exact executed steps. Fractional
pushes, fixed-wall limits, ceiling/boundary crushes, displaced-powder endpoint
overlaps, out-and-back paths and capture/solver limits passed. Hot damaged bonded
matter retained all coordinates except explicitly cut bonds or released anchors.
Pure command policies see isolated before/after queries while ordinary branch
reads retain the prior complete boundary. A rejected lift rolls back previous
AP and heat commands; staged command accounting and JSON continuation passed.

The built public package moved a four-cell world's damaged hot stone and rider,
published AP only with the complete ability, and continued through another
translation and physical tick identically after restore. Existing material rules,
save schemas, the 96 protected sources and the runtime hold are unchanged.
All 17 quiet-window gates passed; their highest launch sample was 15.20% host CPU.
The existing 6% CPU/4 GiB Job limits, independent watchdog and 30-second checks /
60-second SDK deadline remained active. The SDK stage took 24.463 supervised
seconds. Every attempt verified workload/Job cleanup; none used a runtime permit.

The evidence binds 277 source files and 128 SDK artifacts. Three prior artifacts
changed (the reactive bundle and its public/session declarations); two new
translation observation/response declarations were added. The other 123 prior SDK
artifacts and all five tactical browser artifacts are byte-identical to Build 47.

These are tiny CPU correctness results, not native or large-world performance
acceptance. Every command currently stages whole-domain snapshots, so bounded
command count does not imply a short UI stall. Actor-peer response, external loads,
reactive air transport and native scheduling remain further integration work.
Native Worker/GPU, old M5 physical runtime, large-world replay and benchmarks stay
held; legacy demos remain quarantined. The full wishlist remains incomplete.

## Build 47 success criteria — reactive bodies and causal terrain contacts

Established before implementation against wishlist requirements 2, 4, 5 and 6.
Connect real reactive pass traces to one-way actor response, using the existing
fixed-point sweep/contact arithmetic without forging an M5 identity.

1. Extract shared kinematic and displacement kernels with typed adapter boundaries.
   Preserve the existing M5 body/contact APIs, tie ordering, rational times, budgets
   and private trajectory provenance. All 96 protected sources remain unchanged.
2. Add portable `reactive-body-1` state bound to world ID, domain, catalog and the
   reactive evolution/structure rules. Both constrained and unconstrained worlds
   accept it. Validate every field before work; reads and results own their data.
   Reuse X/Z/Y actor movement, bounded integer velocity/gravity, support and exposure.
3. Add `reactive-displacement-1` from the exact before/after query views and live
   movement accessor of one reducer boundary. Cloned/forged, foreign-domain and
   wrong-tick observations reject. Disabled/overflow capture yields incomplete.
4. Evaluate all 29 actual passes, updating observed packed/energy/structure tuples
   after each pass. Melted/burned matter must stop blocking; newly blocking phases
   detect overlap at that boundary, even if later movement would clear it. Moving
   contacts use current material/energy, not tick-start properties.
5. Carry only on structural settlement when all exact upper-face supports are
   linear falling component members with a common displacement. A stationary or
   boundary support prevents carry; loose powder does not carry. Preserve body
   velocity and step during terrain reconciliation; explicit body stepping applies
   gravity/impulses afterward. Detect lost footing and report final water/heat exposure.
6. Preserve exact causal pushes and opposed-constraint crushes. Relocations are
   destination-overlap checks, never invented swept travel. A failed/incomplete
   response returns the original body, with explicit failure and bounded work;
   budget exhaustion clears partial contact/carry observations and requires retry.
7. Prove tiny physical platform carry, fractional debris contact/crush, phase and
   combustion boundaries, holds, all-axis body motion, copy isolation, deterministic
   repeated resolution, policy rollback and JSON continuation. New trajectories
   stay at most 125 cells/eight ticks. Trap old M5 tick/support execution.
8. Exercise the built public entry with game-owned body state, pure tick reduction
   and exact restarted continuation. Compare observed and unobserved material state;
   contacts must never edit material physics or spend energy implicitly.
9. Run the new focused suite, all current bounded CPU suites, types, lint, SDK and
   public integration sequentially under unchanged caps/watchdog. Retain failures,
   verify cleanup/source/artifact hashes and leave runtime holds unchanged.
10. Document one-way response and application-controlled actor cadence. Actor-peer
    response, reactive translation carry, external actor loads and native scheduling
    remain further integration work; no large-world/native/GPU/performance acceptance
    is implied. Legacy demos stay quarantined; the full wishlist remains incomplete.

Build 47 bounded results: **1,455/1,455 selected CPU cases passed across 51 files**,
including 37 new body/contact cases. Ten final-source test jobs, full types, lint,
SDK/browser compilation and public-package integration passed. The existing M5
kinematic/displacement suites also passed through the extracted shared kernels;
the original body save and response shapes remain intact.

Actual tiny reactive ticks now verify structural platform carry, fractional debris
pushes, terrain/boundary crush witnesses, stationary-support vetoes, powder departure,
melting/combustion support loss, current contact energy, hold expiry and final water
exposure. A custom lower-density melt fixture proves a transient phase overlap is
reported at pass 26 even though structural settlement later clears the actor's
occupied cell. Actor state, terrain, AP and accounting publish together or roll
back. The public SDK runs a four-cell platform scenario and exact restarted
continuation, with three completed session ticks total. Material states match
unobserved execution; actor contacts do not alter physics or apply external loads.

Two fixture failures were retained and fixed: the custom material name used a
hyphen rather than the catalog's required underscore format, and the initial
transient-overlap fixture incorrectly assumed builtin glass/melt densities differed.
It now explicitly supplies the lower melt density through a validated catalog.
One SDK preflight sampled **81.641% host CPU** and refused to authorize any workload.
A fresh gate later passed and the build completed under the original caps. Every
launched workload and named Job was gone after cleanup; no limits were relaxed.

[Build 47 evidence](tactical-interventions/build-47-2026-10-17/summary.json) binds
the 14 final acceptance receipts, all failed attempts, launch gates and artifact
hashes. All **96 protected source/configuration hashes** and the runtime hold are
unchanged. Of 122 previous SDK artifacts, 118 are byte-identical; two bundles and
two declarations changed, with four new declarations. The tactical browser bundles
and their input manifest were regenerated through the public SDK; HTML/CSS are
unchanged. Browser compilation is not native execution. Old M5 tick/support solvers
remained trapped, and all 48 held runtime cases remain unexecuted.

This completes single-body one-way reactive tick response. Actor-peer contacts,
reactive translation carry, external loads and responsive native scheduling remain
further work. Body stepping is an explicit application decision, and response
budgets bound solver work rather than wall-clock latency. No large-world replay,
native/GPU or performance acceptance is claimed. The full wishlist remains
incomplete; legacy demos stay quarantined.

## Build 46 success criteria — executed reactive motion for actor coupling

Established before implementation against wishlist requirements 2, 3, 4 and 6.
Reactive endpoint permutations cannot establish swept contacts. Capture the actual
executed boundaries before connecting the existing contact response algorithms.

1. Add optional `motion: {maxEntries?}` to prepared reactive ticks and session
   branches. Default capture is disabled. Use a separate `reactive-motion-1`
   observation contract; leave physical rules, snapshots and existing tick results
   unchanged. Validate options before work and own them. Limit retained entries
   to 65,536 (default 8,192), including pass headers, segments and changed tuples.
2. Record all 29 ordered tick boundaries: 20 movement passes, six heat passes,
   phase changes, combustion, then structural settlement. Track tick-start slot
   lineage through actual swaps and the structural permutation. Movement swaps and
   falling fragment members are linear; structural displaced occupants are explicit
   relocations. Structural segments identify their post-damage input component.
   Record exact packed/energy/structure changes per pass, including transformations.
3. Capture canonical coordinates only; temporary hold anchors must never leak into
   observations. Captured and uncaptured results, existing reports, energy and
   absolute-tick continuation must match exactly, independent of work budget.
4. No incomplete job exposes a trace. Overflow clears retained passes and reports
   `overflow`/requires reexecution; it must not truncate a trace and label it complete,
   alter physics, or cancel a valid physical tick. Cancellation releases capture.
   Domain-set capture shares one aggregate budget across primary and reservoirs;
   it must not multiply the budget by the number of domains.
5. Tick reducers receive lazy `movement(domain?)` observations tied privately to the
   same before/after query boundaries. Retained accessors stay bound after later
   ticks. Branches retain only their most recent complete tick observation. Copies
   of public records cannot forge live provenance. Missing/overflowed capture is
   explicit so a game policy can reject the whole ability atomically.
6. Tiny CPU tests reconstruct complete states from pass changes, verify path lineage
   against executed single-pass swaps, distinguish fragment motion from occupant
   relocation, exercise heat/phase/combustion/holds and odd-tick restart, and prove
   session rollback, isolation, shared budgets and cancellation. New trajectories
   stay at most 125 cells/eight ticks; old M5 physical execution remains trapped.
7. Run focused motion tests and every current bounded suite, types, lint, SDK/browser
   compilation and public-package integration sequentially with unchanged watchdog,
   CPU/memory/deadline limits. Keep all failures and compare final source/artifact
   hashes. All 96 protected sources and the runtime hold remain unchanged.
8. Document capture cost and limitations: these are disposable executed observations,
   not authoritative saves or a load/contact solver. Translation already has separate
   step receipts; cross-domain handoffs imply no swept path. Reactive actor response,
   native/GPU acceptance and performance remain further work; legacy demos remain
   quarantined. This build is progress toward, not completion of, the wishlist.

Build 46 bounded results: **1,418/1,418 selected CPU cases passed across 50 files**,
including 34 new executed-motion cases. Nine sequential test jobs, full types,
lint, SDK/browser compilation and public-package integration passed on their first
attempts. All 13 fresh launch gates passed (highest sampled CPU 25.293%). The SDK
job took 22.864 seconds including supervision, within the 60-second cap; both core
test groups completed within their 30-second caps. Every owned workload and named
Job was gone after cleanup. CPU/memory caps, watchdog and runtime hold are unchanged.

The new tests reconstruct complete final coordinates from actual pass changes,
check slot lineage against independent single-pass swaps, distinguish falling
fragment paths from displaced-occupant relocations, and preserve exact energy and
capture-on/off results through heat, phase changes, combustion, holds and restart.
Budget exhaustion clears all domain traces while allowing the physical tick to
complete. Query-bound movement policies can reject an entire staged ability;
retained callbacks and public-copy isolation keep the original tick identity.
The built public entry exercises captured versus uncaptured snapshot continuation
without adding physical ticks to its existing tiny scenario.

[Build 46 evidence](tactical-interventions/build-46-2026-10-17/summary.json) binds
267 current source hashes, all 13 acceptance receipts, cleanup and preflight logs.
All **96 protected source/configuration hashes** are unchanged. Of 120 previous
SDK artifacts, 111 are byte-identical; the reactive bundle and eight declarations
changed, and two motion declarations were added. All five browser artifacts are
byte-identical. The 48 held physical-runtime cases remain unexecuted; old M5 tick
and support solvers were trapped throughout the new tests.

This completes the bounded executed-observation slice only. Reactive actor
carry/debris response still needs an adapter consuming these real pass boundaries;
external actor loads and native scheduling remain later work. Capture scans passes,
and latest movement access retains before/after domain snapshots even with capture
disabled. No large-world replay, native interaction, GPU or performance acceptance
is claimed. Legacy demos remain quarantined and the full wishlist is incomplete.

## Build 45 success criteria — queries against exact reactive previews

Established before implementation against wishlist requirements 2, 3, 4 and 6.
Connect gameplay decisions to the complete custom-material candidate, reusing the
existing fixed-point geometry implementation instead of maintaining a second solver.

1. Extract the dimension-independent geometry kernel. Preserve existing M5 query
   API, stamps, branding, half-open boundaries, rational hit times, tie ordering,
   per-query cell budgets, support areas and exposure arithmetic. Do not change
   physics kernels, catalogs, save schemas or any of the 96 protected sources.
2. Add `reactive-geometry-1` views through session and branch `queries(domain?)`.
   A view owns a validated complete domain and uses its exact active catalog for
   default-phase blocking, explicit material filters and sensible temperature.
   Custom fuels must not report their chemical energy as temperature. Retain
   closed-body boundaries, all three axes, odd/rectangular shapes and exact volume.
3. Stamp every answer with domain, world rules, absolute tick and either committed
   revision or preview base/branch/completed-command/completed-tick/horizon identity.
   Views retained after edits, commit, restore or discard remain immutable historical
   observations. Acquiring a view from an inactive branch fails. Partial jobs remain
   invisible; isolated reactive views must not masquerade as old M5 geometry.
4. Extend the pure synchronous tick reducer with lazy `beforeQueries` and `queries`
   for its complete before/after boundaries, including reservoirs. Retained callbacks
   preserve their original boundaries. Query failures and a rejected unit-clearance
   policy roll back the entire candidate, including earlier AP and terrain changes.
   Query observations cannot alter results or accounting and require no extra tick.
5. Verify exact shared-kernel parity and hand-checkable custom-material queries,
   hot/chemical/latent energy exposure, water immersion, changed support, reservoir
   isolation, stale/retained views, cancellation and JSON continuation. New physical
   fixtures stay at most 125 cells/eight ticks; old M5 stepping remains trapped.
6. Run focused geometry tests, existing session/domain/hold/translation/world tests,
   both disjoint core partitions, full types, lint, SDK/browser compilation and public
   package integration sequentially with existing limits. Retain all failed attempts;
   compare changed build artifacts explicitly and preserve all protected hashes.
7. Document bounded query work and O(domain cells) capture/validation costs. This
   supplies geometry facts for game policy, not actor carry/debris response, support
   load capacity, navigation policy or measured browser latency. Native/GPU,
   large-world replay and benchmarks remain held; legacy demos remain quarantined.

Build 45 bounded results: **1,384/1,384 selected CPU cases passed across 49 files**,
including 34 new geometry cases and the existing 1,350 cases. Eight final-source
test jobs, full types, lint, SDK/browser compilation and public-package integration
passed. Both core partitions remained below 15 seconds of test-run time. The SDK
job completed in 23.456 seconds including supervision, within its existing
60-second limit. All final and historical workload/Job cleanup checks passed.
Evidence: [`build-45-2026-10-17/summary.json`](tactical-interventions/build-45-2026-10-17/summary.json).

Retained failures: the setup rejected a runner copy whose line endings had changed
before issuing any authorization; byte-identical reviewed runners replaced it.
The first focused run rejected a custom fluid's invalid reverse phase edge; the
next rejected a parity fixture material unsupported by M5. Both were fixture
errors. Type checking then rejected mutation of readonly cloned registry records;
the fixtures now construct owned property records. Final-source receipts reran
all scopes after that correction. No runtime limits or physics were changed.

Artifact review found exactly three changed SDK bundles (reactive materials,
tactical session, tactical renderer), three changed existing declarations and
two new declarations for the shared kernel and reactive geometry. The browser
app/worker bundles and their input manifest changed through the shared kernel;
HTML/CSS and all 96 protected source/configuration hashes stayed unchanged.
The public package verifies candidate-only obstruction, retained reservoir views
and exact exposure after JSON continuation. Native interaction, GPU execution,
large-world replay and performance remain unverified and held. Reactive actor
carry/debris response and responsive browser integration remain further work;
the full wishlist is not complete and legacy demos remain quarantined.

## Build 44 success criteria — atomic reactive previews and game transactions

Established before implementation against wishlist requirements 1, 2, 3, 5 and 6.
Connect the reactive domain set to speculative abilities and application state,
using the same exact kernels for preview and committed execution.

1. Add an explicit `reactive-session-1` save with world/game-rules identities,
   instance-local revision, complete reactive domains, bounded portable game data
   and exact decimal energy accounting. Reuse the existing dimension-independent
   game-data copier; validate complete saves before publication. Restore requires
   matching identities/topology, preserves saved accounting, increments the live
   revision and invalidates old candidates. Existing physics/save formats stay intact.
2. Allow at most four live branches from an identified committed revision. Each
   owns ordinary snapshots and a specified 0–64 tick horizon; reject absolute-tick
   overflow before allocation. Queue at most 256 ordered commands within a combined
   65,536-node / 1,048,576-character data budget. Commands cover local edits,
   translation, reservoir transfer, holds/releases and complete game-state updates.
   Own inputs before accepting them; seal preparation on the first advance.
3. Advance one command boundary or existing job slice at a time, then run exactly
   the requested synchronized ticks. Keep partial physical jobs invisible even to
   branch inspection. Game updates and completed physical ticks become visible
   together at private branch boundaries. Retain only the latest isolated boundary
   report, with a monotonic sequence, rather than accumulating unbounded tick history.
4. Capture synchronous application policies at construction. A pure optional tick
   reducer receives isolated complete state/report data; a validator must return
   exactly true for accepted saves and final candidates. Reject promises, observe
   rejected promise results and poison swallowed reentry. Policy exceptions and any
   failed command discard the candidate without publishing terrain, holds, storage,
   game resources, accounting or revision. Application callbacks must not mutate
   external systems; rollback covers SDK-owned state only.
5. Commit only a ready, same-session, current-revision candidate, once. Publish
   physical state, game data and accounting in one assignment with no resimulation.
   Commit/restore stale and release siblings; explicit discard or failure releases
   branch capacity. Invalid branch options or failed restore preserve existing work.
   Inspections identify base revision, completed duration and readiness, with no
   claim that instance-local counters are global persistent identities.
6. Tiny CPU fixtures prove successful paid abilities, late obstruction rollback,
   distant support loss, reservoir/phase/hold continuation, policy failure after
   physical work, cancellation at incomplete boundaries, stale/foreign/consumed
   handles, bounded input, reentry and exact preview/direct/restart agreement.
   New fixtures use at most 125 total cells and eight ticks per trajectory; trap
   old M5 physical execution. Actor/contact policy and responsive browser transport
   are further integration work, not implied by storing actor data in game state.
7. Run a separate bounded session suite, all existing domain/hold/translation/world/
   core suites, types, lint, SDK/browser compilation and public-package integration.
   Preserve containment/watchdog limits, 96 protected hashes and the runtime hold.
   Native/GPU, M5/large-world replay and benchmarks remain held; legacy demos remain
   quarantined. This step does not claim copy-on-write or measured preview latency.

Build 44 verification adjustment: the combined 1,146-case core job reached its
unchanged 30-second watchdog deadline in `attempt-06`; no assertion failure was
reported before cancellation. The workload and named Job were confirmed gone.
Partition the exact same 43-file selection into two disjoint sequential jobs
(566 / 580 cases), verify their union against the original config and retain the
failed receipt. CPU/memory/deadline limits and physics are unchanged.

Build 44 bounded results: **1,350/1,350 selected CPU cases passed across 48 files**:
47 session, 45 domain, 36 hold, 40 translation, 36 world and 1,146 core cases.
The core partitions passed in 15.58 / 14.74 seconds of test-run time. Full type
checking, structural lint, all 13 SDK entries with declarations, browser artifact
compilation and public-package integration passed. The SDK job took 23.574 seconds
including supervision, inside its unchanged 60-second limit. All 11 acceptance
jobs and the retained timeout have confirmed workload/Job cleanup. Evidence is in
[`build-44-2026-10-17/summary.json`](tactical-interventions/build-44-2026-10-17/summary.json).

The new public check stages AP plus a hot damaged slab transfer, runs one exact
private tick, commits without resimulation, rejects a stale sibling and verifies
complete continuation through a JSON restart. Session fixtures include distant
support collapse, stored-water freezing, temporary holds, late command/policy
failure and cancellation; these small CPU checks do not establish native-browser,
GPU, large-world or performance acceptance. Protected physics/configuration and
the global hold remain unchanged. Actor contacts and responsive browser transport
for this reactive session remain further integration work; legacy demos remain
quarantined and the broader wishlist is incomplete.

## Build 43 success criteria — conservative reactive reservoirs

Established before implementation against wishlist requirements 1, 2, 3, 5 and 6.
Connect finite storage to the same reactive physics, without treating extraction
as deletion plus fresh placement or allowing companion volumes to skip time.

1. Add an explicit `reactive-domains-1` save containing one primary world and named
   reservoirs, all at one absolute tick and using one reactive catalog. Preserve
   each world's v1/v2 identity and holds. Limit the complete set to eight domains
   and 65,536 cells (each existing block still at most 32,768). Validate and own
   every save before publication; canonical reservoir ordering and fixed topology
   on restore prevent ambiguous domains. Existing world saves remain unchanged.
2. Add `reactive-transfer-1` jobs mapping selected existing cells into another
   domain by a fixed integer offset. Exchange the full packed/energy/structure
   tuples with destination occupants, preserving volume, exact energy, damage and
   internal bonds. Default policies reject external bonds, anchors and non-air
   displacement; explicit cut/release/mobile policies match reactive translation.
   Never weld. Reject source/destination holds, wrong catalog/tick, duplicates,
   boundaries and same-domain shortcuts. Storage is a physical companion volume,
   not a vacuum or a hidden heat sink.
3. Bound each transfer swap slice to at most 256 pairs, with isolated input,
   cancellation and a separate validated publication. Return both domain changes,
   spatial correspondence, explicit cuts/releases, equal/opposite internal energy
   deltas and zero external cost. Validation/copying remains finite O(total cells),
   with no unmeasured latency claim or invented swept transfer path.
4. Provide an owning domain set with revision-bound transfer, local translation
   and synchronized complete-tick jobs, edits/holds, restore and combined energy
   accounting. Advance only one domain kernel slice per call; publish all domains
   together after every one reaches the next tick. Invalid, cancelled, stale,
   foreign, consumed or reentrant operations must preserve every committed domain,
   revision and ledger. Successful edits account external energy; transfers and
   ticks conserve the combined total. Restores establish a new accounting baseline.
5. Tiny CPU tests prove bidirectional water/hot-air exchange, bonded damaged slab
   storage, explicit cuts/releases, all axes, rectangular domains, catalog-aware
   obstacles, held destinations, late failure/cancellation, source/result ownership,
   shared-tick atomicity and exact JSON continuation including reservoir chemistry
   and hold expiry. At most 125 cells per new fixture and eight ticks per trajectory;
   old M5 physical execution remains trapped.
6. Run a separate bounded reservoir suite, then existing hold/translation/world/core
   suites, full types, lint, SDK/browser compilation and public-package integration.
   Keep containment/watchdog limits, protected hashes and runtime hold unchanged.
   Native/GPU, M5/large-world replay and benchmarks remain held; legacy demos stay
   quarantined. Application/actor transactions and preview scheduling remain further
   integration work, not implicit consequences of a domain-set commit.

Build 43 result: **1,303 tests in 47 files passed**, in five sequential bounded
jobs: 45 new domain/reservoir cases and the unchanged 36 hold, 40 translation,
36 world and 1,146 core cases. Full types, lint, all thirteen SDK bundles and
declarations, browser compilation and public-package integration passed. All nine
acceptance stages kept the existing caps/watchdog/deadlines and verified cleanup.
Evidence: [Build 43 receipts](tactical-interventions/build-43-2026-10-17/summary.json).

The new fixtures verify all-coordinate exchange, displaced hot air, damaged bonded
slabs on all axes, custom material eligibility, late failure and cancellation,
catalog-aware storage chemistry, shared absolute tick/hold expiry and exact six-tick
continuation across odd JSON restarts. Two game-facing consequences are exercised:
extracting one support releases the distant five-cell walkway on the next tick,
and stored water can receive an accounted cooling edit, freeze, then return as the
same resulting ice. Public integration transfers a damaged slab through the built
package and runs two eight-cell domain-set ticks (four contained world ticks)
across original/restored copies with identical complete states and reports.

Two initial setup failures were fixture errors: the custom fixed shell inherited
stone's softening and reversible melt edge despite changing its identity/cohesion.
Both were corrected without changing production catalog rules. Their receipts and
the earlier passing 43-case run are retained. A later lint preflight observed one
51.66% host-CPU sample and launched no workload; a fresh ten-sample window passed
below 12%, after which lint passed. The failed gate remains in the summary.

All 96 protected source/config hashes, the runtime hold and five browser artifacts
are unchanged. Of 113 prior SDK artifacts, 111 remain byte-identical; only the
reactive bundle and public entry declaration changed, with three new domain/transfer
declarations. Existing world/hold/translation kernels and schemas are unchanged.
No old M5 physical solve, native Worker, GPU, large-world replay or benchmark ran;
all 48 quarantined physical cases remain held. The domain set is a physical atomic
publication boundary. Reactive preview scheduling, game resources and actor
transactions still require integration before the broader wishlist is complete.

## Build 42 success criteria — saved temporary holds in reactive worlds

Established before implementation against wishlist requirements 1, 2, 3, 5 and 6.
Add temporary positional constraints to existing-matter control while retaining
the original unconstrained world behavior and every protected M5 source.

1. Preserve `reactive-world-1` saves and default empty-world construction. Add an
   explicit schema 2 / `reactive-world-2` snapshot carrying `reactive-holds-1`
   records. Adding a hold explicitly opts into this format; merely reading an old
   save does not migrate it. Validate identity, expiry, catalog-specific cohesive
   solid/frozen eligibility, unique/disjoint cells, and limits (64 holds, 32,768
   total cells, 1,024 future ticks). Canonicalize ordering and isolate public reads.
2. A hold at tick T with expiry E constrains movement/support during ticks whose
   input tick is less than E; it is absent in the completed E snapshot. Overlay
   temporary anchors only in private kernel input, never canonical saved structure.
   Holds prevent motion, not heat, damage, combustion or phase change. Retire
   transformed held material before structural settlement, and preserve permanent
   anchors through release/expiry. Partial damage and zero-integrity debris can
   remain held. Record before/after holds, expiry and transformation removals.
3. Add atomic owning-world hold/release/read operations. They change live revision,
   not physical tick or external energy. Invalid/reentrant requests leave every
   domain unchanged and invalidate no valid prepared work. All successful hold
   changes make older tick/translation jobs stale. Restore saves exact remaining
   lifetime and validates before replacing state/accounting.
4. Any successful placement replaces held identity even when it creates identical
   material/thermal/structure values; retire only the replaced cells. Energy,
   integrity, bond and permanent-anchor edits preserve valid holds. Translation
   rejects selected or displaced held matter, including broken debris and attempts
   to use `anchors: release`; explicit hold release is required first. Keep existing
   unheld translation and edit receipts unchanged.
5. Tiny CPU fixtures prove expiry/release and ensuing falls, held damaged bonded
   slabs, surviving permanent anchors, held heating/melting/burning, transformed
   support loss in the same tick, identity replacement, stale/cancelled commits,
   custom eligibility, strict invalid saves and exact JSON continuation at odd ticks.
   Unconstrained v1 state/reports must remain exact under existing tests. Execute
   no more than 125 cells or eight ticks per new trajectory; trap old M5 runtime.
6. Run separate bounded hold, translation, world and existing-core CPU suites,
   followed by full types, lint, SDK and public-package integration. Preserve caps,
   watchdog, 96 protected hashes and the runtime hold. Native/GPU, M5/large-world
   replay and benchmarks remain held; legacy demos stay quarantined. Reservoir,
   branch/application and actor integration remain further wishlist work.

Build 42 result: **1,258 tests in 46 files passed**, in four separate sequential
jobs: 36 new hold cases, 40 translation cases, 36 world cases and 1,146 core cases.
Full types, lint, all thirteen SDK bundles/declarations, browser compilation and
public-package integration passed. All eight acceptance stages kept the same
CPU/memory caps, watchdog and deadlines, with cleanup verified. Evidence:
[Build 42 receipts](tactical-interventions/build-42-2026-10-17/summary.json).

The first hold run stopped on a malformed-save regression: an explicit undefined
`holds` field reached the constructor's default empty list. The reader now rejects
non-array hold records before construction. The failing receipt is retained;
all final acceptance stages ran on the corrected source. The public entry performs
five additional ticks across a four-cell held slab and its odd-tick JSON restart,
verifying exact expiry, heat/damage/bond preservation, subsequent falling and zero
energy drift with no temporary-anchor residue. New unit trajectories stay within
125 cells and six ticks; existing tiny trajectories remain within eight ticks.

All 96 protected source/config hashes, the runtime hold and five browser artifacts
remain unchanged. Of the prior 112 SDK artifacts, 107 remain byte-identical; changes
are limited to the reactive bundle and its block/entry/world/world-tick declarations,
with one new hold declaration. Existing world-1 behavior and saves remain supported;
world-2 is an explicit constrained format. No old M5 physical solve, native Worker,
GPU, large-world replay or benchmark ran. The 48 quarantined physical cases remain
held. Reservoirs, reactive branches/application transactions and actor integration
remain further work; this completes the hold build, not the wishlist.

## Build 41 success criteria — state-preserving reactive translation

Established before implementation against wishlist requirements 1, 2, 3 and 6.
Connect existing-matter control to the reactive world without turning it into
fresh placement or altering the protected M5 intervention implementation.

1. Add `reactive-translation-1` prepared jobs accepting existing cell coordinates,
   a cardinal unit-step path, and explicit external-bond/anchor/displacement
   policies. Bound selection to 32,768 cells, path to 384 steps and selection ×
   (path + 1) to 262,144 entries. Reject invalid/sparse/accessor/decorated requests,
   duplicate or air selections, unsupported policies and closed-boundary crossings.
2. Each advance executes one immutable-input path step, or final publication.
   Rotate each contiguous selected run with its terminal occupant so overlapping
   moves conserve every packed/material, energy and structure coordinate. Preserve
   internal bonds, integrity and heat; never normalize, heal or auto-weld. Default
   policies reject external bonds, anchors and non-air displacement. Explicit cuts
   and releases modify only those connections; mobile displacement must respect the
   reactive catalog and reject intact, anchored or fixed noncohesive solids.
3. Publish only a complete validated result at the original physical tick with zero
   external energy. Retain selected original/final locations, cuts and releases,
   per-step selected/displaced correspondence, all-matter original/final movement,
   touched origins/spatial cells including round trips, and exact endpoint changes.
   Reports describe executed translations, not subsequent support or swept actors.
4. Add owning-world prepare/commit translation. Only same-instance, current-revision,
   complete unconsumed jobs can commit; edits, restore, tick/translation commits make
   older jobs stale. Failed, cancelled, obstructed or reentrant preparations cannot
   publish terrain, energy accounting or revision. Translation costs no engine
   thermal energy and does not advance time; gameplay costs remain application policy.
5. Verify tiny CPU cases (at most 125 cells, paths at most eight steps) across all
   axes/signs, overlapping and disconnected runs, custom solids/fluids, explicit
   cuts/releases, hot damaged slabs, no welding, late-path failures, round trips,
   source/result isolation, stale commits, cancellation and JSON continuation.
   Integrated tick cases must show lifted material falling with preserved history
   and a moved hot fuel support subsequently burning under the same world rules.
6. Pass separate bounded intervention, reactive-world and existing core CPU suites,
   followed by full types, lint, SDK and public-package integration. Keep existing
   harness caps/watchdog, all 96 protected hashes and runtime hold unchanged. M5
   physical runtime, native/GPU, large-world replay and benchmarks remain held;
   legacy demos remain quarantined. Temporary holds, reservoirs and tactical
   actor/application transactions still need reactive-world integration.

Build 41 result: **1,222 tests in 45 files passed**, in separate sequential jobs
for 40 translation cases, 36 reactive-world cases and 1,146 existing core cases.
Full type checking, lint, all thirteen SDK bundles/declarations, browser compilation
and public-package integration passed. All seven acceptance stages retain the same
containment/watchdog limits and confirmed cleanup. Evidence:
[`build-41-2026-10-17/summary.json`](tactical-interventions/build-41-2026-10-17/summary.json).

The new suite initially passed, then review separated movement-touch semantics from
explicit bond edits: an unmoved cut neighbor must appear in `changedCells`/`cutBonds`
without being reported as moving. That assertion was added to the cut regression,
and all 40 cases passed again before the other gates. The earlier passing attempt
is retained as history; final acceptance binds the corrected sources.

Tiny executed paths verify all axes/signs, overlapping/disconnected runs, custom
catalog displacement, reciprocal cuts, selected anchor releases, heat/integrity/
internal-bond preservation, no welding, late-failure atomicity and exact provenance.
Integrated cases lift a hot damaged bonded slab and let it fall with its original
state intact, then move hot fuel and observe ordinary combustion at its destination.
Public SDK acceptance translates a four-cell fixture and executes two additional
reactive-world ticks, matching uninterrupted and JSON-restored state/reports.
The new translation changes neither physical tick nor external energy accounting.

All 96 protected source/configuration hashes, all five prior browser artifacts and
the runtime hold bytes remain unchanged. 108 previous SDK artifacts are identical;
the reactive bundle and its entry/world declarations changed, with one new
translation declaration. Existing world/component rules and snapshot schemas remain
unchanged. The protected M5 translator and physics implementation were not modified.

This is verified CPU behavior on tiny scenes, not latency, GPU parity or full
gameplay acceptance. Translation advances one complete selected path step; final
validation/publication still scans the bounded block. Displaced occupants rotate
directly to run heads, not along a claimed swept actor path. Temporary holds,
reservoirs and actor/application transactions still need reactive-world integration.
The 48 held M5 physical cases were not executed; native Worker/browser, GPU,
large-world replay and benchmarks remain held, and legacy demos quarantined.

## Build 40 success criteria — committed reactive world ticks

Established before implementation against wishlist requirements 1, 2, 3, 5 and 6.
Compose the verified CPU kernels into one owned world boundary, so reaction-driven
support failure is part of an actual completed tick rather than a caller-assembled
sequence. This does not replace M5 or complete tactical actor/game integration.

1. Add `reactive-world-1` snapshots with catalog-bound complete block and absolute
   tick. Freeze one tick as all 28 existing evolution stages, then one complete
   structural solve. Existing component rules/saves stay unchanged. Reject other
   schemas, invalid blocks and overflow before publication. Own all inputs/reads.
2. Expose cancellable prepared tick jobs. An advance runs one evolution stage,
   structural preparation, at most 256 structural work units, or final report
   preparation/publication. Clearly distinguish full-block O(cells) stages from
   bounded graph work; make no unmeasured latency claim. Publish no partial tick.
3. Compose executed matter correspondence across evolution and settlement, not
   endpoint differences. Report original-to-final moves, touched original matter
   and spatial cells, net changed cells, exact energy, and both component reports
   with their coordinate frames documented. Retain distant bridge consequences.
4. Add an owning CPU world with committed snapshot/tick, monotonically increasing
   instance-local revision, atomic edits, prepared-tick commit, restore and energy
   accounting. Only jobs created by this instance at its current revision can
   commit once; incomplete, foreign, cancelled, consumed and stale jobs cannot
   overwrite terrain. Restore validates completely and resets the energy baseline.
   Invalid commands preserve state, revision and accounting. Edits charge their
   exact external energy delta. Existing state schemas are not implicitly imported.
5. Verify tiny integrated scenes (at most 125 cells, eight ticks): burning/melting
   bridge supports, falling intact fragments, evolving smoke, freezing water,
   conserved energy, exact repeated/JSON-restarted trajectories at odd/order-
   changing ticks, work-budget independence, every cancellation stage, stale
   commits and edit/restore failure atomicity. Trap existing M5 stepping/solver.
6. Split the new world cases and existing 1,146 cases into separate sequential
   30-second harness jobs, with explicit combined acceptance and source checks.
   Then pass full types, lint, SDK and public-package integration under unchanged
   caps/watchdog. Retain 96 protected hashes and runtime hold; native/GPU,
   M5/large-world replay and benchmarks remain held, legacy demos quarantined.

Build 40 result: **1,182 tests in 44 files passed**, split into the existing
1,146-case suite (27.43 seconds in Vitest) and 36 new integrated-world cases
(1.31 seconds). Both jobs retained the 30-second workload deadline. Full types,
lint, all thirteen SDK bundles/declarations, browser compilation and public-package
integration passed on their first attempts. All six stages have confirmed cleanup
and unchanged containment. The combined evidence checks both disjoint test scopes
and their current source hashes:
[`build-40-2026-10-17/summary.json`](tactical-interventions/build-40-2026-10-17/summary.json).

The new tests execute complete reactive CPU ticks, including same-tick burning or
melting of a bridge support, falling bonded fragments, freezing and smoke movement.
They verify exact complete states/reports across budgets, eight-tick trajectories
and JSON restart at odd/order-changing ticks. Public-package acceptance executes
three complete four-cell world ticks, checking matter composition, isolated staging,
revision-bound commit and exact continuation. These are actual new reactive-world
ticks; the `physicsTicks: 0` field in older public checks refers to held M5 stepping.

The owning world rejects stale, foreign, consumed, cancelled and incomplete jobs.
Edits and restores are atomic and account for external energy; restore resets the
baseline. Review added guards that poison an outer mutation after a swallowed
reentrant validation attempt, with regressions for edits, restore and preparation.
Every incomplete tick-job boundary in a tiny fixture is cancellable without changing
the committed input. Composition retains executed matter identities and round trips,
including displacement through both movement and structural settlement.

All 96 protected source/configuration hashes, all five existing browser artifacts
and the runtime hold bytes are unchanged. 107 previous SDK artifacts are identical;
only the reactive public bundle and entry declaration changed, with two new world
declarations. Existing component contracts and snapshots remain unchanged.

This does not finish the wishlist. The new reactive world still needs integration
with state-preserving manipulation, temporary constraints, branch/application
transactions, actor contacts and rendering. Its graph slices are work-bounded,
while evolution, allocation, copying and publication remain full-block O(cells).
The 48 held M5 physical cases were not run; native Worker/browser, GPU parity,
M5/large-world replay and benchmarks remain held. Legacy demos remain quarantined.

## Build 39 success criteria — bounded reactive structural mechanics

Established before implementation against wishlist requirements 1, 3, 5 and 6.
Connect the reactive catalog to physical support and falling fragments without
changing M5 or the already versioned reaction/evolution schedules.

1. Add a separate `reactive-structure-1` complete-block solve: catalog-specific
   density, cohesion and exact thermal weakening; complete support BFS; canonical
   integer load splitting; one damage application; reciprocal bond pruning;
   complete bonded components and blocking dependencies; one-cell downward
   fragment motion as a conservative permutation. Closed boundaries and fixed
   noncohesive solids obstruct motion. Never create bonds or reset damage.
2. Expose a cancellable job with 1–256 work units per advance. A unit visits one
   cell (at most six neighbors) or one dependency edge. No radius truncation or
   iteration cutoff may discard distant support. Validation, allocation and
   isolated result copying remain bounded by the 32,768-cell block limit and are
   explicitly outside the work-unit latency claim. Publish only complete results.
3. Return catalog/rules-stamped support distances, loads, capacities, root
   reactions, component identities, broken source cells, conservative source-to-
   destination moves and net changed cells. These are a whole-block solve report,
   not a revision-stamped world delta or swept actor path. Check weight balance,
   matter permutation and zero energy drift before publication.
4. Tiny fixtures (at most 125 cells) exercise all axes, odd/single-cell shapes,
   anchors, nonbonded vertical contact, explicit bonds, distant bridge support,
   thermal damage, custom properties, blocking propagation, closed boundaries,
   displaced fluid, and loss of a burned/melted support. Complete states and
   reports must agree across budgets and JSON restart; cancel at every work
   boundary of a tiny case and preserve the committed input.
5. Keep the original M5 solver and world stepping trapped, all 96 protected
   sources and the runtime hold unchanged. Run only selected bounded CPU tests,
   types, lint, SDK/browser compilation and a tiny public-package case. Retain
   the same CPU/memory/time/watchdog caps and stop at the first failure. Existing
   M5/global-world replay, native browser/GPU and benchmarks remain held; legacy
   demos remain quarantined. This build does not complete world integration.

Build 39 result: **1,146 selected tests in 43 files passed**, including 35 new
structural cases. Full type checking, lint, all thirteen SDK bundles/declarations,
browser compilation and public-package integration passed sequentially under the
unchanged harness. Evidence is retained in
[`build-39-2026-10-17/summary.json`](tactical-interventions/build-39-2026-10-17/summary.json).

The first full attempt stopped on an invalid custom fixture: zero-cohesion
obstacles inherited a nonzero softening property. The next focused attempt
caught another fixture-definition error: cloned custom stone retained the
built-in stone/lava reverse-transition identity. Both were corrected in the test
catalog; production validation remained strict. The 35-case focused attempt then
passed. Review moved bulk workspace allocation to job creation, followed by a
fresh full 1,146-case pass. Every attempt, including both failures and the focused
pass, retains its authorization, logs and confirmed cleanup. No failed run is
presented as acceptance evidence.

The new CPU kernel was actually executed on fixtures up to 125 cells, including
the full distant bridge after burning/melting its sole support. The four-cell
public-package fixture verifies fragment history, exact energy, budget-independent
results and cancellation. Whole-block support BFS and component dependencies run
to completion; each advance is capped at 256 vertex/edge work units. This does
not establish a wall-clock latency target or large-world scalability. Validation,
workspace allocation and result copying remain bounded O(cells) operations.

All 96 protected sources/configuration files and the hold bytes are unchanged.
106 previous SDK artifacts are byte-identical; only the reactive public bundle
and entry declaration changed, with one new structural declaration. All five
browser artifacts are byte-identical. The original M5 solver and stepping were
trapped, and the 48 held physical cases were not executed. Native Worker/browser,
GPU, full-world replay and benchmarks remain held; legacy demos remain
quarantined. Reactive structural settlement is an explicit separate operation;
composing it into a complete world tick and tactical actor/history integration
remain unfinished. Existing reaction/evolution contracts and saves are unchanged.

## Build 38 success criteria — conservative reactive movement and composition

Established before implementation against wishlist requirements 1, 3, 5 and 6.
Make the new reaction kernel interact with moving material; do not alter M5's
rules or treat this local component as a completed structural world.

1. Add `reactive-movement-1` with twenty immutable-input disjoint-pair passes:
   gravity Y even/odd; four rotated downward X/Z diagonals, each Y even/odd;
   blocked liquid spreading on alternating X/Z axes; buoyancy Y even/odd; and
   blocked gas spreading on alternating X/Z axes. Absolute tick selects direction
   order and integer tie-breaking. Boundaries are closed, including odd rectangular
   and single-cell axes. Reuse catalog density and exact thermal ranking.
2. Swaps transport packed material, conserved energy and structural coordinates
   together, preserving material counts and total energy. Intact/damaged/anchored
   solids stay owned by the mechanical layer. Fully failed unanchored cohesive
   solids may fall as loose debris. Noncohesive solid/frozen materials remain
   obstacles; they cannot become holes just because their structure word is zero.
3. Compose movement with the eight unchanged `reactive-reactions-1` passes under
   separate `reactive-evolution-1` saves carrying an absolute tick and catalog-bound
   block. Validate saves and tick overflow before work. Freeze all 28 stages in
   order and publish only complete ticks; support cancellation at every boundary.
   The reaction-only API and existing block/catalog contracts remain intact.
4. Retain executed matter provenance: exact swap count, canonical final original
   cell moves, and touched origins/cells, including motion that returns to its
   start. Report net changed cells across movement plus reactions and exact energy
   totals. No endpoint-difference heuristic may invent a matter identity. This is
   not a swept actor path or global structural-reach report.
5. Tiny CPU cases prove straight and diagonal descent, blocked/lateral flow, hot
   smoke buoyancy and lateral motion, all axes/parities/boundaries, custom densities,
   conservation, protected structural history, and smoke transport after burning.
   Repeat complete states/reports and compare JSON restart at odd ticks and each
   schedule rotation. Cancellation and malformed inputs leave committed state intact.
6. Keep new fixtures at most 125 cells and eight ticks per trajectory, trap M5
   stepping/global support, retain unchanged harness caps/watchdog/deadlines and
   stop on failure. Pass selected tests, full types, lint, SDK and public package
   integration sequentially. Keep protected sources and the runtime hold unchanged;
   native/GPU, M5 replay, global structural solves and benchmarks remain held.

## Build 37 success criteria — exact local reactive cycles

Established before implementation against wishlist requirements 1, 5 and 6.
The new material definitions must drive actual thermal reactions. Implement a
separate bounded CPU kernel without changing M5, its saves or its schedule.

1. Publish `reactive-reactions-1` state with a catalog-bound material block and
   absolute cycle. Validate and isolate saves/inputs; reject overflow and foreign
   identities atomically. A cycle is not an M5/world tick or a movement solve.
2. Freeze the local schedule: six disjoint heat passes (X/Y/Z, even/odd), one
   phase pass, one simultaneous combustion/extinction pass. Use the existing
   integer temperature, exchange, phase thresholds and chemical energy model.
   Closed boundaries, odd rectangular shapes and singleton axes must work.
3. Hot fuel requires temperature strictly above its flash point and an adjacent
   oxidizer. Mutually selected six-neighbor pairs react once, without consuming
   one oxidizer twice. Selection uses coordinates and absolute cycle only.
   Fuel and oxidizer become their catalog products; bounded transfer of half the
   chemical energy preserves total energy even at storage saturation. Existing
   fire becomes smoke below 80 temperature units, next to water or without nearby
   fuel. Newly produced fire cannot extinguish during the same pass.
4. Phase/reaction changes preserve unchanged material history and remove invalid
   reciprocal bonds. Solid-to-solid phase transitions preserve damage/anchors;
   newly solidified or chemically replaced solids get fresh integrity but no
   implicit joins. This kernel does not infer support, weld surfaces or move cells.
   Complete-cycle reports include all changed cells and exact energy accounting.
5. Support an isolated staged job with one pass per advance, cancellation between
   passes and publication only after all eight passes. Inputs, partial arrays and
   caller mutations must not alter the retained committed result. Save/restart
   must preserve ordering at odd cycles and every direction rotation.
6. Verify hand-computable tiny CPU reaction cases, custom fuels, heat/latent
   thresholds, combustion competition, structural effects, cancellation and
   exact saved continuation. Keep fixtures at most 125 cells and eight cycles;
   test collection must trap M5 stepping/support and native GPU execution.
   Retain the 6% CPU/4 GiB Job, watchdog, deadlines, quiet gates and stop-first
   failure. These isolated kernel units are the only added execution scope.
7. Pass selected tests, full types, lint, SDK build and zero-M5-tick public package
   checks sequentially. Preserve protected sources, old rules and runtime hold.
   Full reactive world movement/support, native integration and physical/gameplay
   replay remain separate acceptance work. Legacy demos remain quarantined.

## Build 36 success criteria — extensible reactive material data

Established before implementation against wishlist requirements 1 and 5. The
shared thermal model already stores chemical fuel energy, but M5 rejects wood,
fire, smoke and custom materials. Add a separate public foundation for the next
reactive 3D rules without changing any existing simulation contract.

1. Provide an immutable branded 3D registry with portable definitions, explicit
   supported IDs, stable domain-separated SHA-256 identity and isolated table
   reads. Reuse existing property/phase/fuel validation, require closed transition
   and combustion products, and reject phases the new profile cannot support.
   Default support includes wood/fire/smoke; custom additions use the same checks.
2. Reject malformed data, getters, sparse/decorated arrays, forged registries and
   async mutation races. Canonical ordering must give the same identity; changed
   properties or active material sets must change it. Existing catalogs and M5
   readers must not silently accept the new contract.
3. Add a portable bounded material block containing all three coordinates and
   catalog identity, including odd rectangular shapes. Validate thermal views,
   chemical floors, structural eligibility, reciprocal bonds and boundaries.
   This is material data, not a world snapshot: no tick or simulation API.
4. Atomic construction, energy, damage, anchor and explicit bond edits preserve
   input isolation. Construction is explicitly fresh matter and clears old bonds;
   joins are explicit. Thermal edits cannot consume chemical fuel. Report exact
   external energy and changed cells. Saving/loading preserves existing history.
5. Publish the experimental reactive-materials package entry, documentation and
   bounded unit/public-package evidence. Pass selected tests, types, lint and SDK
   builds sequentially. Keep all protected physics and runtime holds unchanged.
   Combustion evolution, transport/support integration, native execution and
   replay/performance acceptance remain outstanding requirements.

## Build 35 success criteria — actors cannot pass through peers

Established before implementation. Wishlist requirement 4 needs reliable actor
contacts during terrain motion, including transient collisions that endpoint
overlap checks miss.

1. Preserve the published `terrain-body-group-1` and individual displacement
   behavior. Add a separate versioned actor-group API that checks simultaneous,
   piecewise swept body volumes through the exact observed terrain passes.
2. Track actual constrained paths, not requested carry or final displacement.
   Include stationary peers, moving peers, direction changes, delayed pushes,
   initial overlap, all axes and tangential touching. Order contacts by pass,
   exact rational time and portable actor IDs; use no floating approximation.
3. Shared bounded work covers both terrain response and peer checks. Exhaustion
   returns incomplete with original bodies and no successful prefix. A detected
   peer overlap reports the earliest contact and leaves all bodies unchanged.
   Peer pushing, rigid-body response, health and knockdown are not inferred.
4. Integrate both translation and complete-tick actor groups into the chamber,
   with a new application save identity. A conflicting preview cannot publish
   terrain, actors, resources or saved parcel controls. Legacy SDK behavior and
   all protected material physics remain unchanged.
5. Add hand-checkable edit/inert regressions, mock worker and zero-tick public
   integration. Pass selected CPU tests, full types, lint, SDK/browser builds
   sequentially under the reviewed harness. Actual physical coupling, native
   execution, GPU/replay/benchmarks and legacy demos remain held.

## Build 34 success criteria — chamber material wind

Before implementation: connect the conservative transport foundation to the
SDK-only chamber. Existing matter, application transactions and exact saved
history remain the product contract.

1. Add provenance-bound translation continuation for saved parcel controls,
   including displaced gas and identical-valued cells. Reject cloned, foreign,
   incomplete or mismatched observations. Preserve cycle, velocity and fractions.
2. Seed three existing steam/water/sand parcels. A bounded wind pulse or drift
   advances one explicit transport cycle, preserving all terrain coordinates and
   total thermal energy through swaps. A pulse adds velocity once. Environmental
   ticks only follow material provenance; no hidden transport substeps.
3. Version chamber saves explicitly. Parcel history, AP and turn commit together;
   stale previews, invalid commands, range/velocity limits and actor obstructions
   cannot partially publish. Retired control never creates replacement matter.
4. Show controls and saved parcel state through the existing worker/UI and A/B
   boundary. Demonstrate JSON continuation and public SDK use without material
   stepping. Preserve previous earth/thermal/actor assistance behavior.
5. Sequential bounded CPU tests, types, lint, SDK/browser compilation and public
   entry integration must pass. Preserve failed attempts. Keep the runtime hold,
   96 protected hashes and legacy quarantine. Native interaction, actual M5
   trajectories, GPU/replay and performance remain explicitly unaccepted.

Started 2026-10-17. Status: **in progress**. This checkpoint retains the full
game-developer wishlist for an XCOM-style tactics game with four-element terrain
manipulation. A completed foundation stage does not complete the wishlist.

## Product acceptance

| Requirement | Delivery and evidence required | Status |
|---|---|---|
| Material history | Conservative extraction/storage/transfer; translated structural regions retain energy, damage and internal bonds; explicit cuts/joins; accounted heat; saved temporary constraints with deterministic expiry. Invalid operations are atomic. | Implemented edit/transaction foundation remains covered by Build 35's 961 selected CPU/geometry/edit/inert/mock cases and all five approved gates. Translation tracking includes displaced gas and identical-valued cells. Actual material trajectories pending |
| Branches and transactions | Revision-bound snapshot branches, bounded simulation horizons, inspection/discard/commit, stale rejection; terrain, actors, resources, action points, turn/RNG state commit together. Later buffer reuse must preserve results. | Build 29 removes eager branch/setup copies; reference comparisons pass. Build 33 stages material transport and compact momentum through ordinary actor-aware translations and guarded game updates, with mocked worker coverage. Physical-horizon agreement, GPU branches and chunk-level copy-on-write pending |
| Gameplay queries and changes | Body fit, support, rays/sweeps, material/energy/support change reports, fragment motion correspondence; complete revision-stamped coverage of distant structural effects and explicit overflow fallback. | Implemented reports, path journals and ready-preview/commit transport pass selected CPU gates through Build 33. Real support/motion/replay and GPU production remain pending |
| Actors and terrain | Deterministic volumes, contact/swept movement, footing loss, moving supports, debris and water/temperature exposure. Optional external actor loads; health and knockdown policy stays in the game. | Builds 30–31 add voluntary movement and chamber integration. Build 35 adds exact swept peer-contact detection during terrain motion, shared budgets and atomic chamber rejection, verified with edit/inert/mock cases. Actual material coupling, additional peer responses and external loads remain pending |
| Four elements | Earth manipulation/constraints; conservative water storage/transfer; versioned 3D fuel/combustion/smoke and material extension; bounded force/transport for gas, loose matter, projectiles and actors where needed. No scientific-fluid-accuracy claim. | Earth/water interventions and thermal control implemented; Build 31 adds actor air assistance. Builds 32–34 add saved material transport and chamber wind/drift controls, provenance-bound continuation and atomic staging with CPU/inert/mock coverage. Real material coupling, native elemental scenes and combustion/fuel/smoke/material extensibility remain pending |
| Latency and rendering | Responsive rendering from committed state, bounded simulation submissions, preview supersession at safe boundaries, shared coordinates/depth for actors and overlays, disposable caches. Exact dependency-aware reuse must retain distant support consequences. | Builds 27–29 implement rendering, worker-owned UI and private branch reuse. Build 35 passes 961 selected cases, types/lint, twelve SDK bundles, browser compilation and zero-material-tick public integration. Native execution, measured latency and exact structural reuse remain pending |

Physics and intervention rules are separately versioned. Existing 2D and M1-M5
contracts must remain intact. No gameplay policy (ability ownership/range, AP,
cover bonuses, fog of war, damage or knockdown) becomes a material law.

Build 26 implements the first integrated acceptance scene as an SDK-only headless
reference: lift a damaged, hot slab into cover, remove the walkway's bonded route
to its abutment, change a firing line and save temporary control. Edit-only
integration passed; actual undermining, expiry/falling and full physical preview
agreement remain held acceptance gates. This scene does not replace later water,
fire and air acceptance scenarios. Builds 27–28 add the rendering interface and
tactical UI implementation; their native acceptance remains pending.

## Verification policy

Before each implementation stage, record its success criteria here. Validate
with narrowly selected tests under the reviewed supervisor, one stage at a time,
stopping on first failure. Preserve failed receipts; review and fix before retry.
Record source hashes, limits, results and cleanup. Do not promote source inspection
or CPU tests to GPU, replay, performance or visual acceptance.

The user's incident hold remains active. GPU checks, replay trajectories and
benchmarks are blocked pending the reviewed safety/host prerequisites. Legacy
demos remain quarantined. The present build-and-verify instruction authorizes
bounded CPU unit checks and static type/lint stages; it does not clear that
hardware hold. The user reauthorized SDK build/public-entry checks on 2026-10-17
after the earlier deferral. Selected checks execute no physical ticks or support
solves; public-package integration executes no material ticks. Build 31 also
prepares and discards an air branch without advancing its declared horizon.

## Build 1: conservative translation foundation

Success criteria established before implementation:

1. A new experimental operation consumes an isolated validated M5 snapshot and
   returns a new snapshot plus an intervention receipt. It never mutates the
   input or advances time; M5 evolution/placement and snapshot rules stay intact.
2. Transfer uses an exact permutation of packed material/thermal/phase and energy
   coordinates, including displaced occupants. Volume/material counts and total
   energy are unchanged; external thermal energy is exactly zero.
3. Selected cells retain integrity and all internal bonds. External bonds either
   cause rejection or are explicitly cut reciprocally. Anchors either reject
   motion or are explicitly released. Contact creates no bonds.
4. A caller supplies a bounded cardinal unit-step path. Every intermediate
   position must remain in bounds and satisfy displacement policy; checking only
   the final destination is insufficient. Overlapping source/destination regions,
   reverse directions, disconnected selections and all three axes are supported.
5. Air-only displacement is the default. An explicit mobile policy additionally
   permits unbound material that the M5 local movement rules regard as movable.
   Intact solids and anchored cells cannot be displaced. No occupant is deleted,
   cloned, healed or thermally reseeded.
6. Duplicate/out-of-bounds cells, malformed options, unsupported snapshot state,
   excessive work and any late path failure reject with the original snapshot
   byte-for-byte unchanged. Outputs and receipts own their storage.
7. The receipt identifies the intervention rules version, unchanged tick, source
   and final destination indices, cut edges, released anchors and all edited
   cells. These are intervention changes, not a claim about later support effects.
8. Hand-checkable bounded CPU tests cover these properties, then type checking,
   lint and SDK build expose a documented experimental public entry. No native
   device, simulation step, replay or benchmark is part of this stage.

The initial operation is an instantaneous edit between completed ticks. The path
specifies collision checks, not elapsed simulation time. Mechanical work is not
added to M5's thermal ledger; ability costs belong to the application. Temporary
constraints and actor collision will be added by their own versioned contracts.

## Build 2: snapshot branches and atomic application commitment

Success criteria established before implementation (2026-10-17):

1. A session owns terrain, portable application state (actors/resources/AP/turn/
   RNG supplied by the game), thermal accounting and a monotonically increasing
   revision. Public reads and branches own isolated copies. World, physics,
   intervention and game-rule identities are explicit.
2. A branch records its base revision/start tick and a required horizon before
   work begins. It supports existing M5 edits and the new conservative translation,
   game-state replacement, bounded advancement, inspection and discard. Production
   advancement uses the existing M5 CPU rules, not a preview approximation.
   Inspection includes base/horizon/completed-duration metadata and is a distinct
   envelope that cannot be mistaken for a committed save by `restore`.
3. Only a complete branch from this session and its current base can commit.
   A sibling commit or restore invalidates the old base even if the physics tick
   is unchanged. Foreign, forged, discarded, failed and already committed branches
   reject. Unfinished horizons cannot commit.
4. All potentially failing validation/copying precedes a single synchronous
   publication. Failed edits, game validation, simulation, cleanup, cancellation
   or commit leave the live terrain, game state, revision and accounting unchanged.
   A failed branch cannot subsequently commit its earlier successful operations.
5. Snapshot branches preserve the session's accounting baseline. Relative external
   energy from edits is added exactly; closed simulation must preserve total
   energy. Portable session restore checks balance and identities before changing
   state, and advances the live revision rather than resurrecting an old token.
6. At most four branches are retained, with a maximum declared horizon of 1,024
   ticks and 32 ticks per advancement request. Only one advancement runs per
   session. There is no unbounded request queue. Cancellation/supersession is
   observed between completed ticks; submitted work is never assumed preempted.
7. An application-owned synchronous tick reducer can update actor/resource/turn
   state from each complete physical result. It receives copies and is identified
   by the caller's game-rules version; it must be deterministic and side-effect
   free. Invalid or throwing reducers fail the entire branch.
8. Dedicated bounded CPU tests exercise real edits/translation and zero-horizon
   commits. Inert simulation drivers exercise nonzero horizon scheduling, partial
   failures, cancellation and cleanup without executing physics. Native replay,
   CPU physical-horizon agreement and rendering responsiveness remain explicit
   pending gates, not inferred from mock advancement. SDK/type/lint/public-entry
   checks validate the delivered API under the safe harness.

The production implementation must include actual M5 advancement despite the
runtime validation hold. The session's JSON envelope is a separate contract;
it does not alter M5 snapshots or store disposable renderer caches. Incremental
copy-on-write, GPU branches, body contacts, reservoirs and temporary constraints
remain subsequent stages. This gate does not claim those are implemented.

## Later build gates (must be expanded before each build)

- Extraction/storage: transfer ownership without duplication; retain every state
  coordinate and inventory energy in saves; reject capacity/compatibility errors
  atomically; conserve across world plus reservoirs.
- Constraints/heat: deterministic scope and absolute expiry; persistence and
  interruption semantics; heat deltas accounted exactly, limits reject atomically.
- Transactions: world identity plus revision, rules and game-state identity; a
  branch retains accounting context because M5 restore resets its baseline.
  Failures leave the whole live game unchanged; commit installs the verified
  branch only against its unchanged base.
- Queries/reports: independent exact comparisons, global dependency coverage,
  support changes without voxel changes, energy changes below thermal-byte
  resolution, explicit conservative fallback on report capacity overflow.
- Actors: fixed tick ordering for contact/support/exposure, swept collision and
  carry/displacement; no tunneling, double movement or order-dependent contacts.
- Elements: versioned material/force rules and saved coordinates, complete-state
  CPU/GPU conformance, energy/volume accounting and interacting scene outcomes.
- Execution/rendering: measured preview turnaround, cancellation latency and
  longest submission, complete-state publication and coherent depth composition.
  Hardware acceptance remains pending until safe verification is authorized.

## Evidence

The translation foundation is implemented in `engine/experimental/interventions.ts`
and exported as `state-space-engine/experimental/3d/interventions`.

| Build 1 gate | Result |
|---|---|
| Bounded CPU unit suite | 19/19 passed, zero skipped; 901 ms Vitest duration |
| Full TypeScript check | Passed |
| Structural lint, including new implementation/tests/configuration | Passed |
| SDK build, ten bundles and declarations | Passed |
| Public package entry | Passed: one 4-cubed translation through package exports |
| Owned workload/Job/watchdog cleanup | No remaining owned processes or Jobs observed |
| Earlier physics sources / hard hold / legacy quarantine | Protected hashes unchanged |

All five execution stages ran sequentially under the reviewed supervisor with a
6% CPU / 4 GiB Job limit, independent watchdog and live CPU/memory checks. Tests
used one worker and a 256 MiB Node heap; build/check stages used 512 MiB. The SDK
build had a 60-second deadline; the other stages had 30 seconds. All passed on
their first attempt; no retry or relaxed limit was needed. A source-bound,
process-local one-use CPU authorization preserved the on-disk hard hold and leaf
runtime gates. No GPU telemetry or execution, browser, physics tick, replay or
benchmark ran. Existing M5 and lighting evidence is not promoted to new claims.

[Build 1 summary](tactical-interventions/build-01-2026-10-17/summary.json) links
raw outputs, test reports, health/watchdog/cleanup receipts and authorizations.
It retains 62 SDK artifact hashes and the comparison of 91 protected existing
source/configuration files. The [helper check](tactical-interventions/build-01-2026-10-17/helper-cleanup.json)
records the final owned-process inspection. These establish the CPU edit-only
foundation, not native GPU equivalence, replay, actor safety or performance.

### Build 2 evidence: transaction coordinator

`state-space-engine/experimental/3d/tactical-session` now exports the session,
branch, complete commit and portable save interfaces. The production driver
calls unchanged M5 CPU stepping. It was not physically advanced during validation.

| Build 2 gate | Result |
|---|---|
| Transaction unit tests | 26 passed, using real edits and inert simulation drivers |
| Translation regression tests | 19 passed unchanged |
| Revised full type check and structural lint | Passed |
| SDK build, eleven bundles and declarations | Passed |
| Public package entry | Passed: one zero-horizon 4-cubed terrain/game transaction |
| Process / Job / watchdog cleanup | No owned processes or Jobs observed remaining |
| Production physical-horizon agreement | Pending; runtime hold retained |
| GPU/replay/performance and rendering responsiveness | Pending; blocked |

The initial 44-test suite and type check passed. Subsequent source review found
that an inspected candidate had the same envelope as a committed save. Inspection
now includes explicit preview identity/duration, and restore rejects that envelope.
The revised 45-test suite and type check passed, followed by lint/build/public-entry
checks. The earlier passing receipts remain historical; no failure was hidden and
no resource limit was relaxed. A trap on the real CPU `step` method confirms that
the unit stage executed zero physical ticks. Inert driver tests prove transaction
ordering and failure handling, not physical equivalence or speed.

All stages ran sequentially with the same bounded CPU harness, real health
checks/lease/Job and independent watchdog as Build 1. The latest
[Build 2 summary](tactical-interventions/build-02-2026-10-17/summary.json) retains
commands, source hashes, raw results and cleanup links. It records 96 protected
existing source/configuration files unchanged and all 62 prior SDK artifacts
byte-for-byte unchanged; the rebuilt SDK contains 66 artifacts. The final
[owned-helper inspection](tactical-interventions/build-02-2026-10-17/helper-cleanup.json)
found none remaining. The hard hold and legacy quarantine hashes match Build 1.

At the end of Build 2 the full wishlist remained incomplete. Saved temporary constraints, accounted
thermal actions, reservoirs, gameplay queries/actor contacts, the four-element
extensions, efficient execution/rendering and the pending runtime proofs remain.

## Build 3 acceptance criteria: temporary holds and thermal interventions

Established before implementation. This build advances wishlist items 1 and 2:
hold damaged matter temporarily and apply accounted heating/cooling inside the
same terrain/game transaction. It does not introduce a force solver.

1. Saved, versioned world-space holds select cohesive solid/frozen cells without
   changing their energy, damage or bonds. Their absolute expiry is authoritative
   session state, separate from permanent anchors. A hold active at tick T with
   expiry E affects transitions T -> T+1 through E-1 -> E, then is absent from
   the committed state at E. Releasing or expiring it preserves permanent pins.
2. Holds never silently bind replacement matter: material placement releases the
   affected target even when the material ID is unchanged; melting/phase change
   releases it after that complete tick. A held source must be explicitly
   released before translation. Duplicate IDs, overlapping targets, invalid
   coordinates, noncohesive targets, expired holds and oversized requests fail.
3. A bounded signed energy-delta batch rejects duplicate targets and any invalid
   final energy without clamping. It retains material, phase, integrity and
   bonds until ordinary physics resolves transitions. Receipts separately record
   energy supplied, removed and net external Q, so opposing costs cannot hide
   behind a zero net delta. Game resource/AP costs remain application policy.
4. Holds, energy accounting, terrain and game state publish atomically; failures
   preserve live state. Portable saves, isolated reads, branch cancellation,
   stale rejection and restore retain all authoritative hold data. The session
   schema/rules identity changes explicitly; old envelopes are rejected.
5. CPU edit-only tests cover preserved history, expiry protocol, permanent pins,
   replacement/phase release, malformed saves, overflow/underflow and rollback.
   Inert drivers verify boundary ordering and restart agreement; a real-step
   trap ensures no physical tick runs. Physical held-slab/melting trajectories
   and exact native replay remain pending under the runtime hold.
6. Run selected CPU/mock regression tests, type checking, lint, SDK build and a
   zero-tick public-entry check sequentially through the reviewed bounded harness.
   Stop on failure, retain every receipt, and verify cleanup. Do not run GPU
   telemetry, browsers, physical replay, benchmarks or quarantined demos.

Scope limits: at most 64 holds and 65,536 held cells per session; no overlapping
holds; maximum remaining lifetime 1,024 ticks. This first constraint is a pin at
fixed cell coordinates, not a moving rigid body or an actor constraint. It does
not repair matter, weld contacts, suppress heat/phase changes or account mechanical
work as thermal energy. Performance of the snapshot-based layer is unmeasured.

### Build 3 evidence and remaining gates

`tactical-session-2` / schema 2 now saves holds and their absolute expiry alongside
terrain, game state and thermal accounting. `temporary-holds-1` pins selected
cohesive cells during M5 stepping; canonical terrain retains only permanent pins.
The branch exposes `hold`, `releaseHold` and `addEnergy`. Version 1 session
envelopes reject explicitly. The underlying M5 and earlier physics contracts have
not changed. Their 96 protected source/configuration hashes match Build 2.

| Build 3 gate | Result |
|---|---|
| New constraint/thermal CPU and mock tests | 21 passed |
| Earlier transaction and translation regressions | 45 passed |
| Type checking and structural lint | Passed |
| SDK build | Incomplete: safety harness stopped it for sustained host CPU above 85% |
| Public package entry, including holds and heat | Pending successful SDK build |
| Workload / Job / owned helper cleanup | Confirmed; none observed remaining |
| Actual constrained physics, replay, GPU and performance | Pending; runtime hold intact |

All 66 tests passed with real CPU stepping trapped. Mock driver receipts verify
absolute expiry across odd ticks, staggered holds, independent permanent pins,
phase-release protocol, reload failure, cancellation, and continuation through
portable saves. They are not proof of actual held-body physics or native replay.
Edit-only tests cover history preservation, replacement semantics, thermal
overflow/underflow, separate supplied/removed costs and atomic game validation.

The [Build 3 summary](tactical-interventions/build-03-2026-10-17/summary.json)
retains all source-bound authorizations, raw outputs, telemetry and cleanup links.
The first typecheck passed; a second passed after the mock phase fixture was
updated to use the catalog default phase. Test and lint stages passed. No source
or compiler failure occurred during these checks.

The SDK attempt was stopped with exit 125 after host CPU reached 99.56% and
exceeded 85% for two seconds. The cause of that host spike is unconfirmed. The
workload remained in its 6% CPU / 4 GiB Job, and its sampled total was 4.39 CPU
seconds. Its process and Job were gone after cleanup; the final helper inspection
found none owned by any stage. No later validation workload ran. A read-only
follow-up required ten samples at or below 20% host CPU and stopped on sample
seven at 24.12%; the build retry was deferred without relaxing any safety limit.
The interrupted build left `dist/sdk` incomplete. Do not use previous public SDK
receipts as evidence for this version. SDK build/public-entry completion needs a
quiet host window; the runtime hold and legacy quarantine remain unchanged.

This advances the saved-constraint and thermal-action foundations. Conservative
reservoirs, gameplay queries and global change reports, actor/terrain contacts,
the remaining elemental rules, efficient execution/rendering, and actual physical
validation still remain in the full wishlist.

## Build 4 acceptance criteria: conservative material reservoirs

Established before implementation. This advances the extraction/storage/transfer
part of wishlist items 1 and 5 and extends complete-state transactions in item 2.
The user has deferred SDK checks while background work continues; retain that
pending gate. Source review and authored tests are not passing runtime evidence.

1. A session may own up to eight named finite companion volumes, at most 65,536
   cells in total. Each is a validated M5 snapshot at the session's absolute tick.
   Reservoir geometry and identity are fixed for a session. Its entire physical
   state, including energy, damage and bonds, is saved, branched and restored.
2. A transfer between distinct domains exchanges selected source cells with
   destination occupants. Source coordinates plus one offset define the mapping.
   It is a storage handoff, not movement through intervening world coordinates;
   in-world motion continues to use checked-path translation. Game rules authorize
   inventory access, distance, ports and ability costs.
3. Across both domains, material counts, occupied volume and energy are exact
   permutations. No fresh air, matter, thermal seed or integrity is manufactured.
   Cohesive selections retain internal reciprocal bonds and damage. External
   bonds and permanent anchors reject unless explicitly cut/released. Contact
   does not weld. Temporary held sources require explicit release first.
4. Air-only destination displacement is the default; explicit mobile displacement
   follows the existing translation policy. Intact or pinned occupants block a
   transfer. Invalid domains, coordinates, duplicates, capacity, malformed saves,
   unsupported states and late failures leave all committed state unchanged.
5. Storage is not frozen time: every reservoir executes one complete M5 tick for
   each world tick, sequentially, with closed matter/energy boundaries between
   transfers. Only a complete world-plus-reservoir boundary reaches game policies
   or branch publication. Failures/cancellation clean all created drivers and
   never publish a partly advanced inventory. Empty-reservoir sessions retain
   their existing execution behavior.
6. Accounting covers world plus all reservoirs. Transfers have zero external
   energy; receipts show paired addresses and opposite domain energy deltas.
   Game state, holds, reservoirs, accounting and revision commit atomically.
   The session schema/rules identity changes explicitly; old saves reject.
7. Author hand-checkable CPU edit tests for hot water/ice and damaged bonded
   fragments, displaced gases/liquids, complete permutation/conservation,
   aliases, bounds, malformed saves and rollback. Inert-driver tests cover full
   boundary ordering, cleanup, cancellation, stale commits and snapshot restart.
   Actual reservoir trajectories and native replay remain held runtime gates.
8. Once a quiet verification window is available, run the selected tests, type
   checks, lint, SDK build and public-entry check sequentially under the reviewed
   harness. Retain all failures and cleanup receipts; do not relax the hold,
   invoke GPU telemetry or start quarantined demos.

Reservoirs are additional physical domains, not bags of material IDs or unlimited
storage. Their initial contents are part of session genesis and accounting;
adding/removing a domain during a session is not an implicit free-matter operation.
The application decides their physical interpretation (container, controlled
volume, or explicit off-world storage). No direct heat exchange crosses domains.

### Build 4 source review; verification pending

Implemented `material-reservoirs-1` and the session's explicit schema 3 /
`tactical-session-3` envelope. `branch.transfer` supports primary-to-reservoir,
reservoir-to-primary and reservoir-to-reservoir cell exchanges. Stored physical
coordinates and global thermal accounting participate in branch isolation,
inspection, atomic commit and restore. Domain topology cannot silently change on
restore. The public entry exports reservoir requests, receipts and limits.

The actual CPU driver now creates and advances every domain sequentially at each
logical tick. Each result must match its previous domain's identity, geometry,
energy total and next absolute tick. Only the full boundary reaches game policy.
Driver initialization, step/snapshot, cancellation and cleanup failures preserve
the committed session. Cleanup attempts all created drivers even when one fails.
Neither storage nor rendering becomes a shortcut around physical evolution.

Authored 23 new CPU/edit/mock cases cover conservation, hot-water round trips,
damaged bonded ice, permanent and temporary pins, cut bonds, displacement,
snapshot ownership and capacity, complete domain boundaries, cleanup, cancellation
and mock continuation. The selected suite also retains the earlier 66 cases with
the current envelope expectations. Public SDK coverage now includes a zero-tick
storage round trip. **These revised tests and checks have not been run.** Prior
passing receipts apply to their recorded older source hashes, not this build.

Source review hardened reservoir snapshots against accessors before geometry or
cell data is read, verified that allocations are bounded before the M5 validator
copies a domain, and traced cleanup after partial driver creation and close
failures. Exact transfer mapping is injective: the same coordinate offset maps
unique bounded sources to unique destinations, including different domain strides.
Internal bond directions are unchanged; reciprocal external cuts are explicit;
both resulting domains must pass the existing structural-state validator.

The [Build 4 source record](tactical-interventions/build-04-2026-10-17/summary.json)
retains source hashes, the review scope and pending gates. Read-only hash checks
confirm the same 96 protected physics/configuration files, runtime hold and legacy
quarantine gate remain unchanged. No new test, compiler, SDK build, physics tick,
browser, GPU telemetry or benchmark workload ran during this build. The user
explicitly deferred SDK checks; the previous interrupted SDK output remains
incomplete. Current unit/type/lint/public-entry and physical acceptance are pending.

The next gameplay foundations remain body/support/ray/sweep queries with complete
revision-stamped change reports, actor contacts and exposure, elemental rule
extensions, and responsive execution/rendering. Full-wishlist completion still
requires the retained physical replay and performance gates as well as these APIs.

## Build 5 acceptance criteria: deterministic gameplay geometry queries

Established before implementation. This builds the geometry half of wishlist
item 3 and a prerequisite for actor contacts in item 4. Change reports, physical
support stability, actual actor integration and GPU query acceleration remain
separate required work, not inferred from this geometry API.

1. Committed sessions and ready previews expose isolated geometry views for the
   primary world or a named reservoir. Results carry the originating revision or
   preview identity, completed tick, domain and query rules version. Later edits,
   commits or caller mutations cannot change a retained view.
2. Body fit, downward surface support, segment raycast and swept axis-aligned body
   queries use integer coordinates at 1,024 units per voxel. Hit times are reduced
   rational fractions; comparison uses exact safe-integer products. Coordinate,
   body and work limits reject malformed or excessive queries explicitly.
3. Bodies occupy positive open volume; touching a cell face is allowed. Sweeps
   report earliest contact, including at the endpoint, with deterministic tie
   breaking and an explicit initial-overlap result. World boundaries block bodies.
   No diagonal tunneling, zero-motion error or parallel-axis false collision.
4. Rays may enter from outside the volume for orbit-camera picking. Clip to the
   volume, traverse voxels with exact boundary times, and step all axes together
   at corner crossings. Cells touched only at an edge/corner are not selected.
   Grid-plane starts choose the cell in the travel direction. Default blocking
   materials are solid/frozen/powder; an explicit bounded material-ID filter can
   target water, gases or other built-in materials without changing physics.
5. Support reports identify the nearest downward collision and all co-nearest
   supporting cell faces under the footprint, including closed floor boundaries.
   Surface overlap areas use integer square units. A geometric support contact
   is not a structural stability/load guarantee or permission to stand there.
6. Queries do not step physics, mutate terrain/game state, cache authoritative
   data or decide cover/AP/fog-of-war policy. The same geometric implementation
   serves committed and preview states. Unit cases exercise all axes, signs,
   boundary/corner ties, thin obstacles, initial overlap, zero motion, filters,
   reservoirs, stale retained views and exact fractional contacts.
7. Author source-level regression coverage and document limits. Execution tests
   require a quiet CPU gate and the reviewed single-worker harness. SDK checks
   remain user-deferred; actual physics/replay/GPU and benchmarks remain blocked.

At the start of this build, the read-only Build 4 CPU gate failed at 48.65% on its
first sample (limit 20%). No test workload was launched. Build 4's 23 new cases,
current type/lint checks and SDK gates remain pending; no earlier receipt is
promoted to the current source.

### Build 5 source review; verification pending

Implemented `gameplay-geometry-1` through `session.queries()` and
`branch.queries()`. The views support body fit, exact swept body contacts, clipped
voxel rays and nearest downward contact surfaces in the primary or a named
reservoir domain. They own validated copies of the original domain and immutable
revision/preview stamps. Subsequent edits, commit or result mutation cannot rewrite
the retained geometry. Query creation does copy the entire CPU domain; this is not
a measured low-latency or GPU-resident path.

All query coordinates use integer 1/1,024-voxel units. Exact fraction comparisons,
reduced contact times and fixed X/Y/Z and x-major tie rules replace epsilon-based
selection. Bodies have positive open volume inside closed boundaries. Support
returns contact area and distance, not structural stability, loads or walkability.
A prospective 65,536-cell budget is enforced before broad-phase enumeration,
including initial fit work; over-budget queries throw rather than report clear.

Source review corrected canonical zero times, distinguished a ray entering a
voxel face from initial occupancy, and made simultaneous internal-plane/world-entry
normals follow the same axis order. Bounded array data is copied from descriptors
before interpretation, so overridden caller iterators/methods cannot expand the
query or run during normal validation. Explicit regression cases cover these fixes.

Authored **36 query cases** (26 declarations, including two six-case tables), plus
public SDK geometry assertions. The selected five-file suite now expects 125
cases: the earlier 66, Build 4's 23 and this build's 36. **None of the current
geometry/reservoir suite, compiler, lint or SDK checks has been executed.** Older
receipts remain bound to their earlier sources. The SDK output from the stopped
build remains incomplete and SDK checks remain explicitly user-deferred.

The [Build 5 source record](tactical-interventions/build-05-2026-10-17/summary.json)
records authored cases, hashes, source-review reasoning and pending gates. Read-only
hash comparison found all 96 protected physics/configuration sources unchanged,
including the persistent runtime hold and legacy quarantine gate. Tracked-file
`git diff --check` and a text whitespace scan of new sources found no whitespace
errors. These checks do not establish compilation, physical replay or performance.
No test, compiler, SDK, browser, GPU or physical-simulation workload was launched.

The next gameplay work must still supply complete material/thermal/support change
reports and actual fragment motion correspondence. Geometry queries alone cannot
prove the distant effect of removing a support or carry a unit on moving terrain.
Actor response, elemental rules, responsive execution/render integration and the
integrated acceptance scenes remain required by the full wishlist.

## Build 6 acceptance criteria: complete endpoint change reports

Established before implementation. This stage adds revision-bound comparisons
for wishlist item 3, including the actual spatial reach of support differences.
It is an endpoint report foundation, not the complete per-tick motion journal:
identical-looking matter can move and return without changing either endpoint.
Actual fragment correspondence and intermediate events remain explicit required
work and must never be represented by a falsely complete empty motion list.

1. Ready branches can compare their candidate with their current base revision.
   Committed results retain an isolated comparison between the exact states that
   were published. Reports identify both revisions or preview identity, absolute
   ticks, domain geometry and a separately versioned report contract.
2. Scan every cell in every domain. Independently report material ID, phase,
   conserved energy, exact temperature, mechanical word and temporary-constraint
   differences. Distinguish latent-energy changes from temperature changes.
   Game-state and external-accounting changes are explicit metadata.
3. Use the existing global M5 support solve, without changing its law, on isolated
   before/after input with temporary anchors overlaid. Compare support distance,
   load, capacity and reaction for every cell, including remote bridge cells with
   unchanged material/structure. No local edit box limits coverage. The values
   describe the support assessment at each endpoint, not a promise of survival.
4. Emit ascending x-major runs, exact changed-cell counts and spatial bounds.
   Enforce a shared bounded run budget; on overflow, label that channel as needing
   a full read, retain its complete count/bounds, and expose no truncated run list
   as complete. Bounds are conservative; counts describe actual differing cells.
5. Inspection never advances or publishes physics. Reports are disposable derived
   data, absent from saves and replay authority. A failed query or caller mutation
   leaves live/candidate state intact. Committed report inspection remains bound
   to its original endpoints after later commits/restores.
6. Report generation is explicit and on demand in this CPU reference API. It may
   invoke two global support plans per changed domain and has no latency claim.
   Commit itself must not silently add a global solve. GPU report generation,
   incremental support reuse, per-tick event capture and bounded asynchronous
   observation remain required later integration work.
7. Author edit/inert-observer regressions for global scanning, distant support
   differences, temperature versus latent energy, hold lifetime changes, domain
   separation, bounded fallback, identity/isolation and failure behavior. Author
   separate real-support regression coverage, excluded from the permitted mock
   suite while runtime verification is held. SDK checks remain user-deferred;
   GPU checks, physical replay, benchmarks and legacy demos remain blocked.

### Build 6 source review; verification pending

Implemented `gameplay-changes-1`, available as explicit `branch.changes()` and
`commitResult.changes()` inspection. Reports compare complete primary/reservoir
endpoints and carry revision/preview identities, absolute ticks and geometry.
Material, phase, energy, exact temperature, structure, temporary constraints and
global support each have independent counts, bounds and bounded sparse runs.
They distinguish latent heat from temperature and hold metadata from permanent
mechanical state. Caller mutation and later commits/restores cannot rewrite the
captured endpoints. Inspection failures leave the branch/live state unchanged.

Support observation reuses the unchanged global M5 solve on isolated copies with
active hold anchors overlaid. The comparison covers every cell's distance, load,
capacity and reaction, so distant support differences are not limited by local
edit bounds. The proposed damage/movement is discarded. No solver or physical
schedule was modified. Identical effective physical inputs skip support planning;
otherwise this CPU reference can run two full plans per changed domain. There is
no latency claim and no implicit global solve in commit.

Source review confirmed that overflow preserves exact full-scan counts/bounds,
removes incomplete run lists and explicitly requires a full read. A single budget
covers all channels/domains; discarded runs do not replenish it. Bounds collection
avoids per-changed-cell vector allocations. A malformed first support observation
fails before requesting the second. Query guards prevent reentrant mutation.

Authored **23 edit/inert-observer cases** (20 declarations, including a four-case
table), making 148 expected cases in the six-file selected mock suite. The new
file traps calls to both real physical stepping and the global solver. Authored
**four real-support fixtures** separately cover a released bridge anchor, a local
bond cut, released temporary support and thermal capacity weakening. They reside
in `change-reports.runtime-cases.ts` and an explicit held config, excluded from
both the selected mock suite and ordinary `*.test.ts` discovery. No case has run.

The read-only CPU quiet gate failed on its first sample at **22.75%** (limit 20%).
No test or compiler was launched. SDK build/public-entry checks remain explicitly
user-deferred; the earlier interrupted SDK output is still incomplete. The
[Build 6 source record](tactical-interventions/build-06-2026-10-17/summary.json)
retains hashes, the gate receipt, authored coverage and pending verification.

This is not the full change-report acceptance gate. Reports explicitly describe
**endpoints**, with motion `not-observed` and an execution-trace requirement.
Intermediate support events and actual fragment correspondence cannot be inferred
from endpoint differences, including when matter returns to its starting state.
Per-tick capture, actor response, GPU reporting, asynchronous observation and
incremental structural reuse remain required. The full wishlist and all physical
replay/performance gates remain open; legacy demos remain quarantined.

## Build 7 acceptance criteria: observed CPU motion and bounded preview journals

Established before implementation. This adds actual simulation correspondence
for wishlist items 3 and 4. It does not infer identity from equal-looking endpoint
cells or claim that a net displacement is a continuous collision trajectory.

1. An optional CPU tick observation follows the structural solver's executed
   source permutation and every executed local material swap. It records exact
   original-source to final-destination mappings, including displaced occupants,
   and which original cells moved at any point even when they return in the tick.
   Heat/phase changes retain the matter correspondence at their current location.
2. Capture moving structural components from that tick's actual post-damage solve,
   with canonical tick-local component IDs, source membership and the executed
   downward displacement. These are structural-pass fragments, not immortal
   object IDs or guarantees that the matter remains bonded after phase changes.
3. Physical decisions, pass order, random/hash choices, energy, damage and bonds
   remain identical with capture on/off. Observation is a derived coordinate,
   absent from authoritative snapshots. The default path allocates no provenance
   buffers. Validate observation before publishing a tracked tick. Retain source
   baselines and author held capture-on/off full-state regression coverage.
4. Trace detail has a hard shared entry budget. Count all net-moving/touched cells
   and moving fragments. On overflow, discard incomplete detail, mark the entire
   trace incomplete and require re-execution; a snapshot cannot recover missing
   provenance. No truncated prefix is presented as complete motion.
5. A branch can opt into capture at creation. Primary and reservoir traces are
   collected only at complete domain/tick boundaries and retain operation, domain,
   rule/catalog, geometry and absolute tick identities. Stage an advance's entire
   journal privately; failure, cancellation or invalid driver output cannot expose
   partial traces or commit partial terrain/game state. Commit retains a copied
   revision-stamped journal. Sibling/stale previews cannot supply current traces.
6. Bound journal record/detail retention across the entire branch. Explicitly
   report overflow and missing coverage. The journal scope is simulation ticks;
   direct intervention receipts remain separate, and sub-pass path collision,
   automatic actor response and GPU provenance are still required later work.
7. Author pure trace-fixture and inert-driver regressions for permutations,
   identical-cell motion, movement returning to its origin, fragment membership,
   boundaries, overflow, invalid traces, cancellation, cleanup and retained-state
   isolation. Actual physical-step equivalence tests remain in a separate held
   configuration. SDK checks stay deferred, runtime/GPU/replay/benchmarks blocked,
   and legacy demos quarantined. Source changes are not proof of exact replay.

### Build 7 source review; verification pending

Implemented optional `stepWithMotion()` CPU tick observation and opt-in branch
capture. `material-motion-1` follows the executed structural permutation and
every actual material swap, retaining original-to-final cell correspondence,
touched identities (including return-to-start motion) and post-damage moving
fragment membership. Equal cell values do not erase identity. Heat/phase passes
preserve correspondence; fragment IDs are local to the structural pass and do
not promise surviving bonds after phase change.

The default step path allocates no provenance buffers. Two physical source files
were deliberately instrumented: `structural-world-core.ts` and
`structural-material.ts`. Before-source copies and an exact frozen old material
kernel are retained. A read-only projection confirmed that removing the optional
observation plumbing recovers their previous physical source, ignoring
whitespace. The other 94 of 96 previously protected sources remain unchanged,
including the physical solver, schedules, rules/catalog, GPU implementations,
runtime hold and legacy quarantine. Source comparison is **not** executed
capture-on/off equivalence or replay evidence.

`motion-journal-1` retains complete domain/tick observations with operation,
revision/preview, rules/catalog and absolute tick identities. An advancement
stages traces privately until every domain, game update, validation and cleanup
succeeds. Invalid output, cancellation or cleanup failure cannot publish a
partial journal. Returned traces/journals own their detail, and retained commit
journals remain attached to their original revision after later changes.

Trace detail defaults to 4,096 entries with a 65,536 maximum; journal retention
is capped at 256 domain/tick records and 65,536 entries across the branch.
Overflow clears incomplete detail and explicitly requires re-execution. Exact
trace counts and the journal's observed-record count remain available. Source
review tightened decoding to enforce the shared limit before copying nested
fragment detail and checks that drivers obey the requested per-trace budget.
Capture does not enter authoritative snapshots or change their schema.

Authored **26 pure/inert-driver cases**, making **174 expected cases** in the
seven-file selected mock suite. The new file traps real CPU stepping and the
structural solver. **Six physical equivalence/restart cases** are separately
excluded from ordinary test discovery: complete state/ledger comparison against
capture-off and the frozen old kernel, identical-cell fragment descent, phase
continuity, overflow neutrality, odd-tick restart and invalid-option atomicity.
These join the four held support cases; none of the current new cases has run.
Public SDK assertions check export/method presence without physical execution.

The CPU quiet gate failed on its second sample at **22.66%** (limit 20%, ten
quiet samples required). No test, compiler, SDK, real physical solve/tick, GPU
telemetry or browser workload was launched. SDK checks remain user-deferred and
the previously interrupted SDK output remains incomplete. Current tests, type
checking and lint are pending; historical passing receipts cover earlier hashes.
The [Build 7 source record](tactical-interventions/build-07-2026-10-17/summary.json)
retains source hashes, the failed quiet-gate receipt and the source review.

The journal covers **simulation ticks only**. Direct intervention receipts remain
separate, and net motion is not a sub-pass or continuous collision trajectory.
Actor carry/contact, intervention/event integration, per-tick support/thermal
reports, GPU provenance and bounded asynchronous observation are still required.
Whole-volume provenance uses additional CPU memory/work; no responsiveness or
performance claim is made. Full wishlist acceptance, exact replay and hardware
verification remain open. Legacy demos stay quarantined.

## Build 8 acceptance criteria: ordered action-boundary change journal

Established before implementation. Connect wishlist items 1-3: a single action
may edit terrain, move matter, advance several ticks and update game resources.
Its final endpoint alone cannot describe changes that happened and then reversed.

1. Opt-in branch capture records every successful edit, translation, transfer,
   hold/release, thermal intervention, game-state replacement and complete logical
   simulation tick in order. Every event identifies its sequence, operation,
   before/after tick and completed horizon. The journal identifies the base and
   exact preview or committed revision; stale previews reject. Zero-tick advance
   produces no fictitious physical event.
2. Every event includes full-domain material/phase/energy/temperature/mechanical/
   constraint/support differences between its own boundaries, using the existing
   global support assessment. Removing and restoring a support remains visible
   in separate records, including distant cells outside the original edit box.
   Tick events include expiry and game-policy changes after all domains complete.
3. Retain portable intervention receipts for selected-matter routes/transfers,
   cuts, released anchors and external thermal accounting. Tick records include
   observed per-domain motion from Build 7. Journal capture requires motion
   capture; disabled or incomplete observations cannot masquerade as full motion.
   Endpoint support assessments are not sub-pass support histories, and selected
   intervention routes are not swept paths for displaced occupants or actors.
4. Copy journal output and receipt detail. Caller mutation, later commits/restores
   and returning to identical state cannot rewrite retained events. Journals are
   derived data, absent from authoritative saves; unchanged M5 rules remain the
   only physics authority. Default branches incur no added support observations.
5. Stage a synchronous operation or an entire advance privately. Failure during
   report generation, invalid motion, cancellation, game update or cleanup leaves
   live terrain/game state untouched and invalidates the candidate. No partial
   journal becomes observable. Guards prevent support-observer reentrancy.
6. Bound retained events and all variable receipt/report/motion detail across the
   whole branch. Sparse report overflow retains exact counts/full spatial bounds
   and labels coarse coverage; journal/trace overflow drops incomplete event
   detail and explicitly requires re-execution. Never split live commits merely
   to evade a limit. Limits bound output, not synchronous global-solver work.
7. Author pure/inert regressions for ordered mixed actions, reversed changes,
   distant support, hold expiry, reservoir domains, exact receipt ownership,
   budget boundaries, stale/retained identity, errors, cancellation and cleanup.
   Real-step journal equivalence remains separately held. No builds, SDK checks,
   physical runtime/replay, GPU probes or benchmarks run in this source stage.
   Existing runtime hold and legacy quarantine remain intact.

### Build 8 source review; verification pending

Implemented opt-in `captureJournal` and `branch.journal()` / retained
`commitResult.journal()` under `action-boundaries-1`. Each successful intervention
and complete logical tick has an ordered boundary pair, operation, absolute tick,
completed horizon, full-domain change report and appropriate portable receipt or
observed domain motion. Game/accounting flags and tick-driven hold expiry are
included. Reports compare each adjacent boundary, so reversed changes remain
visible when a final endpoint comparison is empty.

Support still uses the existing global law on isolated input, scanning every
cell rather than the edit box. It can report distant bridge effects from a local
cut/release and their restoration. Journal capture implies motion capture;
explicitly disabling it rejects. Existing default branches add no support
observations. No physical solver, pass, catalog, snapshot schema or rules version
was changed in this stage.

All journal updates are private until their operation/advance succeeds, including
all domains, game updates and driver cleanup. Observer callbacks are guarded
against mutation/publication reentrancy. Receipts and returned report/motion data
are copied; committed journals survive later restore with their original identity.
Capture settings and derived history do not enter authoritative saves.

Sparse overflow is `coarse`, preserving exact counts/full bounds with explicit
full-read requirements. A 256-event, 256-domain/tick or 65,536-detail-entry journal
overflow, or an incomplete tick trace, clears all events and requires re-execution.
Counts still identify how many complete boundaries were observed. Known-overflow
journals skip further support work; capacity is checked before copying event
detail. Consumers requiring complete coverage must reject unsupported actions,
not split live commits and lose transaction atomicity.

Authored **27 edit/inert-driver regressions**, yielding **201 expected cases** in
the eight-file selected suite, plus **three held physical cases** for capture
neutrality, distant bridge release/restoration and odd-tick snapshot continuation.
These join ten previously held physical/support cases. Mock fixtures trap real
step/stepWithMotion/solve calls; physical cases use a separate explicit config and
filename outside normal `*.test.ts` discovery. None has been executed at the
current hashes. SDK assertions check only new exports and method presence.

This is a source-only stage. No quiet gate, test runner, compiler, SDK build,
physical solve/tick, browser, GPU telemetry, replay or benchmark was launched.
SDK checks remain user-deferred, and interrupted SDK output is still incomplete.
The [Build 8 source record](tactical-interventions/build-08-2026-10-17/summary.json)
records source hashes, review reasoning and unexecuted gates. Read-only comparison
confirmed all 96 previously protected physical/configuration sources unchanged,
including the runtime hold and legacy quarantine. Source/whitespace checks do
not prove type correctness, physical equivalence, replay or performance.

The remaining wishlist still requires actor contact/carry/exposure, continuous or
sub-pass motion where collision needs it, four-element extensions, GPU reporting,
bounded asynchronous execution and rendering integration, efficient branches and
exact structural reuse. These journals are complete-boundary observations, not
sub-pass event streams. Their synchronous global observations have no latency
claim. Integrated gameplay acceptance and all held runtime gates remain open.

## Builds 4-8 validation attempt: edit/inert suite only

Acceptance established before launch: first require ten consecutive one-second
CPU samples at or below 20% and at least 8 GiB free RAM. If that fails, launch
nothing. If it passes, run only the eight-file selected suite (201 expected cases,
zero skipped) with one worker, bail on first failure, a 256 MiB Node heap, 6% Job
CPU cap, 4 GiB process-tree memory cap, 30-second independent watchdog and
20-second missing-progress limit. Preserve failed attempts and inspect them before
any retry. Verify that the owned workload and named Job have exited afterward.

This uses the earlier bounded CPU edit/mock authorization; it does not lift the
global hold or the user's SDK deferral. No actual physical step/support solve,
GPU context/telemetry, replay, browser, benchmark or legacy workload is in scope.
Passing the suite would validate these edit/mock assertions only. Type checking,
SDK delivery and physical acceptance require their own subsequent gates.

After the edit/inert suite passes, the separately authorized static gates require
zero TypeScript errors from `tsc --noEmit -p engine/tsconfig.json`, then zero lint
errors from the direct engine lint script. Run each separately after a fresh quiet
gate, using the reviewed 512 MiB Node heap / 6% CPU / 4 GiB tree limits and
30-second watchdog. Stop and review the first failure before proceeding. Neither
command emits the SDK or executes physical tests; SDK build/public-entry checks
remain explicitly deferred.

### Validation result: 201 edit/mock cases, types and lint passed

The [validation record](tactical-interventions/validation-08-2026-10-17/summary.json)
contains fresh source-bound receipts. Four ten-sample CPU quiet gates passed
before the first test attempt, retry, no-emit type check and lint. Each workload
ran alone under the reviewed Windows Job and independent watchdog. No GPU
telemetry/context, real physics/support solve, replay, browser, benchmark or SDK
build was launched. The runtime hold and legacy quarantine hashes are unchanged.

The first suite attempt stopped at one failing reservoir assertion after eight
passes. That test compared whole commit handles, which now include distinct
inspection callbacks. Its data had no reported difference. The corrected test
compares complete snapshots, receipts and returned motion/action-journal values;
no production behavior changed. The failed receipt remains retained.

After review and a fresh quiet gate, **all 201 tests in eight files passed with
zero skipped** (3.97 seconds reported by Vitest). Coverage comprises translation
19, session coordination 26, holds/thermal deltas 21, reservoirs 23, geometry 36,
endpoint reports 23, motion traces 26 and action journals 27. The physical-call
traps in the selected fixtures also passed. Subsequent full no-emit TypeScript
checking and direct structural lint both passed under separate bounded runs.

Every attempted workload reports clean owned-process/named-Job cleanup and
unchanged launch hashes afterward. Successful stages sampled peak tree memory of
about 261 MiB (tests), 263 MiB (types) and 77 MiB (lint), below the 4 GiB cap.
These are sampled containment measurements, not gameplay performance benchmarks.

This validation supersedes the earlier **edit/mock/type/lint pending** status for
the same production hashes in Builds 4-8. Their historical source-only records
remain intact. **Thirteen real-support/physics/restart cases remain unexecuted.**
The SDK build/public-entry deferral and incomplete SDK output remain unchanged.
Full wishlist completion still requires actual physics/replay/GPU evidence,
actor/elemental integration, bounded execution/rendering and gameplay acceptance.

## Build 9 acceptance criteria: deterministic bodies and terrain exposure

Established before implementation. This stage advances wishlist item 4 with a
saved kinematic body contract using the existing geometry views. Moving terrain
transport, debris paths, actor-actor contacts and external structural loads remain
explicit later gates; static-body queries must not claim to solve them.

1. Provide a portable, separately versioned body state: world/domain and physics/
   catalog identity, integer position/size/velocity, gravity, step count and last
   grounded state. Store it inside session game state for atomic terrain/actor/AP
   commitment. Reject invalid/incompatible state and overflow before publication.
   Give `reduceTick` lazy geometry views of that exact complete terrain boundary,
   so body updates can run inside the same atomic game/terrain advancement. Retained
   views/closures keep that tick's identity even after later operations.
2. Resolve one body step against one immutable, revision-stamped geometry view.
   Apply explicit impulse/acceleration and saved gravity, then sweep X, Z, Y in
   that frozen order. Positive Y is down. Use exact integer axis travel; no
   endpoint tunneling, implicit teleport, floating-point integration or hidden
   wall-clock time. Stop colliding velocity components at contact, including
   closed world boundaries; retain unobstructed components.
3. Recompute support from current geometry at both boundaries. Removing a floor
   makes a previously grounded body fall; newly added obstructions block swept
   movement. Report footing loss, landing, per-axis contacts, actual displacement
   and final support surfaces. Initial overlap/outside placement returns an
   unresolved result with the body unchanged; do not invent a depenetration path.
4. Add exact box exposure queries: per-material overlap volume, cell count,
   minimum/maximum and volume-weighted temperature. Include air and explicitly
   account for outside-world volume. Use integer/BigInt arithmetic and portable
   decimal quantities where products exceed safe Number range. Report the maximum
   contiguous liquid depth from the body's feet within each footprint column;
   disconnected water overhead must not count as immersion at the feet.
5. Body limits bound size, velocity/force and the number of geometry queries;
   exposure reserves the existing prospective cell budget before iteration.
   Invalid input, capacity failures or caller mutations cannot change terrain,
   existing body state or session state. Retained views remain tied to their
   original revision. No material rules, energy ledger or actor health/AP policy
   changes as a side effect of contact/exposure calculation.
6. Author hand-checkable static-snapshot tests for all axes/signs, floor removal,
   wall/ceiling/world collisions, diagonal order, exact fractional-size contacts,
   landing, initial embedding, force limits, deterministic saved continuation,
   exposure volumes/temperatures/depth and atomic actor/AP/terrain integration.
   Run only bounded pure geometry/body and edit/inert tests under the reviewed
   harness; trap M5 stepping/support solves. Type/lint follow one at a time when
   safe. SDK builds, actual terrain trajectories, GPU/replay/benchmark workloads
   and legacy demos remain deferred/held.

### Build 9 source result and bounded verification status

Implemented `terrain-body-1`: owned portable body state, exact X/Z/Y axis sweeps,
closed-boundary contacts, saved gravity and explicit impulse/acceleration,
footing loss/landing, and unchanged unresolved bodies for initial embedding or
outside placement. `terrain-exposure-1` reports exact per-material overlap volumes,
temperature ratios and foot-connected liquid depths with explicit outside volume.
The tactical-session public source entry exports the body helpers and exposure
types; the deferred SDK presence check includes them but has not been executed.

`reduceTick` now receives lazy geometry queries stamped at that complete logical
tick. The private terrain boundary and its identity are captured before the
application callback. Each requested domain has one owned cached view; retained
closures keep their original boundary and do not retain the prior game/AP object.
This preserves the existing atomic session publication protocol. It does not
change physical rules or add actors to authoritative material state.

Authored 38 static/body/edit/inert cases, making 239 selected cases in nine files.
The first test run passed its ten-sample CPU quiet gate and ran with the reviewed
256 MiB Node heap, 6% Job CPU cap, 4 GiB process-tree cap, one worker, first-failure
bail, 30-second watchdog and 20-second missing-progress limit. It stopped after
165 passes at the oversized-exposure test's invalid fixture: 64×32×64 with four-cell
chunks exceeded the 512-chunk limit before the assertion. The fixture now uses
eight-cell chunks, keeping the same 131,072-cell query and prospective-budget
check. No physical rule was changed for this correction.

The next quiet gate stopped at host CPU 20.29%, above its 20% launch limit. It
created no workload authorization or process. The failed test receipt and both
quiet-gate receipts are retained in the
[Build 9 record](tactical-interventions/build-09-2026-10-17/summary.json).
Owned workload and named Job cleanup completed. Read-only review also reduced
the lazy query closure to its required terrain/domain data; this post-run change
is explicitly pending verification.

**Build 9 is not accepted yet:** the corrected 239-case suite, no-emit types and
lint remain pending. Earlier 201-case receipts remain historical evidence for
their own hashes only. No SDK build/public-entry command, actual M5 step/support
solve, replay, GPU telemetry/context, browser, benchmark or legacy workload was
launched. The global runtime hold and quarantine remain unchanged.

The next permitted gate is a fresh quiet-window check, then this bounded selected
suite, then separate no-emit types and lint, stopping at the first failure. SDK
delivery stays user-deferred. Real actor/material trajectories and replay need
separate approval under the runtime hold. Moving platforms, debris path contacts,
actor-actor response, loads, full elemental forces/combustion, efficient branches,
bounded rendering/execution and exact support reuse remain wishlist work.

### Build 9 follow-up: 239 edit/inert tests and type checking passed

A fresh ten-sample CPU quiet window permitted the corrected suite in `attempt-03`.
All **239 cases in nine files passed, zero skipped**, including the 38 new body,
exposure and inert-tick integration cases. Vitest reported 4.83 seconds. The
fixture correction and lazy query retention change are both covered by this run.
A separate fresh quiet gate then permitted full no-emit TypeScript checking,
which passed. These results supersede the preceding pending test/type status for
their recorded hashes; the failed attempt and failed retry gate remain retained.

The next gate measured 22.31% host CPU and refused to launch lint. **Lint remains
pending**, with no lint workload or authorization created. SDK build/public-entry
checks remain user-deferred. The
[follow-up validation record](tactical-interventions/build-09-2026-10-17/validation-02.json)
retains exact tested/typechecked source hashes, raw test counts and receipts.

Both successful workloads used the unchanged reviewed supervisor, 6% CPU / 4 GiB
process-tree caps, independent 30-second watchdog and separate owned-process
cleanup. Sampled peak tree memory was approximately 260 MiB for tests and 295 MiB
for types. All 96 protected physical/configuration hashes, the global runtime hold
and legacy quarantine are unchanged. No real material step/support solve, GPU
context/telemetry, replay, browser or benchmark ran. These are edit/static/inert
acceptance results, not physical replay or gameplay performance evidence.

### Build 9 lint completion

A fresh ten-sample quiet gate permitted `lint-02`; direct structural lint passed
and its owned workload/Job exited. The
[completion record](tactical-interventions/build-09-2026-10-17/validation-03.json)
binds that receipt to the same source covered by 239 tests and the no-emit type
check. This completes Build 9's edit/inert/static gates. SDK and actual physical
acceptance remain deferred/held; the full wishlist is still incomplete.

## Build 10 acceptance criteria: observed ordered material paths

Established before implementation. This stage provides the missing chronological
input for actor/platform/debris contact, without claiming to resolve those
contacts yet. Endpoint correspondence cannot recover an excursion returning to
its start or distinguish two different intermediate routes.

1. Add an explicitly opt-in CPU `stepWithMotionPaths` operation for one complete
   M5 tick. Retain existing `step` and `stepWithMotion` results and all physical
   coordinates, material rules and snapshot identities. Capture uses the actual
   structural permutation and actual local swap calls, never endpoint inference.
2. Return a separately versioned portable path record alongside the existing
   motion trace. Stamp dimensions, physics/catalog identity and absolute tick.
   Order passes as the structural plan followed by the frozen 27 material passes.
   Within a pass transfers are simultaneous, canonically sorted by source cell,
   and carry original cell identity. Omitted pass records mean no movement.
3. Mark falling structural members and local swaps as linear cell segments.
   Structural terminal-occupant rotations are explicit instantaneous relocations,
   not invented swept paths through the intervening structure. Heat/phase changes
   are not movement. This contract supplies a kinematic interpolation convention,
   not rigid-body velocities, force response, contact resolution or thermal dose.
4. Bound detail before retaining it. Shared pass/segment budget defaults to 4,096,
   maximum 65,536; overflow empties all path detail, preserves observed counts and
   requires reexecution. Existing motion overflow also prevents a complete path
   claim. Disabled capture allocates no path recorder or retained path data.
5. Portable validation checks complete pass coverage, schedule/parity/direction,
   closed bounds, disjoint simultaneous transfers, original-identity composition,
   exact net/touched agreement with the motion trace and structural membership.
   Reject malformed data, accessors, forged metadata and over-budget inputs before
   publishing. Outputs own all nested arrays; no capture cache is authoritative.
6. Add bounded pure recorder/decoder cases using synthetic executed permutations;
   trap every real world step and support solve. Author separate held tests for
   full-state capture equivalence, overflow neutrality and odd-tick continuation.
   Review instrumentation against the pre-change physical source. Run only safe
   edit/mock, type and lint gates when quiet windows permit. SDK checks, physical
   trajectories, GPU/replay/benchmarks and legacy demos remain deferred/held.

Session-horizon path journals and actor contact resolution will consume this
record in subsequent stages; they are required remaining wishlist work, not
inferred from this capture foundation.

### Build 10 implementation and verification result

Implemented `stepWithMotionPaths` in the CPU structural world, exported its
portable types/version/limits/decoder from the experimental structural-world
entry, and connected an optional path observer to the existing executed-swap
site. The structural recorder distinguishes falling members from instantaneous
terminal-occupant relocations. Paths retain original identity across ordered,
simultaneous passes, including motion that returns to its starting position.
Overflow clears every retained path while keeping observed counts; no path
cache enters a save. Existing step and net-motion result shapes are unchanged.

A read-only projection removed only the declared observation hooks and matched
the pre-build structural-world, material kernel and net-recorder source exactly.
Those baselines and the projection script are retained. This is source-review
evidence, **not executed physical equivalence**. The decoder validates complete
snapshots and internally consistent chronology; it is not authentication of
caller-supplied histories or a measured low-latency GPU query.

After a fresh ten-sample quiet gate, all **278 tests in ten files passed with
zero skipped** (5.33 seconds reported by Vitest). The 39 new cases cover all 20
movement passes, original-identity composition, round trips, simultaneous ordering,
structural relocation semantics, exact detail limits, late overflow, immutable
reads, malformed snapshots/metadata and schedule/permutation inconsistencies.
All real-step/support traps passed. The workload and named Job exited; launch
hashes and the global runtime hold remained unchanged throughout the run.

The subsequent type-check quiet gate failed before authorizing or launching a
workload. Types and lint remain pending for Build 10; Build 9's prior static
receipts do not validate these new source hashes. The
[Build 10 evidence record](tactical-interventions/build-10-2026-10-17/summary.json)
retains the successful test receipt, failed quiet gate, current/attempted hashes
and reviewed hook projection. Four new real-physics cases are excluded from the
edit/mock config, bringing the held physical/support/restart total to 17.
SDK build/public-entry checks remain user-deferred; GPU, physical replay,
benchmarks and legacy demos remain blocked/quarantined. Full wishlist acceptance
still requires the actual actor, elemental, scheduling/rendering and physical
correctness gates.

Final source review found that a fabricated local round trip by an intact
structural member could agree with the final net trace. The decoder now rejects
any local-pass movement of those members, consistent with M5's integrity binding.
The added regression exercises that loophole without executing material physics.
After a fresh quiet gate, `attempt-02` passed **279 cases in ten files, zero
skipped**, including 40 path cases (4.94 seconds reported by Vitest). A separately
gated no-emit TypeScript check also passed. These source-bound receipts supersede
the earlier 278-case/pending-type status for the final source.

Lint's subsequent quiet gate failed before launch; lint remains pending for
Build 10. All launched workloads cleaned up their owned process trees and named
Jobs. The runtime hold, SDK deferral and legacy quarantine remain unchanged.

### Build 10 lint completion

A fresh quiet gate permitted `lint-02`; structural lint passed with owned process
and Job cleanup. The [completion record](tactical-interventions/build-10-2026-10-17/validation-02.json)
binds it to the same code covered by 279 edit/mock tests and no-emit types.
The physical equivalence and SDK gates remain held/deferred.

## Build 11 acceptance criteria: tactical path journals and tick consumers

Established before implementation. Connect observed paths to the actual tactical
session so previews and deterministic actor policies can consume the same ordered
data. This stage does not replace the still-required actor contact solver.

1. Opt-in `capturePaths` branches use the public CPU `stepWithMotionPaths` driver
   for each primary/reservoir tick. Capture implies net-motion capture; an explicit
   contradiction rejects. Validate a separate bounded `pathMaxEntries` option.
   Default branches keep existing physical execution and do not request paths.
2. Give branches and retained commit results a separate revision-stamped `.paths()`
   journal. Each frame includes domain, operation, net trace and validated path
   record. Existing `.motion()` / `.journal()` shapes and scopes remain intact.
   No new authoritative snapshot coordinate or material rule is introduced.
3. Bound the whole journal to 256 domain/tick records and 65,536 shared entries,
   counting frame headers, net detail and path detail. Incomplete capture or any
   capacity overflow clears all frames, keeps observed counts and explicitly
   requires reexecution. Disabled capture is distinguishable from no movement.
4. `reduceTick` receives lazy `beforeQueries` and `movement` accessors for that exact
   complete logical tick and domain. Return isolated records with immutable start/
   end stamps, not a mutable reference into later ticks. All domains must complete
   and validate before the reducer runs. Per-tick observations remain available
   even if long-horizon journal retention overflows; the statuses have distinct
   scopes and must not be confused.
5. A frozen `requiresPaths` game-policy option forces path capture for its reducer;
   branches cannot turn off information required by that game rule. Ability/AP/
   actor policy remains in the application and is identified by gameRulesVersion.
   Missing/malformed/over-budget driver data, reducer failures, cancellation,
   stale revisions and cleanup errors cannot publish any partial game/terrain or
   observation history. Public reads and retained results own their data.
6. Verify pure journal budgets and inert-driver integration, including reservoirs,
   exact callback boundaries, retained closures, late failures and cancellations.
   Trap real physics/support calls. Author held physical agreement/restart tests
   separately. No physical kernel changes are needed. Run bounded selected CPU
   tests, no-emit types and lint one at a time when safe; keep SDK checks deferred,
   runtime/GPU/replay/benchmarks blocked and legacy demos quarantined.

### Build 11 implementation and bounded validation

Implemented `capturePaths`, separate bounded `tactical-paths-1` journals and the
per-tick `beforeQueries` / `movement` reducer inputs. Paths imply net capture;
`requiresPaths` freezes a session's dependency on them. Each callback receives
all domains only after complete validation, with immutable boundary stamps and
owned reads. The current tick's inputs remain available after retained journal
overflow. Commit, failure, cancellation and cleanup preserve atomic publication.

Twenty-one new pure/inert tests cover those contracts, including 261 domain/tick
frames exceeding the 256-frame journal cap, malformed reservoir paths, late
failure, cancellation during path retrieval, stale branches and retained closures.
The [evidence record](tactical-interventions/build-11-2026-10-17/summary.json)
retains **300/300 selected edit/mock tests across 11 files**, zero skipped tests,
and separate passing no-emit type/lint receipts. Each stage used its own ten-sample
quiet gate, the unchanged 6% CPU / 4 GiB Job, 30-second deadline and independent
watchdog. Owned workload/Job cleanup and unchanged source/hold hashes passed.

All 96 protected Build 10 source/configuration hashes remain unchanged. Actual
M5 stepping and support solves were trapped in the new tests. Three additional
physical session/restart cases were authored separately and remain held, bringing
the total held physical cases to 20. These results establish edit/mock integration
and static validity; they do not establish physical replay or game-frame latency.

SDK build/public-entry checks remain user-deferred, and the interrupted SDK output
remains incomplete. Physical checks, GPU checks, replay and benchmarks remain
blocked; legacy demos remain quarantined. Actor carry/debris response, intervention
trajectories, actor loads, four-element extensions, efficient branches/support
reuse and rendering integration still require further stages.

## Build 12 acceptance criteria: moving supports and debris contacts

Established before implementation. Add a reusable CPU motion-query context for
the actor/terrain requirement. It consumes a reducer's live before/after geometry
and validated tick observation, then reconciles a saved body without changing
terrain, energy, tick, actor velocity, or the actor's own movement-step counter.

1. Bind the context to the actual owned geometry boundaries, domain and movement
   record, not matching revision strings alone. Caller mutations or cloned/forged
   observations cannot change the validated history used by a query. The context
   is reusable for multiple bodies and retains its original boundary after commit.
2. Carry a grounded body by the structural pass's one-cell downward displacement
   only when every contacting support surface belongs to moving fragments. A
   stationary support or closed boundary prevents automatic carry. Airborne
   actors and loose flowing powder are not attached to platforms. Check the full
   carry path, not merely its endpoint; expose carried fragment identities.
3. Test each ordered linear cell path against the body's simultaneous path using
   exact integer/rational swept-box contacts. Include transient/round-trip debris
   motion, all axes, diagonal paths, deterministic ties and stationary obstacles.
   Relocations have endpoint overlap checks only and never invent swept impacts.
   Use source material/energy for path contacts and completed geometry for final
   fit, support and exposure. Phase-created overlap is explicit.
4. Keep the response one-way: successful carry updates body position/footing;
   incoming obstruction reports a blocking contact and leaves the input body
   unchanged. Do not invent depenetration, damage or a rigid-body force law.
   The application can reject the complete action or apply its contact policy;
   generic terrain pushing/crush resolution and actor loads remain later work.
5. Bound work by existing path limits, a prospective local cell-visit cap and
   at most 4,096 contacts (default 256). Disabled/overflow observations or contact
   overflow produce explicit incomplete results with no partial carry. Never
   interpret missing paths as an empty world. Output reads are isolated.
6. Exercise carry, partial stationary support, lost footing, crossing debris,
   relocation, contact budgets, phase overlap, wrong-domain/boundary rejection,
   ownership and atomic reducer integration in pure/edit/inert fixtures. Trap
   all physical stepping/support solves. Author held physical cases separately.
   Run selected tests, types and lint sequentially under unchanged safe limits;
   SDK checks stay deferred, runtime/GPU/replay/benchmarks held, legacy quarantined.

### Build 12 implementation and validation status

Added `createTerrainMotion3D` to the experimental tactical SDK entry. Its live
observation binding rejects geometry from a different owned boundary even if all
revision strings match. It reuses privately validated paths for exact swept
contacts, carries bodies on fully moving supports, checks relocation endpoints
and reports unresolved or incomplete results without partial actor publication.
No physical kernel, actor save schema, material law or energy account changed.

The bounded suite passed **332/332 selected tests in 12 files**, including 32 new
pure/edit/inert cases; no-emit type checking and lint also passed. The
first two test attempts stopped at their first failures and cleaned up: an
incorrect fixture schedule direction, then an assertion expecting the raw close
error instead of the coordinator's cleanup wrapper. Both fixture errors were
corrected before the passing run; failed receipts remain retained.

Three physical carry/restart/observational-equivalence cases are separate and
held. Actual trajectories, replay, SDK delivery, GPU parity and frame latency are
not proven by these synthetic permutations. General terrain pushing/crush
resolution, intervention trajectories, actor-actor contacts and actor loads remain
needed for the full actor/terrain requirement. All other wishlist requirements
and their held acceptance gates remain active.

The [Build 12 evidence record](tactical-interventions/build-12-2026-10-17/summary.json)
retains all successful and failed receipts, raw tests, source hashes and cleanup.
Every workload had a fresh ten-sample quiet gate and the unchanged 6% CPU / 4 GiB
Job, 30-second deadline and independent watchdog. All 96 protected Build 11 hashes
remain unchanged. The runtime hold remains active; the three new held cases bring
the total unexecuted physical cases to 23. SDK checks remain user-deferred and
legacy demos remain quarantined. No performance or actual replay claim follows
from these containment/test receipts.

## Build 13 acceptance criteria: bounded terrain-driven body displacement

Established before implementation. Extend the actor/terrain requirement beyond
contact detection while preserving Build 12's existing reconciliation contract.

1. Add a separately versioned, opt-in displacement context using the same live
   observation and owned-boundary identity checks. It must be reusable across
   actors, deterministic under caller iteration order and isolated from report
   mutations. Existing actor saves, material physics and energy ledgers stay intact.
2. Resolve each observed linear pass with causal swept contacts. The actor stays
   still (or follows eligible support) until contact, then matches the contacting
   terrain's normal velocity for the remaining pass. Tangential components stay
   unchanged. Process simultaneous normal constraints together with deterministic
   axis/contact ordering. No preemptive translation or endpoint-only tunneling.
3. Keep trajectories and event times exact. Represent each coordinate as an
   integer intercept plus integer velocity times rational pass time; matching a
   cell face preserves integer completed-pass coordinates. Cover all axes/signs,
   diagonal paths, fractional bodies, multiple impacts and opposing terrain.
4. Include stationary terrain, closed boundaries and material positions produced
   by earlier passes. Conflicting normal-velocity constraints report `crushed`
   under this kinematic rule, with their opposing contacts; damage remains game
   policy. Relocations and phase-created overlap remain explicit unresolved cases.
   Never publish partial body motion on any failure or incomplete observation.
5. Bound total candidate visits/contact tests and event/contact counts across the
   whole tick. Overflow returns incomplete, removes partial detail and requires
   reexecution. Successful displacement changes body position/footing only; actor
   velocity/gravity/step, terrain and accounting are untouched. Actor-actor and
   terrain-load feedback remain subsequent work.
6. Verify exact hand-computable movement, later-pass occupancy, carry interaction,
   crush witnesses, transient crossings, budgets, isolation and atomic game/AP
   commit/rejection with synthetic permutations and traps on physical execution.
   Retain actual physical/restart cases separately under the hold. Run selected
   CPU tests, types and lint one at a time under the unchanged safe harness; SDK,
   runtime/GPU/replay/benchmark restrictions and legacy quarantine remain intact.

### Build 13 implementation and validation status

Added `createTerrainDisplacement3D` with exact event-driven normal response,
stationary/world-boundary constraints, sparse prior-pass occupancy tracking and
explicit opposing-constraint crush witnesses. It leaves the old reconciliation
contract intact and never advances physics or changes material/energy state.
Every unresolved or incomplete response preserves the input body. Shared pure
permutation fixtures now support both carry and displacement test files.

The first bounded run passed 366 selected cases. Source review identified one
additional numerical case worth pinning: an actor already pushed by one cell
encountering an opposing mover at an odd numerator over relative speed 2,048 Q.
The final run passed **367/367 tests across 13 files**, including 35 displacement
cases, with zero skipped tests. All real stepping/support calls remain trapped.

The subsequent ten-sample quiet gate stopped on its first sample at **100% host
CPU**, above the unchanged 20% launch limit. No type-check workload or
authorization was created. Type checking and lint remain pending for these
hashes; Build 12's previous receipts do not establish current static acceptance.

The [Build 13 evidence record](tactical-interventions/build-13-2026-10-17/summary.json)
retains both passing test receipts, raw results, the refused gate, source hashes
and cleanup. All 96 protected source/configuration hashes remain unchanged. Three
new held physical cases bring the unexecuted physical total to 26. The runtime
hold, SDK deferral and legacy quarantine remain intact. Remaining actor work
includes intervention-driven movement, actor-actor response and optional loads;
the full wishlist and its physical/replay/performance gates are still incomplete.

### Build 13 follow-up gate

The next turn's fresh `typecheck-02` quiet gate again stopped at 100% host CPU.
No workload or authorization was created; types/lint remain pending. Source work
can continue, but no later implementation inherits a passing verification claim.

## Build 14 acceptance criteria: conservative translation paths and game reduction

Established before implementation. Connect history-preserving material movement
to the application transaction boundary required for elemental manipulation.

1. Add an opt-in wrapper around the unchanged `material-interventions-1`
   translation. Expand its executed canonical receipt according to the versioned
   cardinal-run rule, preserving original identity across every controlled linear
   step and every terminal-occupant relocation. Label this a receipt-derived path
   expansion, not a newly measured physical trajectory.
2. Check the expansion's complete permutation, explicit bond cuts and anchor
   releases against every output packed/energy/structure coordinate. Reject any
   mismatch before exposing a result. Existing translation behavior, energy
   accounting and absolute tick remain unchanged, including round trips and
   mobile displacement. Default uncaptured translations retain their old path.
3. Bound retained path detail (controlled identities, step headers and segments)
   independently of the existing operation limits. Overflow clears all detail,
   retains counts and requires reexecution; it cannot look like no movement.
   Return owned copies. Do not change portable save schemas or tick journals.
4. Add `branch.translateWithMotion` and a frozen synchronous `reduceTranslation`
   policy. The policy receives owned receipt/game values and lazy before/after
   geometry plus live translation observations. Normal `translate` must capture
   when that policy needs it. The policy can update actor/AP/resource state or
   reject the whole action before publication; reentrancy, async returns and
   failures cannot publish partial terrain, game, accounting or action journals.
5. Stamp the operation's actual before/after boundaries at the same physical tick;
   retain isolated observations after later edits/commit without confusing them
   with current live state. Actor carry/push consumption of these cardinal paths
   is the following integration stage, not implicitly provided by this callback.
6. Author real-edit and inert integration regressions for volume/energy/history,
   all cardinal axes, round trips, displaced occupants, budgets, bound identity,
   holds and atomic policy failure. Keep physical integration cases separate.
   The current CPU launch refusal leaves new tests/types/lint pending; no SDK,
   physical/GPU/replay/benchmark workload may run while its gate/hold blocks it.
   Preserve all 96 protected hashes and keep legacy demos quarantined.

### Build 14 source implementation and pending validation

Added `translateStructuralRegionWithPaths3D` without editing the existing
intervention or physics rules. The wrapper expands the executed receipt into
original-identity linear movement and terminal-occupant relocation, then compares
the reconstructed complete state against the actual translation output. Identity,
coordinate-length, explicit cut/release and every packed/energy/structure value
must match. Bounded detail overflow removes the entire path prefix and signals
reexecution while retaining counts; it does not alter the material operation.

`translateWithMotion` exposes isolated lazy boundary views and observations.
`reduceTranslation` automatically captures ordinary translations and stages a
synchronous game update before the existing atomic branch publication. Function
references are fixed at session creation. Receipts delivered to policy and callers
are separate from those used by action journals. Both views retain the same
absolute tick and distinct operation stamps; retained observations remain preview
observations after commit. Portable save schemas and tick path journals are
unchanged. These callbacks do not yet implement translation-driven actor response.

Source review covered aliasing, simultaneous permutation order, identity across
round trips, hold overlays, unchanged default execution, policy reentrancy and
failure ordering. It tightened output metadata/length checks and explicit captured
result narrowing. **36 new edit/inert cases are authored and unexecuted**, covering
all cardinal axes, hot/damaged bonded history, mobile displacement, round trips,
budgets, injected complete-state mismatches, private provenance, holds and atomic
terrain/game/accounting/journal failure. Three new actual-physics continuation
cases are separately held, bringing the physical total to 29.

The selected edit/inert suite now contains an expected 403 cases. That is a static
case count, **not a passing test result**. The earlier 367-case receipt describes
Build 13 hashes; changes to the coordinator and public entry need fresh acceptance.
No new gate or workload was attempted after this turn's `typecheck-02` launch
refusal. Tests, no-emit types and lint remain pending. SDK execution remains
user-deferred; physical/GPU/replay/benchmarks remain blocked. Legacy quarantine
and all 96 protected source/configuration hashes remain intact.

The [Build 14 source review record](tactical-interventions/build-14-2026-10-17/summary.json)
retains these distinctions, source hashes and the preceding refused quiet gate.
Reviewed CPU runner bytes were copied unchanged for a future bounded run; preparing
or running that stage still requires its unchanged quiet gate and runtime limits.
Full copies, reconstruction scans and retained boundary snapshots have no measured
latency/memory acceptance. Translation actor response, actor-actor contacts, loads,
efficient branching and global structural reuse remain later work. No new physical
determinism, replay or performance claim is made by this source-only stage.

### Build 14 next-turn quiet gate

The fresh `attempt-01` edit-only quiet gate stopped at 86.923% host CPU, above
the unchanged 20% launch limit. It created no workload authorization or process.
Build 14's tests/types/lint remain pending; further work this turn is source-only.

## Build 15 acceptance criteria: actors during conservative translations

Established before implementation. Close the gap between material manipulation
and the terrain/actor relationship in wishlist items 1, 2 and 4.

1. Add an opt-in translation displacement context bound to the live before/after
   geometry and receipt-derived movement from the same action. Reject forged,
   copied or mismatched observations. Never execute a physical tick or modify
   material, bonds, damage, energy, holds or accounting.
2. Reuse the exact rational contact solver used by tick displacement. Preserve the
   existing tick displacement contract, default carry rule and result shape.
   Translation passes use cardinal controlled motion and endpoint-only displaced
   occupant relocations, in receipt order. Intermediate occupancy must include
   every preceding pass, including out-and-back paths and newly vacated cells.
3. At the first pass, carry requires a grounded actor and exact supporting faces.
   At subsequent complete pass boundaries, recompute immediate support. Carry only
   when every contacting support is controlled solid/frozen/powder matter moving
   with the common translation step; mixed fixed support and closed floor support
   do not authorize carry. Side/overhead contacts can constrain that motion.
4. Resolve exact normal pushes, stationary obstacles and closed boundaries with
   deterministic tie-breaking. Report conflicting normal constraints, relocated
   occupant overlap and incomplete coverage explicitly. Every failure returns the
   original actor with zero committed displacement; the application chooses
   whether to reject the whole terrain/game transaction or apply game consequences.
5. Bound contacts, events, candidate work and retained carry detail across the
   whole translation. Overflow removes partial diagnostic detail and requires
   reexecution. Retain pass-stamped requested carry vectors and original support
   identities; do not mislabel requested carry as realized movement. Preserve
   actor velocity/gravity/step and only update position/footing on success.
6. Author real-edit, zero-tick cases for six directions, multi-step support,
   corner/transient paths, mixed support, fractional pushes, crush, relocations,
   budgets, provenance and atomic game/AP rejection. Keep physical continuation
   and restart cases separate under the hold. Existing tick fixtures must still
   run later against the shared solver. Tests/types/lint are pending until a safe
   gate passes; SDK, GPU, physical replay/benchmarks and legacy demos stay blocked.
7. Preserve all 96 protected source/configuration hashes. Retain source evidence
   for the shared-solver extraction without treating it as runtime equivalence.
   Actor-actor collision, terrain loads, forces, gravity time advancement and
   production latency remain explicit later work, not claims of this build.

### Build 15 source implementation and pending validation

Added `createTranslationDisplacement3D` for live translation boundaries. Controlled
support can carry a grounded actor along a cardinal step; later steps inspect
actual prior-pass occupancy and immediate support. Every contacting support must
be controlled for carry eligibility. Fixed-side contacts can constrain the actor
while a platform continues. Linear pushes use exact rational contact times;
terminal occupant relocations remain endpoint-only events. Conflicting normal
constraints report crush, and every unresolved outcome retains the original body.

The implementation extracts the tick displacement contact loop into an internal
shared solver. The tick adapter retains its rule identity, public result shape,
fragment-based first-pass carry and final pass 27. Translation supplies its own
carry eligibility, step ordering and final pass. The intersection/touch/order
helpers and contact event/relocation/permutation sections are preserved as text;
this evidence does not establish runtime equivalence. Existing 35 tick-displacement
regressions remain selected for the eventual safe run.

Translation results separate requested support carry from realized `movedQ`.
They preserve actor velocity, gravity and step; successful results update position
and footing. Per-body contacts/events/work are bounded across the complete action,
and carry headers/support identities have a separate bounded budget. Incomplete
responses remove all partial carry/contact/crush detail and require reexecution.
The game reducer can reject an unresolved actor response before terrain, actor,
AP/resources and accounting publish together.

**33 new edit-only cases are authored but unexecuted.** They cover all cardinal
directions, exact fractional pushes, turns and round trips, mixed support, later
support acquisition, constrained carry, crush, relocation overlap, budgets,
provenance, isolation, zero-tick transaction rejection and saved edit continuation.
Three separate physical cases cover actual falling-support continuation, odd-tick
restart and unchanged physical state under actor observation. All remain held.

The selected edit/inert suite now has an expected **436 cases**, with **32 held
physical cases** in separate selectors. These counts are authored coverage, not
passing results. No workload was launched after the latest 86.923% CPU quiet-gate
refusal. Current tests, no-emit types and lint are pending; the prior 367-case
receipt does not apply to the shared-solver refactor. SDK checks stay user-deferred,
physical/GPU/replay/benchmarks stay held, and legacy demos remain quarantined.

The [Build 15 source review record](tactical-interventions/build-15-2026-10-17/summary.json)
retains the extraction baseline, exact preserved-source sections, current hashes,
the refused gate and unchanged harness runners. All 96 protected source/config
hashes remain unchanged. Actor-actor collision, terrain loads, forces, efficient
branching/structural reuse and the full wishlist's runtime/performance acceptance
remain unfinished. No new physics, replay or latency acceptance is claimed.

### Build 15 follow-up review and refused launch

The fresh `attempt-01` quiet gate stopped at 100% host CPU without creating an
authorization or workload. Source review of translation identity/permutation,
geometry provenance, carry support, exact contact arithmetic and publication
ordering did not establish another defect. That is not test acceptance. Current
tests/types/lint remain pending, and no further workload is attempted this turn.

## Build 16 acceptance criteria: bounded atomic actor groups

Established before implementation. Connect multi-unit tactical actions to the
wishlist's atomic application transactions and predictable work limits.

1. Provide optional group contexts over the existing live tick or translation
   boundaries. Reuse the same contact/translation rules; do not add actor-actor
   forces, physical ticks or material changes. Retain the distinct movement scope.
2. Accept at most 64 uniquely identified saved bodies. Validate every row/body
   before resolution; reject malformed/accessor-bearing records, duplicate IDs
   and incompatible bodies without evaluating a partial group. Sort by exact
   portable identifier order so input order cannot affect failure selection.
3. Share candidate-work, event, contact and carry-detail budgets across the whole
   group, passing only the remaining allowance to each body's existing solver.
   No actor receives a fresh full allowance after earlier actors consume it.
   Hard actor count also bounds per-body geometry setup outside candidate work.
4. Resolve until the first unresolved/incomplete actor in canonical order. On
   success return every updated body; on failure return every original body,
   remove all successful response prefixes and identify the failing actor. Keep
   failure/incomplete distinct and report actual evaluated-body/work/event counts.
5. Results own their data and remain bound to the original geometry. Group calls
   never publish to a session. A synchronous game reducer must be able to commit
   all actor states and AP together with terrain, or throw without partial live
   changes. Document that independently resolved actors may overlap: actor-actor
   policy remains separate.
6. Author edit/inert cases for ordering, duplicate/invalid bodies, aggregate limits,
   later-actor failure, no partial group output, isolation, retained boundaries and
   atomic game rejection. Actual physical continuation remains separately held.
   Current test/static checks remain pending after the failed gate; SDK deferral,
   runtime/GPU/replay/benchmark holds and legacy quarantine remain intact. Preserve
   all 96 protected hashes. No wall-clock responsiveness claim follows from budgets.

### Build 16 source implementation and pending validation

Added optional tick and translation group contexts using the existing body
displacement implementations unchanged. They validate at most 64 named bodies,
resolve in canonical identifier order and share contact/event/work/carry-detail
allowances across the entire group. Every saved-body format and binding is checked
before resolving any actor. Later-actor failure returns all original bodies,
removes successful response prefixes and identifies the first failure. A session
reducer can therefore reject or commit all affected units and AP with the terrain.

Source review covered validation before evaluation, exact ordering, remaining
budget arithmetic, failure-prefix disposal, copied output bodies and geometry
provenance. The factories retain their respective tick/translation scope and do
not add actor-actor interactions. The contact and translation implementations
remain byte-identical to Build 15; all 96 protected source/configuration hashes
also remain unchanged.

**22 new edit/inert tests are authored and unexecuted.** They cover canonical
ordering, invalid/duplicate IDs and bodies, cross-actor budgets, late crush and
overflow, empty groups, isolation, retained observations, inert tick integration,
atomic AP/terrain publication and complete rollback after a later unit fails.
Three separate actual-physics cases cover lifted riders continuing with falling
supports, odd-tick group restart and unchanged physical state under observation.
All physical cases remain held.

The current selector contains an expected **458 edit/inert cases**. There are now
**35 separately held physical cases**. Neither count is a passing receipt. The
last 367-case pass covers older source; current tests/types/lint await a quiet
window. This turn's gate refused launch at 100% CPU, and no workload was attempted
afterward. SDK execution remains deferred, runtime/GPU/replay/benchmarks remain
held and legacy demos remain quarantined.

The [Build 16 source review record](tactical-interventions/build-16-2026-10-17/summary.json)
retains current hashes, unchanged implementation dependencies, the refused gate
and reviewed harness runner hashes. Body-group limits address aggregate candidate
work; geometry setup, scheduling and full-game latency still need measured
acceptance. Efficient branches/structural reuse, four-element rule extensions,
rendering integration and the full wishlist remain incomplete.

### Verification impasse after Build 16

The next fresh `build-16/attempt-01` gate stopped at **98.269% host CPU** before
creating an authorization or workload. The immediately preceding goal turns'
gates also stopped before launch: Build 14 at 86.923%, Build 15 at 100%. All exceed
the unchanged 20% quiet-window limit. No process is being awaited or restarted.

Builds 14-16 remain source implementations with authored tests, not accepted
builds. The current 458-case edit/inert selection, no-emit types and lint need
execution evidence before further changes depend on the shared solver and
transaction contracts. The last passing 367-case result covers older source.
Continuing to accumulate dependent features would not satisfy the user's
requirement to verify each build.

The goal is blocked on a quiet CPU window, not complete or user-paused. Resumption
starts with a new bounded gate and the selected edit/inert suite, stopping at the
first failure, then no-emit types and lint. SDK checks remain user-deferred.
Physical/GPU/replay/benchmark checks remain held and require their separate
reviewed release; a CPU gate pass does not clear them. Legacy demos remain
quarantined. The full original wishlist is retained in the product acceptance
table, including incomplete four-element, reuse, rendering and runtime gates.

The [blocked-audit record](tactical-interventions/build-16-2026-10-17/blocked-audit.json)
retains the three consecutive refused gates, missing workload authorizations,
unchanged implementation hashes and unchanged protected configuration. No fresh
test, replay, SDK or performance success is claimed.

### Quiet-window resumption and type repair (2026-10-17)

The user reported the reel renders finished. A fresh ten-sample quiet gate
passed (maximum 12.305% host CPU), followed by all 458 selected edit/inert tests
with no failures, skips or pending cases. The separate type-check gate passed,
but the compiler rejected the translation boundary stamp because its rules
version widened to `string`. The sequence stopped before lint; both owned
workloads and named Jobs were confirmed absent after cleanup.

Repair success criteria, established before changing source: explicitly type
the existing stamp as `GeometryStamp3D`, without changing runtime expressions,
physical rules or transaction behavior; obtain fresh bounded no-emit type and
lint results; retain the original test/failure receipts and identify their source
hashes. Preserve all 96 protected hashes, the runtime hold and legacy quarantine.
SDK checks remain deferred. This repair and the passing edit/inert suite do not
establish physical replay, GPU behavior or gameplay performance.

The repair adds a type-only import and explicit `GeometryStamp3D` annotation.
It changes no runtime expression. The next type-check gate stopped on its fourth
sample at **33.887% host CPU**, above the unchanged 20% launch limit. No retry
workload or lint stage was launched. Type acceptance remains pending; the
original failed type-check receipt is retained. The [resumption record](tactical-interventions/build-16-2026-10-17/resumption.json)
links the 458-case pass, initial compiler failure, type-only source comparison,
cleanup and refused gate. No further check was attempted after that refusal.

### SDK reauthorization and acceptance criteria (2026-10-17)

The user explicitly authorized SDK checks again. Before the build: the full
no-emit type check now passes with the geometry stamp annotation, and structural
lint passes. The reviewed bounded runner confirmed cleanup for both stages.

SDK acceptance requires all eleven declared entry bundles and their declaration
files to regenerate successfully, followed by the existing public interventions
and tactical-session checks in separate stages. Those checks exercise a 4-cubed
edit and zero-horizon transactions, material transfer, accounting and geometry;
they never advance physical ticks, run support solves or request a GPU adapter.
Presence checks for later motion APIs do not establish their runtime behavior.

Use the unchanged reviewed CPU runner, 6% Job CPU cap, 4 GiB memory cap, 512 MiB
Node heap, independent watchdog and owned-descendant cleanup. The build retains
its previously reviewed 60-second deadline; each public check has 30 seconds.
Every stage requires ten consecutive quiet samples at or below 20% CPU and at
least 8 GiB free memory, fresh source hashes and a one-use expiring manifest.
Stop at the first failed gate or stage. Keep the runtime hold and all 96 protected
hashes intact, with GPU/replay/benchmarks blocked and legacy demos quarantined.

### SDK checks completed (2026-10-17)

All five newly authorized stages passed sequentially. Supervisor wall times:

| Stage | Result | Seconds |
|---|---|---:|
| Full no-emit type check after the annotation repair | Passed | 10.470 |
| Structural lint | Passed | 3.035 |
| Eleven SDK bundles and declarations | Passed | 19.593 |
| Public interventions check | Passed; 64 cells, zero ticks | 1.913 |
| Public tactical-session check | Passed; two 64-cell domains, zero ticks | 1.796 |

The build's sampled peak Job memory was 437.477 MiB. These durations describe
bounded tooling, not gameplay frames. Every stage passed its own quiet gate,
retained live health monitoring and the independent watchdog, and confirmed that
the owned workload and named Job were gone. A final process inventory found no
remaining owned stage runner or watchdog. All 96 protected hashes remain intact.

The [SDK validation record](tactical-interventions/build-16-2026-10-17/sdk-validation.json)
retains commands, source/output hashes, telemetry and cleanup receipts. The earlier
458-test pass remains tied to its original hashes; the only intervening engine
change is the separately recorded type-only annotation. No unit test rerun was
needed for that annotation; the fresh compiler check validates its typing.

This clears the deferred SDK and static-check backlog through Build 16. It does
not complete the wishlist or its physical acceptance gates: all 35 separately
held physical cases, actual replay, GPU execution and performance remain pending.
Public-package checks use checkout self-imports, not a newly installed consumer.
Legacy demos remain quarantined and the runtime safety hold remains unchanged.

## Build 17 acceptance criteria: supersedable targeting previews

Established before implementation. Advance wishlist items 2 and 6: targeting and
AI previews must remain tied to a committed revision, and obsolete requests must
not accumulate work or publish stale terrain/game state.

1. Add an optional public preview queue over the existing tactical session. Keep
   at most one executing branch and one waiting command; a newer valid request
   replaces the waiting command and aborts the executing preview cooperatively.
   Do not begin its successor until advancement and driver cleanup have settled.
2. Copy and validate each portable command and bounded horizon before superseding
   accepted work. Stamp the request with its submission revision and horizon.
   A world change requires a new request; do not silently rebase a waiting one.
3. Give one frozen synchronous preparation callback a temporary staging editor.
   It may edit only its isolated branch through that editor. Revoke the editor
   after preparation; reject asynchronous preparation and queue reentrancy. Keep
   all game/AP/terrain publication in the existing atomic session commit.
4. Resolve tickets explicitly as ready, superseded, cancelled, stale, closed or
   failed. Only the latest ready ticket owned by that queue may commit against
   its unchanged base revision. Returned preview mutations cannot affect commit.
   Retained ready results are historical observations, not ongoing commit permits.
5. Support all existing bounded horizons with batches no larger than the session
   request limit. Respect complete-boundary cancellation and existing yields;
   never invent skipped ticks, physics approximations or a new material rule.
   Close waits for active cleanup. Cleanup failures fail the queue closed and
   prevent queued work from starting.
6. Verify scheduling, replacement, isolation, failures, stale revisions, horizon
   batching and atomic commit using real edits and inert drivers under the safe
   harness. Author separately held physical continuation/equivalence cases.
   Run types, lint, SDK build and a zero-tick public import check sequentially.
   Preserve protected physics hashes, runtime hold and legacy quarantine.

This bounds outstanding requests, not individual physical solve latency. A CPU
driver still runs each tick on its caller's thread; worker execution, bounded GPU
submissions and measured UI responsiveness remain required later acceptance.

### Build 17 implementation and bounded verification

Added `createTacticalPreviewQueue3D` with the separate `tactical-previews-1`
scheduling identity. Commands and horizons validate before replacement; each
ticket carries the submitted revision. One executing branch and one waiting
command are allowed. Supersession aborts cooperatively and waits for driver
cleanup. Preparation uses a revocable synchronous editor; ready data is isolated
from the private commit candidate. Only the latest owned ready ticket can commit
against its unchanged revision. Failures never publish a partial candidate, and
cleanup failures close the queue before another request can start.

Source review caught and repaired a ready-publication lifetime race before test
execution: a caller replacing a preview immediately after its promise resolved
could otherwise leave the old branch allocated. The queue now leaves the active
slot before publishing readiness; a regression replaces ready previews twelve
times and verifies all session branch slots can subsequently be reclaimed.

**All 481 selected edit/inert tests passed**, including 23 new queue cases. No
case was skipped. The new cases trap production physical advancement and support
inspection, and cover queued bursts, active cancellation, delayed cleanup,
revision invalidation, invalid inputs, isolation, expired editors, async/reentrant
preparation, fatal cleanup, 33-tick batching and the 1,024-tick limit with inert
drivers. Full no-emit types, lint, eleven SDK bundles/declarations and zero-tick
public-package integration passed afterward, one stage at a time.

All stages used unchanged reviewed runners, live quiet/resource gates, 6% CPU /
4 GiB Jobs and independent watchdogs. Cleanup receipts confirm owned workloads
and named Jobs were absent after every stage. All 96 protected physics/configuration
hashes remain unchanged. [Build 17 evidence](tactical-interventions/build-17-2026-10-17/summary.json)
records the source/output hashes, exact selection, limits and receipts.

Three new separately selected actual-physics cases cover direct-versus-queued
batching, an odd-tick restored continuation and supersession after a real tick.
They were not run; the total held physical selection is now 38. The runtime hold,
GPU/replay/benchmark blocks and legacy quarantine remain intact. This stage does
not prove physical replay, worker responsiveness or frame deadlines, and the
four-element, efficient-branch, structural-reuse and rendering requirements remain
unfinished. The previous goal turn was progress: it cleared SDK/static gates;
this turn adds and validates the preview scheduling contract.

## Build 18 acceptance criteria: isolated worker preview service

Established before implementation. Advance wishlist items 2 and 6 toward keeping
the camera/UI independent of physical preview execution.

1. Provide a versioned message protocol, worker-side host and client-side facade.
   The worker owns the existing tactical session, preparation callback and preview
   queue. Transfer data only; never serialize/evaluate callbacks or substitute
   physical rules. Add a browser Worker adapter and a public-SDK worker example.
2. Keep one outstanding preview and one local waiting command. Coalesce rapid
   targeting changes before sending more work, with at most one cancellation
   control message. Wait for both cancellation acknowledgement and the old result
   before dispatching the successor. Reject stale revisions and foreign tickets.
3. Publish only fully validated, revision-stamped snapshots. Keep the last
   confirmed world readable during preview work and after transport failure.
   Never apply a late, duplicate, mismatched-channel or malformed reply as a new
   state. Public reads and queued inputs must own their storage.
4. Commit and restore are exclusive requests. Commit only the latest ready
   preview against its submitted revision, preserving terrain/game/AP atomicity.
   If transport fails or times out during a mutation, report its outcome as
   uncertain, retain the last confirmed snapshot and never retry automatically.
5. Bound pending messages and deadlines. Closing cancels preview work and awaits
   worker cleanup; fatal protocol/cleanup failures stop further work. Do not claim
   a timeout can interrupt a native GPU/OS hang. Never reopen the runtime hold.
6. Exercise the real host/client through a structured-clone mock transport and
   inert drivers under the safe CPU harness. Cover cancellation races, stale and
   malformed replies, cleanup, timeouts, atomic commits and retained state.
   Validate types, lint, SDK build and a zero-tick public-package round trip.
   Real browser workers, physical trajectories and frame timing remain separately
   held and must receive explicit future evidence before runtime acceptance.

The transport initially exchanges full snapshots. Main-thread serialization and
validation costs, worker startup and rendered-frame responsiveness remain to be
measured; this build must not label a mock transport pass as thread-isolation or
performance proof. The preceding goal turn was progress (Build 17 implemented and
passed bounded scheduling checks); the full wishlist remains the objective.

### Build 18 implementation and verification status

Authored the worker host/client, `tactical-worker-1` data protocol, owned browser
Worker adapter and public-package bootstrap example. The client keeps the last
confirmed snapshot, coalesces waiting commands and waits for cancellation and
completion before dispatching a successor. Commit/restore failures distinguish
confirmed atomic rejection from an uncertain outcome; mutations are never retried
automatically. Worker rules remain application code and are not serialized.

Source review repaired cancellation acknowledgement ordering, post-commit reply
failure classification, restore publication after host shutdown and endpoint
disposal when subscription cleanup throws. There were **31 authored mock/inert
worker cases**, including regressions for those paths. They have not run.

The first Build 18 preflight stopped at **24.316% host CPU**, exceeding the
unchanged 20% quiet-window limit after three acceptable samples. No test, type
check, lint, SDK build, public-entry check, browser or Worker was launched for
Build 18. No automatic retry followed. The SDK artifacts and successful Build 17
receipts do not validate these newer worker sources. All Build 18 execution gates
remain pending; [the preflight receipt](tactical-interventions/build-18-2026-10-17/quiet-window-attempt-01.json)
and [source-only status record](tactical-interventions/build-18-2026-10-17/preflight-stopped.json)
retain the exact boundary. The 38 actual-physics cases remain separately held.

This turn made source progress but did not clear verification. The runtime hold,
all 96 protected physics/configuration hashes and legacy quarantine are intact.
Full snapshot copying/validation, actual worker isolation, browser responsiveness,
physical continuation and rendering integration still require future acceptance.

### Build 18 continuation: domain identity and host cleanup review

The previous turn made source progress but cleared no execution gate. A fresh
preflight in this continuation stopped before launch at **23.242% host CPU**.
There is still no Build 18 test/build result, and no workload was retried within
this continuation after that refusal.

Source review found that transport compatibility checked the primary world but
omitted immutable reservoir identities/geometry. It now uses the session's
existing reservoir compatibility validator for previews, commits and restores.
Malformed replies cannot redefine stored-material domains, and an invalid restore
is rejected locally before invalidating a ready preview. Source review also found
that a throwing host subscription disposer could prevent preview/driver cleanup.
Host shutdown now attempts both cleanup operations, aggregates failures, and
handles a subscription that reports failure synchronously before returning its
disposer. No physical rule or existing session implementation changed.

Five regression cases are authored for these paths, bringing the worker selection
to **36** and the intended combined edit/inert selection to **517**. None has run.
The [second preflight](tactical-interventions/build-18-2026-10-17/quiet-window-attempt-02.json)
and [updated source review record](tactical-interventions/build-18-2026-10-17/source-review-02.json)
preserve the refusal, source hashes and pending gates. Protected source hashes,
runtime hold, the 38 separately held physical cases and legacy quarantine remain
unchanged. The full wishlist remains in progress.

### Build 18 bounded execution results and remaining gate

The preceding continuation made source progress. On the third goal turn the
preflight passed, and **all 517 selected edit/inert tests passed**, including the
36 host/client mock transport cases. All 18 selected files completed with no
failed, skipped or todo tests. Full no-emit types, lint and the SDK build followed
sequentially and passed. Eleven package bundles and their declarations were
produced. No production physical advancement, support solve, browser or native
Worker was executed.

Each successful stage used a fresh ten-sample quiet gate, the unchanged 6% CPU /
4 GiB Job limits and independent watchdog. Cleanup receipts confirm that the
owned workload and named Job no longer existed after each stage. All 96 protected
source/configuration hashes remained unchanged. Stage wall times were 11.801 s
for tests, 10.339 s for types, 2.732 s for lint and 19.672 s for the SDK build;
these are verification durations, not gameplay performance measurements.

The final zero-tick package-integration preflight stopped at **21.154% host CPU**,
above the unchanged 20% quiet-window limit. That workload was not authorized or
launched and was not automatically retried within the turn. The same quiet-window
blocker recurred across three consecutive goal turns, despite the intervening
successful stages. Further implementation is waiting at this build's remaining
verification gate; the goal is blocked pending a quiet host window. No threshold
was relaxed and no unrelated process was stopped.

[Current bounded evidence](tactical-interventions/build-18-2026-10-17/sdk-validation-pending-integration.json)
retains successful commands, complete selection, source/artifact hashes, cleanup
receipts and the final refused gate. It supersedes earlier pending status only
for the four stages actually executed. Public-package integration, the 38 held
physical cases, native worker/thread isolation, GPU/replay and frame acceptance
remain unproven. Legacy demos remain quarantined. Full-wishlist completion is
still false; the remaining requirements are unchanged.

### Build 18 final approved non-GPU gate

On resumption, the final package stage passed its fresh ten-sample quiet gate
(maximum 5.561% host CPU) and the zero-tick public-package check passed. The
actual built tactical-session package performed the host/client handshake,
preview, atomic commit and close through an isolated mock channel. It verified
the client's acknowledged snapshot against the authoritative session and checked
the exported protocol identity. The check used a 4-cubed world and 4-cubed
reservoir with no physical tick, support solve, browser, native Worker or GPU.

The existing passing test/type/lint/build receipts were reused only after their
source hashes were verified unchanged. The integration stage used the same 6%
CPU / 4 GiB Job and independent watchdog, with a fresh cleanup receipt confirming
the owned workload and named Job were absent afterward. All 96 protected hashes
and the runtime hold are unchanged. No failed receipt was overwritten.

**All five approved non-GPU stages now pass.** [Build 18 summary](tactical-interventions/build-18-2026-10-17/summary.json)
supersedes the earlier pending package status and retains every stage's receipts,
source/output hashes and scope. The previous turn made verification progress;
this resumption clears the remaining package gate. The goal is active and the
full wishlist remains incomplete. The 38 physical cases, native worker execution,
actual replay, GPU/frame performance and rendering integration remain separately
held or unfinished; passing a mock transport is not evidence for those gates.

## Build 19 acceptance criteria: committed gameplay queries over the worker boundary

Established before implementation. Advance wishlist items 3 and 6: let gameplay
inspect physical geometry through the worker it already owns, using one batch
instead of a separate message per fit, ray, support or exposure query.

1. Add a data-only batch API for the five existing geometry operations: fit,
   support, raycast, sweep and material/thermal exposure. Reuse their existing
   fixed-point geometry rules and filters; geometric support does not run a
   structural solve or predict load-bearing capacity.
2. Bind each batch and every answer to the current complete committed revision,
   tick and selected primary/reservoir domain. Preserve request order, reject
   stale bases and unknown domains, and never silently rebase. Preview queries
   and distant structural change reports remain separate future worker APIs.
3. Allow one ordinary worker request in flight. Queries run only while idle;
   no physical advancement or mutation overlaps a batch. Cache at most one
   existing isolated geometry view per requested domain within the batch. Limit
   a batch to 32 operations, retain each query's 65,536-cell work limit, and cap
   portable requests/replies with the existing bounded tactical value budget.
   Reject oversized replies without publishing a partial result. These bounds
   are not a frame-latency guarantee.
4. Query success, malformed input, stale rejection and timeout cannot change
   terrain, game/AP, accounting or revision. Ordinary read success/rejection must
   preserve an already ready candidate; transport failure invalidates connection
   and ticket authority under the existing worker contract while retaining the
   last confirmed committed state.
   Validate reply shape, version, count, kind, domain, stamps and result data
   before returning it. Reads and inputs own their storage. Transport corruption
   fails the client closed; a read failure never claims an uncertain mutation.
5. Version the extended transport as `tactical-worker-2`; reject mixed peers.
   Export the query types/limits from the public tactical-session entry, document
   scheduling and costs, and exercise a zero-tick built-package query round trip.
6. Verify all five operations against direct session geometry on hand-checkable
   primary/reservoir fixtures, plus invalid/stale inputs, altered replies,
   ordering, isolation, budgets, pending-operation exclusion and retained ready
   tickets. Use the safe CPU/mock harness, then types, lint, SDK and zero-tick
   integration sequentially. Preserve the 96 protected hashes, runtime hold and
   legacy quarantine. Native worker/replay/GPU/frame checks stay held.

The preceding goal turn was progress: it completed Build 18's final approved
package check. This stage does not complete the wishlist's structural change
reports, rendering interface, physical trajectories, forces or combustion.

### Build 19 implementation and bounded evidence

Added `client.query(requests)` with `tactical-query-batches-1` data and the extended
`tactical-worker-2` transport. The geometry functions and physics sources are
unchanged. Each batch is bound to the cached committed revision; all five query
kinds preserve their exact direct-session answers, filters and request order for
the primary world and reservoirs. Stale bases and unknown domains reject rather
than rebase. Queries share the existing single-flight request lane and never
advance time, publish terrain/game state or request a structural solve.

The worker reuses one isolated geometry view per requested domain within a batch.
The request count is capped at 32; each query retains its existing 65,536-cell
budget. Whole requests and replies also use the existing 65,536-node, depth-32,
1,048,576-character portable data budget. Oversized replies reject as one failed
read without returning a partial prefix. Reply validation checks query identity,
revision/domain/tick stamps, count/order, geometry result shapes and committed
cell contents, including energy and damage. Exposure volumes and temperature
fractions are checked before returning owned result data.

The acceptance wording for ready candidates was clarified during review: an
ordinary read rejection preserves the candidate, while a fatal transport failure
invalidates the connection/tickets under the existing owned-worker lifetime
contract. Neither changes authoritative terrain, game/AP, accounting or revision.
This distinction is required because a failed owned Worker is terminated rather
than left capable of accepting an unobserved command.

**All 537 selected CPU/edit/inert tests passed**, including 20 new query cases
and the prior 36 worker cases. No test was skipped. The new cases compare all five
query kinds across primary/reservoir domains, check a hand-computed ray hit at
1/6 with preserved heat/damage, and exercise isolation, domain view reuse, the
32-query limit, malformed/stale inputs, ready-ticket retention, pending-operation
exclusion, close, timeout, altered replies, exposure accounting, oversized output,
protocol mismatch and new revision stamps after commit. Production advancement
and structural inspection are trapped; those traps were never called.

Full no-emit types, lint, eleven SDK builds/declarations and zero-tick built-package
integration then passed sequentially. The public check compared the worker ray
result and revision against direct session geometry. All five stages passed fresh
quiet gates and used unchanged 6% CPU / 4 GiB Job limits with independent watchdogs.
Cleanup receipts confirm owned workloads/Jobs were gone afterward. All 96 protected
hashes, runtime hold and legacy quarantine remain unchanged.

[Build 19 evidence](tactical-interventions/build-19-2026-10-17/summary.json) retains
the exact commands, selection, source/output hashes, limits and cleanup receipts.
These results validate CPU/mock geometry transport, not native Worker scheduling,
physical replay or frame timing. The host still copies full CPU geometry views
and a session snapshot for validation, so message batching alone is not evidence
of scale performance or GPU readback avoidance. The 38 actual-physics cases remain
held; structural change reports over the worker boundary and the other unfinished
wishlist requirements remain part of the active goal.

## Build 20 acceptance criteria: worker reports for committed physical changes

Established before implementation. Advance wishlist items 3 and 6 by exposing
the existing complete endpoint report through the owned worker, preserving its
global support reach instead of treating an edit box as the affected region.

1. Add an explicit idle read tied to an acknowledged commit from this client.
   Retain at most the latest commit's report closure in the host; reject foreign,
   copied, superseded or restored-away commit handles. Queries/previews must not
   silently change which commit a caller is inspecting. Release retention on
   host close and successful restore/new commit.
2. Delegate to the existing committed `changes` method, including primary and
   reservoir domains, holds, material/phase/energy/temperature/structure/support
   channels, game and energy-accounting flags. Preserve global endpoint support
   assessment, including distant effects. Do not approximate support locally or
   invent fragment correspondence from endpoint differences.
3. Keep report computation a separate fallible read after atomic commit. Report
   failure cannot undo or reclassify a successful commit, mutate live terrain/AP,
   invalidate an unrelated ready candidate on ordinary rejection, or claim an
   uncertain mutation. Corrupt transport fails the connection closed under the
   existing lifetime contract. No report work runs automatically during commit.
4. Use the existing shared run budget (0–4,096, default 2,048), exact complete
   counts/bounds and explicit coarse fallback. Validate endpoint identities,
   domain shapes/order, all channels, count/range/order/coalescing of runs,
   bounding boxes, budget and motion-unobserved metadata before returning data.
   Whole messages remain subject to the portable data budget; no truncated report
   may look complete. Results own their storage.
5. Extend the worker protocol to `tactical-worker-3`, reject mixed peers, document
   the API, retention cost and global solve cost. This is not incremental graph
   maintenance or a latency guarantee. A zero-tick built-package game-only report
   must prove the new route without invoking structural observation.
6. Test exact equality with direct committed reports using inert support
   observers, including a distant unchanged cell affected by a local intervention,
   reservoirs, coarse fallback, stale handles, failed reports, ready candidates,
   malformed replies and single-flight exclusion. Trap real structural solves and
   physics steps. Then run types/lint/SDK/package stages under the unchanged safe
   CPU harness. Keep all protected hashes, runtime hold and legacy quarantine.

The previous turn was progress: Build 19 passed all five approved non-GPU stages.
This report describes complete action endpoints; intra-action motion/history,
physical support equivalence, native Worker behavior and frame latency remain
separate acceptance gates within the full wishlist.

### Build 20 implementation and approved verification

Added `client.changes(commit, options?)` to `tactical-worker-3`. The client brands
the exact object returned by its acknowledged commit with private endpoint
stamps; copied, foreign, superseded and restored-away handles reject. Caller
mutation of returned data cannot rewrite those private stamps. The host retains
one committed result closure, replaces it after a successful commit, and releases
it after restore/close. Idle reads are tied to both endpoints and occupy the same
single-flight lane as queries and mutations.

The host invokes the existing committed `changes` implementation only on explicit
request. It preserves all seven channels, complete primary/reservoir domains,
global endpoint support observations, game/accounting flags and motion-unobserved
metadata. A report failure is a read failure after an already successful commit,
never an attempted rollback or uncertain mutation. Ordinary read rejection keeps
an unrelated ready candidate available. Report detail shares the existing run
budget across domains/channels, with exact count/bounds and no misleading partial
run list on overflow. The client validates full report identity, shapes, channels,
run ranges/order/coalescing, counts/bounds and budgets before returning owned data.

**All 556 selected CPU/edit/inert cases passed**, including 19 new report cases,
20 worker-query cases and 36 earlier worker cases. No case was skipped. New cases
cover distant support reach from a local edit, equality with direct committed
reports, reservoir transfer, coarse fallback, heat, holds, runs crossing rows and
planes, game-only reads, round-trip motion ambiguity, provenance/ownership,
expired handles, observer failures, malformed replies, single-flight behavior,
close, timeout and protocol mismatch. Real physical advancement and structural
solves were trapped and never called. The support observations in these tests
are deterministic fixtures, not new evidence about actual structural physics.

Full types, lint, eleven SDK builds/declarations and the zero-tick public-package
check passed afterward, one stage at a time. The package report case changes
only AP/game data; terrain, constraints and all support inputs are unchanged, so
the report path invokes no structural observation. Each stage used fresh quiet
gates and unchanged 6% CPU / 4 GiB Jobs with independent watchdogs. Cleanup
receipts confirm owned workloads and Jobs were gone afterward. All 96 protected
hashes, runtime hold and legacy quarantine remain unchanged.

[Build 20 evidence](tactical-interventions/build-20-2026-10-17/summary.json) retains
source/output hashes, exact selection, commands, limits and cleanup receipts.
Native worker/replay/GPU/frame acceptance and the 38 physical cases remain held.
The report retains full action endpoints and may run global support solves; it
does not provide incremental dependency reuse, intra-action motion history or a
frame-latency guarantee. The full wishlist remains incomplete and active.

## Build 21 acceptance criteria: observations from queued previews

Before implementation: the previous goal turn made progress (Build 20 passed its
approved gates). The full wishlist remains active. This build addresses preview
inspection and execution history; it does not authorize physical runtime checks.

1. The bounded preview queue accepts opt-in motion, subpass path and action
   journal capture with the existing per-tick/detail budgets. Omitted capture
   retains session policy defaults. Options can enable capture but cannot turn
   off paths required by a game reducer. Malformed options and invalid budgets
   reject synchronously before superseding accepted work or consuming an ID.
2. Lazy `motion(ticket)`, `paths(ticket)` and `journal(ticket)` reads accept only
   this queue's latest ready ticket at the original committed revision. Waiting,
   running, cancelled, superseded, stale, committed, foreign and closed tickets
   cannot read current observations. Reads return isolated existing core records;
   they never advance physics or infer motion from endpoint differences.
3. Preserve domain order, tick/operation/revision stamps, empty versus disabled
   capture, coarse/overflow signals, and all-or-nothing publication. Committed
   records contain the same captured observations under a committed target.
   Reading observations cannot alter the candidate or future commits.
4. Validate direct-versus-queued complete state equality and capture equality
   with deterministic inert drivers, including a horizon across the 32-tick
   scheduling boundary, a return-to-origin path, reservoirs, cancellation,
   malformed driver output and capture overflow. Trap production physical
   stepping and global support solves throughout the selected tests.
5. Sequentially run selected edit/inert tests, no-emit types, lint, SDK build and
   zero-tick public-package integration through the unchanged reviewed safe
   harness. Each launch needs its own quiet gate. Stop at the first failure;
   retain all attempt and cleanup receipts. All 96 protected hashes must match.

The worker protocol remains version 3: this build first provides the queue-side
capture/inspection boundary. Serialized motion/path/journal transport, native
workers, actual support/physics/replay, GPU and frame acceptance remain pending.
The runtime hold and legacy quarantine remain intact. The full wishlist cannot
be accepted on edit/inert evidence.

### Build 21 implementation and bounded results

The public queue accepts `TacticalPreviewCapture3D` as an optional third request
argument. Its `motion`, `paths` and `journal` members enable existing captures
and budgets. They cannot turn off policy-required paths. Pure validation copies
options before accepted requests are superseded; the queue also checks that the
absolute end tick remains representable. Reads share the existing commit
ownership/revision guard. They delegate to core isolated record readers and add
no physical advancement. The worker wire protocol and physical rules are unchanged.

All **578 selected edit/inert tests passed**, including 22 new capture cases.
Direct and queued complete states and observations match through 33 synthetic
ticks with a reservoir. Coverage includes net-zero paths, fragment membership,
coarse and overflow records, retained copy isolation, malformed inputs and
driver output, cancellation, revision changes, and policy-required paths.
Production physical steps and support solves were trapped and never called.
Full no-emit types and lint also passed. Owned workload and Job cleanup was
confirmed after each stage; all 96 protected hashes remain unchanged.

The next SDK launch was refused by its fresh quiet gate: the first nine samples
were below 20%, but the tenth reached **24.51171875% CPU**. No SDK workload was
authorized or launched. As specified, the sequence stopped there. The SDK build
and changed zero-tick public-package check remain **pending**; existing dist SDK
artifacts are from Build 20. The refused gate is retained without retry or
threshold changes. [Build 21 pending evidence](tactical-interventions/build-21-2026-10-17/summary.pending.json)
records the three successful stages and the stopped launch separately.

This goal turn made implementation and verification progress; it is not a
completed wishlist or a three-turn blocking finding. The runtime hold, 38 held
physical cases, native-worker/GPU/replay/frame gates and legacy quarantine remain
intact. The next gate is a fresh bounded SDK build, followed by the zero-tick
package check. Worker observation transport remains subsequent feature work.

### Build 21 remaining package gates completed

On the next goal continuation, the fresh `sdk-02` quiet gate passed (maximum CPU
7.32421875%). All eleven bundles and declarations built under the unchanged
6% CPU / 4 GiB Job and independent watchdog. The subsequent public-package gate
also passed (maximum CPU 12.596153846153847%). The package integration verified
queued empty motion/paths and a game-only action journal with zero physical ticks,
then committed exactly the inspected journal. No support solve, native worker,
browser or GPU was launched. Both cleanup receipts confirm no owned workload or
Job remained and the hold/source hashes were unchanged.

[Completed Build 21 evidence](tactical-interventions/build-21-2026-10-17/summary.json)
supersedes the pending status without replacing the refused quiet gate or earlier
pending receipt. All 578 selected tests, types, lint, SDK build and zero-tick
package checks now pass; all 96 protected hashes remain intact. The full wishlist
and all held runtime acceptance requirements remain incomplete.

## Build 22 acceptance criteria: worker motion correspondence

Before implementation: Build 21 now passes all five approved stages. This build
connects the existing queue capture boundary to the worker client and provides
simulation-tick motion correspondence for the latest acknowledged action.

1. Worker requests accept the same optional capture options as the queue. Validate
   and detach them before superseding any accepted request; retain policy-required
   paths. Protocol version 4 rejects mismatched peers before accepting work.
2. `client.motion(commit)` accepts only the exact latest acknowledged commit
   handle from that client. It shares the single-flight transport and timeout
   policy. Successful reads, read failures and caller mutations do not change
   authoritative or cached committed state, or invalidate a ready preview.
3. Return existing captured net permutations, touched identities and structural
   fragment membership, preserving complete/disabled/overflow semantics. Capture
   stays opt-in and commits do not eagerly send journals. Only the latest commit
   is retained; restore/close revoke it. No endpoint-derived invented movement.
4. Validate every report's full revision identities, scope, domain order,
   complete horizon coverage, tick/operation ordering, counts and shared budgets.
   Reuse the existing portable permutation validator without running physics or
   allocating full per-tick world copies. Reject partial, malformed, oversized
   and incompatible replies. A malformed read fails transport closed without
   marking an acknowledged mutation uncertain.
5. Use clone-isolated mock transport and inert permutation drivers to compare
   the complete received journal with the direct commit, including reservoirs,
   odd ticks, the 32-tick boundary, return-to-origin movement, fragments, overflow,
   provenance/isolation, supersession, cancellation, close and timeout. Trap real
   physical ticks and support solves. Run selected tests, types, lint, SDK build
   and zero-tick public integration sequentially under unchanged safe limits.

Path/action-journal transport and precommit worker observation reads remain
subsequent work. This net-motion report cannot describe swept contact paths or
direct intervention movement; the existing flags must state that limitation.
No native worker, physical runtime, replay, GPU or benchmark is authorized.
Keep all 96 protected hashes and the legacy quarantine unchanged.

### Build 22 implementation and current evidence

Protocol 4 adds the queue's opt-in capture options and `client.motion(commit)`.
The host reads its latest commit's existing journal lazily. The client keeps
capture limits with private commit stamps; caller edits to returned snapshots or
receipts cannot redirect a read. Ordinary observation failures preserve the
acknowledged commit and any ready preview. Transport failure retains the last
confirmed state. A read timeout creates no uncertain mutation or automatic retry.

The existing permutation decoder now has a metadata-only internal entry used by
the worker report reader. Both routes retain the same net-permutation, touched
identity and fragment membership checks. The reader also verifies the complete
domain/tick horizon, 32-tick queue operation boundaries and shared detail budget.
It needs no full per-tick world copy and runs no support solve. This does not
provide subpass paths, direct intervention movement or a latency guarantee.

All **600 selected edit/inert cases passed**, including 22 new worker motion
cases. The first type check caught a TypeScript default-parameter inference that
limited the budget type to the literal `65536`. An explicit `number` annotation
fixed it without changing runtime behavior. The corrected source passed all 600
cases again, full no-emit types and lint. Original test/type receipts are retained;
`attempt-02`, `typecheck-02` and `lint-01` are the current successful stages.

Coverage includes equality with direct journals at odd starting ticks through a
33-tick horizon and reservoir, return-to-origin movement, falling fragments,
per-tick/cumulative overflow, malformed data, isolation, ownership, supersession,
timeout and cleanup. These use synthetic permutations/inert drivers. Real physical
steps and global support solves were trapped and not called. All 96 protected
hashes remain unchanged, and every launched stage confirmed owned workload/Job
cleanup under the reviewed caps and independent watchdog.

The SDK gate then refused launch at **26.036644165863066% host CPU**, above its
20% limit. No SDK workload or public-package integration ran for Build 22.
Existing built artifacts remain Build 21 (worker protocol 3); Build 22 source is
protocol 4 and must be rebuilt for both peers before use. The sequence stopped
on that refusal without changing thresholds. [Build 22 pending evidence](tactical-interventions/build-22-2026-10-17/summary.pending.json)
records passed stages, the repaired type failure, protected hashes and the refused
launch separately. The remaining package gates need a fresh quiet window.

This goal continuation made progress, including completing Build 21's package
gates. The full wishlist remains active and incomplete. All runtime/replay/GPU
and frame gates, 38 physical cases and legacy quarantine remain held.

### Build 22 package gates completed

The next continuation's fresh `sdk-02` quiet gate passed (maximum CPU
7.024390243902435%). Eleven SDK bundles plus declarations built successfully.
The fresh public-entry gate passed at a maximum 6.0546875% CPU, and the built
protocol-4 client read a complete empty captured motion journal after an
acknowledged game-only zero-tick commit. Both stages used the unchanged reviewed
Job limits and independent watchdog; cleanup confirms no owned workload or Job
remained. No native worker, physical step, support solve, browser or GPU ran.

[Completed Build 22 evidence](tactical-interventions/build-22-2026-10-17/summary.json)
retains all 600 current selected cases, type/lint/build/package receipts, source
and artifact hashes, the repaired type-check failure and original refused quiet
gate. All 96 protected hashes remain unchanged. This supersedes the earlier
pending status without replacing historical receipts; the full wishlist and
held physical/runtime acceptance remain incomplete.

## Build 23 acceptance criteria: worker subpass path history

Before implementation: Build 22 has passed all five approved gates. This stage
connects the existing path journal to the worker client so gameplay can inspect
crossings that net correspondence alone cannot describe.

1. `client.paths(commit)` reads only the latest exact acknowledged commit handle,
   using the existing capture options and single-flight/timeout rules. It shares
   commit ownership, restore/close invalidation and isolated-copy behavior with
   motion reports. Protocol 5 rejects incompatible peers. No eager path payload
   accompanies commit; ordinary read failures do not invalidate a ready preview
   or roll back an acknowledged action.
2. Return the existing complete per-domain/tick path journal, preserving motion
   correspondence, fragment membership, ordered simultaneous subpass segments,
   absolute ticks and operation identities. Disabled or overflow journals cannot
   masquerade as complete empty paths. Direct interventions remain excluded.
3. Reuse the exact existing path chronology validator through a metadata-only
   internal entry; the public snapshot-based decoder retains full before/after
   snapshot validation. Check scheduling parity, axes, legal structural fall and
   relocation, disjoint simultaneous swaps, provenance and composition back to
   the net trace. Transport validation must not step physics or fabricate
   intermediate authoritative snapshots.
4. Enforce 256 retained domain-tick frames and 65,536 shared detail entries,
   including frame overhead, net motion and path pass/segment entries. Enforce
   requested per-tick budgets before copying excess detail. Oversized, partial,
   accessor-bearing, incompatible and malformed reports fail closed. Retained
   observations remain data, not live handles for actor resolution.
5. Compare full mock-worker results with the direct path journal using inert
   fixtures: odd starts and a 33-tick boundary, reservoirs, out-and-back paths,
   structural relocation, all scheduled axes, per-tick/cumulative overflow,
   malformed chronology, ownership, mutation isolation, cancellation, timeout
   and close. Trap actual physics and support solves. Run selected tests, types,
   lint, SDK and zero-tick package integration sequentially via the unchanged
   safe harness, with fresh gates and retained first-failure receipts.

Action-journal transport, precommit worker inspection, integrated actor gameplay
and physical/native-worker/replay/GPU/frame acceptance remain unfinished. This
stage must not claim those from serialized inert path evidence. Preserve the
runtime hold, all 96 protected hashes and legacy quarantine.

### Build 23 implementation; verification not launched

The protocol-5 source adds `client.paths(commit)` using the latest acknowledged
handle and the existing capture, timeout and single-flight rules. The host reads
the captured journal lazily. The client validates full domain/tick coverage,
queue operation order and a shared budget that includes frame overhead, net
trace, path passes and segments. Path decoding uses the existing chronology
algorithm through a new metadata-only internal entry. The public snapshot-based
decoder retains its full before/after snapshot checks. No physical kernel or
authoritative state schema was changed.

Twenty-two regression cases are authored for a selected total of **622**. They
cover direct/transport equality, even/odd scheduled movement, round trips,
structural relocation, per-tick and cumulative overflow, ownership, mutation
isolation, cancellation, cleanup, malformed chronology and the combined detail
budget. They trap production stepping/support solves. These cases have **not
run** and are not evidence of correctness yet.

The first fresh test gate refused launch at **24.12109375% host CPU**, above the
20% limit, after seven quiet samples. No workload was authorized or launched;
there is no live process to wait for and no cleanup required for a test workload.
All five Build 23 gates remain pending. Existing SDK artifacts are still the
verified Build 22/protocol-4 build. [Build 23 pending evidence](tactical-interventions/build-23-2026-10-17/summary.pending.json)
records the exact source hashes and refused gate, without reusing older test
results as proof for this source. The safe runners match the reviewed versions,
all 96 protected hashes match, and runtime/replay/GPU/frame verification and
legacy demos remain held/quarantined. The next action is a fresh selected-test
gate; do not stack another feature build ahead of these pending checks.

This goal turn made progress by completing Build 22's package gates and adding
the Build 23 source/tests. The full wishlist is active, incomplete and unproven
at its held physical acceptance gates.

### Build 23 approved gates completed

The next continuation rechecked the saved state and passed fresh gates for every
stage. All **622 selected CPU/edit/inert cases** passed, including the 22 new path
cases. Full no-emit types, lint, eleven SDK bundles/declarations and zero-tick
public-package integration passed. The integration uses clone-isolated mock
transport to read a complete empty path journal from an acknowledged game-only
commit; it launches no native worker and no physical or support execution.

Every stage used the unchanged reviewed CPU/memory caps and independent watchdog;
cleanup confirms no owned workload or Job remained. All 96 protected hashes and
the runtime hold are unchanged. [Completed Build 23 evidence](tactical-interventions/build-23-2026-10-17/summary.json)
supersedes the pending status while preserving the refused first gate and pending
receipt. Current SDK artifacts use protocol 5. Full physical/runtime acceptance
and the broader wishlist remain incomplete.

## Build 24 acceptance criteria: gameplay queries before committing a preview

Before implementation: Build 23 passed all five approved gates. A tactical caller
must inspect whether a proposed intervention blocks a body or changes exposure
before spending AP. Existing committed queries cannot answer for a private branch.

1. Expose `queue.queries(ticket, options?)` for this queue's latest ready ticket
   and `client.queryPreview(ticket, requests)` for the corresponding worker
   candidate. Return the existing five geometry operations, with the existing
   32-query, per-query cell and portable-response budgets. No physical stepping
   or structural support-capacity solve occurs in a read.
2. Validate full base revision, wire ticket identity, branch/operation identity,
   declared/completed horizon, absolute tick and per-result domain. Preview
   stamps remain preview stamps; never relabel them as committed. Compare cell
   data against a private validated candidate, not the current world or caller-
   mutable ready outcome. Requests and replies own their nested data.
3. Only the latest ready owned ticket can read. Reject pending, cancelled,
   superseded, committed, foreign/copied, restored, stale and closed handles.
   A cancellation or close during a pending preview read must reject that read
   as no longer current while safely draining protocol replies. Ordinary query
   errors preserve the ready candidate; reads never spend AP or publish terrain.
4. Keep one ordinary request in flight and one retained private ready candidate.
   Clear that candidate on invalidation, commit, restore, close and connection
   failure; an in-flight read may retain it only until settlement. Full snapshot
   copies still have cost; do not claim low-latency or copy-on-write behavior.
5. Under protocol 6, compare all five worker query results with direct preview
   geometry after edits and inert horizons, including reservoirs, heat/damage,
   one-view-per-domain reuse, malformed stamps/cell values, failure, cancellation,
   single-flight behavior, timeout and cleanup. Trap physical execution/support
   solves. Pass selected tests, types, lint, SDK build and zero-tick integration
   sequentially under unchanged safe gates before starting another feature.

Support queries establish geometric footing, not structural capacity. Actor
policy, full-action transactions, runtime replay, native workers, GPU/frame
acceptance and remaining elemental/structural extensions retain their separate
requirements. Keep the runtime hold, protected hashes and legacy quarantine.


### Build 24 implementation awaiting approved checks

The preview query path now carries branch/operation identity from ready inspection
through protocol 6. The client keeps a private candidate and releases it on
invalidation; reads validate against that copy, preserve preview stamps and drain
safely during cancellation/close. Direct queue views and worker batches use the
existing geometry algorithms. Twenty-six new cases trap real physical/support
execution and cover edits, reservoirs, inert horizons, ownership, corruption,
response budgets and lifecycle behavior. All five current-source gates are pending.


### Build 24 launch refused; current-source checks pending

The selected-test quiet gate stopped on its third sample at **21.58203125% host
CPU**, above the unchanged 20% launch limit. No workload was authorized or launched;
there is no live test process or cleanup wait. Types, lint, SDK and public-entry
checks remain pending behind the selected tests. Do not use Build 23's successful
622-case receipt as proof for this source. The SDK artifacts still come from
Build 23/protocol 5; the current source uses protocol 6.

The source review also clears the host's retained ticket on cancellation and
close, alongside client candidate release; lifecycle assertions cover discarded
branches. The 26 authored tests have not executed. The next action is a fresh
selected-test safety gate, not another feature build. Reviewed runners are
unchanged, all 96 protected hashes match and the runtime hold remains intact.
[Pending Build 24 evidence](tactical-interventions/build-24-2026-10-17/summary.pending.json)
retains current source hashes and the refused launch. This turn made implementation
progress; the broader wishlist remains active and incomplete.


### Build 24 selected tests passed; static/package gates pending

The next continuation verified the pending source hashes and passed a fresh
quiet-window gate, then ran all **648 selected edit/inert cases across 24 files**.
All 26 new preview-query cases passed, with zero failures, skips or todo tests.
The unchanged harness applied the 6% CPU / 4 GiB Job limits and independent
30-second watchdog. Cleanup confirms no owned workload or named Job remains.

The next, separate typecheck preflight stopped on its second sample at
**30.39309683604986% host CPU**, above the 20% limit. No typecheck workload was
authorized or launched. Types, lint, SDK and zero-tick package integration remain
pending; no automatic retry or new feature was started. All 96 protected hashes
and the runtime hold match. [Current partial evidence](tactical-interventions/build-24-2026-10-17/summary.pending-02.json)
supersedes the earlier test-pending status while retaining both refused gates.
Current artifacts remain Build 23/protocol 5; source is protocol 6.

This continuation completed a required test gate and therefore made progress.
The next safe action is a fresh typecheck gate. The full wishlist and held physical,
replay, native-worker, GPU and frame acceptance remain incomplete.


### Build 24 verification blocked after repeated host-load refusals

The next continuation confirmed every checked source hash still matches the
648-case passing run. A fresh typecheck gate collected eight quiet samples, then
refused launch at **26.82692307692308% host CPU** on the ninth. No typecheck was
authorized or launched. The prior test Job and workload are gone.

This repeats the same CPU quiet-window blocker across three consecutive goal
turns (21.58%, 30.39%, then 26.83%). The previous turn made progress by completing
tests; the remaining gates now require an external quiet CPU window. Stop
automatic retries and mark the full goal blocked, not complete. Do not start a new
feature ahead of pending verification. Resume with a fresh typecheck preflight
when host load permits. Preserve the ten-sample, 20% limit and all other caps.
[Blocked verification evidence](tactical-interventions/build-24-2026-10-17/summary.blocked.json)
retains the three refused gates and current passing source hashes. Types, lint,
SDK and public-entry remain pending; all 96 protected hashes, the runtime hold and
legacy quarantine are unchanged. The full wishlist remains incomplete.


### Build 24 user-authorized CPU verification resumption

After the read-only CPU diagnosis, the user explicitly requested: "i'll risk a
freeze, let's unblock ourselves here". This authorizes continuing the pending
CPU checks. Before running them, the success criteria remain: all selected tests,
full types, lint, eleven SDK bundles/declarations and zero-tick public integration
must pass on current sources, with verified process cleanup and unchanged physics,
runtime hold and legacy quarantine.

A separate `prepare_resume.py` preserves the original preflight and refused
receipts. It changes only the additional CPU quiet-window ceiling from 20% to
50%, matching the reviewed supervisor's existing CPU preflight ceiling. Ten
consecutive samples and 8 GiB free memory remain required. The unchanged runners
retain a 6% workload CPU cap, 4 GiB Job memory cap, independent watchdog, 30-second
stage deadlines (60 for SDK), progress monitoring and live host-overload stops.
The exception authorizes only the enumerated CPU stages for this build; it creates
no GPU/runtime permit and changes no supervisor or protected configuration. If a
stage fails, inspect and fix it before continuing. Do not discard prior evidence.


### Build 24 approved CPU gates completed

The resumed typecheck, lint and SDK build passed. The first public-entry attempt
failed because an older assertion omitted `branchId` and `operation` from preview
inspection metadata. The fix asserts the exact new values (branch 1, operation 5)
for that fixture; it does not weaken identity checking or modify production code.
The failed receipt and verified cleanup remain in `public-entry-01/`.

After the assertion repair, all five stages passed against the corrected source:
**648/648 selected edit/inert tests across 24 files**, full no-emit types, lint,
eleven SDK bundles/declarations and zero-tick public-package integration. The
26 preview-query regressions passed. Each gate rechecked current sources and the
preceding stage; every runner applied the unchanged 6% CPU / 4 GiB Job caps,
independent watchdog, deadlines and overload checks. Cleanup verified no owned
workload or named Job remained. One resumed test preflight peaked at 26.44%,
which the old extra 20% threshold would have rejected; the bounded workload passed.

[Completed Build 24 evidence](tactical-interventions/build-24-2026-10-17/summary.json)
records all receipts, source/artifact hashes, explicit authorization, retained
refused gates and repaired assertion. All 96 protected hashes and the runtime
hold match. Current SDK artifacts use protocol 6. This resolves the SDK-check
blocker; prior pending/blocked receipts remain historical evidence. No runtime,
GPU, replay, native Worker or benchmark execution occurred, and legacy demos
remain quarantined. The full wishlist remains incomplete and its physical
acceptance gates remain unproven.
### Build 25: worker action-history access - acceptance before implementation

The tactical client must inspect captured consequences before committing an
ability and retain ordered history after acknowledgement. Add lazy
`journalPreview(ticket)` and `journal(commit)` reads of existing action boundaries.
History remains derived data, never authoritative replay state. Reading it must
not step physics or solve support, and capture remains opt-in.

Success criteria:

- Bind preview reads to the latest owned ready ticket, private branch, operation,
  horizon and complete revision; bind committed reads to the latest acknowledged
  commit. Cancel, supersede, restore, commit and close invalidate access.
- Validate version, provenance, chronological boundaries, domain coverage, change
  runs and bounds, intervention receipts, conservative motion, capture budgets,
  aggregate entries and disabled/coarse/overflow semantics before delivery.
  Reject malformed replies while retaining the last confirmed state.
- Retain intervening effects even when endpoints match, including transfers,
  accounted heat, holds and distant support. Return isolated copies. Read errors
  cannot make mutation status uncertain; cancellation and close drain the read.
- Version the worker protocol and document public calls. Pass all selected mock
  and edit-only tests, types, lint, eleven SDK bundles and zero-tick package
  integration against the final source snapshot.
- Use the authorized sequential CPU harness: ten launch samples at most 50%,
  8 GiB free, unchanged 6% CPU / 4 GiB Job caps, independent watchdog, deadlines,
  overload stops and confirmed cleanup. Preserve failed receipts and inspect
  failures before continuing. The user's instruction to unblock CPU work remains
  the authorization; runtime safeguards stay intact.

Physical replay, native Worker/browser execution, GPU checks and benchmarks remain
blocked. Preserve protected hashes, the runtime hold and legacy quarantine. This
build can establish CPU/API readiness only; the full wishlist stays incomplete.

### Build 25 completed CPU/API gates

Added `journalPreview(ticket)` and `journal(commit)` under worker protocol 7.
The worker reads existing captured history lazily; the client validates private
preview/commit provenance, chronological preparation and tick batches, domains,
receipts, global change coverage, conservative motion and bounded detail. Total
external energy must match the private candidate or acknowledged commit ledger.
Cancellation, supersession, commit, restore and close retain the existing bounded
lifecycle. Isolated history reads never advance physics or recompute support.

All **674 selected edit/inert tests across 25 files** passed, including 26 new
action-history cases. Full no-emit types, lint, eleven SDK bundles/declarations
and zero-physical-tick public-package integration passed sequentially. The latter
uses game-only journal capture and a structured-clone mock transport; it performs
no native Worker execution or support solve.

The first attempt stopped at an incorrect error-wording assertion: the decoder
correctly rejected an over-budget receipt with `Invalid bounded action array.`
The test now checks that rejection exactly. Its failed receipt and cleanup remain
in `attempt-01`. A 673-case passing run remains in `attempt-02`. Final review then
added aggregate ledger binding and a forged-but-balanced heat receipt regression;
`attempt-03` and all following stages passed against that final source.

[Completed Build 25 evidence](tactical-interventions/build-25-2026-10-17/summary.json)
retains source/artifact hashes, explicit CPU-only authorization, historical
attempts, ten-sample launch checks, unchanged resource limits and verified cleanup.
All 96 protected hashes and the global runtime hold remain intact. Legacy demos
stay quarantined. This continuation completed a required build and its CPU gates;
the overall wishlist remains active and incomplete. Physical trajectories/replay,
native Worker execution, GPU and gameplay-frame acceptance remain held and unproven.

### Build 26: SDK-only hot-slab tactical reference — criteria before implementation

Connect the existing mechanisms in an application-owned reference scenario under
`examples/tactical-slab/`. The example consumes public package entries only; its
ability costs, selection, unit policy and targeting remain outside engine laws.
This is the transaction/scene integration stage, not visual or runtime acceptance.

Success criteria:

1. Create a deterministic bounded scene with an anchored abutment, a bonded hot,
   damaged slab, a walkway attached through that slab, a rider and a second unit.
   Lifting cuts only the slab's external connections, preserves internal history,
   changes a terrain firing line and moves the rider through the existing exact
   translation response. The walkway's future physical response remains a runtime
   gate; do not substitute endpoint geometry for a global support solve.
2. Provide application commands for lift/control, release, accounted heat and
   wait. Selection/range/cost/lifetime policy is fixed and versioned in the example.
   Material, unit bodies, AP, heat resource, turn and RNG remain in the atomic
   session state. Validate untrusted commands and saved game data before use.
3. Use the same preparation and policy in direct preview and worker ownership.
   Default previews request a declared nonzero physical horizon and production
   M5 advancement; zero ticks is an explicit edit-inspection mode for this held
   verification stage. Preview/discard never changes committed state. Stale,
   insufficient-resource, blocked-route and actor-crush failures preserve all
   authoritative state. Restore retains the full application and hold state.
4. Actor reducers consume observed translation/tick paths, reject incomplete or
   unresolved group responses and apply fixed-point gravity at complete ticks.
   No actor load, damage, knockdown or articulated rigid-body law is implied.
5. Expose revision-stamped observations (firing line, body support/exposure and
   candidate identity) for a future UI. Never include disposable views in saves.
   The example must not launch workers, browsers, rendering or physics on import.
6. Add selected CPU edit-only/mock regressions with real step/support traps and
   built-public-package zero-tick integration. Pass the existing selected suite,
   full types, lint and all SDK gates under the unchanged bounded CPU harness.
   Retain evidence, failures and cleanup. Author separate held runtime cases for
   physical preview/execution/restart and support expiry; do not execute them.

Keep protected physics/configuration, runtime hold and legacy quarantine intact.
Native-worker execution, physical replay, GPU/frame benchmarks, full four-element
content, external loads and rendering integration remain explicit pending gates.

### Build 26 completed CPU/reference integration gates

`examples/tactical-slab/` now consumes only public SDK entries to join material
history, actor response, geometry, resources, saved temporary control and preview
publication in one application-owned scenario. Local and worker ownership share
the same versioned policy and command preparation. The model is headless; UI,
rendering and native-worker acceptance are still pending.

The scene's edit-only evidence establishes exact hot/damaged slab transfer,
preserved internal bonds and total energy, explicit external cuts, rider carry,
changed firing line, AP/heat costs, isolated previews, saved holds, stale rejection
and whole-action rollback when a route or actor is blocked. Bond-graph inspection
shows that removal disconnects the remote walkway from the abutment. It does not
establish that the physical support solver will produce a particular collapse.
Actual tick reducers use observed material paths, group response and fixed-point
gravity. Inert-driver tests exercise their coordination and expiry boundaries;
physical trajectories remain unproven.

All **699 selected edit/inert tests across 26 files** passed, including 25 new
reference cases. Full no-emit types, lint, eleven SDK bundles/declarations and
built-public-package zero-tick reference integration passed sequentially under
the unchanged bounded CPU harness. The package check bundles the external example
against package exports and checks preview/commit, rider/history preservation,
save/restore and accounted heat without any physical tick or native Worker.

The initial five gates passed. Final review found that only the local controller
enforced the application's eight-tick maximum; shared preparation now rejects a
worker request above that maximum before it can create a driver. The mock worker
regression covers that path. All five gates were rerun on the corrected source;
the first passing receipts remain retained. Four physical integration cases were
authored separately and remain excluded from selected checks, bringing the held
physical case inventory to 42. Comparisons are sequenced one at a time.

[Completed Build 26 evidence](tactical-interventions/build-26-2026-10-17/summary.json)
retains final source/artifact hashes, authorizations, launch telemetry, historical
attempts and verified cleanup. All 96 protected hashes and existing SDK artifacts
are unchanged. The runtime hold and legacy quarantine remain intact. This turn
made implementation and verification progress; the full wishlist remains active
and incomplete, including physical replay, UI/rendering, four-element extensions,
external loads, efficient branch reuse and hardware performance acceptance.

### Build 27: supported tactical rendering boundary — criteria before implementation

Add `state-space-engine/experimental/3d/tactical-renderer` for composing a complete
tactical scene without using private simulation buffers or changing existing
terrain renderer contracts. This is an implementation and CPU/mock API gate;
actual WGSL compilation, pixels and GPU timing remain held acceptance work.

1. Prepare a disposable, isolated presentation from a fully validated committed
   snapshot or completed preview. Its complete revision/candidate stamp binds
   terrain, actor boxes and targeting overlays. Reject mismatched stamps, malformed
   coordinates and excessive decorations atomically. Presentation never changes
   terrain, game state, holds, energy or replay data.
2. Expose shared world coordinates (one voxel per unit, increasing Y downward,
   geometry fixed-point scale 1,024), camera projection and depth convention to
   host renderers. Terrain and actors write the same depth attachment; overlays
   test that depth without writing it. An optional synchronous host draw callback
   uses that same pass and camera binding, before targeting overlays.
3. The caller owns the WebGPU device and color/depth targets. The renderer creates
   and destroys only its caches. Reject mismatched target size, format, samples or
   usage before writes/submission. Do not acquire a canvas or adapter internally.
4. Build exposed terrain faces on the GPU, retain immutable scene uploads/mesh
   across camera-only frames, and rebuild when a different prepared scene is
   supplied. Native material buffers are not exposed or made authoritative caches.
   Support finite volumes up to the existing 128-cubed bound, subject to device
   limits; do not claim latency or GPU equivalence from mock-device tests.
5. Allow at most one outstanding frame and one submission/completion boundary.
   No automatic frame loop, retry or backlog. Invalid input leaves the renderer
   usable; a device/encoding failure stops rendering and preserves the last
   completed frame's identity. Close drains owned work before releasing caches,
   never caller textures/device. Errors cannot mutate the simulation.
6. Add a public-SDK adapter for the hot-slab reference and CPU/mock regressions
   for stamp isolation, coordinates/projection, depth/pipeline contracts, caching,
   target validation, backpressure, callback errors and resource cleanup. Run
   selected tests, full types, lint, SDK build and zero-GPU public package checks
   sequentially under the unchanged safe CPU harness. Preserve final hashes and
   raw receipts. No native Worker, physical replay, browser, GPU or benchmark run.

Document native shader/pixel correctness and full-frame latency as pending. Keep
all 96 protected hashes, the runtime hold and legacy quarantine intact. The full
wishlist remains incomplete, including naturalistic composition, tactical UI,
structural reuse, efficient branches, four elements and physical actor acceptance.

### Build 27 completed CPU/mock rendering gates

The new `state-space-engine/experimental/3d/tactical-renderer` entry prepares an
isolated scene from a validated committed snapshot or completed preview and binds
actor/targeting boxes to its full geometry stamp. The public hot-slab adapter
composes the two units and selected slab cells through that entry. It does not
start a worker, browser, GPU or simulation on import.

The renderer shares a camera layout/projection and caller-owned depth attachment
between terrain, opaque actor boxes and a synchronous host draw callback.
Outlined overlays test that depth without writing it. Exposed-face generation is
encoded on the GPU; camera-only frames reuse the prepared scene's uploads and
mesh. The host owns its device/targets, and the renderer owns only disposable
caches. Rendering rejects overlap rather than building a frame backlog, uses one
submission/completion boundary, and drains pending work before freeing caches.
Failure retains the last completed scene identity; it cannot promise intact
target pixels after a device error.

All **733 selected CPU/edit/inert/mock tests across 27 files** passed, including
34 new rendering cases. Full no-emit types, lint, twelve SDK bundles/declarations
and built-public-package zero-GPU presentation integration passed sequentially
under the existing 6%-CPU/4-GiB harness, watchdog and per-stage deadlines. The
typecheck configuration extends the original full project and adds only the new
public entry's source mapping so the external example can typecheck before its
first SDK build. Native compilation or rendering was never invoked.

The first selected suite passed 732 tests. The first typecheck stopped on new
helper/fixture type errors with cleanup confirmed; those were fixed. Review also
found that a completion promise rejecting without a reason needed normalization
to an error to prevent false frame success. A regression was added, then all five
gates passed on the corrected source. Initial receipts and the failed typecheck
remain retained.

[Build 27 evidence](tactical-interventions/build-27-2026-10-17/summary.json) binds
the final source and artifact hashes, raw receipts, launch telemetry and cleanup.
All 96 protected sources and all preexisting SDK artifacts are unchanged. The
runtime hold and legacy quarantine remain intact; the 42 physical cases remain
unexecuted. Native WGSL compilation, pixel/depth correctness, full-frame latency
and hardware containment are still pending, as are physical replay and actor
acceptance. Full snapshot preparation/copy cost is unmeasured. This initial
renderer uses diagnostic opaque materials/boxes; naturalistic composition and a
playable tactical UI remain future work. The full wishlist stays active and
incomplete.

### Build 28: worker-owned tactical UI — criteria before implementation

Connect the hot-slab reference and supported rendering boundary into an actual
browser client, with runnable source/bundles but native execution still held.
This advances the responsive intervention/inspection loop; it does not replace
the remaining four-element, structural-reuse or physical-acceptance work.

1. Use only public SDK imports. The dedicated worker owns simulation and commits;
   the UI requests bounded horizons (default two, maximum eight ticks), receives
   complete snapshots and queries consequences in one bounded batch. No physical
   step/support solve may run on the UI thread or in this build's verification.
2. Provide lift, heat/cool, release and wait previews; committed/candidate A/B;
   commit/discard; AP/thermal-cost, horizon/revision, firing-line, support/exposure
   and cell inspection; complete save/import/reset; orbit/zoom and clear errors.
   Preview does not spend resources or mutate committed terrain. Commit updates
   only on acknowledgement, and lost mutation replies show uncertainty without
   retry. Post-commit inspection failure must not imply the commit rolled back.
3. Coalesce preview intents to one active and one latest waiting request. Do not
   overlap worker queries with mutation requests. Superseded/cancelled candidates
   cannot reappear or commit. Invalid commands/saves leave the current candidate
   and committed game intact. Keep camera/render scheduling independent of solves.
4. Render on demand with at most one frame outstanding and one coalesced dirty
   frame. Preserve complete displayed-state identity during async work. Resizing
   and disposal wait for frame completion before destroying owned targets. No
   automatic simulation, retries, unbounded timers, request queues or frame loops.
5. Start only on explicit interaction after a fail-closed check of the existing
   runtime hold. Missing/unreadable/malformed/active hold blocks worker and GPU
   acquisition. Recheck before simulation mutations and frames. Stop/close drains
   owned work and removes listeners; failed startup cleans partial resources.
   Do not clear or weaken the hold, change protected sources or visit the page.
6. Add CPU/mock coordination, gate, cancellation and frame-scheduling regressions;
   bundle browser/worker code through the built public SDK and inspect exports.
   Pass selected tests, full types, lint, twelve SDK bundles and zero-runtime
   public-package integration under the existing sequential bounded harness.
   Retain source hashes, failures and cleanup. Native worker/GPU/visual/frame and
   physical replay acceptance remain explicit pending gates; legacy demos stay
   quarantined. No native execution is authorized by this implementation stage.

### Build 28 completed CPU/mock tactical UI gates

`examples/tactical-slab/` now includes a browser client for the integrated chamber.
It requests production SDK worker previews with a declared duration, shows a
complete candidate's terrain/actors/targeting geometry, compares it with committed
state, and commits only the acknowledged transaction. Controls cover lift,
heat/cool, release, environmental resolution, discard, cell inspection, complete
save/import/reset and orbit/zoom. AP, thermal resource, firing-line obstruction,
support/exposure, temporary hold expiry and revision/tick identity are visible.

The application keeps one active and one latest waiting preview intent. It does
not issue a new mutation while an old observation batch is in flight; superseded
results cannot appear or commit. Rendering has one outstanding frame and one
coalesced dirty successor. Frame completion precedes target resize/disposal.
The client retains the last acknowledged save if a mutation reply is lost and
explicitly identifies that uncertainty. An acknowledged commit followed by an
inspection failure retains its accepted state and identifies the older display.

Native startup is behind explicit Start interaction and a fail-closed read of
the existing runtime hold. The hold is also checked before mutations and frames.
The page was not opened and no native Worker/device was created. Browser/worker
bundles were compiled only, using public package exports; their inputs/outputs
and hashes are retained in evidence. The page's live rendering, usability,
native-worker cancellation and hardware responsiveness remain unverified.

All **766 selected CPU/edit/inert/mock cases across 28 files** passed, including
33 new UI/gate/lifecycle cases. Full types, lint, all twelve SDK bundles and the
zero-physical-tick built-public-package UI integration passed sequentially under
the unchanged 6%-CPU/4-GiB supervisor, watchdog and deadlines. The public check
exercises preview, commit and restore through the real SDK protocol over mock
transport, then compiles both browser entry points. Nonzero scheduling cases use
inert drivers; they do not establish physical preview agreement.

The first suite passed 765 cases. The first typecheck stopped on new async-closure
and mock-port typing errors, with cleanup confirmed; those were corrected. Review
also found a partial canvas-startup cleanup gap. Observer/frame/timer resources
are now released when startup fails, and a mock DOM regression covers an observer
failure before a frame is scheduled. All five gates passed on the corrected
source. Initial receipts and the failed typecheck remain retained.

[Build 28 evidence](tactical-interventions/build-28-2026-10-17/summary.json) records
final hashes, raw results, launch telemetry, artifacts and cleanup. All 96
protected sources and all preexisting SDK artifacts remain unchanged. The runtime
hold, 42 held physical cases and legacy quarantine remain intact. This is another
completed implementation/CPU gate, not completion of the wishlist: native visuals,
physical replay/actors, preview/frame latency, branch/structural reuse, external
loads and four-element extension still require implementation or acceptance.

### Build 29: exact private snapshot reuse — criteria before implementation

Reduce the full-world copying cost of preview/AI branch creation and advancement
setup while preserving the existing public transaction contract. This is a
storage optimization, not a new material law or a substitute for later physical
or hardware acceptance.

1. Branch creation and advancement setup share private, already validated
   snapshot nodes. Internal edits/ticks replace affected nodes; canonical arrays,
   game state, holds, reservoirs and accounting are never mutated in place.
   Siblings, committed state and retained historical reports remain independent.
   No mutable canonical reference may escape through reads, callbacks or drivers.
2. Preserve the current eager-copy strategy behind an internal verification seam
   and compare complete results against the shared strategy for every edit family,
   zero/inert-tick advancement, holds/expiry, reservoirs, journals/queries, commit,
   restore, stale/failed branches and cancellation. Freeze internal shared nodes in
   selected verification cases to catch writes that would violate ownership.
3. Keep all validation at external input, driver publication and commit boundaries.
   Public snapshots/receipts and policy/driver arguments remain isolated copies.
   Do not alter public API signatures, snapshots, rule versions, thermal accounting,
   movement/support laws, cancellation boundaries or worker protocol behavior.
4. Establish allocation evidence from bounded CPU tests: creating/discarding
   branches and starting a zero/inert advance must remove the former eager copy of
   all primary/reservoir cell coordinates. Report exact scope and logical copy
   counts, without claiming wall-clock speedup or avoiding the required driver,
   output, validation and edited-domain copies. No new unbounded cache or pool.
5. Add dedicated shared/copy equivalence and ownership regressions; run the full
   selected suite, types, lint, SDK build and public-package zero-tick integration
   sequentially under the existing bounded harness. Retain source/artifact hashes,
   failures and cleanup. Protected physics sources, runtime hold and legacy
   quarantine remain unchanged. Physical replay and all benchmarks remain held.

The full wishlist remains incomplete. Chunk-level copy-on-write, GPU branches,
exact structural dependency reuse, native responsiveness and four-element/actor
acceptance remain separate work, not claims of this storage gate.

### Build 29 completed CPU gates: private snapshot reuse

Preview branches and advancement setup now share private validated snapshots.
Edits and complete tick publications replace state; public reads, policy inputs,
driver inputs and driver publication retain their existing copying/validation
boundaries. This removes the two coordinator-wide eager copies without changing
public signatures, snapshot schemas, rule identities, accounting or cancellation.
There is no public switch or new persistent state. Production does not freeze or
scan nodes for diagnostics; the freezing/reference-copy/counter seam is internal
to verification.

All **788 selected CPU/edit/inert/mock tests across 29 files** passed, including
22 new strategy/ownership cases. These compare complete snapshots, reports,
journals, paths and queries across edits, thermal changes, translation, storage,
holds/expiry, inert ticks, commit/restore, cancellation, failures and stale
branches. Shared private nodes are frozen in those cases; adversarial mutations
of initial state, public results, callbacks, driver inputs and driver publications
cannot corrupt committed or sibling state. The public-package zero-tick check
also exercises sibling isolation through built exports.

The bounded logical-copy check creates/discards 12 branches with one zero-tick
advance each on a 512-cell world plus a 64-cell reservoir. Eager mode copies
41,472 cell-coordinate values in 144 arrays at those two setup sites; shared mode
copies zero there. This is a count of removed coordinator copies, not a measured
heap reduction or latency benchmark. Required edits, driver state, validation,
queries, public reads and worker transport still allocate/copy. Chunk-level
copy-on-write and structural dependency reuse remain later work.

Full types, lint, all twelve SDK bundles, browser bundle compilation and the
zero-physical-tick public-package integration passed sequentially under the
unchanged 6%-CPU/4-GiB supervisor, independent watchdog and deadlines. All five
stages passed their first execution and confirmed process/Job cleanup. Pre-run
review corrected a test's movement-report access and bounded its asynchronous
polling. No failed runtime attempt is hidden or replaced.

[Build 29 evidence](tactical-interventions/build-29-2026-10-17/summary.json)
retains raw receipts, logical counters, source/artifact hashes and cleanup. All
96 protected sources and the hold hash are unchanged. SDK differences are
restricted to the two tactical bundles, the internal coordinator declaration
and one new internal helper declaration; public declarations remain unchanged.
The 42 physical cases, native Worker/browser/GPU validation and all benchmarks
remain held. Legacy demos remain quarantined. This completes the private-storage
implementation and CPU verification gate; it does not complete the wishlist or
prove physical replay/performance acceptance.

### Build 30: deterministic actor movement and air-assisted commands — criteria before implementation

Extend wishlist items 4 and 5 with generic impulse/acceleration-driven body-group
movement. The game selects targets, ability range and resource costs; the engine
resolves body volumes against the current terrain and peers. This is a separately
versioned kinematic contract, not a wind/material solver or a change to M5.

1. Accept up to 64 uniquely identified saved bodies and a bounded optional command
   per body. Validate all inputs and command sums before querying or moving any
   body. Use existing fixed-point scales, speed/gravity bounds and body save
   identities. Reject unknown/duplicate command targets, malformed/accessor data,
   mixed body-step counters and incompatible geometry. Return owned results.
2. Freeze ordering as ascending portable actor ID, then X/Z/Y axis sweeps. Resolve
   each body against terrain and peers at their current serial-substep positions;
   earlier bodies have completed their moves, later bodies remain at their starts.
   This conservative priority model is explicit and independent of input-array
   order. It is not simultaneous rigid-body dynamics or a pushing law.
3. Clip each axis at its earliest exact terrain/boundary/peer contact; terrain wins
   equal-distance ties and peer ties use canonical ID. Face contact does not count
   as overlap; touching bodies may separate or slide. Never tunnel through a peer
   or newly changed terrain. Cancel only the blocked velocity component, retain
   saved velocity/gravity, and report ordered movement segments and contact IDs.
4. Compute footing before/after against terrain and peers, with exact contact area;
   report footing loss, landing and final water/temperature exposure. Peer support
   is positional contact, not load, bonding or automatic platform carry. No health,
   damage, knockdown, AP or ability semantics enter the movement law.
5. An initially embedded/outside/peer-overlapping body makes the whole result
   unresolved, returning the original complete group with no accepted response
   prefix. Validate final pairwise separation. Bound group work and output by the
   body limit and existing per-query budgets; no timers, background work or caches.
6. Export through the public tactical SDK and demonstrate an application transaction
   that moves an actor with an air impulse and spends AP atomically. A changed
   terrain revision invalidates the preview; a later application rejection retains
   terrain, every actor, AP and RNG. Save/restore retains exact body continuation.
7. Add hand-checkable cases for all axes/signs, thin/edge/corner contacts, terrain
   ties, head-on/crossing/convoy order, footing/exposure, high-speed motion, malformed
   data, isolation and repeated/serialized continuation. Run selected CPU geometry/
   inert tests, full types, lint, SDK and zero-material-tick public integration in
   the existing sequential bounded harness. No physical material step/support solve,
   browser, GPU, replay trajectory or benchmark runs; legacy quarantine stays intact.

The full wishlist remains active. This build supplies an actor movement mechanism
for air assistance and projectiles represented as bodies. Gas/loose-material force
transport, combustion/material extensibility, external actor loads and physical/
native acceptance are still required subsequent work.

### Build 30 completed CPU gates: actor movement and air assistance

The public tactical SDK now exports `moveTerrainActors3D`, its command/result
types and the separate `actor-movement-1` rules identity. It resolves bounded
impulse/acceleration commands against current terrain and peer body volumes,
retaining saved velocity and gravity. The documented order is actor ID followed
by X/Z/Y sweeps. Contact clips the requested component without pushing peers;
terrain wins equal-distance ties, then peer ID. Returned movement segments have
that serial meaning, rather than describing simultaneous rigid-body trajectories.

Footing is measured at both complete group boundaries, so a later peer leaving
cannot leave an earlier body's support flag stale. Reports include terrain/peer
contact witnesses, exact peer support area, footing loss/landing and final water/
temperature exposure. Peer footing introduces no load, bond or automatic carry.
Invalid input throws before movement; initial overlap/outside/embedded state
returns the original entire group and no accepted response prefix. Existing
single-body, material, save and worker-protocol contracts remain unchanged.

All **821 selected CPU/geometry/edit/inert/mock tests across 30 files** passed,
including 33 new cases. These exercise all axes/signs, thin peers, boundaries,
edge/corner/face contact, terrain ties, canonical head-on/crossing/convoy behavior,
footing, water exposure, malformed data, ownership, repeated execution and exact
serialized body continuation. Application tests preserve actors/AP/RNG/terrain
after late rejection and reject an old air preview after a new wall publishes.
These are actual kinematic calculations on static/edited terrain, not material
simulation or structural support capacity solves.

Full types, lint, all twelve SDK bundles, browser bundle compilation and the
zero-material-tick public-package integration passed under the unchanged bounded
harness. The public check applies an air impulse, clips at another actor and
publishes actor state/AP together while retaining terrain and RNG. All five stages
passed on their first execution; workload/Job cleanup was confirmed. Pre-run
review normalized negative-direction zero travel and checked final peer footing.

[Build 30 evidence](tactical-interventions/build-30-2026-10-17/summary.json) retains
the criteria-linked receipts, hashes and cleanup. All 96 protected source/config
hashes and the runtime hold are unchanged. SDK changes are limited to the tactical
session bundle/declaration and the new actor movement declaration. No native
Worker/browser/GPU, material tick/structural solve, material replay or benchmark
ran. The 42 held material cases and legacy quarantine remain intact.

This completes the generic actor movement CPU gate. Integrating the command into
the tactical UI, coupling it to real moving/collapsing terrain, material wind,
combustion/material extension, external loads, exact structural reuse and native
acceptance remain unfinished parts of the full wishlist.

### Build 31: worker-owned air assistance in the tactical chamber — criteria before implementation

Integrate Build 30's actor mechanism into the existing public-SDK application,
advancing the air-assisted-movement and preview/transaction parts of the vision.
This does not substitute actor impulses for the still-required material wind or
combustion extensions.

1. Add a bounded application command selecting rider/scout and one of five fixed
   directions (up or the four horizontal axes). Range and one-AP cost remain game
   policy. Validate command/horizon before replacing a ready candidate locally,
   and revalidate in shared worker preparation. Air previews require 1–8 material
   ticks; zero-tick air cannot spend resources or leave an unresolved intent.
2. Stage one portable pending air intent in the private branch. Apply its impulse
   exactly once in the first tick reducer, after terrain-driven displacement and
   before peer-aware actor motion. Subsequent ticks use saved velocity/gravity.
   Clear the intent at that complete tick. Initial/committed saves reject pending
   intents; incomplete/cancelled/failed previews cannot spend AP or publish actors.
3. Use peer-aware group movement for all chamber actor steps, retaining terrain
   motion response first and atomic publication last. Reject unresolved terrain
   response or actor overlap rather than accepting a partial group. Keep the
   shared actor-step clock and exact thermal accounting. The material laws and
   existing generic SDK/snapshot/worker protocol contracts remain unchanged.
4. Version the application as hot-slab-game-2. Explicitly reject v1 saves and wrong
   pending state without replacing a current candidate. Do not silently migrate
   a save into changed future movement behavior. New complete saves retain exact
   velocity and continuation; no rendering cache or UI intent becomes authority.
5. Add unit/direction selectors and an air-preview control. Show unit positions and
   velocity alongside footing/exposure, preserve A/B and acknowledged-only saves,
   and send commands through the current one-active/one-waiting worker flow. No
   new frame loop, device acquisition or runtime bypass. Document horizon semantics.
6. Verify preparation/reducer/worker/UI behavior with actual body calculations on
   inert material ticks: single impulse, multiple horizons, new obstructions, peer
   contact, stale/cancelled actions, AP/range failures, save continuation and malformed
   saves. Add authored real-material acceptance cases but keep them unexecuted.
7. Pass the selected CPU/inert/mock suite, full types, lint, twelve SDK bundles,
   browser compilation and zero-material-tick public-package preparation checks,
   one stage at a time under the unchanged harness. Retain source hashes, failures
   and cleanup. Native Worker/browser/GPU execution, material trajectories/replay,
   benchmarks and legacy demos remain held/quarantined.

### Build 31 completed CPU gates: air assistance in the chamber

The public-SDK chamber now accepts air assistance for the rider or scout in five
directions. The application checks range and spends one AP privately. It requires
a 1–8 tick preview, applies one impulse after the first complete terrain response,
then continues with saved velocity and gravity. All chamber actor steps use the
peer-aware movement contract. A pending intent cannot enter a committed save;
failed, cancelled and stale previews cannot publish actors or spend live AP.

The application is versioned `hot-slab-game-2` because its saved state and future
actor movement changed. Version 1 saves reject explicitly. Unit/direction controls,
positions and velocities use the existing worker coordinator, A/B selection and
acknowledged-state export. Invalid zero-tick air requests and incompatible saves
retain a ready candidate. Material laws, generic SDK saves and worker protocol
remain unchanged. These actor impulses do not transport gases or loose material.

All **847 selected CPU/geometry/edit/inert/mock tests across 31 files** passed,
including 22 new air application cases and four new UI cases. Actual actor
calculations cover single-impulse continuation, walls, ceilings, peers, AP/range,
malformed and pending saves, late failure, cancellation, stale commits and exact
serialized midair continuation against inert material drivers. Mocked worker/UI
tests cover selectors, horizon, A/B, committed AP/velocity and delayed discard.
Two real-material air cases were authored but not executed; the held inventory
now contains **44 cases across 12 files**.

Full types, lint, twelve SDK bundles, browser compilation and the zero-material-
tick public integration passed sequentially under the unchanged 6%-CPU/4-GiB
supervisor, independent watchdog and deadlines. The public check prepares an air
branch and verifies its isolated intent/AP before discarding it without stepping.
All five stages passed their first execution, with process/Job cleanup confirmed.

[Build 31 evidence](tactical-interventions/build-31-2026-10-17/summary.json) retains
raw receipts, source/artifact hashes, held-case inventory and cleanup. All 96
protected source/config hashes, every prior SDK artifact and the runtime hold
are unchanged. No native Worker/browser/GPU execution, material step/support
solve, material replay or benchmark ran. Legacy demos remain quarantined.

The chamber integration's CPU gate is complete. Physical coupling, native visual
and responsiveness acceptance, material forces, combustion/material extension,
external actor loads, exact structural reuse and the full wishlist remain open.

### Build 32: saved conservative material transport — criteria before implementation

Address the missing material side of air manipulation with a public, versioned
transport primitive. This is an explicit intervention cycle, not a change to M5's
gravity/thermal schedule or its absolute material tick. The game later schedules
cycles and costs through its transaction; physical tick/worker integration remains
a separate gate. Do not describe this primitive as a pressure or continuous wind
solver, nor count it as complete four-element acceptance.

1. Own a portable envelope containing the complete validated M5 terrain and up to
   256 uniquely identified material parcels, an independent transport-cycle count,
   saved velocity and signed fractional travel on all three axes. Freeze identity,
   units (1,024 per cell), speed bound (two cells per axis/cycle), ordering and
   collision behavior as `material-transport-1`. No authoritative state lives in a
   rendering cache. Reject incompatible envelopes before work; reads own copies.
2. Select non-air gas, liquid, powder, molten/viscous matter or fully unbound debris.
   Never select intact, damaged-but-cohesive, anchored or bonded solids. Never
   create fresh matter, reset temperature/damage, form bonds or erase occupants.
   Each successful unit move swaps all three M5 coordinates with untracked gas;
   tracked parcels block one another. Solid/liquid/powder obstacles and closed
   boundaries stop the normal component. This first law has no pushing or momentum
   exchange. Unselected gas is displaced conservatively back into the source.
3. Accept at most one integer impulse per parcel per cycle, validate all sums and
   targets before moving anything, and preserve existing velocity when no impulse
   is supplied. Evaluate ASCII parcel ID then X/Z/Y axes, checking every crossed
   cell. Accumulate signed fractional travel exactly and clear only blocked-axis
   velocity/remainder. Other components continue. No skipped cycles or wall-clock
   inputs; zero/negative-zero output is canonical.
4. Return owned terrain/state and a bounded ordered swap/contact receipt, original
   and final parcel positions, exact edited-cell indices and zero external thermal
   energy. Preserve total matter/thermal energy, M5 tick and all unrelated words.
   Record swaps even if identical coordinate values hide their material provenance.
   Reject duplicate IDs/cells, sparse/accessor data, invalid structures, overflow,
   incompatible versions and invalid impulses atomically without mutating input.
5. Add hand-checkable CPU edit tests for each axis/sign, rectangular chunk boundaries,
   fractions/reversal, persistent momentum, walls, peers/order, gas displacement,
   conservation, bound/damaged solids, ownership, malformed saves and exact JSON
   continuation. Trap M5 stepping and support solves. Public SDK integration imports
   and exercises a conservative transport cycle without executing a material tick.
6. Run the selected edit/geometry/inert/mock suite, full types, lint, SDK and public
   integration sequentially in the reviewed bounded harness. Retain all attempts,
   source/artifact hashes and cleanup. Runtime hold, protected M5 sources and legacy
   quarantine remain unchanged. Coupling saved parcel history to intervening M5
   motion/phase changes, branch transactions, actors and worker scheduling remains
   required before an interactive wind command can be accepted.

Transport velocity is a control coordinate, not thermal or kinetic energy. This
milestone defines no mass-scaled force or kinetic heating law. Mechanical ability
costs stay in the application; direct thermal energy changes use the existing
accounted operation. No scientific fluid-accuracy claim follows from these tests.

Pre-run source review clarified the geometry criterion: M5 requires complete
power-of-two chunks (minimum extent four), unlike the older flat M1 field. Test
rectangular/minimum valid worlds and explicitly reject odd/single-cell M5 envelopes;
do not loosen the existing snapshot validator to accommodate this new operation.

### Build 32 completed CPU gates: saved material transport

The tactical SDK now exports `createMaterialTransport3D`,
`readMaterialTransport3D` and `applyMaterialTransport3D`, plus the separate
`material-transport-1` contract and state/receipt types. The portable envelope owns
terrain, named parcels, an independent cycle and exact saved velocity/fractions.
Each cycle validates impulses before moving, then evaluates parcel ID and X/Z/Y
unit paths. Swaps preserve every M5 coordinate and displaced gas; walls, closed
boundaries and tracked parcels stop the normal component. Cohesive/anchored/bonded
matter cannot be selected. No matter is created, healed, welded or thermally reset.

The operation returns ordered swaps, contact witnesses, original/final parcel
locations and exact edited indices. Swaps between identical gas words remain in
the receipt even when there is no value difference. Velocity is a bounded control
coordinate; no kinetic-energy or mass-scaled force law is implied. Transport
cycles do not advance M5 time or replace material gravity/heat/phase evolution.

All **877 selected CPU/geometry/edit/inert/mock tests across 32 files** passed,
including 30 new transport cases. These exercise all axes/signs, fractions and
reversal, persistent momentum, thin walls, partial travel, tangential movement,
parcel priority, conservative gas exchange, unsupported/bound material, complete
state ownership, malformed data, overflow and exact serialized continuation.
The receipt reconstructs all three state arrays exactly. Runtime traps confirm
the new tests do not invoke M5 ticks or structural solves.

Full types, lint, all twelve SDK bundles, browser bundle compilation and public
integration passed sequentially under the unchanged bounded supervisor/watchdog.
The public package check saves a half-cell of water travel, restores the envelope,
and then swaps water/steam with both energy coordinates preserved. The M5 tick and
input snapshot remain unchanged. All five stages passed their first execution,
and each confirmed workload/Job cleanup.

[Build 32 evidence](tactical-interventions/build-32-2026-10-17/summary.json) retains
raw receipts and final source/artifact hashes. All 96 protected source/config
hashes and the runtime hold are unchanged. SDK differences are limited to the
tactical-session bundle/declaration and the new material-transport declaration.
The existing chamber application and worker protocol remain unchanged.

This completes the primitive's CPU edit gate. It does not complete interactive
wind: saved parcel history still needs remapping across actual M5 motion/phase
changes and integration with branch, actor and worker transactions. Those gates,
the 44 held material cases, native execution, performance, combustion, external
loads, structural reuse and the rest of the wishlist remain open. Legacy demos
remain quarantined; no native Worker/browser/GPU or M5 replay/benchmark ran.

### Build 33: transport continuity and atomic tactical staging — criteria before implementation

Connect the saved transport primitive to exact material provenance and the existing
branch/worker flow. Preserve M5, session-save and worker-wire contracts. Reuse real
translation operations, their actor policies and captured paths instead of adding
a parallel terrain mutation route.

1. Add a compact, versioned transport memory suitable for application game state:
   cycle, velocity/fraction records, terrain metadata/tick and each selected cell's
   three coordinate witnesses. Restore against the current terrain only after all
   identities/witnesses validate. No full terrain array is duplicated in game state.
   Memory is part of a session save, not an independent world/revision authority.
2. Follow one complete physical tick using before/after geometry and the same
   coordinator-bound movement observation. Reject cloned, foreign, mismatched,
   disabled or overflow observations; never guess missing correspondence. Follow
   original parcel identities through net permutations, preserving control velocity
   and fractions without adding a transport cycle. Retire control of matter that
   becomes immobile, reporting its final cell; never remove that matter. Refresh
   metadata/witnesses so double-following or using pre-edit memory rejects.
3. Stage a transport cycle through a public helper usable by a branch or the
   synchronous preview editor. Validate/plan first, group each parcel's ordered
   unit path into one existing translation operation, then update game state via
   a synchronous callback. Retain translation collision/actor/hold policies and
   existing journal paths. Verify the staged full terrain equals the conservative
   plan before saving momentum/costs. Fraction-only cycles still update game state.
4. Preflight the remaining branch operation budget, including the final game write;
   never accept a partial transport. Add explicit editor discard so any helper
   failure, including a swallowed callback error after translations, permanently
   invalidates the candidate. Live terrain, actors, AP/resources/RNG remain intact.
   Cancellation and stale-base handling remain the existing queue/worker rules.
   The final game callback must run under the session mutation guard so it cannot
   publish, restore or mutate another branch while transport is being prepared.
5. Verify exact permutation tracking, identical-material history, condensation and
   freezing fixtures, stale witnesses/ticks, bounded-memory validation and owned
   outputs. Test real edit transactions and inert multi-tick continuation, late
   actor/game failures, operation limits, saved continuation, preview cancellation
   and mocked worker transport. Author real-material coupling cases but keep them
   unexecuted. No inference of physical agreement from inert fixtures.
6. Pass selected CPU/edit/inert/mock tests, full types, lint, SDK/browser compilation
   and public zero-M5-tick integration through the unchanged sequential bounded
   harness. Preserve all receipts and protected hashes. Native acceptance, actual
   M5 replay, performance and legacy demos remain held/quarantined.

Application policy still decides when a transport cycle runs and what it costs.
Following a material tick preserves momentum history but does not secretly apply
another impulse or transport cycle. Full elemental gameplay, native validation,
combustion, actor loads and exact structural reuse remain unfinished.

### Build 33 completed CPU gates: transport continuity and atomic staging

The public tactical SDK now provides compact `material-transport-memory-1` capture
and restore, `followMaterialTransport3D` and `prepareMaterialTransport3D`. Saved
memory contains no terrain arrays: it retains control coordinates, cycle, terrain
metadata/tick and selected-cell witnesses. It belongs to the application's normal
authoritative save, not an independent world/revision identity. Wrong ticks,
metadata and selected-cell history reject before transport can proceed.

Continuation binds to the coordinator's before/after geometry and private complete
movement observation. It follows original parcel identities through permutations,
including identical-material exchanges. Missing, cloned or overflowing provenance
rejects. Condensation retains control; immobile results retire it with an explicit
report while leaving the matter in terrain. Following updates the material tick
and witnesses without applying an extra impulse or advancing the transport cycle.

Preparation groups each parcel's path into an existing actor-aware translation,
then writes momentum and game costs together. It preflights the remaining operation
budget and verifies the final terrain against the conservative plan. Existing hold,
actor collision and journal rules remain in force. Late failure invalidates the
whole candidate even when preparation catches the exception. New branch/editor
`updateGame` executes the final reducer under the session mutation guard; it cannot
commit, restore or mutate a sibling during that callback. Editor `discard` and
`updateGame` expire when preparation returns.

All **907 selected CPU/geometry/edit/inert/mock tests across 33 files** passed,
including 30 new coupling cases. Coverage includes synthetic permutation and phase
continuation, equal-valued matter, stale witnesses, callback reentrancy, late actor
and game rejection, holds, operation boundaries, cancellation, exact serialized
continuation and mocked worker journals. Two real-M5 coupling cases were authored
but not run; the held inventory is now **46 cases across 13 files**.

The first bounded attempt stopped on a test-helper syntax error and an outdated
editor-capability assertion. Those were corrected and the suite passed. Subsequent
review found the game callback reentrancy risk; the mutation guard and regressions
were added. The next attempt stopped on an obsolete `discarded` status expectation,
which now correctly preserves the terminal `failed` diagnosis. The final attempt
passed all 907 cases. All attempts and cleanup receipts are retained; the earlier
type pass was superseded by a full pass against the guarded implementation.

Full types, lint, twelve SDK bundles, browser compilation and zero-M5-tick public
integration passed sequentially under the unchanged bounded supervisor/watchdog.
The public check publishes water/steam displacement, compact saved momentum and AP
atomically while preserving thermal accounting. Every stage confirmed process/Job
cleanup. [Build 33 evidence](tactical-interventions/build-33-2026-10-17/summary.json)
records final and historical receipts, source/artifact hashes and held-case inventory.

All 96 protected source/config hashes and the runtime hold are unchanged. SDK
differences are confined to the two tactical bundles, four tactical declarations
and the new coupling declaration. Existing M5/session saves and worker wire version
remain unchanged. No native Worker/browser/GPU, real material tick/support solve,
M5 replay or benchmark ran. Interactive elemental acceptance, actual material
coupling, native latency, combustion, actor loads and exact structural reuse remain
unfinished. Legacy demos remain quarantined.


## Build 34 — chamber wind and parcel translation continuity

Completed the approved CPU implementation gates on 2026-10-17. Evidence:
[`build-34-2026-10-17/summary.json`](tactical-interventions/build-34-2026-10-17/summary.json).
This does not complete the wishlist or authorize runtime acceptance.

- Added public `followTranslatedMaterialTransport3D`. Original material identities
  follow selected cells and displaced gas through complete bound translation
  paths, including identical-valued swaps and paths that return to their origin.
  Velocity, fractions and transport cycle stay attached to the original matter.
- Chamber saves now require `hot-slab-game-3`. Existing steam, water and sand have
  wind pulse/drift controls, range/AP limits, saved controls, worker/UI display,
  A/B preview and exact JSON continuation. Each intervention advances one explicit
  transport cycle. Ordinary environmental ticks only follow material provenance.
- Actor/terrain response and game costs remain one transaction. A trapped-unit
  regression rejects moving sand without publishing terrain, units or resources.
  The chamber uses public package imports; old save rules reject explicitly.
- Final selected suite: **937 tests across 35 files**, including 30 new
  translation/wind/UI cases. Full typecheck, lint, all twelve SDK bundles,
  browser bundles and zero-material-tick generated-package integration passed.
  Final receipts: `attempt-04`, `typecheck-02`, `lint-01`, `sdk-01`,
  `public-entry-01`. Earlier failed and superseded receipts remain retained.
- Early mock tests incorrectly assumed restoration could immediately follow
  cancellation, then waited on a nonexistent client status. They now wait on the
  UI's actual `canRestore` boundary. Mock DOM coverage exercises wind dispatch.
  The prebuild typecheck now resolves the current tactical-session public source
  entry, removing its dependency on stale generated declarations. The generated
  public-package check remains a separate required gate.
- Every workload used the unchanged 6% CPU/4 GiB Job, independent watchdog,
  deadlines and fresh ten-sample quiet gate. Cleanup was confirmed for every
  attempt. All **96 protected hashes** and the runtime hold remain unchanged.
  Only the tactical-session bundle and two related declaration files changed in
  the SDK; all other SDK artifacts, including the renderer, stayed identical.

There are **47 authored physical cases in 13 separately held files**; none ran.
One new case covers wind continuation after an odd physical tick and restart.
Actual M5 material evolution, structural solves, material replay, native browser
and Worker execution, GPU checks, visual acceptance and benchmarks remain held.
Legacy demos remain quarantined. Combustion/fuel/smoke/material extensibility,
external actor loads, structural dependency reuse and full elemental gameplay
remain unfinished.

## Build 35 — exact terrain-driven actor peer contacts

Completed the approved CPU implementation gates on 2026-10-17. Evidence:
[`build-35-2026-10-17/summary.json`](tactical-interventions/build-35-2026-10-17/summary.json).
The full wishlist and actual physical/native acceptance remain incomplete.

The source review found that the v1 body-group helper intentionally resolves
actors independently. Endpoint checks in the application could reject final
intersections but could not detect an actor passing through a peer and ending
elsewhere. The new `terrain-actor-group-1` contract addresses that missing contact
information while preserving the v1 helper and individual displacement behavior.

- Added `createTerrainActorGroup3D` and `createTranslatedActorGroup3D`. The common
  solver records private, piecewise trajectories through the actual observed
  passes, including stationary portions, delayed pushes, stops and turns.
- Pair checks use simultaneous swept volumes and exact rational comparisons with
  BigInt cross-products. Contacts are ordered by pass, time and ASCII actor IDs.
  Initial overlap is explicit; tangential or endpoint-only touching is permitted.
- Terrain response and peer detection share the existing bounded work allowance.
  A peer conflict returns all original bodies and its earliest proven contact.
  Exhaustion returns incomplete without a successful prefix or partial contact.
  These are contact/rejection semantics, not actor pushing, momentum exchange,
  articulated dynamics, damage or knockdown.
- The chamber adopts the new checks under `hot-slab-game-4`. Conflicting terrain
  motion cannot publish actor state, AP, terrain or saved parcel controls. Old
  chamber saves reject instead of silently acquiring different game behavior.
- **961 tests across 36 files passed**, including 24 new contact/integration cases.
  Full types, lint, twelve SDK bundles, browser compilation and the generated
  public entry passed. Final receipts are `attempt-02`, `typecheck-02`, `lint-01`,
  `sdk-01`, and `public-entry-01`. The initial typecheck identified two test-only
  union assertions; both were fixed and the source-bound suite rerun. Earlier
  receipts are retained with confirmed cleanup.
- The public-package check detects a transient platform crossing with clear final
  boxes. It executes zero material ticks and uses no native browser, worker or GPU.
  Existing chamber wind, air assistance, lifting and save continuation checks pass.
- All **96 protected hashes** remain unchanged. Only the tactical-session bundle,
  its declaration and the internal displacement declaration changed among prior
  SDK artifacts; the actor-group declaration is new. Other SDK artifacts remain
  identical. Every workload retained the 6% CPU/4 GiB Job, watchdog, deadlines and
  fresh quiet-window gate. Cleanup was confirmed after every attempt.

There are now **48 authored physical cases across 13 held files**, including a
new peer-aware falling/restart case; none executed. Actual M5 trajectories and
structural solves, physical replay, native rendering/Worker execution, GPU checks
and benchmarks remain held. Legacy demos remain quarantined. Combustion, material
extensibility, external actor loads, exact structural reuse and full elemental
gameplay still require further implementation and acceptance.

## Build 36 — extensible reactive material data

Completed the approved CPU implementation gates on 2026-10-17. Evidence:
[`build-36-2026-10-17/summary.json`](tactical-interventions/build-36-2026-10-17/summary.json).
The success criteria at the top of this checkpoint preceded implementation.
This is the validated data foundation for combustion and custom materials;
reactive simulation and full wishlist acceptance remain incomplete.

- Added the `state-space-engine/experimental/3d/reactive-materials` public entry.
  Its immutable `reactive-materials-1` registry includes 17 physical builtins,
  including wood, oil, fire, smoke and ash, plus validated custom additions.
  The profile has a domain-separated SHA-256 identity, active transition/product
  closure and the existing exact phase/fuel validation. Inputs are owned before
  asynchronous hashing; returned records, definitions and tables cannot mutate
  the validated registry. Old catalogs do not silently become reactive profiles.
- Added `reactive-material-block-1`: portable packed material/thermal/phase,
  conserved energy and structural coordinates for bounded rectangular volumes.
  Validation rejects incompatible identities, thermal/fuel inconsistencies,
  reserved bits, unsupported materials and invalid reciprocal bonds. It does
  not repair malformed state or infer a physical tick.
- Atomic placement, energy, integrity, anchor and explicit bond edits return an
  isolated block and exact external-energy/change receipt. Fresh placement clears
  old connections, including neighbor bits; joining remains explicit. Damage and
  anchors survive energy edits. Thermal subtraction cannot consume chemical fuel.
  Failed edits leave every input coordinate untouched. JSON continuation retains
  complete material history and custom catalog identity.
- **1,016 tests across 38 files passed**, including **55 new material-data cases**.
  Full type checking, lint, all thirteen SDK bundles/declarations, browser bundle
  compilation and zero-material-tick public SDK integration passed. Final receipts:
  `attempt-03`, `typecheck-03`, `lint-02`, `sdk-02`, `public-entry-02`.
- Review tightened optional thermal input validation. The first typecheck caught
  two read-only mutation-test typings and a narrow phase-list type; these were
  corrected. An artifact comparison then detected TypeScript redirecting an old
  declaration's import through the new entry. Removing the redundant type
  re-export restored exact prior artifacts; all gates were rerun after this fix.
  Failed and superseded receipts remain retained, with cleanup confirmed.
- All **96 protected source/configuration hashes**, all **101 prior SDK artifacts**
  and all **5 browser artifacts** are unchanged. Only the new reactive JavaScript
  bundle and its two declarations were added. Every workload retained the 6% CPU /
  4 GiB Job, independent watchdog, 30-second checks / 60-second SDK deadline and
  fresh ten-sample quiet gate. The global runtime hold remains byte-identical.

The new entry intentionally has no evolution, world, support, movement or rendering
API. Construction/edits are not evidence of combustion, freezing, burning smoke
transport or world integration. The **48 physical cases in 13 held files** remain
unexecuted. Real material stepping, physical replay, native Worker/browser/GPU and
benchmarks remain held; legacy demos remain quarantined. Reactive rules and world
integration, external actor loads, structural dependency reuse and full elemental
gameplay still need implementation and acceptance.

## Build 37 — exact local reactive cycles

Completed the bounded CPU gates on 2026-10-17. Evidence:
[`build-37-2026-10-17/summary.json`](tactical-interventions/build-37-2026-10-17/summary.json).
The success criteria above were recorded before implementation. This build makes
the new material definitions drive actual local reactions; integrated world and
full wishlist acceptance remain incomplete.

- Added `reactive-reactions-1` through the existing reactive-materials public
  entry. Portable state carries an absolute cycle and validated catalog-bound
  block. The eight immutable-input passes perform six exact integer heat exchanges,
  one phase transition pass, and simultaneous combustion/fire extinction.
- Hot fuel and adjacent oxidizer use mutual coordinate/cycle-dependent selection
  over all six neighbors. One oxidizer cannot burn two fuels. Catalog products
  convert chemical energy without changing total energy; saturated storage clips
  transfer instead of discarding energy. Existing fire cools/extinguishes into
  smoke under the documented conditions. Newly produced fire survives its first
  pass. Custom fuels use the same rules.
- Phase/reaction changes clear invalid reciprocal bonds, including surviving
  neighbors. Unchanged cells retain damage and anchors; solid-to-solid phase
  changes retain structural history. New solids have fresh integrity and no
  implicit joins. The kernel does not move material or solve structural support.
- `createReactiveReactionJob3D` owns its candidate, advances one bounded pass at a
  time, supports cancellation between passes and publishes only a validated
  complete result. Results and reports are isolated. `advanceReactiveReactions3D`
  is the synchronous one-cycle convenience API. Reports include actual changed
  cells, phase/extinction events, reacting pairs and exact energy totals.
- **1,060 tests across 40 files passed**, including **44 new local kernel/job
  cases**. The new fixtures use at most **125 cells** and **eight cycles per
  trajectory**. They cover hand-calculated X/Y/Z heat and parity results, chemical
  conversion, saturation, latent thresholds, phase changes, all six reaction
  directions, odd-cycle restart, malformed saves and cancellation at every
  incomplete boundary. M5 stepping and global support functions were trapped.
- Full type checking, lint, thirteen SDK bundles/declarations, browser bundle
  compilation and generated-package integration passed. Final receipts are
  `attempt-01`, `typecheck-01`, `lint-01`, `sdk-01`, `public-entry-01`. The public
  check runs two equivalent complete local cycles on a three-cell custom-fuel
  fixture, plus one cancelled first pass. It advances zero M5 world ticks.
- The block implementation moved into a private module so data and reaction jobs
  share one validated-registry identity in the public bundle without circular
  imports. Existing block/catalog rules and save schemas are unchanged.
  Only the reactive bundle and public reactive declaration changed among prior
  SDK artifacts; **102 prior SDK artifacts** and all **5 browser artifacts** remain
  identical. Two new internal declarations describe blocks and reactions.
- All **96 protected source/configuration hashes** and the runtime hold remain
  unchanged. Every workload retained the 6% CPU / 4 GiB Job, independent watchdog,
  deadlines, fresh quiet gate and confirmed cleanup. No benchmark or native
  browser/Worker/GPU workload ran. Legacy demos remain quarantined.

The new local reaction units are executed evidence, not inert stand-ins. Their
scope does not include reactive material movement, smoke transport, pressure,
global support, actor/world coupling or integrated gameplay replay. The **48 M5
physical cases in 13 held files** remain unexecuted. Reactive world integration,
external actor loads, structural dependency reuse, native interaction and measured
latency remain outstanding, so the full wishlist stays active.

## Build 50 — reactive material control and continuity: success criteria

Recorded before implementation. Wishlist targets: history-preserving water/air
control and exact saved previews. This increment delivers the transport planner
and material-memory adapters; atomic ability-command staging follows separately.

1. Share the existing material transport arithmetic without changing its versioned
   lexical parcel / X-Z-Y schedule: Q1024, speed at most two cells per axis,
   256 parcels and 1,536 swaps. Reactive custom gases, liquids, powders and failed
   cohesive debris use their own catalog. Intact, anchored, bonded, held and
   noncohesive solid material cannot be selected or displaced. Targets must be
   unbound gas. All three material coordinates travel together; no tick, energy,
   fuel, damage, bonds or temporary constraint lifetime is invented.
2. Validate and own complete portable control states and compact memories. Bind
   memory to world, domain, dimensions, catalog, physical component rules and
   absolute tick; witness all three selected-cell coordinates. Reject malformed,
   stale, incompatible and aliasing input atomically. Self-contained saves are
   application-owned state, not evidence that a command was executed.
3. Follow only complete, privately bound executed reactive tick/translation paths,
   including displaced and value-identical gas. Preserve cycle, velocity and
   fractional remainder; update witnesses after thermal/reaction changes. Retire
   parcels that become air or immobile. Reject foreign/cross-domain observations,
   disabled capture and overflow without accepting partial continuity.
4. Prove hand-computed all-axis motion, collision, fractional accumulation, custom
   materials, chemical/thermal energy preservation, hold rejection, invalid-input
   isolation and JSON continuation. Tiny real reactive trajectories remain at most
   125 cells/eight ticks/eight translation steps. Protect old M5 runtime entrypoints.
5. Run new tests and the previous 1,530 selected tests sequentially through the
   unchanged safe harness, then full types, lint, SDK compilation and tiny public
   integration. Retain failures and source/artifact hashes. Runtime hold and all
   96 protected files stay unchanged; native/GPU checks, M5 physical replay and
   benchmarks remain blocked, and legacy demos remain quarantined.

The planner does not publish a world, charge action points, resolve actors or
enforce ability range. Do not commit its snapshot through restore as an ability:
that would bypass the transaction and observation boundary. Live atomic transport
commands, force fields/pressure, external actor loads and performance acceptance
remain outstanding.

### Build 50 completed CPU gates: transport candidates and executed continuity

Completed on 2026-10-17. Evidence:
[`build-50-2026-10-17/summary.json`](tactical-interventions/build-50-2026-10-17/summary.json).
The criteria above preceded implementation. Full wishlist acceptance remains open.

- Added `reactive-transport-1` and compact `reactive-transport-memory-1` through
  the existing reactive-materials public entry. Candidate motion shares the old
  transport arithmetic, with unchanged ordering, limits and blocking behavior.
  Reactive eligibility adds custom-catalog cohesion and temporary-hold protection.
  No material evolution, structural rule, existing save schema or clock changed.
- Candidates preserve complete material tuples, chemical/sensible energy and
  unrelated hold lifetimes. Strict portable reads own their inputs; complete
  validation precedes motion. Compact memory binds world/game/domain identity,
  catalog, dimensions, physical component rules and tick, plus selected-cell
  witnesses. It is saved application state, not proof of a committed intervention.
- The continuity adapter follows privately bound completed tick and translation
  paths, including displaced and value-identical gas. It preserves control cycle,
  velocity and fractions, updates thermal/material witnesses, and retires newly
  immobile matter. Foreign, disabled or overflowed observations reject. A reducer
  rejection rolls back earlier commands in the existing session transaction.
- **1,570 tests across 54 files passed**, including **40 new cases**, in thirteen
  sequential contained jobs. Tests exercise all axes/signs, serial parcel order,
  closed/odd/singleton dimensions, fractional motion, custom fuels/gases/debris,
  chemical conservation, holds, malformed input, phase retirement, private
  observation binding and odd-tick saved control continuation. Old M5 physical
  entrypoints remained trapped; new physical fixtures stayed at most 125 cells.
- Full types, lint, all thirteen SDK bundles/declarations, browser compilation
  and public-package integration passed. The new public fixture uses three cells,
  three candidate cycles, and translation/tick continuation with saved control.
  It does not execute an atomic transport ability or a native browser/GPU workload.
- The first two focused attempts stopped during custom-catalog fixture setup:
  zero-cohesion stone retained softening, then copied materials retained reverse
  phase links to builtin identities. The fixtures now disable those inapplicable
  properties. Both failures and cleanup receipts are retained. Focused attempt 03
  passed; attempts 04–15 cover the prior suites. Final non-test receipts are
  `typecheck-02`, `lint-01`, `sdk-01`, and `public-entry-01`; the earlier passing
  type check is retained as superseded evidence.
- All **96 protected files** and the runtime hold remain unchanged. **130 prior
  SDK artifacts** remain byte-identical; the reactive/tactical JavaScript bundles
  and reactive entry declaration changed, with three new declarations. Browser
  app/worker bundles and their input manifest changed; HTML/CSS stayed identical.
  All launches kept the 6% CPU / 4 GiB Job, independent watchdog, deadlines,
  ten-sample quiet gate, stop-on-failure policy and confirmed descendant cleanup.

Atomic transport-command staging, actor reconciliation during transport, force
fields, external actor loads and native responsiveness remain further work.
The 48 held M5 physical cases, native Worker/browser/GPU checks and large-world
replay/benchmarks were not run. Legacy demos remain quarantined.

## Build 51 — atomic reactive transport commands: success criteria

Recorded before implementation. Wishlist targets: material control with physical
history, revision-bound previews, dependable actor contacts and bounded execution.

1. Add a transport command to reactive sessions. A pure synchronous application
   selector reads the named control's memory from the current staged game at
   execution time, including preceding commands. Validate it against that exact
   domain boundary. The existing pure command reducer receives the resulting
   control memory and receipt and decides game costs/actor state. A selector and
   reducer are required; terrain and returned game publish at one command boundary.
2. Execute through a cancellable transport job using the same shared arithmetic
   as the existing planner: at most one parcel/six swaps per advance, then complete
   validation/publication. Preparation, snapshot copies and final validation are
   still bounded full-volume work, not a wall-clock guarantee. Results must equal
   the planner exactly. No physical tick, hidden impulse, thermal charge, healing,
   implicit bonds or hold expiry may be introduced.
3. Preserve the old command/tick boundary during partial execution. Cancellation,
   stale branches, malformed memory/impulses, late actor conflicts, invalid returned
   game, async callbacks and swallowed reentry must roll back the entire branch,
   including earlier AP, thermal and material commands. Preserve ledger history.
4. Capture only actual completed command paths with private boundary provenance.
   Selected parcels move linearly; displaced gas relocates. Original identity
   must survive serial swaps and identical values. Bound capture; overflow clears
   observations, never changes physics. Actor reconciliation uses the existing
   exact contact/peer kernels and only the currently moving parcel can carry an
   actor. Stationary support vetoes carry. Missing capture or response budgets
   cannot produce an accepted partial actor result.
5. Support saved control through chained transport, ordinary ticks and unrelated
   controllers displaced by another command. The commanded control uses the new
   cycle/velocity/fractions from its receipt; other controllers follow movement
   without an extra impulse or cycle. Preview/commit and JSON restart must agree
   in every material, game and accounting coordinate.
6. Establish tiny CPU evidence (at most 125 cells/eight ticks/eight executed swaps
   per new scenario), then rerun the prior 1,570 tests in sequential bounded jobs,
   full types, lint, SDK and public integration. Keep caps, watchdog, source-bound
   authorizations and stop-on-first-failure behavior. All 96 protected files and
   runtime hold remain unchanged; native/GPU replay and benchmarks remain blocked,
   and legacy demos remain quarantined.

Application policy owns range, allowed materials, costs, controller acquisition
and actor damage/removal decisions. This command adds conservative explicit
transport, not a pressure/wind field, kinetic energy model or external actor loads.
Full native interaction, responsive scheduling and performance acceptance remain
outstanding parts of the wishlist.

### Build 51 completed CPU gates: atomic transport abilities and actor contacts

Completed on 2026-10-17. Evidence:
[`build-51-2026-10-17/summary.json`](tactical-interventions/build-51-2026-10-17/summary.json).
The criteria above preceded implementation. Full wishlist acceptance remains open.

- Added named transport commands to reactive sessions. The application selects
  control memory from the current staged game, so chained commands consume their
  predecessor's updated control state. Complete terrain, control memory, actor
  response and application costs publish together after the command reducer
  accepts. A later failure discards the entire branch, including earlier edits
  and charges; commit does not resimulate the preview.
- The planner now also exposes a cancellable job. Each advance processes one
  parcel and at most six conservative swaps, followed by a separate complete
  validation/publication call. It uses the existing fixed-point arithmetic and
  preserves all material coordinates, energy, damage and constraint lifetimes.
  Transport advances its control cycle without advancing the physical clock.
- Added privately bound executed transport paths and actor/group adapters. Capture
  follows original matter through serial swaps, including identical-valued gas.
  Only the parcel moving in the current pass can carry an actor; stationary
  support vetoes carry. Exact contacts and peer conflicts use the shared solver.
  Disabled/overflowed capture or exhausted response budgets cannot accept a
  partial actor result. Other controllers can follow these paths without another
  impulse or control cycle.
- **1,611 tests across 55 files passed**, including **41 new cases**, in fourteen
  sequential contained jobs. Cases cover bounded progress, cancellation, stale
  branches, selector/reducer isolation and reentry, late rollback, accounting,
  all-axis movement/carry, collision budgets, peer conflicts, retained historical
  observations and exact JSON continuation. New executed fixtures stay within
  125 cells, eight ticks and eight swaps. Existing M5 runtime entrypoints stayed
  trapped; the 48 held physical cases were excluded.
- Full types, lint, all thirteen SDK bundles/declarations, browser compilation
  and public-package integration passed. The new public eight-cell ability fixture
  performs two transport commands with exact save/restart continuation across
  three total executed ticks, and rejects a separate peer-contact candidate
  without changing its committed save. The public job also verifies partial
  result rejection and cancellation. No native browser or Worker was launched.
- Focused attempt 01 stopped on a test expectation: pure platform carry does not
  consume a collision-event slot. The corrected test checks carry/work budgets
  separately and adds an actual swept collision with zero event budget. Attempt
  02 passed; attempts 03–15 cover the previous suites. The failed receipt and
  cleanup remain recorded. Final non-test receipts are `typecheck-02`, `lint-01`,
  `sdk-01` and `public-entry-01`; the earlier passing type check is superseded.
- All **96 protected files** and the runtime hold remain unchanged. **127 prior
  SDK artifacts** remain byte-identical; two JavaScript bundles and seven existing
  declarations changed, with three new internal declarations. The translation
  adapter retains its public signature while sharing the controlled-contact
  implementation. Only the browser worker bundle and input manifest changed;
  app JavaScript, HTML and CSS remain identical. The recorder's anticipated
  artifact sets were corrected after inspecting these actual outputs.
- All twenty quiet-window gates passed; the highest sampled launch CPU usage was
  **35.45%**, below the 50% launch limit. Every workload retained the **6% CPU /
  4 GiB Job**, independent watchdog, deadlines and confirmed descendant cleanup.
  SDK compilation took 24.432 seconds within its 60-second deadline. These are
  contained verification timings, not gameplay latency measurements.

Whole-domain staging, snapshot copying and final validation still cost O(volume).
Force fields, external actor loads, exact structural dependency reuse, responsive
native integration and measured latency remain outstanding. M5 physical runtime,
native Worker/browser/GPU checks and large-world replay/benchmarks remain held.
Legacy demos remain quarantined.

## Build 52 — responsive reactive worker boundary: success criteria

Recorded before implementation. Wishlist targets: responsive previews, exact
application transactions and a supported asynchronous integration boundary.

1. Add a separately versioned reactive worker protocol through the public SDK.
   The host owns its session and application policies; messages carry data only.
   Handshake binds the world, application rules and custom catalog. No M5 protocol,
   physical rules or save schema changes. Retain exact direct-session behavior.
2. Permit only one outstanding request, one active preview and one waiting latest
   intent. Advance one existing bounded session slice per request, yielding a
   browser task between slices. Superseding/cancelling waits for the current reply,
   discards the old branch, then starts the latest intent. No physical tick is
   skipped and no partially computed state is exposed as committed.
3. Return compact progress while computing and a complete validated candidate only
   when ready. Commit only the latest privately identified, same-revision ticket;
   require the acknowledged state to equal that preview except for revision.
   Restore must match the supplied save exactly except for the new local revision.
   Preserve the last acknowledged save on timeout, transport or malformed replies.
   Lost commit/restore acknowledgements are uncertain outcomes, never retried.
4. Strict framing, monotonically ordered messages, immutable caller inputs,
   bounded commands, slice budgets and per-request deadlines must fail closed.
   Close/cancel releases the branch and pending work; duplicate/wrong-channel
   replies or send failures cannot publish state. Policies and private movement
   capabilities stay inside the host, where actor/cost reconciliation occurs.
5. Use mock ports and controllable task scheduling to prove backpressure,
   coalescing, cancellation during in-flight work and at ready boundaries,
   malformed/error handling, shutdown, exact direct-session equivalence and JSON
   continuation. Execute tiny reactive fixtures only (at most 125 cells/eight
   physical ticks per trajectory), with legacy runtime entrypoints trapped.
6. Run new focused tests, relevant prior regressions, full types, lint, SDK build
   and public-package integration through unchanged bounded CPU runners. Retain
   failures and source/artifact evidence. The 96 protected hashes, runtime hold
   and legacy quarantine remain intact. Native Worker/browser/GPU execution and
   performance acceptance remain held; mock scheduling proves the protocol, not
   actual browser latency. Whole-domain cloning/validation remains O(volume).

### Build 52 completed CPU gates: reactive worker previews

Completed on 2026-10-17. Evidence:
[`build-52-2026-10-17/summary.json`](tactical-interventions/build-52-2026-10-17/summary.json).
The criteria above preceded implementation. Full wishlist acceptance remains open.

- Added the separate `reactive-worker-1` host/client protocol through the existing
  reactive-materials entry. The host owns its session, custom registry and pure
  policies. Actor reconciliation, material-control memory and application costs
  remain inside that authority. No physical rules, save schemas or M5 protocol
  changed; callbacks and private movement capabilities are not serialized.
- The client permits one outstanding message, one active preview and one waiting
  latest intent. Each advance request executes one existing bounded session slice;
  another task is scheduled only after the reply. New intents coalesce locally,
  wait for the current safe boundary and discard the previous branch. Capture,
  progress, cancellation and slice-size choices do not alter physical results.
- Intermediate replies carry copied progress only. A ready candidate contains a
  complete validated state and revision/branch identity. Commit requires the
  original latest ticket and an acknowledgement equal to that candidate except
  for revision. Restore similarly checks the exact requested save. An explicit
  policy rejection is atomic and leaves the connection usable. Lost or malformed
  mutation replies retain the last acknowledged save, mark the outcome uncertain,
  close the endpoint and never trigger an automatic retry.
- **1,655 tests across 56 files passed**, including **44 worker cases**, in fifteen
  sequential contained jobs. New tests exercise real ten-cell reactive scenarios
  through mock ports: transport/actor policy, exact direct-session and JSON
  continuation, task yields, different slice sizes, latest-intent coalescing,
  in-flight/ready cancellation, deadlines, budgets, malformed progress/state,
  copied tickets, policy rejection and close during an unacknowledged commit.
  Native Worker/GPU execution and old M5 physical entrypoints remained excluded.
- Full types, lint, thirteen SDK bundles/declarations, browser compilation and
  public-package integration passed. The public worker fixture uses eight cells
  and three total executed ticks, including repeated save continuation. It verifies
  direct-session equality, supersession and a maximum of one outstanding message
  with structured-clone mock endpoints and real Node task yields. This is not a
  native Worker or UI performance measurement.
- The first type check identified missing generic context on the frozen client
  object and a nullable test error message; both were corrected. The initial
  37-case worker suite passed, then seven additional cases covered mutation
  rejection/shutdown, progress regression and slice independence. Their first
  launch was blocked by **60.35% host CPU**, above the 50% quiet-window limit;
  no workload was authorized or started. After documentation/evidence work, a
  fresh quiet gate passed and all 44 cases passed in `attempt-03`. Earlier results,
  the failed preflight and their original authorizations remain preserved.
- Prior suites passed in `attempt-04` through `attempt-17`; final non-test receipts
  are `typecheck-03`, `lint-01`, `sdk-01` and `public-entry-01`. Twenty-two of twenty-three
  preflight gates passed; the highest passing launch sample was **24.90% CPU**.
  Every launched job retained the **6% CPU / 4 GiB Job**, independent watchdog,
  deadlines and verified descendant cleanup. SDK compilation took **25.707 seconds**
  and public integration **3.567 seconds**, within their 60/30-second deadlines.
- All **96 protected files** and the runtime hold remain unchanged. **137 prior
  SDK artifacts** and all **5 browser artifacts** are byte-identical. Only the
  reactive bundle and its entry declaration changed, with three new worker
  declarations. No native browser, Worker, GPU or benchmark was launched.

The protocol bounds queued work and provides cancellation points; preparation,
validation and complete-state transfer still cost O(volume). Compact remote
queries/change reports, native rendering integration, force fields, external actor
loads, structural dependency reuse and measured responsiveness remain outstanding.
The 48 M5 physical cases, native Worker/browser/GPU checks and large-world replay /
benchmarks remain held. Legacy demos remain quarantined.

## Build 53 — reactive worker geometry and physical change reports: success criteria

Recorded before implementation. Wishlist targets: gameplay geometry, reliable
physical change reach and responsive inspection of previews and committed states.

1. Add catalog-aware batches for fit, support, rays, swept bodies and exposure,
   bound to an exact committed revision or latest ready preview. Validate request
   budgets and result identities; transfer compact answers, not another full world.
   Execute at most one existing bounded geometry query per worker inspection slice.
2. Add a resumable endpoint comparison of material/phase, packed state, conserved
   energy, physical temperature, structural words and temporary constraints.
   Assess support globally at both endpoints with the existing reactive solver;
   discard its proposed state. Report changed distance/load/capacity/reaction cells
   anywhere in the domain, including remote effects of a local support cut.
3. Use one shared run budget across report channels. Overflow retains exact counts
   and full bounds, clears incomplete runs and explicitly requires a broader read.
   Do not infer fragment identity or transient motion from endpoint differences.
   Reports own isolated data and do not modify state, accounting or physical clocks.
4. Extend the separately versioned reactive worker protocol with bounded inspection
   start/advance/cancel operations. Keep one message in flight, task yields and
   latest-intent coalescing. Superseding, cancelling or closing must retire pending
   inspection at a safe boundary; stale results cannot be accepted. Queries and
   reports must not consume or invalidate an otherwise valid ready preview.
5. Only the latest original acknowledged commit or ready ticket may request its
   worker report. Validate stamps, domains, canonical ranges, budgets and observed
   cells. Retain exact preview/commit comparison and saved continuation. Test direct
   versus worker answers, remote bridge effects, custom material temperatures,
   reservoirs, holds, overflow, malformed responses and cancellation, using tiny
   executed CPU fixtures (at most 125 cells/eight ticks per trajectory).
6. Run new focused tests and prior selected regressions, full types, lint, SDK and
   public-package integration with unchanged safe CPU runners. Preserve failed
   attempts and source-bound evidence. All 96 protected files, runtime hold and
   legacy quarantine stay intact. No native Worker/browser/GPU, old M5 runtime,
   large-world replay or performance claims. Full snapshot preparation/validation
   still costs O(volume); this build bounds observation work and transfer size.

### Build 53 completed CPU gates — 2026-10-18

The authorized CPU gates are now complete. Evidence:
[`build-53-2026-10-17/summary.json`](tactical-interventions/build-53-2026-10-17/summary.json).
The folder retains the original build date; final verification completed on
2026-10-18 Pacific. The progress entries below are historical records.

- **1,695 tests passed across 57 files**, with no failures, skips or todos in the
  final accepted runs. This includes the 40 new observation cases and all 1,655
  previously selected regressions, divided into 16 sequential bounded jobs.
- Full tactical type checking, lint, the SDK build and public-package integration
  passed. All 20 final stages used the unchanged 6% CPU / 4 GiB Job, independent
  watchdog, fresh ten-sample quiet gate and source-bound authorization. Cleanup
  verified no surviving workload process or named Job after each launch.
- Public-package assertions exercise committed and ready-preview geometry,
  endpoint reports, exact direct/mock-worker comparison, original commit handles
  and continued transport transactions. The SDK build took 25.813 seconds under
  its 60-second bound; package integration took 4.046 seconds under its 30-second
  bound. These are verification timings, not gameplay performance measurements.
- The versioned `reactive-worker-2` protocol exposes inspection start/advance/
  cancel with one outstanding message and task yields. Reports assess support
  throughout the domain, including remote bridge effects and temporary holds,
  and preserve exact full counts/bounds when the shared range budget overflows.
- All **96 protected source/configuration files** and the runtime hold remain
  byte-identical. There are 305 checked source hashes and 146 SDK artifacts.
  Five existing SDK artifacts changed and four declarations were added. The
  existing tactical client app/worker bundles and their input manifest were
  regenerated by the public integration check because the geometry-reply
  validator is now shared. Browser execution was not performed.

The earlier widened-literal type error and its fix remain recorded. Four failed
quiet gates launched nothing: the earlier saturation refusals and one brief
72.36% burst during resumption. The separate Bun sweep attribution, partial
receipts and blocked audit remain immutable. A fresh quiet window allowed the
remaining checks to finish; no unrelated process was controlled by this task.

Acceptance is scoped to CPU kernels, mock transports and compiled public APIs.
Endpoint reports do not identify fragments or transient movement, support still
uses a global assessment, and copying/setup/validation remain O(volume). Native
Worker/browser/GPU, old M5 physical execution, large-world replay and benchmarks
remain held. The full wishlist remains unfinished, including force fields,
external actor loads, structural dependency reuse and native integration.
Legacy demos remain quarantined.

### Build 53 historical progress — focused CPU checks passed; broader gates pending

The `reactive-worker-2` extension and public `reactive-changes-1` diagnostic are
implemented. The 40 focused CPU tests pass, including five geometry query kinds,
custom-catalog exposure, reservoir domains, remote bridge support changes, a real
one-tick collapse, exact direct/mock-worker agreement, holds, overflow and
cancellation. Inspection errors preserve a ready preview. Commit/restore and
latest-intent ordering retain one outstanding message and task yields.

The first type check found a widened query-result rules literal; an explicit
return type fixed it. The second full tactical type check passed. Focused tests
ran in a 6% CPU / 4 GiB Windows Job with the independent watchdog, and all three
launched attempts completed cleanup. No GPU, native Worker, legacy demo, old M5
physical case, large-world replay or benchmark was launched.

Broader verification is **pending**, not accepted. Two subsequent quiet-window
preflights stopped before authorizing a workload: host CPU measured 67.06%, then
100%, above the unchanged 50% launch ceiling. No retries follow the second failed
preflight in this attempt. Existing regression suites, final type check, lint,
SDK build and public-package integration still require a quiet window. Public
integration assertions have been added but have not run against a rebuilt SDK.

Evidence: [`build-53-2026-10-17/progress-01.json`](tactical-interventions/build-53-2026-10-17/progress-01.json).
This is a partial record, not a delivery acceptance or performance result. The
prior 1,655-test Build 52 receipt remains historical evidence; it does not prove
the current changes pass those regressions. All 96 protected files, safety hold
and quarantine remain unchanged. Endpoint reports deliberately exclude fragment
identity and transient paths; support still requires a global assessment. Native
integration, performance, force fields, external loads and dependency-aware
structural reuse remain further work.

### Build 53 continuation — saturation attributed; no new workload launched

A third broader-regression preflight (`attempt-04`) refused launch at 99.90%
host CPU. A 45-second read-only capture identified a separate Claude-launched
`bun gpu/season-sweep.ts gangsters full 100 30 52 16 3000` process (PID 43536),
averaging 85.78% of total machine CPU; the host averaged 98.93%. The collector
averaged 0.18%. No unrelated process was modified. This is current-load evidence,
not a diagnosis of earlier freezes. Details and raw samples are in
[`cpu-attribution-01/findings.md`](tactical-interventions/build-53-2026-10-17/cpu-attribution-01/findings.md).

Static review confirmed the current implementation retains private geometry
capabilities, global support assessment, the shared report budget, ready-preview
preservation on read errors, and one-message ordering. No additional source fix
was identified in this review. The source hashes covered by the 40 focused tests
and passing type check still match. The prior partial receipt remains immutable;
the continuation is recorded in
[`progress-02.json`](tactical-interventions/build-53-2026-10-17/progress-02.json).
Broader regressions, lint, SDK/public integration and final acceptance remain
pending. No native Worker/GPU/old M5 execution, large-world replay, benchmark or
legacy demo was launched.

## Build 38 — conservative reactive movement and complete evolution

Completed the bounded CPU gates on 2026-10-17. Evidence:
[`build-38-2026-10-17/summary.json`](tactical-interventions/build-38-2026-10-17/summary.json).
The success criteria above preceded implementation. This build connects material
motion with thermal reactions; the full structural/gameplay integration remains
an explicit outstanding requirement.

- Added `reactive-movement-1`: twenty disjoint-pair passes for gravity, rotated
  diagonal descent, blocked liquid spreading, buoyancy and blocked gas spreading.
  Catalog density and exact temperature ranking govern exchanges. All three
  coordinates move together. No movement pass creates matter or external energy.
- Intact, damaged and anchored solid regions remain mechanically owned. Fully
  failed unanchored cohesive cells may fall as loose debris. Noncohesive solid or
  frozen phases remain obstacles even when their structure word is zero. The
  movement kernel cannot break an intact region into independent mobile cells.
- Added `reactive-evolution-1` with an absolute tick, strict portable state,
  28-stage jobs, one-stage advancement and cancellation at every incomplete
  boundary. The final eight stages reuse the unchanged reaction API. Only a
  complete validated tick can publish; caller mutation cannot affect staged or
  retained results. A synchronous helper advances exactly one bounded tick.
- Motion reports retain executed swap count, final moves by original cell, and
  touched origins and locations. An explicit test displaces an air cell twice
  and returns it unchanged: its movement remains observable even though it has
  no endpoint difference. Reports combine this with net changed cells and exact
  reaction events/energy. They do not claim to provide swept actor paths or
  global structural reach.
- **1,111 tests across 42 files passed**, including **51 new movement/evolution
  cases**. They cover all movement axes and parities, diagonal priority, blocked
  flow, closed/odd/singleton boundaries, gas thresholds, custom density, full-cell
  tuple conservation, structural history, repeated trajectories and odd-tick /
  direction-rotation save continuation. New fixtures stay at most **125 cells**
  and **eight ticks per trajectory**. M5 steps and global support were trapped.
- Full types, lint, thirteen SDK bundles/declarations, browser compilation and
  public-package integration passed. Final receipts: `attempt-01`, `typecheck-01`,
  `lint-01`, `sdk-01`, `public-entry-01`. The public three-cell burning fixture
  produces fire, then moves its heat upward as smoke. Three complete evolution
  executions include the repeated continuation; another job cancels after stage
  21. Earlier reaction-only integration remains passing.
- Only the reactive bundle and its public declaration changed among prior SDK
  artifacts. Two new declarations expose movement/evolution. **104 prior SDK
  artifacts**, all **5 browser artifacts**, all **96 protected source/configuration
  hashes**, and the runtime hold remain unchanged. Every workload retained the
  6% CPU / 4 GiB Job, independent watchdog, deadlines, quiet gate and confirmed
  cleanup. A read-only recorder typo initially expected 4,296 MiB instead of
  4,096 MiB; the assertion was corrected against the unchanged receipts before
  publishing evidence. No workload caps or test results were altered.

The new tiny CPU trajectories execute real movement and reactions. They do not
establish integrated structural collapse, actor coupling or full-world replay.
The **48 M5 physical cases in 13 held files** remain unexecuted. Global support
solves, native browser/Worker/GPU checks and frame benchmarks remain held; legacy
demos remain quarantined. Profile-aware mechanics, application integration,
external actor loads, exact structural reuse and measured latency still require
implementation and acceptance. The full wishlist remains active.
