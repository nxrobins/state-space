# Composed engine evolution

Evolution optimizes an existing, versioned physical law. Candidates replace one
current production kernel and must preserve exact packed cells and energy after
every pass of the composed engine. New physical laws require explicit changes to
the contract, independent reference, scenarios, and compatibility policy.

The evaluator is a development-checkout tool. Install the Python development
environment and root npm dependencies; the independent CPU reference is compiled
from the TypeScript sources in that checkout. The public SDK has no dependency
on the evaluator or an LLM provider. The evaluation context records both the
installed TypeScript compiler version and the compiler file's content hash.

## Local evaluation and bounded search

```powershell
python evolve_ss.py evaluate --target thermal
python evolve_ss.py evaluate --target thermal --candidate candidate.wgsl
python evolve_ss.py search --target thermal --candidate candidate-a.wgsl --candidate candidate-b.wgsl --seed 8173
```

Targets are `codec`, `thermal`, `gravity`, `diagonal`, `liquid`, `buoyancy`,
`spread`, `phase`, and `combustion`. Historical aliases 1a/2a/2b/2c/2d select the
corresponding current target. The old 1b synchronization and 1c spatial experiments
are absent from the ca-v3 production schedule and cannot be promoted. Active-region
dispatch will need its own composed equivalence and measured-work contract.

Evaluation without `--candidate` tests the current production baseline. A search
always evaluates that baseline, then the supplied local files. It has a finite
proposal count and stops if no currently qualified parents remain. Proposals do
not overwrite `locked/` or published packages.

Paid generation requires an explicit command such as:

```powershell
python evolve_ss.py search --target thermal --mutations 5 --model YOUR_MODEL_ID
```

That command uses `ANTHROPIC_API_KEY` from the environment and the explicitly
selected model. Calls have deadlines and no automatic retries. An LLM only proposes
source. The host evaluator computes all scores. Seeds reproduce scenarios and
random choices for fixed parent/archive inputs; LLM responses and timing are not
promised to be reproducible.
Proposal records preserve model/request identity, usage, response, and prompt hash.

## Candidate contract and evidence

Physics candidates contain one `tick` entry with `@workgroup_size(16,16)` and the
target's required override constants. The host owns storage bindings, common
physical helpers, and the complete pass schedule. Output writes use `io_copy` or
`io_write` so both state arrays travel together. Codec candidates contain
`pack_voxel`, `unpack_voxel`, and `exchange_thermal` helpers, without bindings or
entry points. The legacy thermal helper retains its specified bit-operation
behavior; production thermodynamics uses the separate conserved enthalpy law.

The local optimization language excludes barriers and unbounded loops. Literal
bounded `for` loops cannot alter or alias their induction variable in the body.
This limits common runaway proposals; it is not a security sandbox for hostile GPU
code. Evaluation workers have explicit deadlines. Source repairs produce a new
candidate; evaluation never silently changes candidate text.

Required gates include:

- Independent CPU equality of all three arrays after every scheduled pass, with exact
  trace length/order, tiny/odd/non-square grids, cross-workgroup scenes, custom
  material IDs, fractional energy, and all four movement salts.
- Exact energy budgets, phase-specific material-count rules, positive observable
  behavior in every target variant, deterministic repetition, and split/resume
  equivalence. A solver that does nothing cannot qualify through conservation.
- A host-owned codec harness that observes each decoded field, packs independent
  field inputs, and checks the thermal helper. A candidate's own identity harness
  supplies no correctness evidence.
- Complete finite objective values. Missing fields, booleans used as numbers,
  non-finite values, empty evidence, failed compilation, and timeouts fail closed.

`evolution-v2/evidence/` holds content-addressed candidate text, source/context
bundles, complete input/reference scenes, compiled shader hashes, worker logs, and
reports. Reports identify the policy, device/driver/backend, software versions,
catalog and schedule sources, seeds, workload configuration, and timing samples.
Host wall-time provenance also includes CPU identity, logical CPU count, and a
hash identifying the host, so copying an archive to another machine requires
fresh evaluation even when its GPU model is the same.
Changing sources, policy, device, seed, or measurement settings invalidates reuse.
An archive's mutable `fitness` field never authorizes a parent or influences ranking.

## Review and release

```powershell
python evolve_ss.py stage --receipt THE_EVALUATION_RECEIPT
```

Staging loads the immutable candidate and performs a fresh evaluation against the
current engine. It emits a content-addressed review artifact containing exact WGSL,
base hash, patch, new receipt, and context. Apply the reviewed change, regenerate
runtime assets with `python -m engine.generate`, and run `python -m engine.verify`
before releasing it. A staged candidate is not automatically a performance
improvement: inspect distributions and confirm any claimed gain on the intended
devices and workloads.

## Performance measurement

```powershell
python evolve_ss.py benchmark
python -m eval.verify --benchmark
```

Candidate evaluation uses sparse, dense-flow, thermal, and reactive workloads at
32x32 and 65x33. The standalone baseline matrix uses 32x32, 128x128, 257x129, and
512x512. Each repetition starts from the identical seeded full state and absolute
tick. Defaults are two discarded warmups and seven measured four-tick runs.

The report retains samples, median, mean, min/max, p95, and standard deviation.
The measured quantities are host wall times with GPU completion included:

- `syncTickMs`: encoding, submission, and a completion read at each tick boundary.
- `endToEndMs`: the complete native composed call, including input validation,
  buffer allocation, upload, synchronized stepping, and both full-state readbacks.

Shader compilation, catalog construction, scene generation, reference checking,
and evidence serialization are outside these timing intervals. Values are not GPU
timestamp measurements and do not establish browser SDK or cross-device throughput.
The browser SDK's full-readback boundary remains an explicit future optimization
target. Timing comparisons need identical contexts and repeated confirmation;
candidate-written work counters are never an objective.

The native host boundary uses bulk signed-integer projection and accounting,
differential-tested against the scalar thermodynamic reference. Validation still
checks every cell, material identity, energy bound, and packed temperature view;
it does not use a sampling shortcut. Full-state readbacks remain part of the
native/public field contract and of the end-to-end measurement.

The ca-v3 policy adds structural application and bond normalization targets.
Every input, reference pass, final hash, deterministic repetition and restart
includes the persistent structural coordinate. Structure-only changes count as
positive behavior. A completed GPU output rejected by state validation retains
its three raw coordinates and failed tick, so an actual malformed result can be
distinguished from a compilation error. Such a result is never committed.
Benchmark rows report host planning separately, while total/tick timings include
planning and all three transfers. ca-v2 receipts cannot authorize ca-v3 work.
