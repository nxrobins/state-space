/** Tiny real reactive kernels only; legacy physical execution remains trapped. */
import { beforeAll, afterAll, describe, expect, test, vi } from 'vitest';
import * as mechanics from './structural-mechanics.js';
import { CpuStructuralWorld3D } from './structural-world-core.js';
import { CpuVolume } from './3d-core.js';
import { createReactiveMaterialRegistry3D, defaultReactiveMaterialCatalog3D, createReactiveMaterialBlock3D as block,
  editReactiveMaterialBlock3D as edit, createReactiveWorldSnapshot3D as snapshot, createConstrainedReactiveWorldSnapshot3D as constrained,
  createReactiveDomainsSnapshot3D as domains, readReactiveDomainsSnapshot3D as read, createReactiveDomainSet3D as owner,
  createReactiveTransferJob3D as transfer, createReactiveDomainsTickJob3D as groupTick, createReactiveWorldTickJob3D as worldTick,
  REACTIVE_DOMAINS_LIMITS_3D, REACTIVE_TRANSFER_LIMITS_3D, MAT, BONDS_3D, ANCHOR_3D,
  type ReactiveMaterialRegistry3D, type ReactiveMaterialEdit3D, type ReactiveDomainsSnapshot3D,
  type ReactiveDomainSet3D, type ReactiveTransferRequest3D, type ReactiveTransferJob3D } from './reactive-materials.js';
const guards = [vi.spyOn(CpuVolume.prototype, 'step'), vi.spyOn(mechanics, 'solveStructure3D'),
  ...(['step', 'stepWithMotion', 'stepWithMotionPaths', 'inspectStructure'] as const).map(k => vi.spyOn(CpuStructuralWorld3D.prototype, k))];
for (const g of guards) g.mockImplementation(() => {throw Error('Existing world runtime held.');});
afterAll(() => {for (const g of guards) {expect(g).not.toHaveBeenCalled(); g.mockRestore();}});
let r: ReactiveMaterialRegistry3D, custom: ReactiveMaterialRegistry3D;
beforeAll(async () => {
  const c = defaultReactiveMaterialCatalog3D(); for (const m of c.propertiesCatalog.materials) m.properties.conductivity = 0;
  r = await createReactiveMaterialRegistry3D(c);
  custom = await r.extend([{...structuredClone(r.material(MAT.STONE)), id: 200, name: 'fixed_shell',
    properties: {...r.material(MAT.STONE).properties, cohesion: 0, softening: 0, melt_point: 0, melts_into: 0, latent_heat_melt: 0}},
    {...structuredClone(r.material(MAT.WOOD)), id: 201, name: 'reactive_resin'}]);
});
const p = {x: 0, y: 0, z: 0}, dims = {width: 3, height: 3, depth: 1};
const place = (x = 0, y = 0, z = 0, material: number = MAT.WATER, thermal = 40): ReactiveMaterialEdit3D => ({kind: 'place', x, y, z, material, thermal});
const state = (edits: ReactiveMaterialEdit3D[] = [], shape = dims, tick = 0, registry = r) => snapshot(registry, edit(registry, block(registry, shape), edits).block, tick);
function setup(primary = state([place()]), flask = state(), registry = r): ReactiveDomainSet3D {
  expect(primary.block.packedCells.length + flask.block.packedCells.length).toBeLessThanOrEqual(125);
  return owner(registry, primary, [{id: 'flask', world: flask}]);
}
const request = (extra: Partial<ReactiveTransferRequest3D> = {}): ReactiveTransferRequest3D => ({from: null, to: 'flask', cells: [[0, 0, 0]], offset: [0, 0, 0], ...extra});
function finish<T>(j: {progress(): {status: string}; advance(work?: number): unknown; result(): T}, budget = 7): T {
  let calls = 0; while (j.progress().status === 'running') {if (++calls > 20 * 125 * 8 + 512) throw Error('Tiny domain job exceeded its work bound.'); j.advance(budget);} return j.result();
}
function exchange(s: ReactiveDomainSet3D, req = request(), budget = 1) {const j = s.prepareTransfer(req); finish(j, budget); return s.commitTransfer(j);}
function tick(s: ReactiveDomainSet3D, budget = 7) {const j = s.prepareTick(); finish(j, budget); return s.commitTick(j);}
function tuples(s: ReactiveDomainsSnapshot3D) {return [s.world, ...s.reservoirs.map(d => d.world)].flatMap(d => d.block.packedCells.map((v, i) => `${v}:${d.block.energyQ[i]}:${d.block.structure[i]}`)).sort();}

describe('reactive reservoir saves and conservative transfers', () => {
  test('saves own canonical reservoirs while preserving each original world format', () => {
    const a = state(), b = constrained(r, a.block), raw = domains(r, a, [{id: 'z', world: b}, {id: 'a', world: a}]);
    expect(raw.rulesVersion).toBe('reactive-domains-1'); expect(raw.reservoirs.map(d => d.id)).toEqual(['a', 'z']);
    expect(raw.world.schemaVersion).toBe(1); expect(raw.reservoirs[1].world.schemaVersion).toBe(2);
    a.block.energyQ[0] = 0; b.holds.push({id: 'fake', cells: [0], expiresAtTick: 2}); expect(read(r, raw)).toEqual(raw);
  });
  test('water extraction exchanges hot air rather than deleting its volume or energy', () => {
    const a = state([place(0, 0, 0, MAT.WATER, 80)]), b = state([place(0, 0, 0, MAT.AIR, 100)]), s = setup(a, b), before = s.snapshot();
    const out = exchange(s); expect(tuples(s.snapshot())).toEqual(tuples(before)); expect(s.domain(null).block.energyQ[0]).toBe(b.block.energyQ[0]);
    expect(s.domain('flask').block.packedCells[0]).toBe(a.block.packedCells[0]); expect(s.domain('flask').block.energyQ[0]).toBe(a.block.energyQ[0]);
    expect(out.receipt.sourceEnergyDeltaQ).toBe((BigInt(b.block.energyQ[0]) - BigInt(a.block.energyQ[0])).toString());
    expect(BigInt(out.receipt.sourceEnergyDeltaQ) + BigInt(out.receipt.destinationEnergyDeltaQ)).toBe(0n);
    expect(out.receipt.externalEnergyQ).toBe('0'); expect(s.energyBalance().externalQ).toBe(0n); expect(s.energyBalance().driftQ).toBe(0n); expect(s.tick).toBe(0);
  });
  test('reverse transfer restores every coordinate and combined accounting exactly', () => {
    const s = setup(), before = s.snapshot(), balance = s.energyBalance(); exchange(s); exchange(s, request({from: 'flask', to: null}));
    expect(s.snapshot()).toEqual(before); expect(s.energyBalance()).toEqual(balance); expect(s.revision).toBe(2);
  });
  test('offsets work along all six axis directions without changing transported history', () => {
    const shape = {width: 3, height: 3, depth: 3};
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const a = state([place(1, 1, 1, MAT.STONE, 70), {kind: 'integrity', x: 1, y: 1, z: 1, integrity: 73}], shape), s = setup(a, state([], shape));
      const offset: [number, number, number] = [0, 0, 0]; offset[axis] = sign;
      const out = exchange(s, request({cells: [[1, 1, 1]], offset})); const i = out.receipt.destinations[0];
      expect(s.domain('flask').block.packedCells[i]).toBe(a.block.packedCells[13]); expect(s.domain('flask').block.energyQ[i]).toBe(a.block.energyQ[13]); expect(s.domain('flask').block.structure[i]).toBe(73);
    }
  });
  test('bonded slabs retain damage heat and internal bonds on every axis across rectangular geometry', () => {
    for (let axis = 0; axis < 3; axis++) {
      const c: [number, number, number] = [0, 0, 0]; c[axis] = 1;
      const a = state([place(0, 0, 0, MAT.STONE, 70), place(...c, MAT.STONE, 90), {...p, kind: 'bond', direction: 2 * axis + 1, bonded: true}, {...p, kind: 'integrity', integrity: 73}], {width: 2, height: 3, depth: 2});
      const s = setup(a, state([], {width: 4, height: 3, depth: 3})), before = s.snapshot(), out = exchange(s, request({cells: [c, [0, 0, 0]], offset: [1, 1, 1]}));
      expect(tuples(s.snapshot())).toEqual(tuples(before)); expect(s.domain('flask').block.structure[out.receipt.destinations[0]]).toBe(73 | BONDS_3D[2 * axis + 1]);
    }
  });
  test('external bonds reject by default and explicit cuts update both source endpoints without welding', () => {
    const a = state([place(0, 0, 0, MAT.STONE), place(1, 0, 0, MAT.STONE), {...p, kind: 'bond', direction: 1, bonded: true}]);
    const s = setup(a, state([place(1, 0, 0, MAT.STONE)])), before = s.snapshot(); expect(() => s.prepareTransfer(request())).toThrow(/cut/); expect(s.snapshot()).toEqual(before);
    const out = exchange(s, request({externalBonds: 'cut'})); expect(out.receipt.cutBonds).toEqual([[0, 1]]); expect(out.receipt.sourceChangedCells).toEqual([0, 1]);
    expect(s.domain(null).block.structure[1]).toBe(255); expect(s.domain('flask').block.structure.slice(0, 2)).toEqual([255, 255]);
  });
  test('permanent anchors require explicit release and never hitchhike into storage', () => {
    const s = setup(state([place(0, 0, 0, MAT.STONE), {...p, kind: 'anchor', anchored: true}]));
    expect(() => s.prepareTransfer(request())).toThrow(/release/); const out = exchange(s, request({anchors: 'release'}));
    expect(out.receipt.releasedAnchors).toEqual([0]); expect(s.domain('flask').block.structure[0]).toBe(255); expect(s.domain(null).block.structure[0] & ANCHOR_3D).toBe(0);
  });
  test('mobile displacement conserves water steam smoke lava powder and failed debris', () => {
    for (const material of [MAT.WATER, MAT.STEAM, MAT.SMOKE, MAT.LAVA, MAT.SAND, MAT.STONE]) {
      const edits = [place(0, 0, 0, material)]; if (material === MAT.STONE) edits.push({...p, kind: 'integrity', integrity: 0});
      const s = setup(state([place(0, 0, 0, MAT.ICE, 10)]), state(edits)), before = s.snapshot();
      const blocked = s.prepareTransfer(request()); expect(() => blocked.advance()).toThrow(/obstructed/);
      exchange(s, request({displacement: 'mobile'})); expect(tuples(s.snapshot())).toEqual(tuples(before)); expect(s.domain(null).block.packedCells[0] & 255).toBe(material);
    }
  });
  test('catalog-specific fixed noncohesive solids remain obstacles despite zero structural words', () => {
    const s = setup(state([place()], dims, 0, custom), state([place(0, 0, 0, 200)], dims, 0, custom), custom);
    const j = s.prepareTransfer(request({displacement: 'mobile'})); expect(() => j.advance()).toThrow(/obstructed/); expect(s.revision).toBe(0);
  });
  test('selected custom matter transfers without receiving default material properties', () => {
    const s = setup(state([place(0, 0, 0, 201, 90), {...p, kind: 'integrity', integrity: 57}], dims, 0, custom), state([], dims, 0, custom), custom), before = s.snapshot();
    exchange(s); expect(tuples(s.snapshot())).toEqual(tuples(before)); expect(s.domain('flask').block.structure[0]).toBe(57);
  });
  test('intact and anchored destination structures cannot be erased by mobile transfer', () => {
    for (const edits of [[place(0, 0, 0, MAT.ICE)], [place(0, 0, 0, MAT.STONE), {...p, kind: 'integrity' as const, integrity: 0}, {...p, kind: 'anchor' as const, anchored: true}]]) {
      const s = setup(state([place()]), state(edits)), before = s.snapshot(), j = s.prepareTransfer(request({displacement: 'mobile'}));
      expect(() => j.advance()).toThrow(/obstructed/); expect(s.snapshot()).toEqual(before);
    }
  });
  test('source holds require explicit release independently of permanent-anchor policy', () => {
    const s = setup(state([place(0, 0, 0, MAT.STONE)])); s.hold(null, {id: 'lift', expiresAtTick: 2, cells: [[0, 0, 0]]});
    expect(() => s.prepareTransfer(request({anchors: 'release'}))).toThrow(/held/); s.releaseHold(null, 'lift'); exchange(s); expect(s.domain('flask').block.structure[0]).toBe(255);
  });
  test('a held failed destination blocks displacement and unrelated holds retain lifetime', () => {
    const s = setup(state([place()]), state([place(0, 0, 0, MAT.STONE), {...p, kind: 'integrity', integrity: 0}, place(1, 0, 0, MAT.STONE)]));
    s.hold('flask', {id: 'broken', expiresAtTick: 2, cells: [[0, 0, 0]]}); s.hold('flask', {id: 'other', expiresAtTick: 3, cells: [[1, 0, 0]]});
    const j = s.prepareTransfer(request({displacement: 'mobile'})); expect(() => j.advance()).toThrow(/obstructed/);
    s.releaseHold('flask', 'broken'); exchange(s, request({displacement: 'mobile'})); const out = s.domain('flask'); expect(out.schemaVersion === 2 && out.holds).toEqual([{id: 'other', expiresAtTick: 3, cells: [1]}]);
  });
  test('reservoir-to-reservoir exchange leaves the primary world and its holds untouched', () => {
    const a = constrained(r, state([place(0, 0, 0, MAT.STONE)]).block, 0, [{id: 'held', expiresAtTick: 2, cells: [0]}]);
    const s = owner(r, a, [{id: 'first', world: state([place()])}, {id: 'second', world: state()}]);
    exchange(s, request({from: 'first', to: 'second'})); expect(s.domain(null)).toEqual(a); expect(s.domain('second').block.packedCells[0] & 255).toBe(MAT.WATER);
  });
  test('selection order and slice budgets produce identical complete states and receipts', () => {
    const s = setup(state([place(), place(1), place(2)])), raw = s.snapshot();
    const a = finish(transfer(r, raw, request({cells: [[2, 0, 0], [0, 0, 0], [1, 0, 0]]})), 1);
    const b = finish(transfer(r, raw, request({cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0]]})), 256); expect(a).toEqual(b);
  });
  test('partial swaps have no public result and require a separate publication boundary', () => {
    const s = setup(state([place(), place(1)])), before = s.snapshot(), j = s.prepareTransfer(request({cells: [[0, 0, 0], [1, 0, 0]]}));
    expect(j.advance(1)).toMatchObject({completedPairs: 1, lastAdvanceWork: 1, phase: 'swap'}); expect(() => j.result()).toThrow(); expect(s.snapshot()).toEqual(before);
    expect(j.advance(1).phase).toBe('publish'); expect(() => s.commitTransfer(j)).toThrow(); j.advance(1); expect(s.snapshot()).toEqual(before); s.commitTransfer(j);
  });
  test('late obstruction rolls back earlier private exchanges and preserves a sibling tick', () => {
    const s = setup(state([place(), place(1)]), state([place(1, 0, 0, MAT.STONE)])), before = s.snapshot(), balance = s.energyBalance(), sibling = s.prepareTick();
    const j = s.prepareTransfer(request({cells: [[0, 0, 0], [1, 0, 0]]})); j.advance(1); expect(() => j.advance(1)).toThrow(/obstructed/);
    expect(j.progress().status).toBe('cancelled'); expect(() => s.commitTransfer(j)).toThrow(); expect(s.snapshot()).toEqual(before); expect(s.energyBalance()).toEqual(balance);
    finish(sibling); s.commitTick(sibling);
  });
  test('cancellation after each incomplete transfer boundary discards cuts releases and swaps', () => {
    const a = state([place(0, 0, 0, MAT.STONE), place(1, 0, 0, MAT.STONE), {...p, kind: 'bond', direction: 1, bonded: true}, {...p, kind: 'anchor', anchored: true}]);
    for (let stop = 0; stop < 2; stop++) {const s = setup(a), before = s.snapshot(), j = s.prepareTransfer(request({externalBonds: 'cut', anchors: 'release'}));
      if (stop) j.advance(1); expect(j.cancel()).toBe(true); expect(j.cancel()).toBe(false); expect(() => s.commitTransfer(j)).toThrow(); expect(s.snapshot()).toEqual(before); expect(s.revision).toBe(0);}
  });
  test('identical tuple exchanges retain correspondence even when both net diffs are empty', () => {
    const a = state([place(0, 0, 0, MAT.STONE), {...p, kind: 'integrity', integrity: 0}]), s = setup(a, a), before = s.snapshot();
    const out = exchange(s, request({displacement: 'mobile'})); expect(s.snapshot()).toEqual(before); expect(out.receipt.sources).toEqual([0]); expect(out.receipt.destinations).toEqual([0]);
    expect(out.receipt.sourceChangedCells).toEqual([]); expect(out.receipt.destinationChangedCells).toEqual([]);
  });
  test('requests inputs and results own their arrays and cannot alter eventual committed state', () => {
    const s = setup(), before = s.snapshot(), req = request(), j = s.prepareTransfer(req); (req.cells as unknown as number[][])[0][0] = 2; (req.offset as unknown as number[])[0] = 2;
    const result = finish(j); result.state.reservoirs[0].world.block.energyQ[0] = 0; result.receipt.sources.length = 0;
    const out = s.commitTransfer(j); out.receipt.sources.length = 0; expect(s.domain('flask').block.energyQ[0]).toBe(before.world.block.energyQ[0]);
    const readback = s.domain('flask'); readback.block.energyQ[0] = 0; expect(s.domain('flask').block.energyQ[0]).toBe(before.world.block.energyQ[0]);
  });
  test('strict malformed selections offsets policies and domain identities reject without mutation', () => {
    const s = setup(), before = s.snapshot(); const bad = [null, request({from: 'missing'}), request({to: null}), request({cells: []}), request({cells: [[0, 0, 0], [0, 0, 0]]}),
      request({cells: [[1, 0, 0]]}), request({cells: [[3, 0, 0]]}), request({offset: [Number.MAX_SAFE_INTEGER, 0, 0]}), request({offset: [0.5, 0, 0]}),
      {...request(), anchors: undefined}, {...request(), displacement: 'overwrite'}, {...request(), cells: new Array(1)}, {...request(), offset: [0, 0]}, {...request(), extra: true}];
    for (const value of bad) {expect(() => s.prepareTransfer(value as ReactiveTransferRequest3D)).toThrow(); expect(s.snapshot()).toEqual(before); expect(s.revision).toBe(0);}
  });
  test('accessor requests and saves reject without invoking user getters', () => {
    const s = setup(), getter = vi.fn(() => 'flask'), req = request(); Object.defineProperty(req, 'to', {get: getter, enumerable: true}); expect(() => s.prepareTransfer(req)).toThrow();
    const raw = s.snapshot(); Object.defineProperty(raw.reservoirs[0], 'world', {get: getter, enumerable: true}); expect(() => s.restore(raw)).toThrow(); expect(getter).not.toHaveBeenCalled(); expect(s.revision).toBe(0);
  });
  test('invalid work budgets reject before any additional private work', () => {
    const j = transfer(r, setup().snapshot(), request()), before = j.progress(); for (const n of [0, 257, NaN, 1.5]) {expect(() => j.advance(n)).toThrow(); expect(j.progress()).toEqual(before);} j.cancel();
    expect(Object.isFrozen(REACTIVE_TRANSFER_LIMITS_3D)).toBe(true); expect(Object.isFrozen(REACTIVE_DOMAINS_LIMITS_3D)).toBe(true);
  });
});

describe('atomic synchronized reactive domains', () => {
  test('one domain set tick equals the same complete kernel run independently on each domain', () => {
    const s = setup(state([place(0, 0, 0, MAT.STONE)]), state([place()])), before = s.snapshot(), a = finish(worldTick(r, before.world)), b = finish(worldTick(r, before.reservoirs[0].world));
    const out = tick(s); expect(s.domain(null)).toEqual(a.state); expect(s.domain('flask')).toEqual(b.state); expect(out.receipt.domains).toEqual([{id: null, report: a.report}, {id: 'flask', report: b.report}]);
    expect(s.tick).toBe(1); expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('a completed primary tick remains private until every reservoir and publication finish', () => {
    const s = setup(), before = s.snapshot(), j = s.prepareTick(); let calls = 0;
    while (j.progress().completedDomains === 0) {if (++calls > 3000) throw Error('Fixture bound'); j.advance(7); expect(s.snapshot()).toEqual(before);}
    expect(j.progress().completedDomains).toBe(1); expect(() => j.result()).toThrow(); expect(() => s.commitTick(j)).toThrow(); finish(j); expect(s.snapshot()).toEqual(before); s.commitTick(j); expect(s.tick).toBe(1);
  });
  test('cancellation after a primary domain finishes leaves all domains and ledgers untouched', () => {
    const s = setup(), before = s.snapshot(), balance = s.energyBalance(), j = s.prepareTick(); let calls = 0;
    while (j.progress().completedDomains === 0) {if (++calls > 3000) throw Error('Fixture bound'); j.advance(7);} expect(j.cancel()).toBe(true); expect(() => s.commitTick(j)).toThrow();
    expect(s.snapshot()).toEqual(before); expect(s.energyBalance()).toEqual(balance); expect(s.revision).toBe(0);
  });
  test('stored custom fuel keeps its chemical heat and burns using ordinary reactive world rules', () => {
    const s = setup(state([place(0, 0, 0, 201, 181)], dims, 0, custom), state([], dims, 0, custom), custom); const before = s.energyBalance().currentQ;
    exchange(s); const out = tick(s); const report = out.receipt.domains.find(d => d.id === 'flask')!.report;
    expect(report.evolution.reactions.reactedPairs).toHaveLength(1); expect(s.domain('flask').block.packedCells.some(v => (v & 255) === MAT.ASH)).toBe(true);
    expect(s.energyBalance().currentQ).toBe(before); expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('extracting a floor support releases the complete distant walkway on the next shared tick', () => {
    const a = state([...Array.from({length: 5}, (_, x) => place(x, 0, 0, MAT.STONE)),
      ...Array.from({length: 4}, (_, x) => ({...p, x, kind: 'bond' as const, direction: 1, bonded: true})), place(0, 1, 0, MAT.STONE)], {width: 5, height: 2, depth: 1});
    const s = setup(a), moved = exchange(s, request({cells: [[0, 1, 0]], offset: [0, -1, 0]}));
    expect(moved.receipt.sourceChangedCells).toEqual([5]); const out = tick(s), primary = out.receipt.domains[0].report;
    expect(primary.structure.movingCells).toEqual([0, 1, 2, 3, 4]); expect(primary.moves).toContainEqual({from: 4, to: 9});
    expect(s.domain('flask').block.packedCells.some(v => (v & 255) === MAT.STONE)).toBe(true); expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('reservoir hold expiry runs on the shared tick and preserves damage through subsequent fall', () => {
    const a = state([place(0, 0, 0, MAT.STONE, 70), {...p, kind: 'integrity', integrity: 73}]), s = setup(a); exchange(s);
    s.hold('flask', {id: 'suspended', expiresAtTick: 2, cells: [[0, 0, 0]]}); tick(s); expect(s.domain('flask').block.structure[0]).toBe(73);
    const second = tick(s); expect(second.receipt.domains[1].report.holds?.expired).toEqual(['suspended']); tick(s); expect(s.domain('flask').block.structure[3]).toBe(73);
  });
  test('stored water freezes under an accounted cooling edit and returns as the same resulting ice', () => {
    const shape = {width: 1, height: 2, depth: 1}, s = setup(state([place()], shape), state([], shape)); exchange(s);
    const cooling = s.edit('flask', [{...p, kind: 'energy', energyQ: 0}]); expect(BigInt(cooling.receipt.value.externalEnergyQ)).toBeLessThan(0n);
    tick(s); const frozen = s.domain('flask').block; expect(frozen.packedCells[1] & 255).toBe(MAT.ICE); expect(frozen.structure[1]).toBe(255);
    exchange(s, request({from: 'flask', to: null, cells: [[0, 1, 0]], offset: [0, -1, 0]}));
    expect(s.domain(null).block.packedCells[0]).toBe(frozen.packedCells[1]); expect(s.domain(null).block.energyQ[0]).toBe(frozen.energyQ[1]);
    expect(s.domain(null).block.structure[0]).toBe(frozen.structure[1]); expect(s.energyBalance().externalQ).toBe(BigInt(cooling.receipt.value.externalEnergyQ)); expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('six shared ticks and odd-tick JSON restarts preserve every world and complete report', () => {
    const a = setup(state([place(0, 0, 0, MAT.STONE, 70)]), state([place(0, 0, 0, MAT.WOOD, 181)])), b = setup(a.domain(null), a.domain('flask'));
    a.hold(null, {id: 'held', expiresAtTick: 3, cells: [[0, 0, 0]]}); b.restore(a.snapshot());
    for (let i = 0; i < 6; i++) {if (i === 1 || i === 3) b.restore(JSON.parse(JSON.stringify(a.snapshot()))); expect(tick(b, 31).receipt).toEqual(tick(a, 1).receipt); expect(b.snapshot()).toEqual(a.snapshot());}
    expect(a.energyBalance().driftQ).toBe(0n); expect(b.energyBalance().driftQ).toBe(0n);
  });
  test('local translations work in reservoirs without reseeding matter or changing other domains', () => {
    const s = setup(state(), state([place(0, 0, 0, MAT.STONE, 70), {...p, kind: 'integrity', integrity: 73}])), before = s.snapshot();
    const j = s.prepareTranslation('flask', {cells: [[0, 0, 0]], path: [[1, 0, 0]]}); finish(j); const out = s.commitTranslation(j);
    expect(out.receipt.domain).toBe('flask'); expect(s.domain('flask').block.structure[1]).toBe(73); expect(s.domain(null)).toEqual(before.world); expect(s.tick).toBe(0); expect(s.energyBalance().externalQ).toBe(0n);
  });
  test('external energy and placement costs are accounted across primary and reservoir edits', () => {
    const s = setup(), before = s.energyBalance().currentQ, primary = s.edit(null, [place(1, 0, 0, MAT.STONE, 80)]), stored = s.edit('flask', [place(0, 0, 0, MAT.WOOD, 90)]);
    const charge = BigInt(primary.receipt.value.externalEnergyQ) + BigInt(stored.receipt.value.externalEnergyQ);
    expect(s.energyBalance()).toEqual({initialQ: before, currentQ: before + charge, externalQ: charge, driftQ: 0n}); expect(s.revision).toBe(2);
    tick(s); expect(s.energyBalance().externalQ).toBe(charge); expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('identical placement retires reservoir holds while failed late edits preserve them', () => {
    const s = setup(state(), state([place(0, 0, 0, MAT.STONE, 20)])); s.hold('flask', {id: 'held', expiresAtTick: 2, cells: [[0, 0, 0]]}); const before = s.snapshot();
    expect(() => s.edit('flask', [place(0, 0, 0, MAT.STONE, 20), place(99)])).toThrow(); expect(s.snapshot()).toEqual(before); expect(s.revision).toBe(1);
    const out = s.edit('flask', [place(0, 0, 0, MAT.STONE, 20)]); expect(out.receipt.value.changedCells).toEqual([]); const d = s.domain('flask'); expect(d.schemaVersion === 2 && d.holds).toEqual([]);
  });
  test('every successful domain change makes older tick transfer and translation jobs stale', () => {
    for (const change of ['edit', 'restore', 'hold', 'transfer', 'tick', 'translation'] as const) {
      const s = setup(state([place(), place(1, 0, 0, MAT.STONE)])), t = s.prepareTick(), x = s.prepareTransfer(request()), m = s.prepareTranslation(null, {cells: [[0, 0, 0]], path: [[0, 1, 0]]});
      if (change === 'edit') s.edit(null, []); else if (change === 'restore') s.restore(s.snapshot()); else if (change === 'hold') s.hold(null, {id: 'h', expiresAtTick: 2, cells: [[1, 0, 0]]});
      else if (change === 'transfer') exchange(s); else if (change === 'tick') tick(s); else {const j = s.prepareTranslation(null, {cells: [[0, 0, 0]], path: [[0, 1, 0]]}); finish(j); s.commitTranslation(j);}
      expect(() => s.commitTick(t)).toThrow(/stale/); expect(() => s.commitTransfer(x)).toThrow(/stale/); expect(() => s.commitTranslation(m)).toThrow(/stale/); t.cancel(); x.cancel(); m.cancel();
    }
  });
  test('foreign consumed incomplete and wrong-kind capabilities cannot publish', () => {
    const a = setup(), b = setup(), j = a.prepareTransfer(request()); expect(() => a.commitTransfer(j)).toThrow(); expect(() => b.commitTransfer(j)).toThrow(/foreign/);
    const wrong = a.prepareTick(); expect(() => a.commitTransfer(wrong as unknown as ReactiveTransferJob3D)).toThrow(/foreign/); wrong.cancel(); finish(j); a.commitTransfer(j); expect(() => a.commitTransfer(j)).toThrow(/consumed/);
  });
  test('failed edits and invalid restores leave an already prepared commit usable', () => {
    const s = setup(), j = s.prepareTransfer(request()), before = s.snapshot(); expect(() => s.edit('missing', [])).toThrow(); expect(() => s.edit(null, [place(2), place(99)])).toThrow();
    expect(() => s.restore({...before, tick: 1})).toThrow(); expect(s.snapshot()).toEqual(before); finish(j); s.commitTransfer(j);
  });
  test('swallowed reentry poisons transfer preparation without altering previous capabilities', () => {
    const s = setup(), before = s.snapshot(), j = s.prepareTick(); let tried = false;
    const req = new Proxy(request(), {ownKeys(target) {if (!tried) {tried = true; try {s.edit(null, []);} catch {}} return Reflect.ownKeys(target);}});
    expect(() => s.prepareTransfer(req)).toThrow(/reentry/); expect(s.snapshot()).toEqual(before); expect(s.revision).toBe(0); finish(j); s.commitTick(j);
  });
  test('swallowed reentry during a staged edit cannot publish the staged domain', () => {
    const s = setup(), before = s.snapshot(); let tried = false;
    const row = new Proxy(place(1), {ownKeys(target) {if (!tried) {tried = true; try {s.restore(before);} catch {}} return Reflect.ownKeys(target);}});
    expect(() => s.edit(null, [row])).toThrow(/reentry/); expect(s.snapshot()).toEqual(before); expect(s.energyBalance().externalQ).toBe(0n); expect(s.revision).toBe(0);
  });
  test('public holds reports and snapshots cannot mutate committed reservoir storage', () => {
    const s = setup(state(), state([place(0, 0, 0, MAT.STONE)])); const h = s.hold('flask', {id: 'h', expiresAtTick: 3, cells: [[0, 0, 0]]}); h.receipt.value.holds[0].cells.length = 0;
    const out = tick(s); out.receipt.domains[1].report.holds!.after[0].cells.length = 0; const saved = s.snapshot(); saved.reservoirs.length = 0;
    const d = s.domain('flask'); expect(d.schemaVersion === 2 && d.holds[0].cells).toEqual([0]); expect(read(r, s.snapshot())).toEqual(s.snapshot());
  });
  test('restore establishes a new combined baseline and preserves exact saved hold lifetime', () => {
    const s = setup(state([place(0, 0, 0, MAT.STONE)])); s.hold(null, {id: 'h', expiresAtTick: 2, cells: [[0, 0, 0]]}); s.edit('flask', [place()]); tick(s); const saved = s.snapshot();
    const b = setup(saved.world, saved.reservoirs[0].world), old = b.prepareTick(); b.restore(JSON.parse(JSON.stringify(saved)));
    expect(b.energyBalance().externalQ).toBe(0n); expect(b.energyBalance().initialQ).toBe(s.energyBalance().currentQ); expect(() => b.commitTick(old)).toThrow(/stale/); old.cancel();
    tick(b); const d = b.domain(null); expect(d.schemaVersion === 2 && d.holds).toEqual([]); expect(b.tick).toBe(2);
  });
  test('malformed mismatched and changed-topology saves reject before replacing any domain', () => {
    const s = setup(), before = s.snapshot(), otherCatalog = state([], dims, 0, custom);
    const bad = [{...before, reservoirs: undefined}, {...before, rulesVersion: 'wrong'}, {...before, world: otherCatalog}, {...before, reservoirs: [{id: 'flask', world: state([], dims, 1)}]},
      {...before, reservoirs: []}, {...before, reservoirs: [{id: 'changed', world: state()}]}, {...before, reservoirs: [{id: 'flask', world: state([], {width: 1, height: 1, depth: 1})}]},
      {...before, reservoirs: [{id: null, world: state()}]}, {...before, reservoirs: [before.reservoirs[0], before.reservoirs[0]]}, {...before, reservoirs: new Array(1)}];
    for (const raw of bad) {expect(() => s.restore(raw)).toThrow(); expect(s.snapshot()).toEqual(before); expect(s.revision).toBe(0); expect(s.energyBalance().driftQ).toBe(0n);}
  });
  test('domain and combined cell bounds reject before oversized coordinate allocation', () => {
    const small = state([], {width: 1, height: 1, depth: 1}), rs = Array.from({length: 7}, (_, i) => ({id: 'r' + i, world: small}));
    expect(domains(r, small, rs).reservoirs).toHaveLength(7); expect(() => domains(r, small, [...rs, {id: 'extra', world: small}])).toThrow();
    const fake = {...small, block: {...small.block, width: 128, height: 128, depth: 2}};
    expect(() => domains(r, fake, [{id: 'a', world: fake}, {id: 'b', world: small}])).toThrow(/budget/);
  });
  test('all-singleton domains share exact maximum ticks without overflow', () => {
    const a = state([], {width: 1, height: 1, depth: 1}, Number.MAX_SAFE_INTEGER - 1), s = setup(a, a); tick(s); expect(s.tick).toBe(Number.MAX_SAFE_INTEGER);
    expect(() => s.prepareTick()).toThrow(/overflow/); expect(s.domain('flask').tick).toBe(s.tick); expect(s.energyBalance().driftQ).toBe(0n);
  });
  test('pure domain jobs isolate their input and produce budget-independent reports', () => {
    const s = setup(), raw = s.snapshot(), a = groupTick(r, raw), b = groupTick(r, raw); raw.reservoirs[0].world.block.energyQ[0] = 0;
    expect(finish(a, 1)).toEqual(finish(b, 256)); expect(s.tick).toBe(0);
  });
});
