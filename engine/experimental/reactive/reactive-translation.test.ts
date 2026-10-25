import { holdPhysics, STRUCTURAL_CALLS } from '../../test-support/hold-physics.js';
/** Tiny controlled-matter paths and reactive continuation; M5 stepping remains trapped. */
import { beforeAll, describe, expect, test, vi } from 'vitest';

import {
  createReactiveMaterialRegistry3D,
  defaultReactiveMaterialCatalog3D,
  createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit,
  createReactiveWorldSnapshot3D as state,
  readReactiveWorldSnapshot3D as read,
  createReactiveWorld3D as world,
  createReactiveTranslationJob3D as job,
  REACTIVE_TRANSLATION_LIMITS_3D,
  MAT,
  PHASE,
  ANCHOR_3D,
  BONDS_3D,
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialEdit3D,
  type ReactiveWorldSnapshot3D,
  type ReactiveTranslationRequest3D,
  type ReactiveTranslationJob3D,
  type ReactiveWorld3D,
  type ReactiveTranslationCoordinate3D,
  type ReactiveWorldTickJob3D,
} from '../reactive-materials.js';
holdPhysics('volumeStep', 'solveStructure3D', ...STRUCTURAL_CALLS);
let r: ReactiveMaterialRegistry3D, custom: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  const c = defaultReactiveMaterialCatalog3D();
  for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0;
  r = await createReactiveMaterialRegistry3D(c);
  const stone = structuredClone(r.material(MAT.STONE));
  Object.assign(stone.properties, {
    melt_point: 0,
    melts_into: 0,
    latent_heat_melt: 0,
    freeze_point: 0,
    boil_point: 0,
  });
  custom = await r.extend([
    { ...stone, id: 200, name: 'reactive_slab' },
    {
      ...stone,
      id: 201,
      name: 'fixed_shell',
      properties: { ...stone.properties, cohesion: 0, softening: 0 },
    },
    {
      ...stone,
      id: 202,
      name: 'fixed_crystal',
      properties: { ...stone.properties, cohesion: 0, softening: 0, default_phase: PHASE.FROZEN },
    },
  ]);
});
const at = { x: 0, y: 0, z: 0 };
const place = (
  x: number,
  y = 0,
  z = 0,
  material: number = MAT.STONE,
  thermal = 20,
): ReactiveMaterialEdit3D => ({ kind: 'place', x, y, z, material, thermal });
function fixture(
  edits: ReactiveMaterialEdit3D[],
  dimensions = { width: 5, height: 1, depth: 1 },
  registry = r,
  tick = 0,
) {
  expect(dimensions.width * dimensions.height * dimensions.depth).toBeLessThanOrEqual(125);
  return state(registry, edit(registry, block(registry, dimensions), edits).block, tick);
}
const request = (
  cells: readonly ReactiveTranslationCoordinate3D[] = [[1, 0, 0]],
  path: readonly ReactiveTranslationCoordinate3D[] = [[1, 0, 0]],
  options: Omit<ReactiveTranslationRequest3D, 'cells' | 'path'> = {},
): ReactiveTranslationRequest3D => ({ cells, path, ...options });
function finish(j: ReactiveTranslationJob3D) {
  let calls = 0;
  while (j.progress().status === 'running') {
    if (++calls > 9) throw Error('Tiny translation path exceeded eight steps.');
    j.advance();
  }
  return j.result();
}
function move(s: ReactiveWorldSnapshot3D, req = request(), registry = r) {
  return finish(job(registry, s, req));
}
function tick(w: ReactiveWorld3D) {
  const j = w.prepareTick();
  let calls = 0;
  while (j.progress().status === 'running') {
    if (++calls > 20 * 125 + 64) throw Error('Tiny world work bound exceeded.');
    j.advance(7);
  }
  return w.commitTick(j);
}
function slab() {
  return fixture([
    place(1, 0, 0, MAT.STONE, 70),
    place(2, 0, 0, MAT.STONE, 90),
    { ...at, x: 1, kind: 'bond', direction: 1, bonded: true },
    { ...at, x: 2, kind: 'integrity', integrity: 73 },
  ]);
}
describe('conservative reactive translation', () => {
  test('all six cardinal directions preserve a selected hot damaged cell', () => {
    for (const path of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      const s = fixture(
        [place(2, 2, 2, MAT.STONE, 70), { x: 2, y: 2, z: 2, kind: 'integrity', integrity: 73 }],
        { width: 5, height: 5, depth: 5 },
      );
      const out = move(s, request([[2, 2, 2]], [path])),
        destination = 62 + path[0] + 5 * path[1] + 25 * path[2];
      expect(out.receipt.sources).toEqual([62]);
      expect(out.receipt.destinations).toEqual([destination]);
      expect(out.state.block.packedCells[destination]).toBe(s.block.packedCells[62]);
      expect(out.state.block.energyQ[destination]).toBe(s.block.energyQ[62]);
      expect(out.state.block.structure[destination]).toBe(73);
      expect(read(r, out.state)).toEqual(out.state);
    }
  });
  test('overlapping runs rotate their terminal occupant without duplication or lost history', () => {
    const s = slab(),
      out = move(
        s,
        request([
          [1, 0, 0],
          [2, 0, 0],
        ]),
      );
    expect(out.state.block.structure).toEqual([0, 0, 255 | BONDS_3D[1], 73 | BONDS_3D[0], 0]);
    expect(out.state.block.energyQ.slice(2, 4)).toEqual(s.block.energyQ.slice(1, 3));
    expect(out.receipt.movement.moves).toEqual([
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 1 },
    ]);
    expect(out.receipt.steps).toEqual([
      {
        selectedSources: [1, 2],
        selectedDestinations: [2, 3],
        displaced: [{ from: 3, to: 1, origin: 3 }],
      },
    ]);
  });
  test('overlapping negative-axis runs rotate in the opposite direction exactly', () => {
    const s = slab(),
      out = move(
        s,
        request(
          [
            [2, 0, 0],
            [1, 0, 0],
          ],
          [[-1, 0, 0]],
        ),
      );
    expect(out.receipt.sources).toEqual([1, 2]);
    expect(out.receipt.destinations).toEqual([0, 1]);
    expect(out.state.block.structure.slice(0, 2)).toEqual(s.block.structure.slice(1, 3));
    expect(out.receipt.steps[0].displaced).toEqual([{ from: 0, to: 2, origin: 0 }]);
  });
  test('selection ordering cannot change canonical state or receipt', () => {
    const s = slab();
    expect(
      move(
        s,
        request([
          [2, 0, 0],
          [1, 0, 0],
        ]),
      ),
    ).toEqual(
      move(
        s,
        request([
          [1, 0, 0],
          [2, 0, 0],
        ]),
      ),
    );
  });
  test('disconnected runs each displace their own terminal occupant', () => {
    const s = fixture([place(1), place(3)], { width: 7, height: 1, depth: 1 }),
      out = move(
        s,
        request([
          [3, 0, 0],
          [1, 0, 0],
        ]),
      );
    expect(out.receipt.steps[0].displaced).toEqual([
      { from: 2, to: 1, origin: 2 },
      { from: 4, to: 3, origin: 4 },
    ]);
    expect(out.receipt.destinations).toEqual([2, 4]);
    expect(out.state.block.structure).toEqual([0, 0, 255, 0, 255, 0, 0]);
  });
  test('mobile water displacement carries its exact energy back to the run head', () => {
    const s = slab();
    const filled = { ...s, block: edit(r, s.block, [place(3, 0, 0, MAT.WATER, 80)]).block };
    const out = move(
      filled,
      request(
        [
          [1, 0, 0],
          [2, 0, 0],
        ],
        [[1, 0, 0]],
        { displacement: 'mobile' },
      ),
    );
    expect(out.state.block.packedCells[1]).toBe(filled.block.packedCells[3]);
    expect(out.state.block.energyQ[1]).toBe(filled.block.energyQ[3]);
    expect(out.receipt.energy.beforeQ).toBe(out.receipt.energy.afterQ);
    expect(out.receipt.externalEnergyQ).toBe('0');
  });
  test('default displacement rejects water even when it has no structural word', () => {
    const s = fixture([place(1), place(2, 0, 0, MAT.WATER, 50)]);
    expect(() => move(s)).toThrow(/obstructed/);
  });
  test('mobile policy admits sand smoke steam lava and fully broken cohesive debris', () => {
    for (const material of [MAT.SAND, MAT.SMOKE, MAT.STEAM, MAT.LAVA, MAT.STONE]) {
      const commands = [place(1), place(2, 0, 0, material)];
      if (material === MAT.STONE) commands.push({ ...at, x: 2, kind: 'integrity', integrity: 0 });
      const s = fixture(commands),
        out = move(s, request(undefined, undefined, { displacement: 'mobile' }));
      expect(out.state.block.packedCells[1]).toBe(s.block.packedCells[2]);
      expect(out.state.block.energyQ[1]).toBe(s.block.energyQ[2]);
    }
  });
  test('mobile policy rejects intact and anchored debris', () => {
    const intact = fixture([place(1), place(2)]),
      pinned = fixture([
        place(1),
        place(2),
        { ...at, x: 2, kind: 'integrity', integrity: 0 },
        { ...at, x: 2, kind: 'anchor', anchored: true },
      ]);
    for (const s of [intact, pinned])
      expect(() => move(s, request(undefined, undefined, { displacement: 'mobile' }))).toThrow(
        /obstructed/,
      );
  });
  test('custom cohesion determines whether zero-structure debris is movable', () => {
    const s = fixture(
      [place(1), place(2, 0, 0, 200), { ...at, x: 2, kind: 'integrity', integrity: 0 }],
      undefined,
      custom,
    );
    expect(
      move(s, request(undefined, undefined, { displacement: 'mobile' }), custom).state.block
        .packedCells[1] & 255,
    ).toBe(200);
  });
  test('custom noncohesive solid and frozen obstacles cannot become displacement holes', () => {
    for (const material of [201, 202]) {
      const s = fixture([place(1), place(2, 0, 0, material)], undefined, custom);
      expect(s.block.structure[2]).toBe(0);
      expect(() =>
        move(s, request(undefined, undefined, { displacement: 'mobile' }), custom),
      ).toThrow(/obstructed/);
    }
  });
  test('explicitly selected custom solid matter can be controlled without reseeding it', () => {
    const s = fixture([place(1, 0, 0, 201, 100)], undefined, custom),
      out = move(s, request(), custom);
    expect(out.state.block.packedCells[2]).toBe(s.block.packedCells[1]);
    expect(out.state.block.energyQ[2]).toBe(s.block.energyQ[1]);
    expect(out.state.block.structure[2]).toBe(0);
  });
  test('external bonds reject by default without touching either endpoint', () => {
    const s = slab(),
      before = structuredClone(s);
    expect(() => job(r, s, request([[2, 0, 0]]))).toThrow(/cut/);
    expect(s).toEqual(before);
  });
  test('explicit cuts preserve damage and remove reciprocal links only', () => {
    const s = slab(),
      out = move(s, request([[2, 0, 0]], [[1, 0, 0]], { externalBonds: 'cut' }));
    expect(out.receipt.cutBonds).toEqual([[1, 2]]);
    expect(out.state.block.structure).toEqual([0, 255, 0, 73, 0]);
    expect(out.receipt.changedCells).toEqual([1, 2, 3]);
    expect(out.state.block.energyQ[3]).toBe(s.block.energyQ[2]);
    expect(out.receipt.movement.touchedCells).toEqual([2, 3]);
    expect(out.receipt.movement.touchedOrigins).toEqual([2, 3]);
  });
  test('selected anchors require explicit release and cannot be accidentally copied to the destination', () => {
    const s = fixture([place(1), { ...at, x: 1, kind: 'anchor', anchored: true }]);
    expect(() => job(r, s, request())).toThrow(/release/);
    const out = move(s, request(undefined, undefined, { anchors: 'release' }));
    expect(out.receipt.releasedAnchors).toEqual([1]);
    expect(out.state.block.structure[2]).toBe(255);
  });
  test('cuts and releases leave unselected permanent anchors intact', () => {
    const s = {
      ...slab(),
      block: edit(r, slab().block, [
        { ...at, x: 1, kind: 'anchor', anchored: true },
        { ...at, x: 2, kind: 'anchor', anchored: true },
      ]).block,
    };
    const out = move(
      s,
      request([[2, 0, 0]], [[1, 0, 0]], { anchors: 'release', externalBonds: 'cut' }),
    );
    expect(out.state.block.structure[1]).toBe(255 | ANCHOR_3D);
    expect(out.state.block.structure[3]).toBe(73);
    expect(out.receipt.releasedAnchors).toEqual([2]);
  });
  test('contact with another solid never welds the moved slab to it', () => {
    const s = fixture([place(1), place(3)]),
      out = move(s);
    expect(out.state.block.structure).toEqual([0, 0, 255, 255, 0]);
    expect(out.receipt.cutBonds).toEqual([]);
  });
  test('a late closed-boundary failure discards all earlier private movement', () => {
    const s = slab(),
      before = structuredClone(s),
      j = job(
        r,
        s,
        request(
          [
            [1, 0, 0],
            [2, 0, 0],
          ],
          [
            [1, 0, 0],
            [1, 0, 0],
            [1, 0, 0],
          ],
        ),
      );
    j.advance();
    j.advance();
    expect(() => j.advance()).toThrow(/boundary/);
    expect(j.progress().status).toBe('cancelled');
    expect(j.progress().completedSteps).toBe(2);
    expect(() => j.result()).toThrow();
    expect(s).toEqual(before);
  });
  test('a late obstruction cannot publish earlier cuts anchor releases or path movement', () => {
    const s = fixture([
      place(0),
      place(1),
      place(3),
      { ...at, kind: 'bond', direction: 1, bonded: true },
      { ...at, x: 1, kind: 'anchor', anchored: true },
    ]);
    const before = structuredClone(s),
      j = job(
        r,
        s,
        request(
          undefined,
          [
            [1, 0, 0],
            [1, 0, 0],
          ],
          { externalBonds: 'cut', anchors: 'release' },
        ),
      );
    j.advance();
    expect(() => j.advance()).toThrow(/obstructed/);
    expect(s).toEqual(before);
    expect(() => j.result()).toThrow();
  });
  test('a clear endpoint does not permit tunneling through an intermediate solid', () => {
    const s = fixture([place(1), place(2)]);
    expect(() =>
      move(
        s,
        request(undefined, [
          [1, 0, 0],
          [1, 0, 0],
        ]),
      ),
    ).toThrow(/obstructed/);
  });
  test('direction changes preserve original identities and exact displaced provenance', () => {
    const s = fixture([place(1, 1, 1, MAT.WOOD, 181)], { width: 3, height: 3, depth: 3 });
    const out = move(
      s,
      request(
        [[1, 1, 1]],
        [
          [1, 0, 0],
          [0, -1, 0],
          [0, 0, 1],
        ],
      ),
    );
    expect(out.receipt.sources).toEqual([13]);
    expect(out.receipt.destinations).toEqual([20]);
    expect(out.receipt.steps.map((step) => step.selectedSources[0])).toEqual([13, 14, 11]);
    expect(out.receipt.steps.map((step) => step.displaced[0])).toEqual([
      { from: 14, to: 13, origin: 14 },
      { from: 11, to: 14, origin: 11 },
      { from: 20, to: 11, origin: 20 },
    ]);
    expect(out.state.block.energyQ[20]).toBe(s.block.energyQ[13]);
  });
  test('out-and-back motion retains touched identities and steps despite no net change', () => {
    const s = fixture([place(1, 0, 0, MAT.WOOD, 181)]),
      out = move(
        s,
        request(undefined, [
          [1, 0, 0],
          [-1, 0, 0],
        ]),
      );
    expect(out.state).toEqual(s);
    expect(out.receipt.changedCells).toEqual([]);
    expect(out.receipt.movement.moves).toEqual([]);
    expect(out.receipt.movement.touchedCells).toEqual([1, 2]);
    expect(out.receipt.movement.touchedOrigins).toEqual([1, 2]);
    expect(out.receipt.steps).toHaveLength(2);
  });
  test('one call executes exactly one path step then publication requires a final boundary', () => {
    const j = job(
      r,
      fixture([place(1)]),
      request(undefined, [
        [1, 0, 0],
        [1, 0, 0],
      ]),
    );
    expect(j.progress()).toEqual({
      status: 'running',
      phase: 'translate',
      completedSteps: 0,
      totalSteps: 2,
    });
    j.advance();
    expect(j.progress().completedSteps).toBe(1);
    expect(() => j.result()).toThrow();
    j.advance();
    expect(j.progress().phase).toBe('publish');
    expect(() => j.result()).toThrow();
    j.advance();
    expect(j.progress().status).toBe('complete');
  });
  test('cancellation at every incomplete path boundary preserves input and history', () => {
    const s = fixture([place(1)]),
      before = structuredClone(s),
      req = request(undefined, [
        [1, 0, 0],
        [-1, 0, 0],
      ]);
    for (let stop = 0; stop <= 2; stop++) {
      const j = job(r, s, req);
      for (let i = 0; i < stop; i++) j.advance();
      expect(j.cancel()).toBe(true);
      expect(j.cancel()).toBe(false);
      expect(() => j.result()).toThrow();
      expect(() => j.advance()).toThrow();
      expect(s).toEqual(before);
    }
  });
  test('source request and result mutation cannot alter captured work or retained output', () => {
    const s = slab(),
      req = request([
        [1, 0, 0],
        [2, 0, 0],
      ]),
      expected = move(s, req),
      j = job(r, s, req);
    s.block.energyQ.fill(0);
    s.block.structure.fill(0);
    (req.cells as unknown as number[][])[0][0] = 99;
    (req.path as unknown as number[][])[0][0] = -1;
    const p = j.progress();
    p.status = 'cancelled';
    expect(finish(j)).toEqual(expected);
    const result = j.result();
    result.state.block.structure.fill(0);
    result.receipt.steps[0].displaced[0].origin = 99;
    result.receipt.sources.length = 0;
    result.receipt.movement.touchedOrigins.length = 0;
    expect(j.result()).toEqual(expected);
    expect(j.cancel()).toBe(false);
    expect(() => j.advance()).toThrow();
  });
  test('JSON continuation and an equivalent catalog produce identical translation results', async () => {
    const s = fixture([place(1)], undefined, r, 7),
      next = move(s),
      registry = await createReactiveMaterialRegistry3D(JSON.parse(JSON.stringify(r.toCatalog())));
    const req = request([[2, 0, 0]], [[1, 0, 0]]);
    expect(move(read(registry, JSON.parse(JSON.stringify(next.state))), req, registry)).toEqual(
      move(next.state, req),
    );
    expect(next.state.tick).toBe(7);
    expect(next.receipt.tick).toBe(7);
  });
  test('invalid selection identities coordinates and path steps fail before publication', () => {
    const s = fixture([place(1)]),
      cases = [
        request([]),
        request([[0, 0, 0]]),
        request([
          [1, 0, 0],
          [1, 0, 0],
        ]),
        request([[5, 0, 0]]),
        request([[1.5, 0, 0]]),
        request(undefined, []),
        request(undefined, [[0, 0, 0]]),
        request(undefined, [[1, 1, 0]]),
        request(undefined, [[2, 0, 0]]),
      ];
    for (const req of cases) expect(() => job(r, s, req)).toThrow();
    expect(s).toEqual(fixture([place(1)]));
  });
  test('strict optional policy and record validation reject explicit undefined unknown and hidden fields', () => {
    const s = fixture([place(1)]),
      base = request();
    for (const bad of [
      { ...base, anchors: undefined },
      { ...base, externalBonds: null },
      { ...base, displacement: 'all' },
      { ...base, extra: true },
      null,
      Object.defineProperty({ ...base }, 'hidden', { value: 1 }),
      { ...base, [Symbol('x')]: 1 },
    ])
      expect(() => job(r, s, bad as ReactiveTranslationRequest3D)).toThrow();
  });
  test('sparse decorated typed-array and accessor requests reject without getter execution', () => {
    const s = fixture([place(1)]),
      getter = vi.fn(() => [[1, 0, 0]]),
      base = request();
    const accessor = Object.defineProperty({ ...base }, 'cells', { get: getter, enumerable: true });
    const decorated = Object.assign([[1, 0, 0]], { x: 1 });
    const coordinateGetter = Object.defineProperty([1, 0, 0], '0', { get: getter });
    for (const bad of [
      accessor,
      { ...base, cells: new Array(1) },
      { ...base, cells: decorated },
      { ...base, path: [new Int32Array([1, 0, 0])] },
      { ...base, cells: [coordinateGetter] },
    ])
      expect(() => job(r, s, bad as ReactiveTranslationRequest3D)).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
  test('bounded selection path and cell-step limits reject oversized work before stepping', () => {
    expect(Object.isFrozen(REACTIVE_TRANSLATION_LIMITS_3D)).toBe(true);
    const s = fixture([place(1)]),
      base = request();
    for (const bad of [
      { ...base, cells: new Array(32769).fill([1, 0, 0]) },
      { ...base, path: new Array(385).fill([1, 0, 0]) },
      { cells: new Array(32768).fill([1, 0, 0]), path: new Array(8).fill([1, 0, 0]) },
    ])
      expect(() => job(r, s, bad)).toThrow();
  });
  test('catalog mismatch and malformed world snapshots fail without normalization', () => {
    const s = slab(),
      bad = structuredClone(s);
    bad.block.structure[1] = 255;
    expect(() =>
      job(
        r,
        bad,
        request([
          [1, 0, 0],
          [2, 0, 0],
        ]),
      ),
    ).toThrow();
    expect(() => job(custom, s, request())).toThrow();
    expect(() =>
      job(r, { ...s, rulesVersion: 'ca-3d-m5' } as unknown as ReactiveWorldSnapshot3D, request()),
    ).toThrow();
  });
});
describe('reactive-world translation commit and physical continuation', () => {
  test('prepared translation remains isolated until a complete same-revision commit', () => {
    const s = slab(),
      w = world(r, s.block, 3),
      before = w.snapshot(),
      balance = w.energyBalance(),
      j = w.prepareTranslation(
        request([
          [1, 0, 0],
          [2, 0, 0],
        ]),
      );
    j.advance();
    expect(w.snapshot()).toEqual(before);
    expect(() => w.commitTranslation(j)).toThrow(/complete/);
    j.advance();
    const receipt = w.commitTranslation(j);
    expect(receipt.fromRevision).toBe(0);
    expect(receipt.toRevision).toBe(1);
    expect(w.tick).toBe(3);
    expect(w.snapshot()).toEqual(j.result().state);
    expect(w.energyBalance()).toEqual(balance);
    expect(receipt.receipt).toEqual(j.result().receipt);
  });
  test('cancelled consumed and foreign translation jobs cannot publish', () => {
    const s = fixture([place(1)]),
      a = world(r, s.block),
      b = world(r, s.block),
      foreign = b.prepareTranslation(request());
    finish(foreign);
    expect(() => a.commitTranslation(foreign)).toThrow(/foreign/);
    const cancelled = a.prepareTranslation(request());
    cancelled.cancel();
    expect(() => a.commitTranslation(cancelled)).toThrow();
    const j = a.prepareTranslation(request());
    finish(j);
    a.commitTranslation(j);
    const before = a.snapshot();
    expect(() => a.commitTranslation(j)).toThrow(/consumed/);
    expect(a.snapshot()).toEqual(before);
  });
  test('edits restore and sibling translation commit invalidate old translation jobs', () => {
    for (const change of ['edit', 'restore', 'translation']) {
      const w = world(r, fixture([place(1)]).block),
        a = w.prepareTranslation(request()),
        b = w.prepareTranslation(request());
      finish(a);
      finish(b);
      if (change === 'edit') w.edit([]);
      else if (change === 'restore') w.restore(w.snapshot());
      else w.commitTranslation(b);
      const before = w.snapshot();
      expect(() => w.commitTranslation(a)).toThrow(/stale/);
      expect(w.snapshot()).toEqual(before);
    }
  });
  test('tick and translation commits invalidate each other without crossing capability types', () => {
    const w = world(r, fixture([place(1)], { width: 5, height: 2, depth: 1 }).block),
      translated = w.prepareTranslation(request()),
      ticking = w.prepareTick();
    finish(translated);
    expect(() => w.commitTick(translated as unknown as ReactiveWorldTickJob3D)).toThrow(/foreign/);
    expect(() => w.commitTranslation(ticking as unknown as ReactiveTranslationJob3D)).toThrow(
      /foreign/,
    );
    w.commitTranslation(translated);
    expect(() => w.commitTick(ticking)).toThrow(/stale/);
    ticking.cancel();
    const other = w.prepareTranslation(request([[2, 0, 0]]));
    finish(other);
    tick(w);
    const before = w.snapshot();
    expect(() => w.commitTranslation(other)).toThrow(/stale/);
    expect(w.snapshot()).toEqual(before);
  });
  test('late failed translation leaves revision accounting and a sibling tick usable', () => {
    const s = fixture([place(1), place(3)]),
      w = world(r, s.block),
      before = w.snapshot(),
      balance = w.energyBalance(),
      j = w.prepareTranslation(
        request(undefined, [
          [1, 0, 0],
          [1, 0, 0],
        ]),
      );
    j.advance();
    expect(() => j.advance()).toThrow(/obstructed/);
    expect(() => w.commitTranslation(j)).toThrow();
    expect(w.snapshot()).toEqual(before);
    expect(w.energyBalance()).toEqual(balance);
    expect(w.revision).toBe(0);
    expect(tick(w).toRevision).toBe(1);
  });
  test('swallowed reentrant mutation during request validation poisons translation preparation', () => {
    const w = world(r, fixture([place(1)]).block),
      before = w.snapshot();
    let attempted = false;
    const req = new Proxy(request(), {
      ownKeys(target) {
        if (!attempted) {
          attempted = true;
          try {
            w.edit([]);
          } catch {}
        }
        return Reflect.ownKeys(target);
      },
    });
    expect(() => w.prepareTranslation(req)).toThrow(/reentry/);
    expect(w.snapshot()).toEqual(before);
    expect(w.revision).toBe(0);
    const j = w.prepareTranslation(request());
    finish(j);
    expect(w.commitTranslation(j).toRevision).toBe(1);
  });
  test('a lifted hot damaged slab falls on the next physical tick with its history intact', () => {
    const s = fixture(
      [
        place(1, 3, 0, MAT.STONE, 70),
        place(2, 3, 0, MAT.STONE, 90),
        { ...at, x: 1, y: 3, kind: 'bond', direction: 1, bonded: true },
        { ...at, x: 2, y: 3, kind: 'integrity', integrity: 73 },
      ],
      { width: 4, height: 4, depth: 1 },
    );
    const w = world(r, s.block),
      lifted = w.prepareTranslation(
        request(
          [
            [1, 3, 0],
            [2, 3, 0],
          ],
          [[0, -1, 0]],
        ),
      );
    finish(lifted);
    w.commitTranslation(lifted);
    const result = tick(w);
    expect(w.snapshot().block).toEqual(s.block);
    expect(w.tick).toBe(1);
    expect(w.revision).toBe(2);
    expect(result.report.structure.movingCells).toEqual([9, 10]);
    expect(w.energyBalance().driftQ).toBe(0n);
  });
  test('moved hot fuel retains chemical and thermal history and then burns under ordinary world rules', () => {
    const s = fixture([place(0, 0, 0, MAT.WOOD, 181)], { width: 3, height: 3, depth: 1 }),
      w = world(r, s.block),
      moved = w.prepareTranslation(request([[0, 0, 0]]));
    finish(moved);
    w.commitTranslation(moved);
    expect(w.snapshot().block.energyQ[1]).toBe(s.block.energyQ[0]);
    expect(w.energyLedger().chemicalQ).toBe(80n * 256n);
    const out = tick(w);
    expect(out.report.evolution.reactions.reactedPairs[0].fuel).toBe(1);
    expect(w.snapshot().block.packedCells[1] & 255).toBe(MAT.ASH);
    expect(w.energyBalance().externalQ).toBe(0n);
    expect(w.energyBalance().driftQ).toBe(0n);
  });
  test('saved translated worlds continue with identical physical reports after JSON restart', () => {
    const s = fixture([place(1, 1, 0, MAT.STONE, 70)], { width: 4, height: 4, depth: 1 }),
      a = world(r, s.block, 3),
      b = world(r, s.block);
    const moved = a.prepareTranslation(request([[1, 1, 0]]));
    finish(moved);
    const receipt = a.commitTranslation(moved);
    b.restore(JSON.parse(JSON.stringify(a.snapshot())));
    receipt.receipt.steps[0].displaced.length = 0;
    receipt.receipt.movement.moves.length = 0;
    expect(tick(b).report).toEqual(tick(a).report);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(a.energyBalance().driftQ).toBe(0n);
    expect(b.energyBalance().driftQ).toBe(0n);
  });
});
