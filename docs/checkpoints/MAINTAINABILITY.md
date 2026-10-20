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

## Remaining stages

4. Neutral bounded-data validation and copying.
5. SDK entry manifest, shared build configuration and automatic lint coverage.
6. Deterministic shared fault-injecting test transport.
