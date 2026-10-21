# Shared client utilities

Utilities that more than one example client uses. They are plain TypeScript
with no engine imports.

| File | Role | Used by |
| --- | --- | --- |
| `frame-pump.ts` | One outstanding draw per invalidation; callers supply the scheduling and the guards | `reactive-chamber/view.ts`, `tactical-slab/ui-runtime.ts` |
