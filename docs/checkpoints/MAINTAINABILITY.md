# Maintainability refinement validation

Base: `db459937be0df4034e1d6b36dbf1835796d547d3` (PR #29).
Scope: six incremental refinements, preserving physics, complete replay boundaries,
resource accounting, protocol compatibility, and bounded native performance.
The no-mistakes executable is unavailable on this host; checks and adversarial
reviews are executed directly. Each stage is reviewed before the next begins.

## 1. Readability and formatting

Pinned Prettier, explicit formatting commands, and expanded chamber/worker control
flow. Formatting is isolated from semantic refactors. Adversarial review compared
normalized emitted JavaScript/CSS for all 12 changed program/style files: identical.
Types, structural lint, browser build and 100 worker/chamber tests passed
(receipt `b79deff525594aeeb6b3d41a7feba081`). The native chamber acceptance also
passed all 13 journeys (receipt `d4a5ff3c0ffe43278a4b5d8340e6145f`), including
HTML controls, pixels, saves, fault handling and shutdown. No blocking finding remains.

## 2. Worker state authority

Added isolated asynchronous SDK state subscriptions and `whenIdle()`. The chamber
now observes the SDK directly instead of inferring terminal events from transport
messages. Wire format and physical scheduling are unchanged. Adversarial review
covered timer-only failure, rejected sends, observer exceptions/mutation,
unsubscribe, shutdown, and callback reentrancy. Initial subscription delivery was
made private to the new subscriber to prevent rebroadcast loops.
106 focused tests passed (receipt `a3a8a5e6f1724e63a6526d829cc3c792`), as did types,
lint, SDK/browser builds and native acceptance (receipt
`2a954019ed1f4fef9a415870d3092b84`). No blocking finding remains.

## Stage 3 — lifecycle and presentation ownership

Extracted a DOM-independent lifecycle controller, a canvas/GPU owner, and a
shared frame pump. Reset and import use one candidate replacement path. Picking
uses the camera of the completed frame. Slab and chamber keep their distinct
runtime-hold policies. Review covered stop during both startup phases, failed
replacement, stop during replacement/old-client disposal, observer exceptions,
and repeated shutdown. Cleanup must finish before startup can begin again.
63 focused tests passed (receipt `857ddeb4316b425592cf8aa175385622`), plus types,
lint and browser build. Native validation found an unbound browser animation
callback; fixed with explicit wrappers and reran all 13 journeys successfully
(receipt `e3649c60c53b401bbb75b109d8abe073`). No blocking finding remains.

## Stage 4 — neutral bounded data

Moved bounded portable copying and strict record-field validation into a neutral
module, removed reactive dependencies on the tactical coordinator, and retained
the old copy export and diagnostics. Eight record validators delegate to the
shared rule. Catalog copying, array prototype policies and the legacy tactical
record policy remain separate because their accepted inputs differ.
Adversarial review compared 115 executable outcomes against the previous copier;
all matched. Boundary tests cover node/depth/character limits, aliases, cycles,
getters, hidden/symbol fields and prototype-looking keys. All 1,839 CPU tests and
18 controller tests passed (receipt `9e480e0a2d7542bc8f9d03a2cffacb64`), plus builds,
types, lint and native journeys (receipt `da1af33dbe46420c9cf7cb5dc335cdf5`). Source
evidence now includes all engine TS. No blocking finding remains.

## Stage 5 — SDK build metadata and automatic lint coverage

A single entry manifest drives a shared build factory. Package exports and
TypeScript declaration roots are checked mirrors; stale/missing exports fail the
build before output deletion. Existing per-entry Vite commands remain compatible.
Entries keep their target settings and separate bundle identities. Lint discovers
all engine/example TS/JS sources, including new nested files, with file-attributed
diagnostics; CI checks formatting too.
Adversarial review exercised missing/duplicate metadata, new-file lint discovery,
symlink loops, generated output exclusion, module URL queries and application
import boundaries. Previously unlinted test import extensions were corrected.
A stale pre-formatting artifact initially differed; rebuilding the same source
with old and new configs proved all 15 JS outputs byte-identical. Installed
package verification passed all 13 export declarations (receipt
`450652297d6a48749f0f596c0f1941fe`), along with both examples, full CPU/controller
tests, types/lint/format and native acceptance (receipt
`46709fbbe817444cb3ac2b0ea0104dbd`). No blocking finding remains.

## Remaining stages

6. Deterministic shared fault-injecting test transport.
