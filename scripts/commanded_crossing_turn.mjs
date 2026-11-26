/** CPU reference client for one crossing order. The ordinary world still previews at most two ticks. */
import { at } from './crossing_reference.mjs';
import { speed, ticks } from './moving_crossing_scene.mjs';

export function standingOn(api, state, surface, actor = 'unit') {
  const foot = api.cuboidBounds(at(state, actor)),
    bank = api.cuboidBounds(at(state, surface));
  return (
    foot.min[0] >= bank.min[0] &&
    foot.max[0] <= bank.max[0] &&
    foot.min[2] >= bank.min[2] &&
    foot.max[2] <= bank.max[2] &&
    Math.abs(foot.min[1] - bank.max[1]) < 1e-6
  );
}

function surfaceSpeed(api, unit) {
  const omega = api.applyWorldInverseInertia(
    unit.orientation,
    unit.principalInertia.map((i) => 1 / i),
    unit.intrinsicAngularMomentum,
  );
  return Math.hypot(...unit.velocity) + Math.hypot(...omega) * Math.hypot(...unit.halfExtents);
}

function jointPosition(api, state) {
  const bank = api.cuboidBounds(at(state, 'abutment')),
    deck = api.cuboidBounds(at(state, 'deck'));
  return [(bank.max[0] + deck.min[0]) / 2, bank.max[1], at(state, 'abutment').center[2]];
}
function withinReach(api, state, target) {
  const engineer = at(state, 'engineer');
  return (
    standingOn(api, state, 'abutment', 'engineer') &&
    Math.hypot(...target.map((x, i) => x - engineer.center[i])) <= 0.75
  );
}
function brake(body) {
  return {
    kind: 'impulse',
    id: body.id,
    impulse: [-body.mass * body.velocity[0], 0, -body.mass * body.velocity[2]],
  };
}

export function createCrossingSession(api, profiles, initial) {
  const makeWorld = (s) => api.createMultiphysicsWorld3D(profiles, s);
  let live = makeWorld(initial);
  const plans = new WeakMap();
  function prepareTeam(orders) {
    const { engineer: action, unit: movement } = orders ?? {};
    if (
      !orders ||
      Object.keys(orders).length !== 2 ||
      !Object.hasOwn(orders, 'engineer') ||
      !Object.hasOwn(orders, 'unit') ||
      !['move-into-range', 'reinforce-deck', 'wait'].includes(action) ||
      !(movement === 'cross-to-far-bank' || (action === 'move-into-range' && movement === 'wait'))
    )
      throw Error('Expected one engineer order and one heavy crossing order.');
    const state = live.snapshot();
    const engineer = at(state, 'engineer');
    const edits = [];
    const joint = state.bonds.find((b) => b.a === 'abutment' && b.b === 'deck');
    let target;
    if (action === 'move-into-range') {
      if (!joint) throw Error('Engineer approach requires an intact joint.');
      target = jointPosition(api, state);
      if (
        !standingOn(api, state, 'abutment', 'engineer') ||
        surfaceSpeed(api, engineer) > 1e-7 ||
        withinReach(api, state, target)
      )
        throw Error('Engineer must start from rest outside joint reach on the near bank.');
      // Approach east along the near bank at one model unit per second.
      edits.push({ kind: 'impulse', id: engineer.id, impulse: [engineer.mass, 0, 0] });
    }
    if (action === 'reinforce-deck') {
      if (!joint || joint.strength >= 500)
        throw Error('Reinforcement requires an intact weaker joint.');
      if (!withinReach(api, state, jointPosition(api, state)))
        throw Error('Engineer must stand within reach of the deck joint.');
      edits.push(
        { kind: 'cut', a: joint.a, b: joint.b },
        { kind: 'bond', a: joint.a, b: joint.b, strength: 500 },
      );
    }
    return prepareTurn(
      movement,
      Object.freeze({ engineer: action, unit: movement }),
      edits,
      state,
      target,
    );
  }
  function prepare(order) {
    if (order !== 'cross-to-far-bank' && order !== 'wait') throw Error('Unknown crossing order.');
    return prepareTurn(order, order, []);
  }
  function prepareTurn(order, submitted, firstEdits, start = live.snapshot(), target) {
    const base = live,
      fork = makeWorld(start);
    // A resting contact can leave tiny residual motion after a wait turn.
    const unit = at(start, 'unit');
    if (
      order === 'cross-to-far-bank' &&
      (!standingOn(api, start, 'abutment') || surfaceSpeed(api, unit) > 1e-7)
    )
      throw Error('Crossing starts from rest on the near bank.');
    let phase = 'running',
      pending,
      edits,
      arrival = null,
      fracture = null,
      braked = null,
      inRange = null,
      engineerBraked = null;
    const handle = Object.freeze({
      status: () => phase,
      advance(budget) {
        if (phase !== 'running') throw Error('Crossing preview is not running.');
        try {
          if (!pending) {
            const state = fork.snapshot(),
              u = at(state, 'unit');
            edits = state.tick === start.tick ? [...firstEdits] : [];
            if (order === 'cross-to-far-bank') {
              if (state.tick === start.tick)
                edits.push({ kind: 'impulse', id: u.id, impulse: [u.mass * speed, 0, 0] });
              else if (arrival !== null && braked === null) {
                edits.push(brake(u));
                braked = state.tick + 1;
              }
            }
            if (target && inRange !== null && engineerBraked === null) {
              edits.push(brake(at(state, 'engineer')));
              engineerBraked = state.tick + 1;
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
          if (target && inRange === null && withinReach(api, snapshot, target))
            inRange = snapshot.tick;
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
        return {
          order: submitted,
          arrival,
          fracture,
          braked,
          ...(target ? { inRange, engineerBraked } : {}),
          snapshot: fork.snapshot(),
        };
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
    prepareTeam,
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
