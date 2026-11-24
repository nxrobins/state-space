# Self-hosted GPU runner incident state

Provision Python 3.10+ as `python`, Git, a usable native WebGPU adapter and the
NVIDIA telemetry required by the GPU supervisor before registering the runner.
Use the separate bounded Metal workflow for a Mac host.

Set `STATE_SPACE_HOST_STATE_DIR` in the runner service environment to an absolute,
persistent directory outside the runner workspace and every project checkout.
After reviewing the host's incident status, create `safety-hold.json` there.
List every existing independent State Space checkout in `checkoutRoots`. The
preflight discovers linked worktrees from each root and refuses an incomplete
Git inventory or a checkout that has an incident hold.

```json
{
  "blockRecovery": false,
  "checkoutRoots": ["/absolute/path/to/existing/state-space"]
}
```

Use `true` while the host has an unresolved incident. Missing, malformed or
blocked host state stops the workflow before checkout. Local recovery permits
require their own reviewed recovery command. The runner refuses a checkout hold
even when that checkout has a permit.

Every workflow attempt uses a fresh `gpu-runs/<run-id>-<attempt>` checkout. An
existing target causes a refusal. Checkout cleaning is disabled. The preflight
registers successful new checkouts under the external `checkouts/` directory,
so later runs also inspect holds recorded there. Keep those registrations until
the corresponding evidence has been archived and any incident reviewed. Remove
a registration deliberately when retiring its checkout. A missing registered
checkout blocks the next preflight.

The supervisor stores default receipts in
`STATE_SPACE_HOST_STATE_DIR/receipts/<run-id>-<attempt>/<verification-id>/` and
uses a lease in the host directory to serialize workloads across checkouts.
Manual supervised commands with this environment use `receipts/local-1/`.
Explicit `--output` paths retain their existing behavior. The workflow uploads
the current attempt's external receipts and its checkout-local evidence.

Record a new incident in the durable host file before dispatching another run.
The Python supervisor rechecks that file and the registered checkout holds at
launch. Node entry points also check the durable host file. Host-state files,
registrations and receipts require the same filesystem protection as the runner.

CPU supervised test discovery excludes native GPU tests before requesting an
adapter. `STATE_SPACE_REQUIRE_GPU=1` conflicts with a CPU job and fails early.
Explicit GPU jobs retain the required-adapter check. Outside a CPU job, an unset
or zero requirement preserves optional-adapter discovery.
