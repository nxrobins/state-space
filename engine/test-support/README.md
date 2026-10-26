# Worker transport test support

`createWorkerBus` is test-only and imports no production protocol or physics.
Its queue advances only when a test calls `until`, `settle`, or a task's `run`.
Each send, logged message and delivery owns a separate structured clone.

- Set `config.mapReply` to corrupt a reply, return `null` to drop it, or return
  an array to duplicate it. The sent log retains the original message.
- Set `config.hold` to delay matching traffic. Inspect/reorder `held`, then call
  `releaseHeld()` to move it into the runnable queue.
- `config.sendFailure`, `config.scheduleFailure` and `errors[side]` inject
  transport, scheduling and endpoint failures.
- `maximum()` records peak outstanding request sequences. Duplicate replies
  cannot decrement the count twice. `settle()` preserves falsy rejection reasons.
- Both helpers have bounded progress. They do not advance clocks; use fake timers
  explicitly for timeout behavior. Domain assertions stay in their own tests;
  shared input builders are described below.

The tactical suite's microtask transport and the chamber's browser Worker shim
exercise different scheduling boundaries and remain separate. Native browser
acceptance continues to test the real Worker/event-loop boundary.

## Structure negative controls

`structure-mutants.ts` holds the exact source edits that the native negative
controls in `engine/structure.test.ts` apply to `engine/structure.ts` in memory.
Those controls run only in the native suite. `structure-mutants.test.ts` runs in
the CPU suite and checks that each edit still finds its anchor once, so a
formatting change fails hosted CI instead of silently disabling a control.

## Frozen multiphysics inputs

`multiphysics-fluid-fixtures.ts` supplies fresh plain input objects shared by the
fluid regression and explicitly selected CPU profiling cases. It does not advance
physics or export an SDK API. Domain assertions remain in their respective suites;
the 27/64-particle cases keep the same geometry for before/after comparisons.
