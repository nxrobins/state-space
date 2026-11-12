# Reactive preview commit: remove a repeated complete save read

Base: `eb2f4cb485f5f2129082b75d0c7b72267adc3a38`.
Status: proposed CPU optimization; runtime equivalence and performance acceptance
remain pending. No native workload, physical test, build or benchmark was run on
the Windows development host. Its incident hold remains unchanged.

## Change and invariant

Reactive branch finalization already reads the complete candidate through
`readReactiveSessionSnapshot3D`, validates application policy, checks reentry,
then marks the branch ready. Until commit, that private field, game and accounting
cannot change: enqueue and advance reject, public observations own their data,
and any live commit or restore invalidates the branch revision.

Commit now uses this invariant instead of repeating the full save read over its
fresh draft. The draft still copies the field and portable game. Commit still
checks the current revision, horizon and topology, invokes application validation
on an isolated copy, copies the returned snapshot and checks reentry before
publication. It retains no additional candidate snapshot. External save readers,
restore validation, physical rules and Worker protocols are unchanged.

This removes one complete domain read/copy and its physical/accounting validation
from each successful commit. The invariant assumes the existing portable-data
contract and an unmodified JavaScript realm; it adds no stronger realm guarantee.

## Equivalence checks

The existing reactive-session suite already covers policy rejection at commit,
stale/foreign/consumed branches, cancellation, ownership, complete accounting,
physical continuation and invalid external saves. New cases compare commits with
the original full-save reader across zero/one/two-tick horizons, work budgets
1/7/256, a reservoir transfer and JSON restore. Other cases mutate returned
preview/policy data and exercise swallowed commit-validation reentry with a ready
sibling. All new physical fixtures use the existing tiny world and at most two
ticks. The held M5/volume calls remain trapped.

## Required qualification

Run the focused reactive-session suite, then the bounded CPU/session/Worker
regressions and standard build/type/lint/format checks on an approved host. Keep
the Windows safety hold in place. A passing CPU CI run is not native Worker/GPU
or full-world qualification.

Use the existing seven-profile reactive chamber diagnostic on the base and this
change, on the same approved host and Node version. Compare complete saves and
ledger values, commit duration, total preview-to-commit cost and peak memory.
Its three samples per profile are diagnostic, not p95 qualification. Follow with
repeated bounded native application stages before claiming a latency gain.
Retain source/input identities and failed attempts. Do not change physics,
workload, visual settings, deadlines or safety gates to obtain acceptance.

Only after this CPU change is qualified should the next optimization be selected
from measured remaining CPU costs or GPU structural rebuild/synchronization costs.
