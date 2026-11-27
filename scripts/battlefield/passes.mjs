import { viewOf, distribution } from './slice.mjs';
import { framesPerSlice, cameraAt } from './scene.mjs';

// Keep drawing while a prediction is outstanding. Every pass visits every camera
// keyframe in order; overruns dwell at the last keyframe and stay in the timings.
export async function measurePass({ packet, request, draw, boundary, clock, check, counts }) {
  const frames = [],
    queries = [],
    observed = [];
  let current = viewOf(packet.initial),
    previous;
  for (const [index, slice] of packet.slices.entries()) {
    let ready, commitReply, fault, submitted, received, commitSent, commitReceived;
    let previewVisible,
      commitVisible,
      playback = 0;
    function send(kind) {
      const promise = request({
        kind,
        tick: slice.tick,
        ...(kind === 'preview' ? { edits: slice.edits } : {}),
      });
      promise
        .then((value) => {
          if (kind === 'preview') {
            ready = value;
            received = clock();
          } else {
            commitReply = value;
            commitReceived = clock();
          }
        })
        .catch((e) => {
          fault = e;
        });
    }
    for (let n = 0; n < 120; n++) {
      const stamp = await boundary(),
        callback = clock();
      if (fault) throw fault;
      if (++counts.frames > 4096) throw Error('Battlefield frame bound exceeded');
      if (n === 0) {
        submitted = clock();
        send('preview');
      }
      if (previewVisible !== undefined && commitSent === undefined) {
        commitSent = clock();
        send('commit');
      }
      const shownPrediction = ready && previewVisible === undefined;
      const playing = commitReply && playback < ready.views.length;
      if (playing) current = ready.views[playback++];
      const key = index * framesPerSlice + Math.min(n, framesPerSlice - 1);
      const stages = await draw(
        current,
        shownPrediction ? ready.views.at(-1) : null,
        cameraAt(key),
      );
      const completed = clock();
      if (shownPrediction) previewVisible = completed;
      if (playing && playback === ready.views.length) commitVisible = completed;
      frames.push({
        tick: slice.tick,
        key,
        visibleTick: current.tick,
        forecastTick: shownPrediction ? ready.views.at(-1).tick : null,
        stamp,
        callback,
        completed,
        interval: previous === undefined ? null : stamp - previous,
        completionMs: completed - stamp,
        workMs: completed - callback,
        ...stages,
      });
      previous = stamp;
      if (commitVisible !== undefined && n + 1 >= framesPerSlice) {
        observed.push({ views: ready.views, committed: commitReply });
        queries.push({
          tick: slice.tick,
          workerMs: ready.workerMs,
          transportPreviewMs: received - submitted,
          predictionVisibleMs: previewVisible - submitted,
          commitAckMs: commitReceived - commitSent,
          playbackCompleteMs: commitVisible - commitSent,
        });
        break;
      }
      if (n === 119) throw Error('Four-tick crossing did not complete in 120 frames');
    }
  }
  check(observed);
  const frame = distribution(frames.map((f) => f.completionMs)),
    prediction = distribution(queries.map((q) => q.predictionVisibleMs));
  const missedDeadlines = frames.filter((f) => f.completionMs > 1000 / 60).length;
  const lostSlots = frames.reduce(
    (s, f) => s + Math.max(0, Math.round((f.interval ?? 0) / (1000 / 60)) - 1),
    0,
  );
  return {
    frames,
    queries,
    frame,
    prediction,
    missedDeadlines,
    lostSlots,
    meetsDiagnosticBudgets:
      frame.p95 <= 12 && !missedDeadlines && !lostSlots && prediction.p95 <= 100,
  };
}
