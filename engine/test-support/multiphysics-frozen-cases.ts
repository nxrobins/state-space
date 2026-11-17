/** Frozen liquid/contact behaviour: open failures, rejection boundaries, stress scenes and
 * passing controls, each recorded exactly. A case drives an injected engine, so one catalogue
 * records the working tree, an immutable bundle of an earlier commit, or both side by side.
 * Test-only. It advances physics and records what happened; the freeze suites own every
 * comparison. A recorded rejection is evidence of today's behaviour, never a passing result. */
import { createHash } from 'node:crypto';
import type * as Public from '../experimental/multiphysics.js';

export type FrozenEngine3D = Pick<
  typeof Public,
  | 'createMultiphysicsProfiles3D'
  | 'seedThermalParcel3D'
  | 'createMultiphysicsSnapshot3D'
  | 'createMultiphysicsTickJob3D'
  | 'createMultiphysicsWorld3D'
  | 'createMultiphysicsDemonstration3D'
  | 'createMultiphysicsTimedCup3D'
  | 'createMultiphysicsResolvedTank3D'
>;
type Profiles = Public.MultiphysicsProfiles3D;
type Snapshot = Public.MultiphysicsSnapshot3D;
type Seed = Public.ThermalSeed3D;
type Vec3 = Public.Vec3;
type Quat = Public.Quat;

export type FrozenGroup3D = 'open-failure' | 'rejection' | 'stress' | 'control';
export type FrozenFact3D = string | number | boolean;
export type FrozenRejection3D = {
  /** Steps committed before the rejected one. */
  afterSteps: number;
  message: string;
  /** Where the bounded job stopped, and the work it had completed. */
  stage: string;
  work: number;
  /** The rejected input stayed bit-identical, and a second attempt and an attempt from its
   * JSON save rejected at the same stage, work and message. */
  atomic: boolean;
};
export type FrozenRecord3D = {
  id: string;
  group: FrozenGroup3D;
  outcome: 'completed' | 'rejected';
  /** One entry per committed step, `<digest> <work>`: a 64-bit digest prefix of the exact
   * state and report, then the deterministic work units the step consumed. */
  steps: string[];
  /** SHA-256 of the last committed snapshot (the initial one when nothing committed). */
  final: string;
  rejection: FrozenRejection3D | null;
  /** Readable measurements, compared bit for bit apart from the sign of zero. */
  facts: Record<string, FrozenFact3D>;
};
export type FrozenCase3D = {
  id: string;
  group: FrozenGroup3D;
  /** Why this behaviour is pinned. */
  why: string;
  /** Left to the supervised `check`; the unit suite records only the light cases, which
   * together cost a few seconds of the suite's bounded time. */
  heavy: boolean;
  run(context: FrozenContext3D): void;
};
export type FrozenContext3D = {
  engine: FrozenEngine3D;
  profiles: Profiles;
  seed(id: string, material: string, center: Vec3, options?: Partial<Seed>): Public.ThermalParcel3D;
  /** Advance up to `count` ticks, recording each. Returns the last committed snapshot, and
   * stops at the first rejection, which it records with its atomicity checks. */
  advance(
    snapshot: Snapshot,
    count: number,
    observe?: (result: Public.MultiphysicsTickResult3D, step: number) => void,
  ): { snapshot: Snapshot; rejected: boolean };
  /** Record one committed step of a journey that is not a plain tick. */
  commit(value: unknown, work: number, snapshot: Snapshot): void;
  reject(rejection: FrozenRejection3D): void;
  fact(name: string, value: FrozenFact3D): void;
};

const bits = new DataView(new ArrayBuffer(8));
/** Key order does not matter; array order, the sign of zero and every bit of a number do. */
export function encodeFrozen3D(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw Error('Frozen records require finite numbers.');
    bits.setFloat64(0, value);
    return 'n' + bits.getBigUint64(0).toString(16).padStart(16, '0');
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return `[${value.map(encodeFrozen3D).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${encodeFrozen3D(record[key])}`)
      .join(',')}}`;
  }
  throw Error('Frozen records require plain data.');
}
export const digestFrozen3D = (value: unknown): string =>
  createHash('sha256').update(encodeFrozen3D(value), 'utf8').digest('hex');
const text = (error: unknown) => (error instanceof Error ? error.message : String(error));

type Attempt =
  { result: Public.MultiphysicsTickResult3D } | { message: string; stage: string; work: number };
function attempt(engine: FrozenEngine3D, profiles: Profiles, snapshot: Snapshot): Attempt {
  let job: Public.MultiphysicsTickJob3D;
  try {
    job = engine.createMultiphysicsTickJob3D(profiles, snapshot);
  } catch (error) {
    return { message: text(error), stage: 'admission', work: 0 };
  }
  try {
    while (job.progress().status === 'running') job.advance(256);
    return { result: job.result() };
  } catch (error) {
    const progress = job.progress();
    return { message: text(error), stage: progress.stage, work: progress.work };
  }
}

/** Record one case against one engine. `onStep` lets a launcher report progress. */
export function recordFrozenCase3D(
  engine: FrozenEngine3D,
  profiles: Profiles,
  frozen: FrozenCase3D,
  onStep?: (steps: number) => void,
): FrozenRecord3D {
  const record: FrozenRecord3D = {
    id: frozen.id,
    group: frozen.group,
    outcome: 'completed',
    steps: [],
    final: '',
    rejection: null,
    facts: {},
  };
  const commit = (value: unknown, work: number, snapshot: Snapshot) => {
    if (record.rejection) throw Error('A frozen case cannot continue past its rejection.');
    record.steps.push(`${digestFrozen3D(value).slice(0, 16)} ${work}`);
    record.final = digestFrozen3D(snapshot);
    onStep?.(record.steps.length);
  };
  const reject = (rejection: FrozenRejection3D) => {
    if (record.rejection) throw Error('A frozen case records one rejection.');
    record.outcome = 'rejected';
    record.rejection = rejection;
  };
  frozen.run({
    engine,
    profiles,
    seed: (id, material, center, options = {}) =>
      engine.seedThermalParcel3D(profiles, {
        id,
        material,
        center,
        owner: 'authored',
        temperature: 20,
        ...options,
      }),
    advance(start, count, observe) {
      let snapshot = start;
      if (!record.final) record.final = digestFrozen3D(snapshot);
      for (let step = 0; step < count; step++) {
        const before = encodeFrozen3D(snapshot),
          outcome = attempt(engine, profiles, snapshot);
        if ('result' in outcome) {
          snapshot = outcome.result.snapshot;
          commit(outcome.result, outcome.result.report.work, snapshot);
          observe?.(outcome.result, step);
          continue;
        }
        const again = attempt(engine, profiles, snapshot),
          saved = attempt(engine, profiles, JSON.parse(JSON.stringify(snapshot)) as Snapshot);
        reject({
          afterSteps: record.steps.length,
          ...outcome,
          atomic:
            encodeFrozen3D(snapshot) === before &&
            encodeFrozen3D(again) === encodeFrozen3D(outcome) &&
            encodeFrozen3D(saved) === encodeFrozen3D(outcome),
        });
        return { snapshot, rejected: true };
      }
      return { snapshot, rejected: false };
    },
    commit,
    reject,
    fact(name, value) {
      // The freeze file is JSON, which cannot carry the sign of zero.
      record.facts[name] = value === 0 ? 0 : value;
    },
  });
  return record;
}

/** Sources whose rejections bound the liquid/contact envelope, under
 * engine/experimental/multiphysics/. */
export const FROZEN_REJECTION_SOURCES_3D: readonly string[] = Object.freeze([
  'collision.ts',
  'coupling-energy.ts',
  'fluid-coupling.ts',
  'fluids.ts',
  'rigid.ts',
  'world-tick.ts',
  'world.ts',
]);
/** The message of every `throw Error(...)` in a source, sorted, repeats kept. A computed part
 * keeps its placeholder text. Moving code does not change the list; adding, removing or
 * rewording a rejection does. */
export function rejectionVocabulary3D(source: string): string[] {
  const literal = /throw Error\(\s*(?:'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`)/g,
    found = [...source.matchAll(literal)].map((match) => match[1] ?? match[2]);
  if (found.length !== source.split('throw Error(').length - 1)
    throw Error('A rejection without a literal message cannot be frozen.');
  return found.sort();
}

const aboutZ = (angle: number): Quat => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
/** `side`-cubed unit lattice of water samples, centred in x and z, lowest layer at `y`. */
function waterBlock(context: FrozenContext3D, side: number, y: number, layers = side) {
  const offset = (side - 1) / 2;
  return Array.from({ length: side * side * layers }, (_, i) =>
    context.seed(`w${String(i).padStart(3, '0')}`, 'water', [
      (i % side) - offset,
      y + Math.floor(i / (side * side)),
      (Math.floor(i / side) % side) - offset,
    ]),
  );
}
/** Closed cup: an anchored floor at the origin and four walls around a `side`-wide well. */
const CUP_WALLS = ['floor', 'left', 'right', 'front', 'back'];
function cup(context: FrozenContext3D, side: number, height: number) {
  const w = side / 2,
    h = height / 2;
  return [
    context.seed('floor', 'ceramic', [0, 0, 0], { halfExtents: [w, 0.5, w] }),
    context.seed('left', 'ceramic', [-w - 0.5, h + 0.5, 0], { halfExtents: [0.5, h, w] }),
    context.seed('right', 'ceramic', [w + 0.5, h + 0.5, 0], { halfExtents: [0.5, h, w] }),
    context.seed('front', 'ceramic', [0, h + 0.5, -w - 0.5], { halfExtents: [w + 1, h, 0.5] }),
    context.seed('back', 'ceramic', [0, h + 0.5, w + 0.5], { halfExtents: [w + 1, h, 0.5] }),
  ];
}
function world(
  context: FrozenContext3D,
  parcels: Public.ThermalParcel3D[],
  anchors: string[],
  settings: Partial<Public.MultiphysicsSettings3D> = {},
): Snapshot {
  return context.engine.createMultiphysicsSnapshot3D(context.profiles, {
    parcels,
    anchors,
    settings,
  });
}
const parcelOf = (snapshot: Snapshot, id: string) => snapshot.parcels.find((p) => p.id === id)!;

/** The extended gate's paddle, at a chosen plate speed: 27 resting samples, no gravity. */
function paddle(speed: number, dt: number, steps: number) {
  return (context: FrozenContext3D) => {
    const water = Array.from({ length: 27 }, (_, i) =>
      context.seed(`w${String(i).padStart(2, '0')}`, 'water', [
        (i % 3) - 1,
        Math.floor(i / 9) - 1,
        (Math.floor(i / 3) % 3) - 1,
      ]),
    );
    const start = world(
      context,
      [
        context.seed('paddle', 'copper', [-2.5, 1, 0], {
          halfExtents: [0.25, 1, 1.5],
          velocity: [speed, 0, 0],
        }),
        ...water,
      ],
      [],
      { gravity: [0, 0, 0], dt },
    );
    let impactHeat = 0;
    const { snapshot } = context.advance(start, steps, (result) => {
      impactHeat += result.report.mechanicalHeat;
    });
    context.fact('paddleX', parcelOf(snapshot, 'paddle').center[0]);
    context.fact('paddleSpeed', parcelOf(snapshot, 'paddle').velocity[0]);
    context.fact('impactHeat', impactHeat);
    context.fact('numericalEnergy', snapshot.accounting.numericalEnergy);
  };
}
/** The combined-failure fixture rebuilt with a chosen plate half width. The shipped fixture
 * uses 0.4 so the plate clears its neighbours; 0.5 wedges it against both terminals. */
function combinedFailure(context: FrozenContext3D, plateHalfWidth: number): Snapshot {
  const { engine, profiles } = context,
    valve = engine.createMultiphysicsDemonstration3D(profiles, 'wax-valve');
  return engine.createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      ...valve.parcels,
      context.seed('water', 'water', [0, 3, 1], { temperature: 40 }),
      context.seed('plate', 'copper', [0, 0.75, 1], {
        temperature: 40,
        halfExtents: [plateHalfWidth, 0.5, 0.5],
      }),
    ],
    anchors: valve.anchors,
    bonds: [
      ...valve.bonds,
      { a: 'core', b: 'plate', strength: 80, restLength: Math.hypot(1, 0.25) },
    ],
    battery: valve.battery,
    settings: valve.settings,
  });
}
/** Run to completion or rejection, then note where the named bodies ended up. */
function settle(
  build: (context: FrozenContext3D) => Snapshot,
  steps: number,
  track: string[] = [],
) {
  return (context: FrozenContext3D) => {
    const { snapshot } = context.advance(build(context), steps);
    for (const id of track) {
      const parcel = snapshot.parcels.find((p) => p.id === id);
      if (parcel) {
        context.fact(`${id}.y`, parcel.center[1]);
        context.fact(`${id}.speed`, Math.hypot(...parcel.velocity));
      }
    }
    context.fact('numericalEnergy', snapshot.accounting.numericalEnergy);
  };
}

export const FROZEN_CASES_3D: readonly FrozenCase3D[] = Object.freeze([
  // --- Open failures recorded in docs/MULTIPHYSICS.md -------------------------------------
  {
    id: 'paddle-speed-1-dt120',
    group: 'open-failure',
    why: 'Published open finding: at plate speed 1 the moving paddle is rejected at impact.',
    heavy: true,
    run: paddle(1, 1 / 120, 110),
  },
  {
    id: 'paddle-speed-1-dt240',
    group: 'open-failure',
    why: 'The same finding at half the timestep; refinement does not clear it.',
    heavy: true,
    run: paddle(1, 1 / 240, 220),
  },
  {
    id: 'combined-failure-builder-journey',
    group: 'open-failure',
    why: 'Builder stage: 48 committed ticks and a 2,048 Q heat edit, then the next preview is rejected.',
    heavy: false,
    run(context) {
      const { engine, profiles } = context,
        live = engine.createMultiphysicsWorld3D(
          profiles,
          engine.createMultiphysicsDemonstration3D(profiles, 'combined-failure'),
        );
      const preview = (edits: Public.MultiphysicsEdit3D[]) => {
        const candidate = live.prepare(edits, 2);
        try {
          while (candidate.progress().status === 'running') candidate.advance(256);
          return { candidate, error: null };
        } catch (error) {
          return { candidate, error: text(error) };
        }
      };
      const commit = (edits: Public.MultiphysicsEdit3D[]) => {
        const { candidate, error } = preview(edits);
        if (error !== null) return error;
        const work = candidate.progress().work,
          committed = live.commit(candidate);
        context.commit(committed.result, work, committed.result.snapshot);
        return null;
      };
      const rejected = (message: string, candidate: Public.MultiphysicsPreview3D) => {
        const progress = candidate.progress(),
          before = encodeFrozen3D(live.snapshot()),
          revision = live.revision(),
          again = preview([]),
          restarted = engine.createMultiphysicsWorld3D(
            profiles,
            JSON.parse(JSON.stringify(live.snapshot())) as Snapshot,
          ),
          fresh = restarted.prepare([], 2);
        let saved = '';
        try {
          while (fresh.progress().status === 'running') fresh.advance(256);
        } catch (error) {
          saved = text(error);
        }
        context.reject({
          afterSteps: live.revision(),
          message,
          stage: `preview tick ${progress.completedTicks + 1}`,
          work: progress.work,
          atomic:
            progress.status === 'failed' &&
            again.error === message &&
            again.candidate.progress().work === progress.work &&
            saved === message &&
            fresh.progress().work === progress.work &&
            live.revision() === revision &&
            encodeFrozen3D(live.snapshot()) === before,
        });
      };
      for (let round = 0; round < 24; round++) {
        const error = commit([]);
        if (error !== null) return rejected(error, preview([]).candidate);
      }
      const target = live.snapshot().parcels[0].id;
      context.fact('heatedParcel', target);
      const heated = commit([{ kind: 'heat', id: target, energyQ: 2048 }]);
      if (heated !== null) return rejected(heated, preview([]).candidate);
      context.fact('ticksBeforeRejection', live.snapshot().tick);
      const next = preview([]);
      if (next.error !== null) return rejected(next.error, next.candidate);
      context.fact('continuedPastRecordedEdge', true);
    },
  },
  {
    id: 'combined-failure-wedged-plate',
    group: 'open-failure',
    why: 'A full-width plate is wedged against both terminals: the unqualified wedged-support contact.',
    heavy: false,
    run: settle((context) => combinedFailure(context, 0.5), 90, ['plate', 'water', 'valve']),
  },

  // --- Rejection boundaries: the envelope the solver refuses to leave ---------------------
  {
    id: 'reject-fluid-point-travel',
    group: 'rejection',
    why: 'A fluid sample moving more than 0.2 kernel radii in one tick.',
    heavy: false,
    run: settle(
      (context) =>
        world(context, [context.seed('w', 'water', [0, 5, 0], { velocity: [0, -40, 0] })], []),
      2,
    ),
  },
  {
    id: 'reject-fluid-boundary-travel',
    group: 'rejection',
    why: 'A solid moving more than 0.2 kernel radii in one tick beside fluid.',
    heavy: false,
    run: settle(
      (context) =>
        world(
          context,
          [
            context.seed('w', 'water', [0, 0, 0]),
            context.seed('block', 'copper', [-1.6, 0, 0], { velocity: [40, 0, 0] }),
          ],
          [],
          { gravity: [0, 0, 0] },
        ),
      2,
    ),
  },
  {
    id: 'reject-fluid-penetration',
    group: 'rejection',
    why: 'A fluid sample that starts 0.1 inside a solid.',
    heavy: false,
    run: settle(
      (context) =>
        world(
          context,
          [
            context.seed('floor', 'ceramic', [0, 0, 0], { halfExtents: [1.5, 0.5, 1.5] }),
            context.seed('w', 'water', [0, 0.9, 0]),
          ],
          ['floor'],
        ),
      2,
    ),
  },
  {
    id: 'reject-boundary-sample-limit',
    group: 'rejection',
    why: 'More than 128 solid boundary samples within reach of the fluid.',
    heavy: false,
    run: settle((context) => {
      const water = Array.from({ length: 100 }, (_, i) =>
        context.seed(`w${String(i).padStart(3, '0')}`, 'water', [
          (i % 10) - 4.5,
          1,
          Math.floor(i / 10) - 4.5,
        ]),
      );
      return world(
        context,
        [context.seed('floor', 'ceramic', [0, 0, 0], { halfExtents: [6, 0.5, 6] }), ...water],
        ['floor'],
      );
    }, 1),
  },
  {
    id: 'reject-fluid-sample-limit',
    group: 'rejection',
    why: 'More than 128 fluid samples.',
    heavy: false,
    run: settle(
      (context) =>
        world(
          context,
          Array.from({ length: 129 }, (_, i) =>
            context.seed(`w${String(i).padStart(3, '0')}`, 'water', [
              4 * (i % 12),
              4 * Math.floor(i / 12),
              0,
            ]),
          ),
          [],
          { gravity: [0, 0, 0] },
        ),
      1,
    ),
  },
  {
    id: 'reject-rigid-overlap',
    group: 'rejection',
    why: 'Two free solids that start 0.1 inside each other.',
    heavy: false,
    run: settle(
      (context) =>
        world(
          context,
          [context.seed('a', 'copper', [0, 0, 0]), context.seed('b', 'copper', [0.9, 0, 0])],
          [],
          { gravity: [0, 0, 0] },
        ),
      2,
    ),
  },
  {
    id: 'reject-compressed-liquid',
    group: 'rejection',
    why: 'Eight samples packed at half their rest spacing.',
    heavy: false,
    run: settle(
      (context) =>
        world(
          context,
          Array.from({ length: 8 }, (_, i) =>
            context.seed(`w${i}`, 'water', [
              0.5 * (i % 2),
              0.5 * (Math.floor(i / 2) % 2),
              0.5 * Math.floor(i / 4),
            ]),
          ),
          [],
          { gravity: [0, 0, 0] },
        ),
      4,
    ),
  },
  {
    id: 'reject-gas-closing-speed',
    group: 'rejection',
    why: 'Two gas samples closing fast enough to exceed the pair volume step.',
    heavy: false,
    run: settle(
      (context) =>
        world(
          context,
          [
            context.seed('a', 'air', [-0.5, 0, 0], { velocity: [30, 0, 0] }),
            context.seed('b', 'air', [0.5, 0, 0], { velocity: [-30, 0, 0] }),
          ],
          [],
          { gravity: [0, 0, 0] },
        ),
      4,
    ),
  },

  // --- Stress scenes: liquid and contact motion outside the published gates ---------------
  {
    id: 'stress-liquid-drop-on-floor',
    group: 'stress',
    why: 'A 27-sample block falls one unit onto an open floor and spreads.',
    heavy: true,
    run: settle(
      (context) =>
        world(
          context,
          [
            context.seed('floor', 'ceramic', [0, 0, 0], { halfExtents: [3.5, 0.5, 3.5] }),
            ...waterBlock(context, 3, 2),
          ],
          ['floor'],
        ),
      90,
      ['w000', 'w013', 'w026'],
    ),
  },
  {
    id: 'stress-dam-break',
    group: 'stress',
    why: 'A resting 27-sample column with one wall missing collapses sideways.',
    heavy: true,
    run: settle(
      (context) => {
        const floor = context.seed('floor', 'ceramic', [2, 0, 0], { halfExtents: [3.5, 0.5, 1.5] });
        return world(
          context,
          [
            floor,
            context.seed('left', 'ceramic', [-2, 2, 0], { halfExtents: [0.5, 1.5, 1.5] }),
            context.seed('front', 'ceramic', [2, 2, -2], { halfExtents: [4.5, 1.5, 0.5] }),
            context.seed('back', 'ceramic', [2, 2, 2], { halfExtents: [4.5, 1.5, 0.5] }),
            ...waterBlock(context, 3, 1),
          ],
          ['floor', 'left', 'front', 'back'],
        );
      },
      90,
      ['w002', 'w026'],
    ),
  },
  {
    id: 'stress-wax-drop-into-cup',
    group: 'stress',
    why: 'A buoyant body falls 1.5 units into an 18-sample pool.',
    heavy: true,
    run: settle(
      (context) =>
        world(
          context,
          [
            ...cup(context, 3, 3),
            ...waterBlock(context, 3, 1, 2),
            context.seed('body', 'wax', [0, 4.5, 0]),
          ],
          CUP_WALLS,
        ),
      110,
      ['body'],
    ),
  },
  {
    id: 'stress-copper-drop-into-cup',
    group: 'stress',
    why: 'A dense body falls 1.5 units into an 18-sample pool.',
    heavy: true,
    run: settle(
      (context) =>
        world(
          context,
          [
            ...cup(context, 3, 3),
            ...waterBlock(context, 3, 1, 2),
            context.seed('body', 'copper', [0, 4.5, 0]),
          ],
          CUP_WALLS,
        ),
      110,
      ['body'],
    ),
  },
  {
    id: 'stress-paddle-speed-2',
    group: 'stress',
    why: 'The paddle at twice the rejected speed.',
    heavy: true,
    run: paddle(2, 1 / 120, 60),
  },
  {
    id: 'stress-liquid-on-tilted-plate',
    group: 'stress',
    why: 'Four samples fall onto a fixed plate tilted 30 degrees and slide off.',
    heavy: true,
    run: settle(
      (context) =>
        world(
          context,
          [
            context.seed('plate', 'ceramic', [0, 0, 0], {
              halfExtents: [2.5, 0.25, 1.5],
              orientation: aboutZ(Math.PI / 6),
            }),
            ...[0, 1, 2, 3].map((i) =>
              context.seed(`w${i}`, 'water', [(i % 2) - 0.5, 2.5, Math.floor(i / 2) - 0.5]),
            ),
          ],
          ['plate'],
        ),
      90,
      ['w0', 'w3'],
    ),
  },
  {
    id: 'stress-plate-squeezes-liquid',
    group: 'stress',
    why: 'A free plate lands on a nine-sample layer resting on a floor.',
    heavy: true,
    run: settle(
      (context) =>
        world(
          context,
          [
            context.seed('floor', 'ceramic', [0, 0, 0], { halfExtents: [3.5, 0.5, 3.5] }),
            ...waterBlock(context, 3, 1, 1),
            context.seed('press', 'copper', [0, 2.05, 0], { halfExtents: [1.5, 0.25, 1.5] }),
          ],
          ['floor'],
        ),
      60,
      ['press', 'w004'],
    ),
  },
  {
    id: 'stress-spinning-plate-in-liquid',
    group: 'stress',
    why: 'A plate spinning about its own axis sweeps an edge into a resting block, no gravity.',
    heavy: true,
    run: settle(
      (context) =>
        world(
          context,
          [
            ...waterBlock(context, 3, -1),
            context.seed('plate', 'copper', [-2.6, 0, 0], {
              halfExtents: [0.25, 1, 1],
              angularVelocity: [0, 1.5, 0],
            }),
          ],
          [],
          { gravity: [0, 0, 0] },
        ),
      120,
      ['plate'],
    ),
  },
  {
    id: 'stress-liquid-riding-falling-plate',
    group: 'stress',
    why: 'Nine samples ride a free plate that falls onto a floor.',
    heavy: true,
    run: settle(
      (context) =>
        world(
          context,
          [
            context.seed('floor', 'ceramic', [0, 0, 0], { halfExtents: [3.5, 0.5, 3.5] }),
            context.seed('tray', 'copper', [0, 2, 0], { halfExtents: [1.5, 0.25, 1.5] }),
            ...waterBlock(context, 3, 2.75, 1),
          ],
          ['floor'],
        ),
      90,
      ['tray', 'w004'],
    ),
  },
  {
    id: 'stress-liquid-in-v-wedge',
    group: 'stress',
    why: 'Two samples fall into the V between two fixed plates at plus and minus 45 degrees.',
    heavy: true,
    run: settle(
      (context) =>
        world(
          context,
          [
            context.seed('ramp-a', 'ceramic', [-1.5, 0, 0], {
              halfExtents: [2, 0.25, 1],
              orientation: aboutZ(-Math.PI / 4),
            }),
            context.seed('ramp-b', 'ceramic', [1.5, 0, 0], {
              halfExtents: [2, 0.25, 1],
              orientation: aboutZ(Math.PI / 4),
            }),
            context.seed('w0', 'water', [0, 1.5, 0]),
            context.seed('w1', 'water', [0, 2.6, 0]),
          ],
          ['ramp-a', 'ramp-b'],
        ),
      120,
      ['w0', 'w1'],
    ),
  },
  {
    id: 'stress-rigid-slot-wedge',
    group: 'stress',
    why: 'A cube falls into a slot exactly its own width, touching both walls and then the floor.',
    heavy: true,
    run: settle(
      (context) =>
        world(
          context,
          [
            context.seed('floor', 'ceramic', [0, 0, 0], { halfExtents: [2.5, 0.5, 1.5] }),
            context.seed('left', 'ceramic', [-1.5, 2, 0], { halfExtents: [1, 1.5, 1.5] }),
            context.seed('right', 'ceramic', [1.5, 2, 0], { halfExtents: [1, 1.5, 1.5] }),
            context.seed('cube', 'copper', [0, 3, 0]),
          ],
          ['floor', 'left', 'right'],
        ),
      90,
      ['cube'],
    ),
  },
  {
    id: 'stress-rigid-corner-impact',
    group: 'stress',
    why: 'A cube strikes a floor and a wall in the same tick, with restitution on both.',
    heavy: false,
    run: settle(
      (context) =>
        world(
          context,
          [
            context.seed('floor', 'ceramic', [0, 0, 0], { halfExtents: [3.5, 0.5, 1.5] }),
            context.seed('wall', 'ceramic', [-4, 2, 0], { halfExtents: [0.5, 2.5, 1.5] }),
            context.seed('cube', 'copper', [-2.5, 1.5, 0], { velocity: [-4, -4, 0] }),
          ],
          ['floor', 'wall'],
          { gravity: [0, 0, 0] },
        ),
      60,
      ['cube'],
    ),
  },
  {
    id: 'stress-rigid-pile',
    group: 'stress',
    why: 'Six loose cubes, three of them tilted, fall into a pile on a floor.',
    heavy: true,
    run: settle(
      (context) =>
        world(
          context,
          [
            context.seed('floor', 'ceramic', [0, 0, 0], { halfExtents: [4.5, 0.5, 4.5] }),
            ...[0, 1, 2, 3, 4, 5].map((i) =>
              context.seed(
                `c${i}`,
                'copper',
                [0.35 * (i % 3) - 0.35, 1.3 + 1.25 * i, 0.3 * (i % 2)],
                {
                  orientation: i % 2 ? aboutZ(0.3 + 0.1 * i) : [0, 0, 0, 1],
                },
              ),
            ),
          ],
          ['floor'],
        ),
      150,
      ['c0', 'c5'],
    ),
  },

  // --- Passing controls: must stay exactly as they are under exact-behaviour work ---------
  ...(
    [
      'wax-valve',
      'rotating-contact',
      'fluid-switch',
      'falling-battery',
      'combined-failure',
    ] as const
  ).map((name): FrozenCase3D => ({
    id: `control-${name}`,
    group: 'control',
    why: `Demonstration ${name}, 30 ticks.`,
    heavy: name !== 'rotating-contact' && name !== 'falling-battery',
    run: settle(
      (context) => context.engine.createMultiphysicsDemonstration3D(context.profiles, name),
      30,
    ),
  })),
  {
    id: 'control-combined-failure-to-break',
    group: 'control',
    why: 'The extended gate trajectory: release, break and eight further ticks.',
    heavy: true,
    run(context) {
      let state = context.engine.createMultiphysicsDemonstration3D(
          context.profiles,
          'combined-failure',
        ),
        releasedAt = -1,
        brokenAt = -1;
      for (let step = 0; step < 80 && brokenAt < 0; step++) {
        const next = context.advance(state, 1, (result) => {
          if (result.report.brokenBonds.some((b) => b.a === 'plate' || b.b === 'plate'))
            brokenAt = step;
        });
        if (next.rejected) return;
        state = next.snapshot;
        if (releasedAt < 0 && parcelOf(state, 'valve').material === 'molten_wax') releasedAt = step;
      }
      context.fact('releasedAt', releasedAt);
      context.fact('brokenAt', brokenAt);
      const { snapshot } = context.advance(state, 8);
      context.fact('plate.y', parcelOf(snapshot, 'plate').center[1]);
    },
  },
  {
    id: 'control-timed-cup',
    group: 'control',
    why: 'The 26-sample timed cup, the heaviest qualified interactive load, 6 ticks.',
    heavy: true,
    run: settle((context) => context.engine.createMultiphysicsTimedCup3D(context.profiles, 3), 6, [
      'body',
    ]),
  },
  {
    id: 'control-timed-cup-4',
    group: 'control',
    why: 'The 63-sample cup that misses the preview target, 2 ticks.',
    heavy: true,
    run: settle((context) => context.engine.createMultiphysicsTimedCup3D(context.profiles, 4), 2, [
      'body',
    ]),
  },
  {
    id: 'control-resolved-tank',
    group: 'control',
    why: 'The 99-sample resolved tank with a wax body, 2 ticks.',
    heavy: true,
    run: settle(
      (context) => context.engine.createMultiphysicsResolvedTank3D(context.profiles, 'wax'),
      2,
      ['body'],
    ),
  },
  {
    id: 'control-resting-cup',
    group: 'control',
    why: 'The sustained-rest gate scene, 27 samples in a closed cup, 6 ticks.',
    heavy: true,
    run: settle(
      (context) => world(context, [...cup(context, 3, 3), ...waterBlock(context, 3, 1)], CUP_WALLS),
      6,
      ['w013'],
    ),
  },
  {
    id: 'control-paddle-speed-half',
    group: 'control',
    why: 'The paddle at the passing gate speed, through impact.',
    heavy: true,
    run: paddle(0.5, 1 / 120, 221),
  },
]);
