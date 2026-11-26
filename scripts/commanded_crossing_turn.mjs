/** CPU reference client for one crossing order. The ordinary world still previews at most two ticks. */
import { at } from './crossing_reference.mjs';
import { speed, ticks } from './moving_crossing_scene.mjs';

export function standingOn(api, state, surface) {
  const foot = api.cuboidBounds(at(state, 'unit')),
    bank = api.cuboidBounds(at(state, surface));
  return (
    foot.min[0] >= bank.min[0] &&
    foot.max[0] <= bank.max[0] &&
    foot.min[2] >= bank.min[2] &&
    foot.max[2] <= bank.max[2] &&
    Math.abs(foot.min[1] - bank.max[1]) < 1e-6
  );
}

export function createCrossingSession(api, profiles, initial) {
  const makeWorld = (s) => api.createMultiphysicsWorld3D(profiles, s);
  let live = makeWorld(initial);
  const plans = new WeakMap();
  function prepare(order) {
    if (order !== 'cross-to-far-bank' && order !== 'wait') throw Error('Unknown crossing order.');
    const base = live,
      start = base.snapshot(),
      fork = makeWorld(start);
    // A resting contact can leave tiny residual motion after a wait turn.
    const unit = at(start, 'unit');
    const omega = api.applyWorldInverseInertia(
      unit.orientation,
      unit.principalInertia.map((i) => 1 / i),
      unit.intrinsicAngularMomentum,
    );
    const surfaceSpeed =
      Math.hypot(...unit.velocity) + Math.hypot(...omega) * Math.hypot(...unit.halfExtents);
    if (
      order === 'cross-to-far-bank' &&
      (!standingOn(api, start, 'abutment') || surfaceSpeed > 1e-7)
    )
      throw Error('Crossing starts from rest on the near bank.');
    let phase = 'running',
      pending,
      edits,
      arrival = null,
      fracture = null,
      braked = null;
    const handle = Object.freeze({
      status: () => phase,
      advance(budget) {
        if (phase !== 'running') throw Error('Crossing preview is not running.');
        try {
          if (!pending) {
            const state = fork.snapshot(),
              u = at(state, 'unit');
            edits = [];
            if (order === 'cross-to-far-bank') {
              if (state.tick === start.tick)
                edits = [{ kind: 'impulse', id: u.id, impulse: [u.mass * speed, 0, 0] }];
              else if (arrival !== null && braked === null) {
                edits = [
                  {
                    kind: 'impulse',
                    id: u.id,
                    impulse: [-u.mass * u.velocity[0], 0, -u.mass * u.velocity[2]],
                  },
                ];
                braked = state.tick + 1;
              }
            }
            pending = fork.prepare(edits, 1);
          }
          if (pending.advance(budget).status !== 'ready') return null;
          const { result } = fork.commit(pending);
          pending = undefined;
          const { snapshot, ticks: reports } = result;
          if (
            fracture === null &&
            reports[0].brokenBonds.some((b) => b.a === 'abutment' && b.b === 'deck')
          )
            fracture = snapshot.tick;
          if (arrival === null && standingOn(api, snapshot, 'far-bank')) arrival = snapshot.tick;
          if (snapshot.tick - start.tick === ticks) phase = 'ready';
          return { edits, result };
        } catch (error) {
          pending?.cancel();
          phase = 'failed';
          throw error;
        }
      },
      cancel() {
        if (phase !== 'running' && phase !== 'ready') return false;
        pending?.cancel();
        phase = 'cancelled';
        plans.delete(handle);
        return true;
      },
      result() {
        if (phase !== 'ready') throw Error('Crossing preview is not ready.');
        return { order, arrival, fracture, braked, snapshot: fork.snapshot() };
      },
    });
    plans.set(handle, {
      base,
      fork,
      consume: () => {
        phase = 'committed';
      },
    });
    return handle;
  }
  return Object.freeze({
    snapshot: () => live.snapshot(),
    prepare,
    commit(handle) {
      const plan = plans.get(handle);
      if (!plan || plan.base !== live) throw Error('Foreign, consumed or stale crossing preview.');
      const result = handle.result();
      live = plan.fork;
      plan.consume();
      plans.delete(handle);
      return result;
    },
  });
}
