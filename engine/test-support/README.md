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
  explicitly for timeout behavior. Domain-specific fixtures/assertions stay in
  their own tests.

The tactical suite's microtask transport and the chamber's browser Worker shim
exercise different scheduling boundaries and remain separate. Native browser
acceptance continues to test the real Worker/event-loop boundary.
