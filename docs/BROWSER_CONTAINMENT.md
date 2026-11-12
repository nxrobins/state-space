# GPU-disabled browser containment

This document retains the GPU-disabled scope and its historical attempts. The
subsequent [GPU-enabled lifecycle scope](GPU_BROWSER_CONTAINMENT.md) was separately
authorized on 2026-10-28 and uses distinct version-2 mode-bound capabilities.

This is the narrow prerequisite for terrain-native validation. It does not render
terrain, compile shaders, request an adapter, step physics, or release the incident
hold. The user authorized its implementation and GPU-disabled cancellation checks
on 2026-10-28. Native GPU stages still need their separate execution-host review
and authorization.

`scripts/verify_browser_containment.py` supplies the controller and supervisor;
`scripts/verification_scope.py` validates capabilities;
`scripts/verification_restricted_browser.py` supplies the fixed browser leaf.
The generic verification supervisor and browser helpers remain unchanged and
continue to reject `blockRecovery: true`.

## Authorization and containment

An offline review packet pins the hard hold and incident, helper/test sources,
Python executable, installed Chrome executable and its versioned core DLLs,
browser arguments, limits, and the protected performance checkout. It is a local
review artifact, not a credential by itself. The packet contains no engine or
scene entry point. The standard-library helpers use the base Python executable
directly to avoid Windows virtual-environment redirector PID ambiguity.

For each individually selected case, the controller:

1. Checks the source/browser/incident hashes, the old worktree's branch, HEAD,
   status and all tracked/non-ignored file hashes, prior case results, and the
   absence of a previous attempt.
2. Takes the existing OS verification lease and exclusively creates an execution
   lock. An abandoned lock in any earlier containment packet fails closed; the
   persistent OS `lease.lock` file is not treated as an abandoned execution.
3. Requires host CPU at most 30% and at least 8 GiB available memory throughout a
   fresh 30-second window. A busy host returns 75 before issuing a capability.
   Missing/invalid/stale telemetry fails closed and requires review. No GPU
   telemetry or context is requested.
4. Issues and immediately consumes a capability for one exact command and case.
   It binds the review digest, arguments, owner PID, fresh Job identity, fixed
   limits and 60-second authorization lifetime. An exclusive claim remains spent
   even after a failed or interrupted attempt.
5. Starts an owned supervisor. The supervisor arms the independent watchdog and
   creates the existing Windows Job with **6% process-tree CPU, 4 GiB job memory,
   and a 30-second independent deadline**. The child starts suspended; the outer
   observer retains its process handle after Job assignment and before resume.
6. The leaf rechecks the capability, parent, current execution lock and actual
   Windows Job membership, then exclusively consumes its leaf claim. An inherited
   or invented Job environment variable is insufficient.
7. Checks outcomes and cleanup, then rechecks hashes and the protected worktree.
   A cleanup/preservation failure leaves the execution lock for investigation.

These checks prevent accidental reuse and scope expansion. They do not defend
against a malicious local account that can rewrite the supervisor and its review
files. The hold is never opened for writing, and no generic recovery permit is
created. The existing health thresholds, independent heartbeat watchdog, active
process limit and kill-on-close behavior remain in force.

## Restricted browser

Only installed Chrome is supported by this first implementation. Each browser
gets a fresh profile inside its attempt and the fixed `about:blank` URL, a small
384 x 216 window, and explicit GPU, compositor, software-rasterizer, WebGL and
WebGPU disabling flags. The Chrome sandbox stays enabled. Background networking,
extensions and updates are disabled; resolver/proxy settings also prevent normal
page network access. These settings are defense in depth, not a network sandbox.
The launcher has no URL, flag, JavaScript, screenshot or scene override.

The host connects only to the loopback DevTools endpoint reported by that fresh
profile. It exposes four fixed commands: `Browser.getVersion`,
`Browser.getBrowserCommandLine`, `Target.getTargets`, and `Browser.close`.
There is no `Runtime.evaluate`, navigation, page session or target-creation API.
The returned command line must match the approved arguments, allowing only a
single adjacent empty `--flag-switches-begin` / `--flag-switches-end` pair that
Chromium itself can add. Flags inside those delimiters, duplicate flags and all
other additions, removals or changed values are refused. Target discovery
must show exactly one blank page. Replies have a 64 KiB ceiling, a two-second
absolute deadline and one outstanding request. Invalid IDs, error replies,
unexpected frames, disconnects and malformed endpoints fail closed.

The disabling flags follow [Chromium's switch definitions](https://chromium.googlesource.com/chromium/src/+/HEAD/content/public/common/content_switches.cc)
and [Chrome's automation flag guidance](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md).
This is a GPU-disabled browser configuration, not proof that no browser/OS code
ever loads a graphics library. No GPU workload or GPU cancellation is accepted
by these checks.

## Individual checks

| Case | Acceptance |
| --- | --- |
| `unit` | All isolated capability/CDP tests pass inside the capped Job. An audit hook rejects actual subprocess and socket activity from tests. |
| `startup-close` | Fresh browser reaches CDP, confirms its arguments and single blank page, acknowledges close, and exits 0. |
| `stalled-cdp` | After normal startup, send a real `Browser.getVersion` request and deliberately stop reading replies. After two seconds the supervisor terminates its Job without relying on CDP. Leaf exits 125 and all descendants disappear within five seconds of the injected fault. |
| `supervisor-loss` | With the same real pending request, terminate only the exact owned supervisor process. The independent watchdog must report heartbeat expiry, exit 125 and terminate the leaf with 125; the Job must empty within five seconds. |

The stalled case injects a non-reading client. It is not evidence that the browser
itself hung or that a kernel/driver failure can be recovered. The supervisor-loss
case uses a separate observer holding the global lease and query/cleanup handles;
it does not kill the observer or simulate a whole-host crash.

All cases require no remaining Job processes, an exited watchdog, an absent named
Job after handles close, safe removal of the owned profile, unchanged source/hold
hashes, and an unchanged old worktree. Negative cases are successful *tests of
cancellation*, not successful runtime workloads. Failed receipts are retained and
never overwritten or automatically retried.

## Commands and retained evidence

Prepare an inert packet first, inspect it, then select one case per invocation:

```powershell
.venv\Scripts\python.exe -m scripts.verify_browser_containment --prepare 'C:\Program Files\Google\Chrome\Application\chrome.exe'
.venv\Scripts\python.exe -m scripts.verify_browser_containment --packet <returned-packet> --case unit
```

The later case names are `startup-close`, `stalled-cdp`, and `supervisor-loss`.
The tool requires their order and never advances automatically. Do not issue
another runtime case after a failed one. A source/browser/incident change
invalidates the packet; rebuilding a packet does not itself authorize a retry.

Evidence lives below `dist/verification/browser-containment/<packet-id>/`:
review/preservation manifests, quiet samples, spent capabilities and claims,
supervisor/leaf reports, process inventories, watchdog outcomes, telemetry and
bounded logs. GPU-native validation uses a different future capability; this
packet cannot authorize it.

## Retained execution: 2026-10-28

The first reviewed packet is
`dist/verification/browser-containment/257ab14edf834d5f8be802734b40eded/`.

| Attempt | Result | Observer duration | Peak Job memory |
| --- | --- | ---: | ---: |
| Isolated authorization/CDP tests | 21 passed; no failures or skips | 2.706 s | 18.04 MiB |
| Blank-browser startup/close | **Refused**: reported browser arguments differed from the approved arguments | 2.903 s | 175.15 MiB |
| Stalled CDP cancellation | Not run; startup prerequisite failed | — | — |
| Supervisor loss | Not run; startup prerequisite failed | — | — |

Both launched attempts had fresh 30-sample quiet windows. Maximum host CPU was
4.33% and 4.81%, respectively; available memory stayed above 98 GiB. Both used
the unchanged 6% / 4 GiB Job limits and 30-second independent watchdog deadline.

Chrome `156.0.8078.47` reached its owned DevTools endpoint and answered
`Browser.getVersion`. It then failed the argument comparison **before** the
blank-target or normal-close acceptance checks. This is a failed startup test,
not a passed browser lifecycle or cancellation test. The supervisor terminated
the owned Job; its receipt has `passed: false` and leaf exit 1. The outer observer
recorded an empty Job, watchdog exit 0, removal of the owned profile and absence
of the named Job. There was no watchdog timeout or cleanup error.

The initial leaf did not save the actual returned argument array on mismatch,
so the exact discrepancy cannot be reconstructed from that receipt. Current
sources save it before validation and include added/missing arguments in the
error. Chromium's [experiment-switch conversion](https://chromium.googlesource.com/chromium/chromium/+/HEAD/chrome/browser/about_flags.cc)
can insert empty delimiter pairs; the comparison now permits only that exact
empty pair. This is a source-supported compatibility adjustment; the original
failed receipt remains unchanged. The separately approved retry below confirms
argument acceptance on that attempt, not complete browser acceptance.

The original hard-hold hash remained
`f99d5948a531069090895c0c00a85538fb0b5d5b283a569ee870d5e33532312c`, with
`blockRecovery: true` and no recovery permit. The old performance worktree's
2,227 tracked/non-ignored files, branch, HEAD and dirty status matched before and
after both attempts. Spent claims remain in the receipts; no execution lock
remained. No engine/physics source, generic guard or generic browser helper was
modified.

The diagnostic/argument-comparison follow-up packet
`dist/verification/browser-containment/8346372c972b494a8e1d207ab98296df/`
passed 23 isolated tests (2.478 s observer duration, 18.54 MiB peak Job memory).
Final sources additionally reject stale locks across packets and treat missing
quiet telemetry as failure instead of a busy-host retry. Their packet is
`dist/verification/browser-containment/2715b16ea3974ff489701e612928f163/`:
**25 isolated tests passed**, zero failures/errors/skips, 0.451 s unittest time,
2.650 s observer duration, 18.53 MiB peak Job memory. Both follow-up attempts had
fresh quiet windows and the same limits, with complete cleanup and unchanged
hold/worktree/source hashes.

### Separately approved startup retry

After the initial refusal and isolated checks, the user explicitly approved
**one** fresh startup attempt, with another failure stopping the sequence.
`2715b16ea3974ff489701e612928f163/startup-close/` retains that attempt.

Chrome `156.0.8078.47` reached CDP and its reported arguments matched the pinned
launch arguments plus the adjacent empty experiment sentinels. The exact array
is retained in `browser-command-line.json`. The retry then **failed the
single-blank-page target check**, before normal-close acceptance. Observer
duration was 3.196 s and peak Job memory 177.29 MiB, under the same 6% / 4 GiB /
30-second limits and a fresh quiet window. Leaf exit was 1, watchdog exit was 0,
the Job emptied, the named Job disappeared, and the owned profile was removed.
Hold, source and old-worktree preservation checks passed.

The failing revision did not retain the returned target list, so this receipt
does not distinguish a target-readiness race from an unexpected target. Current
sources now save the target response before checking it and record successful
argument validation separately. The strict target rule is unchanged; it has not
been relaxed to make the check pass. No further browser attempt is authorized
by the one-retry approval, and none was made.

The final diagnostic-only revision is pinned by
`dist/verification/browser-containment/62cf3bf6fc4e4cd3a09bf1804b6bddd7/`.
Its isolated suite passed all 25 tests, with no failures/errors/skips (0.456 s
unittest time, 2.652 s observer duration, 18.85 MiB peak Job memory). It ran after
a fresh quiet window with complete cleanup and unchanged hold/worktree/source
hashes. This final packet has not launched Chrome.

There have been **two actual browser attempts, both refused**, and no stalled-CDP
or supervisor-loss execution. Those cases require a successful startup gate.
Native shader/image stages remain held. [The checkpoint](checkpoints/BROWSER_CONTAINMENT.json)
pins the retained receipts and final helper sources without claiming
browser/native acceptance.
