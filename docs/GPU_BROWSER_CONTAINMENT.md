# GPU-enabled browser lifecycle scope

The user's 2026-10-28 request, “let's do gpu-enabled”, authorizes the next bounded
GPU-enabled browser pass on this workstation. It supersedes the earlier
GPU-disabled-only scope for this pass; it does not clear the incident hold or
authorize an unrestricted demo, renderer, benchmark or physics trajectory.

The shared containment helpers now pin `mode: gpu-enabled` in a version-2 review
packet and capability. The previous GPU-disabled packets and failed receipts are
retained unchanged. Their results are documented in
[GPU-disabled containment](BROWSER_CONTAINMENT.md).

## Fixed scope and limits

- One fresh owned Chrome profile, one `about:blank` page, 384 x 216 headless
  window, fixed arguments and fixed CDP methods; no arbitrary navigation/eval.
- Component extensions with background pages and both WebUI omnibox popup
  features are disabled. This prevents the extra built-in targets observed in
  the first GPU-enabled attempt; the one-blank-target gate stays strict.
- GPU-enabled launch uses `--enable-gpu`, normal driver autodetection and
  `--disable-software-rasterizer`. It does not enable unsafe WebGPU, disable the
  sandbox or GPU watchdog, force a backend, or request a fallback adapter.
- CPU/memory limits match the existing GPU policy: **12% process-tree CPU,
  8 GiB Job memory, 30-second independent deadline**. The supervisor still stops
  its workload at 25 seconds and has the existing independent heartbeat watchdog.
- A fresh 30-second quiet window requires CPU at most 30%, at least 8 GiB free
  host memory, GPU utilization at most 15%, temperature below 65 C, and at least
  1 GiB free GPU memory. Missing, malformed or stale telemetry fails closed.
  Runtime GPU temperature at 75 C or low GPU memory cancels the attempt.
- Isolated tests run first at the CPU policy's **6% / 4 GiB / 30 seconds** and
  do not query or initialize the GPU, even when testing a GPU-enabled packet.

The [Chromium headless GPU documentation](https://chromium.googlesource.com/chromium/src.git/+/main/docs/gpu/using-gpu-hardware-in-headless-chrome.md)
describes `--enable-gpu` as selecting normal driver detection instead of forced
software rendering. Only GPU-enabled capabilities permit the additional fixed
CDP command `SystemInfo.getInfo`. Its complete response is retained, and success
requires a nonzero hardware device from NVIDIA/AMD/Intel and Chrome reporting
enabled GPU compositing without a software renderer. This is browser hardware
configuration evidence, not a WebGPU adapter/device, shader or terrain result.

The outer controller owns the timed GPU telemetry subprocesses. It remains alive
during the injected supervisor loss, avoiding orphan telemetry subprocesses from
the deliberately killed supervisor. It publishes run-ID-bound samples; the
supervisor also stops if those samples become stale. Both runtime monitors retain
the existing CPU/memory health checks. No other application is stopped.

## Startup and cancellation order

The single blank-page rule is unchanged. CDP may start before the initial page
target exists, so the leaf waits only while the target list is empty: at most 20
queries, at most two seconds, and within the existing 12-second startup window.
An unexpected nonempty target list still fails immediately. Every target
observation is saved before validation; no target is filtered out or navigated
away to make the check pass.

Each case is invoked separately after reviewing the preceding receipt:

1. Isolated negative tests for authorization, mode separation, telemetry, target
   readiness, hardware-report validation, transport bounds and cleanup.
2. GPU-enabled startup, target/hardware checks and normal close.
3. Stalled CDP reader: a real request is sent, then reading is deliberately
   stopped; the host cancels the owned Job without using CDP.
4. Supervisor loss: the exact owned supervisor is terminated; its independent
   watchdog must expire and terminate the owned leaf/browser tree.

Failures stop the sequence with original receipts retained. These cases do not
test interruption of a running GPU kernel or recovery from a driver/OS hang.
Normal Chrome startup/compositing is GPU-enabled, but there is no explicit
WebGPU request, scene rendering, shader catalogue or simulation in this scope.
The global hold stays byte-identical and the old performance checkout is checked
against its retained file, branch, HEAD and dirty-status snapshot.

## Invocation and evidence

```powershell
.venv\Scripts\python.exe -m scripts.verify_browser_containment --prepare 'C:\Program Files\Google\Chrome\Application\chrome.exe' --mode gpu-enabled
.venv\Scripts\python.exe -m scripts.verify_browser_containment --packet <returned-packet> --case unit
```

Later cases use `startup-close`, `stalled-cdp`, and `supervisor-loss`. The mode
cannot be overridden while running a packet. Capabilities bind mode, sources,
browser binaries/arguments, limits, incident identity, case and owned Job; they
are consumed once under the existing OS lease. Stale execution locks anywhere
in the containment packet directory block a new launch.

## First retained GPU-enabled attempt

Packet `dist/verification/browser-containment/4fbd48354c7447bba4960cad3da09289/`
pins the first GPU-enabled implementation. Its isolated case passed **33 tests**
with zero failures/errors/skips, in 0.581 s unittest time (2.842 s observer time,
18.76 MiB peak Job memory), under CPU-only 6% / 4 GiB limits.

The GPU-enabled `startup-close` attempt used 12% CPU / 8 GiB memory / a 30-second
independent deadline after a fresh CPU/GPU quiet window. Chrome reported the
approved GPU-enabled arguments. The attempt **failed the target gate** after
2.852 s observer time; peak Job memory was 226.00 MiB. It retained these targets:

- The intended `page` at `about:blank`.
- Two `browser_ui` omnibox targets at `chrome://omnibox-popup.top-chrome/` and
  `chrome://omnibox-popup.top-chrome/omnibox_popup_aim.html`.
- Chrome's bundled Hangouts `background_page` at
  `chrome-extension://nkeimhogjdpnpccoofpliimaahmaaome/background.html`.

This proves the refusal in this attempt was extra built-in targets, not an empty
initial target list. It is consistent with the earlier GPU-disabled target
failure, whose returned list was not captured, but cannot retroactively prove
that earlier result's cause.

The observer recorded 35 C GPU temperature and 1% utilization during the attempt.
Leaf exit was 1, watchdog exit 0, all owned Job processes terminated, the named
Job disappeared and the profile was removed. Hold/source/worktree checks passed.
The hardware-info command and normal-close acceptance were not reached. There
is no shader, terrain, hardware-compositing acceptance or cancellation-case
acceptance from this receipt.

The corrective source patch adds the component-background-extension disabling
flag documented by [Chrome's tooling guide](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md),
and disables `WebUIOmniboxPopup` and `WebUIOmniboxAimPopup`, defined in
[Chromium's feature source](https://chromium.googlesource.com/chromium/src/+/e9df86d10b8ac4e4e507673b1d94078b9c9e72d5/chrome/browser/ui/omnibox/omnibox_next_features.cc).
No targets are filtered or allowlisted around the failed gate. The exact
observed four-target shape is included in an isolated rejection regression.
The patch is pinned by packet `d40b35fb88374a749ef87c71add94948`; browser retry
requires separate review under the staged stop-on-failure rule.

That corrective packet passed **34 isolated tests**, zero failures/errors/skips,
in 0.553 s unittest time (2.781 s observer duration, 18.82 MiB peak Job memory).
Its CPU-only Job, independent watchdog, quiet window, cleanup and preservation
checks all passed. The user subsequently approved one GPU-enabled startup retry
and, conditional on success, the two individual cancellation cases.

## Approved retry and cancellation receipts

The corrected packet is
`dist/verification/browser-containment/d40b35fb88374a749ef87c71add94948/`.
The approved startup retry passed after a fresh 30-second CPU/GPU quiet window.
It confirmed exactly one `about:blank` page, the pinned arguments, hardware GPU
compositing and normal browser exit 0. Observer duration was **2.779 s**; peak
Job memory was **152.24 MiB**.

Chrome `156.0.8078.47` reported an **NVIDIA GeForce RTX 4090**, driver
`32.0.16.1088`, and an ANGLE Direct3D11 renderer on that device. Both
`gpu_compositing` and `webgpu` feature statuses were `enabled`; no WebGPU device
was requested. The retained GPU sample during startup was 36 C and 2%
utilization. The browser, leaf, supervisor and watchdog exited successfully,
the Job emptied, the named Job disappeared and the owned profile was removed.
Hold, helper-source and protected-worktree checks passed.

The following cases ran individually, each after a fresh 30-second CPU/GPU quiet
window and review of the preceding result:

| Case | Test result | Observer duration | Fault to empty Job | Job memory |
| --- | --- | ---: | ---: | ---: |
| Startup / normal close | Passed | 2.779 s | Not applicable | 152.24 MiB peak |
| Stalled CDP reader | Passed | 4.642 s | 2.156 s, including the deliberate 2 s pre-cancellation wait | 187.87 MiB peak |
| Supervisor loss | **Failed / unaccepted**: process-inventory observer error during teardown | 5.415 s | Not captured | 107.19 MiB last sampled peak; final peak unavailable |

For stalled CDP, the supervisor terminated the owned Job while the real
`Browser.getVersion` request remained unread. The leaf exited 125, the watchdog
exited 0 without a failure reason, and no Job processes remained. The owned
profile was removed and the named Job disappeared. The supervisor workload
receipt correctly says `passed: false` and `expectedCancellation: true`; the
outer **cancellation test** passed. This is not a successful runtime workload or
a GPU-kernel cancellation result.

### Supervisor-loss failure and cleanup audit

The supervisor-loss case reached the same single blank page and verified
hardware GPU compositing before the exact owned supervisor process was killed.
The observer then raised `Incomplete owned-process inventory`. Its cleanup
path attempted the same process enumeration and raised the same error before
closing all observation handles, recording the watchdog outcome, or removing
the owned profile. The controller process subsequently exited. The original
failed `report.json` is preserved byte-for-byte; no workload was retried.

The query wrapper rejects snapshots when the returned process-ID count differs
from the assigned count (or exceeds its fixed capacity). The failed revision
does not retain those raw counts. The failure occurred during teardown, but the
receipt does not establish whether this was a transient list inconsistency or
another enumeration issue. Microsoft's [process-list structure contract](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_process_id_list)
defines both counts; the next repair must preserve those diagnostics and handle
an incomplete query without skipping owned-resource cleanup. No conclusion about
watchdog success can be recovered from the missing outcome fields.

A separate cleanup audit then took the OS verification lease and confirmed:

- The exact named Job was absent.
- The recorded controller, supervisor, leaf, browser and watchdog PIDs no longer
  existed; a separate command-line scan found no tagged helper/browser processes.
- The remaining profile resolved inside this exact attempt and contained no
  reparse points. Only that owned profile was removed.
- The execution lock was archived as `execution-lock.retired.json`, preserving
  its original bytes. No active containment execution lock remains.
- The hold and original failed report remained byte-identical, and the old
  performance worktree matched the pre-packaging snapshot for branch, HEAD,
  dirty status and all **2,227 tracked/non-ignored files**.

`supervisor-loss/cleanup-audit.json` records these checks and explicitly keeps
`testPassed: false`. Later absence of processes does not prove whether the
independent watchdog or final Job-handle closure ended the workload. The failed
case remains unaccepted even though its owned resources have now been reconciled.

Current disposition: **GPU-enabled startup and stalled-CDP cancellation accepted;
supervisor-loss validation incomplete**. The subsequent
[root-cause investigation](SUPERVISOR_LOSS_ROOT_CAUSE.md) reproduced the observer's
failure cascade, repaired independent outcome capture and cleanup, and passed
47 isolated CPU-only tests under 6% CPU / 4 GiB / 30 seconds. No browser case was
rerun; the original raw counters and watchdog outcome remain unavailable. A new
bounded authorization and source-pinned packet are required for native
supervisor-loss validation. Terrain shader/image validation and
GPU workload cancellation remain outside these results. The incident hold stays
`blockRecovery: true` throughout.
