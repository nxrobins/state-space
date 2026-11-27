# Battlefield frame and preview benchmark

The renderer pans across a 64 × 16 × 64 battlefield at a 1920 × 1080 drawing resolution using the production cinematic material profile. Twelve squad markers occupy the level. Two are the simulated engineer and heavy unit from the frozen crossing mission. The other ten and the surrounding terrain are presentation geometry. Four water parcels, a deck and its footing participate in the crossing. This diagnostic does not qualify the 8,192-parcel mission workload or minimum PC.

## Measurement

The hosted Ubuntu job reconstructs the 250-tick rush from its public mission entry point and matches the independent pre-mission SHA-256 for the full history and final turn. It takes ticks 93–188, including fracture at 95, and prepares 24 successive four-tick predictions on a private world in a separate Node worker. The four one-tick world transactions preserve edit boundaries. Only a subsequent commit publishes the branch. Each round compares every snapshot, receipt and tick report, including signed zero. One warm-up and three measured rounds retain all 72 worker, message round-trip and commit timings. Node timing ends at receipt of a message. GPU and input-to-display timings require the native stage.

The native packet contains the exact start, edits, continuation and render poses. Both passes draw the same camera keyframes with terrain, water, units and a forecast marker. The recorded pass takes predictions from the packet. The live pass runs the public CPU engine in a module Worker while the camera continues drawing. The marker encodes deck survival, appears above the predicted unit position, and stays visible through a completed frame before commit. Playback presents the four returned poses in order. Each slice includes at least twelve camera frames. A slow response adds measured dwell frames at the last camera keyframe. Every completed frame includes changed-cell projection, terrain upload and the GPU render completion. OS scanout is outside this boundary. Full live results must match the hosted reference after timing.

Receipts include raw camera keys, frame start and completion times, upload/render costs, worker time, input to prediction display, commit acknowledgment and playback completion. Evaluate the two passes separately. Diagnostic targets are 12 ms p95 per completed frame, zero 60 Hz deadline misses or lost slots, and 100 ms p95 to a visible four-tick forecast. Completion of a measurement and meeting its targets are distinct fields.

## Run

Hosted CI runs the CPU capture under the existing supervisor and retains the native packet with the summary in the `battlefield-<run>-<attempt>` artifact. On an eligible Mac with the repository's native qualification prerequisites, copy the contents of the artifact's `battlefield/capture-*/native/` to `dist/battlefield-benchmark/` at the reviewed checkout and invoke the fixed stage:

```sh
uv run python -m scripts.verify_macos_qualification --stage battlefield-crossing-visible
```

The stage uses the owned visible Chrome window, requires a hardware adapter, and retains the report and screenshot through the existing Mac supervisor. The Windows incident hold remains in effect. Hosted CPU results carry no native frame or minimum-PC qualification.
