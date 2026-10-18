# Safer verification harness: source review

Review date: 2026-10-16. Scope: M5 browser transport, independent watchdog,
supervisor, durable journal, recovery receipts and their regression tests.

**Both authorized non-GPU stages passed: 52 mock/temporary-file tests and four
bounded Windows containment tests. Runtime verification remains blocked.** No
browser sessions, builds, replays or benchmarks were run. This does not clear the
workstation for GPU execution or establish M5 completion.

## Findings fixed

| Finding | Fix | Regression coverage written |
|---|---|---|
| Pipe writes happened before the response timeout, and cleanup could close a pipe while its writer was blocked. | One bounded write queue and a writer thread; one deadline covers sending and receiving. Cleanup requests an explicit close, kills an unresponsive helper, joins pipe threads briefly and avoids closing streams still in use. | Blocked write returns by deadline; kill precedes closing a stalled pipe; response order and overflow. |
| The supervisor could accept a quickly exiting child without checking its final output; a stopped watchdog or failed termination could be missed at completion. | Drain and validate final bounded output, require complete structured progress, recheck watchdog liveness before passing, check termination/handle-close results, and retain an armed watchdog if Job cleanup remains unresolved. | Empty, truncated and out-of-order final progress; late-created child cannot resume after watchdog expiry; failed termination is reported. |
| Journal construction returned before its file was usable. A late flush could publish progress after failure, and the file-size limit was checked only at final validation. | Wait for file creation and initial `fsync` before browser launch. Reject late publication using the event deadline and failure latch. Enforce record/file byte limits before writing. | Startup disk failure; blocked/late `fsync` produces no acknowledgement or progress; overflow stops before the write. |
| Explicit browser close triggered the same failure callback as an unexpected disconnect. Teardown timers could keep the helper alive, while cleanup errors skipped remaining resources. | Separate expected shutdown from transport failure; cancel settled deadline timers; bound profile removal; continue each cleanup independently and fail the receipt on any cleanup error. Avoid calling HTTP shutdown when its serving thread never started. | Timer cancellation, CDP disconnect/ID errors, error-buffer byte cap and cleanup failure isolation. |
| Existing output directories could lose retained reports; final acceptance did not reconcile replay timings and could accept malformed success values or a missing browser receipt. | Require a fresh evidence directory, compare every retained tick timing as well as digests/ranges, validate replay identity and boolean success, and require the browser evidence receipt. | Retained evidence is not overwritten; mismatched timing/digest/range is rejected. |

Files changed by this review are confined to harness code, tests and documentation.
The simulation algorithms, authored command tapes and canonical state digest
remain unchanged by this review. Existing unrelated working-tree changes remain
in place. Historical benchmark/replay receipts have not been promoted or rerun.

## What is ready to test

1. **Mock and temporary-file tests first: passed.** The three Python harness test
   files and the JavaScript transport test file ran separately and sequentially
   under explicit authorization. The Python transport uses mocked processes; the JavaScript tests
   use mocked fetch/WebSocket objects. These tests do not launch a real browser,
   query GPU telemetry, import the physics engine or run simulation work.
2. **Owned print/sleep subprocess tests second: passed under separate authorization.** `VerificationGuardTests` in
   `tests/test_verification_guard.py` is now skipped by default. It requires the
   explicit `STATE_SPACE_TEST_CONTAINMENT=reviewed-non-gpu` opt-in on Windows.
   Enable it only for the separately approved containment test invocation, after
   the first phase passes. It exercises a temporary Job/lease and an independent
   watchdog with small print/sleep payloads, including a deliberately stalled
   supervisor writer. Each invocation has its own timeout; it does not clear or
   consume the actual incident hold.
3. **Stop and inspect every failure.** Do not retry automatically or move on to
   browser/GPU execution. Real browser startup, driver behavior, adapter creation,
   GPU cancellation, replay equivalence and gameplay timing remain unvalidated.

Test sources:

- `tests/test_verification_browser.py`
- `tests/test_verification_journal.py`
- `tests/test_verification_guard.py`
- `tests/verification-events.test.mjs`

The first follow-up request authorized mock and temporary-file tests only. The
next request separately authorized bounded containment cases, one at a time,
stopping on the first failure. The containment opt-in was confined to those test
processes. Runtime recovery was never enabled. The hard hold and the legacy demo
gate in `scripts/verify_checks.mjs` remained byte-for-byte unchanged throughout.

## Mock test results (2026-10-16 local date)

| Suite | Passed | Skipped | Process wall time |
|---|---:|---:|---:|
| Python browser transport / final progress | 10 | 0 | 0.8440 s |
| Python journal / event protocol / watchdog policy | 14 | 0 | 2.3280 s |
| Python hold / recovery / health gates | 21 | 4 | 1.4220 s |
| JavaScript journal / CDP protocol | 7 | 0 | 0.1250 s |

All suites passed on their first attempt; no failure fixes or harness source
changes were needed. Runs were sequential, each with an outer 30-second timeout.
Containment, inherited verification-job and legacy opt-ins were removed from the
child environments. Python tests also had an audit hook forbidding real process
launches and socket connect/bind operations. The JavaScript suite ran directly in
one Node process with mocked fetch/WebSocket objects and a 128 MiB V8 heap limit.
No npm scripts or broad test discovery were invoked. The four Windows Job and
print/sleep tests were explicitly checked to be skipped.

[Retained summary](verification-harness/mock-tests-2026-10-16/summary.json) links
the per-suite receipts and raw stdout/stderr logs. Receipts include commands,
runtime versions, source hashes, duration, exit status and protected-file hashes.
These are harness test receipts, not replay or frame-performance evidence.

At the end of the mock phase, readiness meant ready to test containment, with
separate authorization. The subsequent results below supply the bounded OS
evidence; the mock receipts themselves remain unchanged.

## Bounded containment results (2026-10-16 local date)

All four existing containment cases ran separately, in the following order, and
passed on their first attempt. No failure fixes were needed. Each case finished
and its receipt and workload process states were checked before the next launch.

| Case | Observed result | Whole test process wall time |
|---|---|---:|
| Successful contained print | Exit 0; workload process absent afterward. | 2.688 s |
| Lease exclusion | Second owner refused before any workload was created. | 0.688 s |
| Descendant timeout | Independent 1-second deadline terminated the workload with exit 125; both workload and spawned descendant absent afterward. | 2.703 s |
| Stalled supervisor writer | Four-second injected `fsync` stall; independent watchdog reported supervisor heartbeat expiry and workload exit 125. Workload absent afterward. | 6.047 s |

[Retained containment evidence](verification-harness/containment-tests-2026-10-16/summary.json)
includes each original supervisor report, stdout/stderr, telemetry fixture,
unittest result, source hashes and protected-file hashes. The evidence runner
preserved the temporary reports without changing the tested harness or tests.
It enforced case order and refused to advance past a failed case. The test's
supervisor invocation had a 15-second timeout and the outer test wrapper had a
25-second timeout. Payloads only printed or slept; the normal CPU Job settings
were 6% CPU and 4 GiB memory limits. Health data came from fixtures, so these runs
do not validate live host telemetry or load thresholds.

The three intentional refusal/cancellation supervisor receipts correctly report
`passed: false`. Their tests passed by checking those failures; they are not
successful runtime workload receipts. Read-only post-run checks found no Python
helpers bearing any of the four unique run IDs and no remaining named Jobs. No
manual process termination or cleanup intervention was needed.

The actual incident hold remained hard-blocked without a recovery permit. Its
SHA-256 and the legacy gate's SHA-256 matched before and after each case and at
final inspection. Runtime verification stays blocked and legacy demos stay
quarantined. Browser/GPU execution needs its own reviewed scope and authorization.

## Evidence and limits

The earlier Python AST, JavaScript syntax and whitespace checks were static. The
mock receipts establish the tested mock failure behavior and small-file journal
behavior, including real temporary-file writes and injected `fsync` failures.
The separate containment receipts additionally establish cancellation and cleanup
for the specific print/sleep cases above. They do not establish real browser pipe
cancellation, GPU cancellation, cleanup under an OS fault, or storage survival
across a power loss.

The independent watchdog still relies on a functioning operating system. It
cannot guarantee recovery from a driver/kernel/whole-host hang. Retain the staged
execution-host review described in `3D_M5.md` before any GPU work. M5 replay and
32³/64³/128³ performance acceptance remain pending.
