# Windows CPU collision scope

The Windows freeze/reboot cause remains undetermined. The October 28 investigation
established a separate observer cleanup defect; its original GPU-enabled result
remains failed and unaccepted. See [the investigation](SUPERVISOR_LOSS_ROOT_CAUSE.md).
A CPU workload alone is not evidence that the host failure has been resolved.

## Latest authorized retry

The offset-cache timing investigation completed review
`9f411a5c1e714d649c5c5decb22dd359`: eleven stages, 30 rows, 210 measured trajectories,
3,888 instrumented steps and 108 differential checks. The 8 ms result changes
sign with engine order in the four instrumented cohorts. Both measured long
steps (110.034 and 325.171 ms) have large wall/CPU gaps and at most 0.445 ms GC
overlap. The original uninstrumented 181.190 ms sample remains unattributed.
Engine, TOI, exact replay, safety limits and qualification gates are unchanged.
See [offset timing findings](COLLISION_OFFSET_TIMING.md) and
[checkpoint](checkpoints/COLLISION_OFFSET_TIMING.json).

The per-solve contact-offset cache completed review
`3de856c150ea41ac9de0e8b9601d341e`: all 21 stages, 63 comparison rows, 21 fresh
denominator-cache controls and 108 differential checks. Coverage confirms 474,192
fewer vector subtractions. Exact replay, TOI behavior and physical diagnostics
are preserved. Timing is mixed: resting-stack medians improve at 16/2 ms and
worsen at 8 ms; a 181.190 ms sample remains retained. One prelaunch quiet refusal
was preserved before a fresh quiet observation, with no attempted-stage reuse.
Safety limits, the incident hold and all qualification gates remain unchanged.
See [offset-cache results](COLLISION_OFFSET_CACHE.md) and
[checkpoint](checkpoints/COLLISION_OFFSET_CACHE.json).

The cached contact/solver profile completed review
`cf46c60fbee34dfb8860326a6d27976c`: ten stages, nine sampled profiles, one separate
coverage run and 108 differential checks. Effective response is now 1.5% of
recognized engine samples; solving remains 47.2%. It identified caching
the two contact-to-center offsets within one solve, implemented separately above.
That profiling run left engine, TOI, replay, limits and qualification gates unchanged. See
[cached solver findings](COLLISION_CACHE_SOLVER_PROFILE.md).

The cached-stack outlier investigation completed review
`a8abb21b416f4547a4cd8bee9d9db8ae`: eleven stages, 30 rows, 210 measured
trajectories, 3,888 instrumented steps and 108 differential checks. All nine
measured long steps were dominated by time uncharged as CPU. A cached 2 ms step
took 234.856 ms with zero recorded thread/process CPU and no GC overlap. The
original uninstrumented sample's exact cause remains unproven. Engine, replay,
limits, incident hold and qualification gates are unchanged. See
[cached-stack timing findings](COLLISION_CACHE_TIMING.md).

The normal effective-mass cache completed review
`e3e46c48e46847a19a50477dee6c5f61`: all 21 stages, 63 comparison rows, 21 fresh
pre-cache controls, 108 differential checks and the isolated call-count check.
Exact states, receipts, work and TOI behavior are preserved. Resting-stack medians
improve, while other fixtures are mixed and a retained 2 ms timing tail worsens
that row's mean. Earlier diagnostic-recorder failures remain incomplete; their
lossless recording repair did not change engine code or safety limits. All
qualification gates remain open. See [cache results](COLLISION_NORMAL_CACHE.md)
and [checkpoint](checkpoints/COLLISION_NORMAL_CACHE.json).

The contact/solver profiling follow-up completed review
`1f8f93269a2e435d82004d20ed366e39`: nine stages, nine sampled profiles and a
separate call-count run. Replay, deterministic work, the engine and all safety
limits are unchanged. Contact solving accounts for 53.1% of recognized engine
samples. It identified the per-solve normal-denominator cache implemented above.
See [solver findings and evidence](COLLISION_STACK_SOLVER_PROFILE.md).

The follow-up stack timing investigation completed review
`f563007cdba34c539ff275d33ad28a00`: ten stages, 30 rows, 210 measured trajectories
and 3,888 instrumented steps. It changes no engine or replay code. All safety
limits and qualification gates remain intact. A prior preflight file-access
failure was retained and its abandoned lock was retired only after an exclusive
lease audit confirmed no live owner, Job or attempted workload. See
[timing findings and evidence](COLLISION_STACK_TIMING.md).

The subsequent owned-data optimization completed a fresh, separate review
`b35049763d24429e86685ce0c0c6ba1d`: all 19 stages, 63 comparison rows and 21
baseline controls completed. Exact replay and deterministic work match the
original implementation. The earlier optimization review's host-load abort is
retained as incomplete. Safety limits, incident hold and qualification gates
remain unchanged. See [optimization results](COLLISION_OWNED_OPTIMIZATION.md)
and [checkpoint](checkpoints/COLLISION_OWNED_OPTIMIZATION.json).

## Original completed comparison

The November 8 CPU retry completed under review
`e5929904a7a64fbb9e366695e16fcf24`: all **18 containment/execution stages** and
**63 collision rows** completed, with exact within-backend replay throughout.
The independent supervisor-loss probe emptied its Job in 2.994 seconds with
watchdog reason 1; cancellation emptied its Job in 2.148 seconds. All named Jobs
are absent and no execution lock remains. Hold bytes, bound sources, the original
failed GPU report and the protected worktree were preserved at every stage.

All 21 State Space rows and all 42 MuJoCo discrete/speculative rows are present.
The LEG-WORKER world reference also passed the original budgets, continuation,
both restart formats, cancellation, isolation and token checks. The cohort retains
441 measured timings, 21 comparison cohorts and 42 timestep refinements.
See [the interpreted results](COLLISION_REFERENCE_RESULTS.md) and
[completion checkpoint](checkpoints/COLLISION_REFERENCE_RESULTS.json).

Completion means the diagnostic cohort executed; it does not mean every physical
diagnostic passed. State Space passed all 12 analytical/barrier checks. Each
MuJoCo mode passed six analytical checks and failed six strict barrier checks;
the nine other rows per backend remain observational. Speculative contacts
prevented full wall passage in these fixtures while allowing soft penetration.
No tolerance, sample count or qualification flag was changed.

Transient busy-host readings still occurred during preflight. The controller now
observes for at most 90 seconds to obtain the unchanged **30 consecutive quiet
seconds**; it resets after busy/low-memory samples and fails closed on invalid
telemetry. A refused 90-second window before ss-thin-wall is retained. Its later
launch followed a full accepted quiet window. No failed workload was replaced.
Static validation passed 17 Python tests, including five new quiet-window checks;
Python lint passed. Workload CPU/memory caps and deadlines were unchanged.

The earlier read-only GPU access check found an NVIDIA GeForce RTX 4090, so no
additional access setup was needed. This retry made no GPU query and launched no
browser or GPU workload. All runtime, performance, GPU, Worker and R1 acceptance
flags remain false. The Windows incident hold remains in force.

## Earlier retries retained

CPU packet `0e2e8816b33c477d90ef6b047f71e665` passed all three containment probes,
including independently observed watchdog termination after supervisor loss
(2.998 seconds to an empty Job). It then passed the real LEG-WORKER replay with
both restart formats and all work budgets, and all **21 State Space rigid rows**
completed their exact replay checks. Twelve analytical/barrier diagnostics passed;
the nine rotating-plate, impact-chain and stack rows are observational.

MuJoCo stopped during dependency import: the overly broad audit boundary also
blocked CPython's Windows platform detection. A physics-free reproduction showed
the local hostname read followed by the Windows version command. The fixed
metadata preflight described below preserves the strict dependency audit. Its
static Python suite passes 12 tests. The old failed receipt and source versions
are retained; the incomplete comparison has 21 State Space rows and no MuJoCo rows.

Corrected packet `18d820bc310b4af38651ec54760ec0fd` initially retained three quiet
refusals at 32.12%, 36.83% and 47.17% host CPU, as recorded in the historical
[retry checkpoint](checkpoints/COLLISION_CPU_RETRY.json). In the subsequent retry
it passed all three containment probes, then further quiet refusals prevented
world/physics execution. Its collected comparison remains incomplete with zero
rows. Prior helper versions are retained in
`dist/verification/collision-quiet-review-20261108` before the new preflight was
bound into review `e5929904a7a64fbb9e366695e16fcf24`. Old failures and incomplete
packets remain historical evidence; the successful cohort does not overwrite them.

## Initial result on November 8

The initial path was implemented, but local benchmark execution remained gated. Review
`0a7b9cbec9734fff835cac3ab12652e7` retained two quiet-window refusals (34.71% and
35.78% host CPU), then passed a complete quiet window and normal startup/close.
That Job used 1.094 CPU seconds, peaked at 18.69 MiB, and was confirmed empty and
absent after 2.773 seconds of observer time.

The next stage passed its quiet window, then the observer recorded 90.91%,
93.08% and 98.06% host CPU. It aborted at the existing 85%-for-two-seconds limit,
before the leaf claim or fault-ready marker. The source of that host load is
not established. The stage is **failed**, not a qualified cancellation result.
Independent cleanup confirmed zero active processes, leaf exit 125, watchdog
exit 125 and disappearance of the named Job. The watchdog's heartbeat expiry
occurred after forced cleanup began; it does not qualify supervisor-loss behavior.

No execution lock remains. Hold bytes, the original failed GPU report, bound
sources and the protected worktree are unchanged. No physics, MuJoCo, browser,
GPU telemetry or GPU workload ran. The comparison contains zero rows and is
explicitly incomplete. Supervisor-loss, real world replay and collision stages
remain unattempted; every qualification acceptance flag remains false.

The [checkpoint](checkpoints/COLLISION_CPU_SCOPE.json) binds the raw receipts.
The failed packet cannot advance. Review the host-load abort and establish a
stable execution window before preparing a fresh containment sequence; do not
increase budgets or skip prerequisites to make the run pass.

This scope implements the user's November 8 request to review that hold and
establish a narrow CPU benchmark path. It does not change safety-hold.json,
blockRecovery:true, the generic guard, the watchdog, existing browser scopes, or
the protected CPU performance worktree. It issues no recovery permit. Generic
runtime verification (including ordinary CPU entry points), browser, Worker and
GPU workloads remain held. The old failed report is hashed before and after.

## Fixed launch sequence

1. Inert CPU process: normal startup and close.
2. Inert CPU process: cancellation by exact owned Job termination.
3. Inert CPU process: kill its exact supervisor; independently observe watchdog
   heartbeat expiry, reason 1, watchdog/leaf exit 125 and empty Job within five
   seconds. Forced observer cleanup cannot qualify this result.
4. Production world LEG-WORKER replay: two ticks plus one continuation, complete
   receipts and state, budgets 1/7/256, repeat, lossless and JSON restart,
   cancellation, isolation and stale/foreign commit rejection.
5. Seven paired fixtures, each running State Space then MuJoCo. State Space uses the unchanged three timesteps,
   replay budgets, restart checks, two warmups and seven measured repetitions.
   MuJoCo runs the same fixture with speculative contacts disabled and enabled.
   Full integration state and restart/repeat equality remain required.

Each stage needs every earlier passing receipt from the same immutable review.
An attempted stage cannot be reused. Failure stops dependent work; a fresh packet
does not bypass an unresolved execution lock.

## Containment and its limits

Every stage uses a fresh 30-second quiet window (host CPU at most 30%, at least
8 GiB available RAM), the global OS lease, a 6% aggregate Windows Job CPU hard
cap, 4 GiB Job memory, below-normal workload priority, one-thread numerical
libraries, a 25-second supervisor deadline and a 30-second independent watchdog.
The observer stays outside the owned Job and retains process handles before
resuming the leaf. Job children inherit containment; breakaway is not enabled.
The watchdog terminates the exact named Job after a three-second supervisor
heartbeat gap. Cleanup terminates without relying on enumeration, separately
checks active-process accounting, then closes each handle and verifies Job
disappearance. Cleanup uncertainty retains the execution lock.

The CPU preflight now observes continuously for at most 90 seconds to find that
full quiet window. Every busy or low-memory sample resets the window; missing,
stale or invalid telemetry fails closed. Receipts retain all observations and
separately identify the accepted quiet samples. This avoids repeating dependency
hashing after each transient refusal. The workload is not launched while waiting;
its 25-second supervisor and 30-second watchdog deadlines are unchanged.

Capabilities expire in 60 seconds and bind the one-use claim, live owner, exact
case/command, Job identity, hold, source files, engine bundle, Python/Node binaries
and isolated dependency files. A job environment variable is insufficient.
The Python leaf and Node attestation helper verify actual Windows Job membership.
There is no user-supplied workload command, executable, mode, or budget argument.

Before MuJoCo dependency loading, a fixed CPython Windows platform query runs
inside the owned Job. Its local hostname read and possible `cmd /c ver` query
populate the standard-library metadata cache. Both platform.py and cmd.exe are
hashed in the review, and ComSpec is fixed to that command. The subsequent
dependency audit still rejects every socket event (including hostname reads)
and all subprocesses. This avoids mistaking platform detection for network IO;
it does not grant network or arbitrary command access to MuJoCo.

No Chrome, browser context, GPU telemetry query or graphics workload is launched.
The MuJoCo leaf blocks graphics imports, network operations and subprocesses.
Only mujoco-core 4.0.0 and NumPy 2.3.4 are installed in the isolated target;
standalone graphics dependencies are absent. The core wheel includes graphics
modules, whose imports are explicitly blocked. Node imports the pinned CPU engine graph
only after ownership validation. This is a boundary against accidental misuse,
not hostile edits by a local user. Job limits/watchdogs cannot recover a frozen
kernel or driver; these observations establish only bounded process containment.

The underlying Windows contracts are documented in Microsoft's
[Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
and [CPU rate control](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_cpu_rate_control_information)
references.

## State Space profiling recipe

The [CPU profiling extension](COLLISION_CPU_PROFILE.md) uses a separate fixed
recipe under the same controller. `--prepare-profile` binds the completed
comparison as an exact baseline and requires the identical engine bundle,
fixtures and protocol. It retains all three containment probes and full world
replay, followed by the seven State Space fixtures. MuJoCo cases are excluded
from this recipe. Sampling interval and output size are fixed; arbitrary workload
or profiler flags are not accepted.

The Node entry starts an in-process V8 sampling session only after live Job
attestation. It opens no debugger listener or browser. Every profiled row must
match the earlier complete lossless state and deterministic work counts. Profile
timings are separate diagnostic observations; they do not replace the original
comparison or advance any qualification gate. The scope/controller/test sources
from the completed comparison are preserved before this extension.

## Commands

The [owned-data optimization recipe](COLLISION_OWNED_OPTIMIZATION.md) is prepared
with `--prepare-optimization`. It adds one fixed boundary/ownership regression
stage before world replay and runs fresh pre-change controls alongside each
State Space fixture. Only the rigid module may differ in the engine source graph;
fixtures, protocol, dependencies and limits remain bound. Complete state and work
counts must match the historical baseline and fresh controls. The recipe keeps
the original paired MuJoCo cohort and does not open profiling, GPU or browser modes.

Use the base Python 3.13 executable; a venv redirector does not preserve the
process identity needed by this controller. Preparation never imports physics:

```powershell
node scripts/benchmark_collision_reference.mjs prepare --output dist/verification/NEW_BENCHMARK_PACKET
& $basePython -B scripts/verify_collision_cpu.py --prepare dist/verification/NEW_BENCHMARK_PACKET
```

The returned CPU review packet fixes all stage inputs. Run one stage at a time:

```powershell
& $basePython -B scripts/verify_collision_cpu.py --packet dist/verification/collision-cpu/REVIEW_ID --case startup-close
```

Follow the fixed cases in review.json, stopping immediately on nonzero exit.
Exit 75 means the quiet window was not satisfied and no workload was launched.
A failed attempt is retained; do not edit its receipt or remove a retained lock.

Aggregate existing evidence without running either engine:

```powershell
node scripts/collision-reference/collect-cpu.mjs dist/verification/collision-cpu/REVIEW_ID
```

The benchmark protocol and [qualification boundaries](COLLISION_REFERENCE_BENCHMARK.md)
are unchanged. All runtime, performance, native Worker, browser/GPU and R1
acceptance flags stay false. Timings under a 6% CPU cap are diagnostic observations,
not normal-throughput measurements or performance acceptance. No failed exact
replay is relaxed into a tolerance comparison to complete the cohort.
