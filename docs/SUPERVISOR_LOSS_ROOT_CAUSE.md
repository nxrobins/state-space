# Supervisor-loss observer failure

Recorded 2026-10-28. The observer's failure cascade is reproduced and repaired.
The original GPU-enabled supervisor-loss case remains **failed / unaccepted**.
This investigation launched no browser or GPU workload.

## Established failure chain

The failed attempt is
`dist/verification/browser-containment/d40b35fb88374a749ef87c71add94948/supervisor-loss/`,
run `6634c5da97024118b17e80158a7a9c1e`.

1. The restricted browser reached one blank page and hardware compositing. The
   outer controller killed its exact supervisor child as requested by the test.
2. `JobObserver.pids()` raised `Incomplete owned-process inventory`. That exact
   message came after a successful `QueryInformationJobObject` return, when
   `count > 64` or `count != assigned`. The failed revision retained neither
   count, returned byte length nor process IDs from that query.
3. The observer's `finally` block called `job.pids()` again before termination
   or handle closure. The same exception escaped into its single cleanup error
   handler, skipping the remaining cleanup actions.
4. Watchdog reason and exit codes were only read after the main observation
   loop. The exception bypassed those reads. Job/process handles, the watchdog
   mapping and the owned profile did not receive their normal explicit cleanup.
   The controller later exited; a separate lease-protected audit reconciled the
   remaining profile and execution lock.

The confirmed defect is coupling cleanup and outcome capture to a process-list
query that can fail. Rejecting an incomplete inventory is still required; it
must not prevent independent cleanup or erase the evidence needed to determine
what stopped the workload.

## What the old evidence cannot establish

The fault-ready marker was written at Unix time `1793204132.7611766`; the report
finished at `1793204135.7615566`, **3.000380 seconds later**. This is consistent
with the independent watchdog's three-second heartbeat expiry. The old receipt
does not record the exact supervisor-kill time, query counters, watchdog reason
or watchdog exit code. Timing alone cannot establish that the watchdog fired.

The later cleanup audit proved the named Job and recorded processes were gone.
It cannot distinguish watchdog termination from termination when the final Job
handle closed. Nor can it prove that the incomplete list was a transient race,
a persistent teardown condition, or an out-of-capacity result. The repaired
code does not assume any of those explanations is true.

Microsoft's [process-list structure contract](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list)
distinguishes assigned processes from process IDs returned. The
[query API](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject)
also exposes success/failure, returned bytes and the Win32 error. Those are now
retained so another incomplete result can be diagnosed directly.

## Repair

- Record raw process-list counts, bounded IDs, byte count, API result, Win32
  error and timestamp. Keep the last 32 query samples and every sample attached
  to an inventory exception.
- Permit at most three queries, separated by 20 ms, for an in-envelope count
  mismatch. Only a fresh complete, valid list can succeed. API errors, invalid
  IDs, malformed byte counts and counts beyond the existing 64-process envelope
  fail immediately; persistent mismatch still fails. No capacity or safety
  threshold was increased.
- Retain the leaf process handle before inventory polling. Capture watchdog
  reason and process exit codes independently of enumeration, including before
  forced cleanup. Save post-cleanup outcomes separately.
- Terminate only the exact owned Job without first enumerating it. Confirm its
  active count through the independent basic-accounting query. Attempt Job,
  process and mapping closure separately, collecting each cleanup error while
  preserving the original failure.
- Remove the owned profile only after the named Job is absent and process
  teardown has no cleanup errors. Always attempt GPU-monitor shutdown.
- Require an empty final inventory at acceptance. Cleanup cannot turn a failed
  observation into a passing test. Cleanup errors retain the execution lock for
  reconciliation as before.

The independent watchdog, generic verification guard, browser arguments, CPU
and memory limits, quiet thresholds and physics/rendering code are unchanged.
The only unit-runner change includes the new observer regression module in its
fixed, source-pinned test list; its subprocess/network prohibition remains.

## Validation

Both CPU-only attempts used separate immutable packets and consumed one-use
capabilities after a successful 30-second quiet window. Each used **6% Job CPU,
4 GiB Job memory, one worker and a 30-second independent deadline**. Neither
queried the GPU or launched Chrome.

| Attempt | Result | Observer duration | Peak Job memory |
| --- | --- | ---: | ---: |
| Old observer plus new regression cases | 41 tests: 2 failures, 4 errors, 0 skips | 2.955 s | 18.84 MiB |
| Repaired observer plus additional error cases | 47 tests: all passed, 0 skips | 2.878 s | 18.79 MiB |

The first result intentionally reproduced the defects with injected API data
and fake process handles. Its existing 34 tests passed. The final result took
0.668 s inside unittest and 1.125 s total Job CPU time. Regressions cover
transient and persistent incomplete inventories, invalid IDs/byte counts,
Win32 failures, independent accounting, termination/handle/mapping cleanup
failures, independent outcome capture and preventing cleanup from qualifying an
earlier failed observation. Both outer controllers verified complete cleanup.
Ruff and `git diff --check` passed.

The final unit controller also exercised real Windows Job queries and ordinary
CPU-worker shutdown. It observed complete zero-, one- and two-process lists,
an empty final Job, exited supervisor/leaf/watchdog, named Job disappearance
and profile cleanup. This does **not** reproduce the native browser teardown
condition or qualify GPU supervisor-loss cancellation.

The red packet is `7090f9f714bf484d9cad5aea0cf9cc8d`; the passing packet is
`a7f3587386354d078727537d58af16f9`, both under
`dist/verification/browser-containment/`. Original helper copies, the failure
timeline and preservation results are under
`dist/verification/supervisor-loss-root-cause/c0b030414ad74f9689e38b0b78d839d7/`.
The durable [checkpoint](checkpoints/SUPERVISOR_LOSS_ROOT_CAUSE.json) records
source/receipt hashes and measured limits.

## Preserved boundaries and remaining gate

The original failed report remains byte-identical. `blockRecovery: true` and
the hold's bytes are unchanged; no recovery permit or active execution lock
remains. The old `D:\state-space-cpu-performance` worktree retains its branch,
HEAD, dirty status and all **2,227 tracked/non-ignored files**.

The next native step is a separately authorized, source-pinned supervisor-loss
attempt under the existing GPU limits and quiet gate. A new packet will also
need its source-specific prerequisite cases; the old failed packet cannot be
reused. The raw counters and watchdog outcome from that attempt are needed to
resolve the remaining native trigger. No such run was performed or authorized
by this root-cause investigation. Terrain shader/image and GPU-kernel
cancellation validation remain pending.
