import {describe, test, expect} from 'vitest';
import {createChamber, prepareCommand, finishBranch, SUPPORT, ICE, index} from '../../examples/reactive-chamber/scenario.js';
import {MAT, GEOMETRY_SCALE_3D as Q} from 'state-space-engine/experimental/3d/reactive-materials';

describe('reactive chamber public SDK reference', () => {
  test('control, burning support, and cooled support follow actual physics with exact accounting', async () => {
    for (const kind of ['wait', 'heat', 'cool'] as const) {
      const {registry, session} = await createChamber(), before = session.snapshot();
      const branch = prepareCommand(registry, session, kind === 'wait' ? {kind} : {kind, cell: [...SUPPORT]});
      const preview = finishBranch(branch);
      expect(session.snapshot()).toEqual(before);
      const out = session.commit(branch).snapshot;
      expect(session.energyBalance().driftQ).toBe(0n);
      expect(out.game.tick).toBe(2); expect(out.game.actor.step).toBe(2);
      if (kind === 'heat') {
        expect(out.game.burned).toBeGreaterThan(0);
        expect(out.domains.world.block.packedCells[index(SUPPORT)] & 255).not.toBe(MAT.WOOD);
        expect(out.game.fallen).toBeGreaterThan(0);
        expect(out.game.lostFooting).toBeGreaterThan(0);
        expect(out.game.actor.minQ[1]).toBeGreaterThan(before.game.actor.minQ[1]);
      } else {
        expect(out.game.burned).toBe(0); expect(out.game.fallen).toBe(0);
        expect(out.game.actor).toEqual({...before.game.actor, step: 2});
      }
      expect({...out, revision: preview.state.revision}).toEqual(preview.state);
    }
  });
  test('heat melts the ice while cooling and untouched controls retain it', async () => {
    for (const kind of ['wait', 'heat', 'cool'] as const) {
      const {registry, session} = await createChamber();
      const b = prepareCommand(registry, session, kind === 'wait' ? {kind} : {kind, cell: [...ICE]}); finishBranch(b);
      const s = session.commit(b).snapshot;
      expect(s.game.phaseChanges > 0).toBe(kind === 'heat');
      expect(s.domains.world.block.packedCells.some(v => (v & 255) === MAT.ICE)).toBe(kind !== 'heat');
      expect(session.energyBalance().driftQ).toBe(0n);
    }
  });
  test('cancel spends nothing and a stale sibling cannot commit', async () => {
    const {registry, session} = await createChamber(), before = session.snapshot();
    const discarded = prepareCommand(registry, session, {kind: 'heat', cell: [...SUPPORT]}); finishBranch(discarded); discarded.discard();
    expect(session.snapshot()).toEqual(before);
    const first = prepareCommand(registry, session, {kind: 'wait'}), second = prepareCommand(registry, session, {kind: 'wait'});
    finishBranch(first); finishBranch(second); session.commit(first);
    expect(() => session.commit(second)).toThrow();
  });
});

import {createReactiveSession3D, editReactiveMaterialBlock3D} from 'state-space-engine/experimental/3d/reactive-materials';
import {chamberInitial, chamberPolicy, CHAMBER, readCommand, compileCommand} from '../../examples/reactive-chamber/scenario.js';
import {SAVE_FORMAT, canonical, parseSave, stateHash, verifyRecording, type ChamberStep} from '../../examples/reactive-chamber/recording.js';
import {prepareScene, inspectScene, sceneData, orbitCamera, pickCell, pickElementCell, canvasSize, projectPoint} from '../../examples/reactive-chamber/presentation.js';

describe('chamber transaction and durable recording boundaries', () => {
  test('crushing by an actual falling cell rejects the entire candidate', async () => {
    const {registry} = await createChamber(), initial = chamberInitial(registry);
    initial.domains.world.block = editReactiveMaterialBlock3D(registry, initial.domains.world.block,
      [{kind: 'place', x: 3, y: 2, z: 3, material: MAT.STONE}]).block;
    const session = createReactiveSession3D(registry, initial, chamberPolicy(registry)), before = session.snapshot();
    const b = prepareCommand(registry, session, {kind: 'wait'});
    expect(() => finishBranch(b)).toThrow(/Actor response rejected/); expect(b.progress().status).toBe('failed'); expect(session.snapshot()).toEqual(before);
  });
  test('missing motion capture rejects actor consequences without publishing partial physics', async () => {
    const {session} = await createChamber(), before = session.snapshot(), b = session.branch({horizonTicks: 2});
    expect(() => finishBranch(b)).toThrow(); expect(session.snapshot()).toEqual(before);
  });
  test('unsupported edits cannot replace terrain or evade resource charges', async () => {
    const {session} = await createChamber(), before = session.snapshot(), b = session.branch({horizonTicks: 0});
    b.enqueue({kind: 'edit', domain: null, edits: [{kind: 'place', x: 3, y: 4, z: 3, material: MAT.AIR}]});
    expect(() => finishBranch(b)).toThrow(/only permits thermal/); expect(session.snapshot()).toEqual(before);
  });
  test('finite resources charge actual energy, including cooling clamped at chemical fuel', async () => {
    const {registry, session} = await createChamber(), first = prepareCommand(registry, session, {kind: 'cool', cell: [...SUPPORT]});
    finishBranch(first); const s = session.commit(first).snapshot;
    expect(s.game.heatRemovedQ).toBe(20 * 256); expect(s.game.remainingQ).toBe(CHAMBER.budgetQ - 20 * 256);
    expect(s.accounting.externalQ).toBe(String(-20 * 256)); expect(s.game.burned).toBe(0);
    const full = await createChamber();
    for (let i = 0; i < 8; i++) {const b = prepareCommand(full.registry, full.session, {kind: 'heat', cell: [0, 0, 0]}); finishBranch(b); full.session.commit(b);}
    expect(full.session.snapshot().game.remainingQ).toBe(0); const before = full.session.snapshot();
    expect(() => prepareCommand(full.registry, full.session, {kind: 'heat', cell: [0, 0, 0]})).toThrow(/resource/);
    expect(full.session.snapshot()).toEqual(before);
  });
  test('input validation rejects getters, coordinates, unknown fields and exhausted cadence before branching', async () => {
    const {registry, session} = await createChamber();
    for (const raw of [null, {kind: 'heat', cell: [8, 0, 0]}, {kind: 'wait', extra: true}, {kind: 'cool', cell: [0, 1]}, {kind: 'teleport'}]) expect(() => readCommand(raw)).toThrow();
    let invoked = false; expect(() => readCommand({get kind() {invoked = true; return 'wait';}})).toThrow(); expect(invoked).toBe(false);
    const s = session.snapshot(); s.domains.tick = CHAMBER.maxTicks; expect(() => compileCommand(registry, s, {kind: 'wait'})).toThrow(/tick limit/);
  });
  test('save replay proves each complete boundary and exact continuation, including absolute tick and resources', async () => {
    const original = await createChamber(), initial = original.session.snapshot(), steps: ChamberStep[] = [];
    const commands = [{kind: 'heat', cell: [...SUPPORT]}, {kind: 'wait'}, {kind: 'cool', cell: [...ICE]}];
    for (const command of commands) {const b = prepareCommand(original.registry, original.session, command); finishBranch(b); const snapshot = original.session.commit(b).snapshot;
      steps.push({command: readCommand(command), sha256: await stateHash(snapshot)});}
    const save = {format: SAVE_FORMAT, catalog: original.registry.toCatalog(), initial, snapshot: original.session.snapshot(), steps};
    const parsed = parseSave(original.registry, JSON.stringify(save), initial), restart = await createChamber();
    const restored = await verifyRecording(parsed, async command => {const b = prepareCommand(restart.registry, restart.session, command); finishBranch(b); return restart.session.commit(b).snapshot;});
    expect(restored).toEqual(save.snapshot);
    for (const current of [original, restart]) {const b = prepareCommand(current.registry, current.session, {kind: 'wait'}); finishBranch(b); current.session.commit(b);}
    expect(restart.session.snapshot()).toEqual(original.session.snapshot());
    for (const mutate of [(s: typeof save) => {s.format = 'future' as typeof SAVE_FORMAT;}, (s: typeof save) => {s.catalog.materialIds.pop();},
      (s: typeof save) => {s.snapshot.game.remainingQ++;}, (s: typeof save) => {s.initial.game.actor.minQ[0]++;}]) {
      const bad = structuredClone(save); mutate(bad); expect(() => parseSave(original.registry, JSON.stringify(bad), initial)).toThrow();
    }
    const bad = structuredClone(parsed); bad.steps[0].command = {kind: 'cool', cell: [...SUPPORT]}; const isolated = await createChamber();
    await expect(verifyRecording(bad, async command => {const b = prepareCommand(isolated.registry, isolated.session, command); finishBranch(b); return isolated.session.commit(b).snapshot;})).rejects.toThrow(/commit 1/);
    const copy = structuredClone(save.snapshot); expect(await stateHash(copy)).toBe(await stateHash(save.snapshot));
    expect(canonical({...copy, game: Object.fromEntries(Object.entries(copy.game).reverse())})).toBe(canonical(copy));
  });
});

describe('reactive presentation boundaries', () => {
  test('scene owns its snapshot and uses catalog colors with matching inspection identity', async () => {
    const {registry, session} = await createChamber(), raw = session.snapshot(), s = prepareScene(registry, raw, [...SUPPORT]);
    raw.domains.world.block.packedCells[index(SUPPORT)] = 0;
    expect(inspectScene(s, [...SUPPORT])).toMatchObject({identity: s.identity, tick: 0, material: MAT.WOOD});
    const colors = sceneData(s).boxes; expect(Array.from(colors).some(v => Math.abs(v - 0x8c / 255) < 1e-6)).toBe(true);
    const camera = orbitCamera(), projected = projectPoint(camera, [3 * Q + Q / 2, 4 * Q + Q / 2, 3 * Q + Q / 2], 640, 400)!;
    expect(pickCell(s, camera, projected.x, projected.y, 640, 400)).toEqual([...SUPPORT]);
  });
  test('preview identities remain distinct and incomplete or mismatched previews reject', async () => {
    const {registry, session} = await createChamber(), b = prepareCommand(registry, session, {kind: 'wait'}), before = b.inspect();
    expect(() => prepareScene(registry, before)).toThrow(); const p = finishBranch(b), scene = prepareScene(registry, p);
    expect(scene.kind).toBe('preview'); expect(scene.identity).not.toBe(prepareScene(registry, session.snapshot()).identity);
    const bad = structuredClone(p); bad.base = {...bad.base, tick: bad.base.tick + 1}; expect(() => prepareScene(registry, bad)).toThrow(); b.discard();
  });
});


describe('Retina viewport projection', () => {
  test('a capped backing store preserves the CSS aspect ratio and finite target bounds', () => {
    for (const [width, height, ratio] of [[1055, 660, 2], [300, 520, 3], [2500, 1400, 2], [500, 300, 1.25]]) {
      const size = canvasSize(width, height, ratio);
      expect(size.width).toBeLessThanOrEqual(1600); expect(size.height).toBeLessThanOrEqual(900);
      expect(Math.abs(size.width / size.height - width / height)).toBeLessThan(.005);
    }
    expect(canvasSize(1055, 660, 2)).toEqual({width: 1439, height: 900});
    expect(() => canvasSize(Infinity, 10, 2)).toThrow(); expect(() => canvasSize(10, 10, 0)).toThrow();
  });
  test('pointer coordinates invert the actual rendered projection at capped and rounded resolutions', async () => {
    const {registry, session} = await createChamber(), scene = prepareScene(registry, session.snapshot()), camera = orbitCamera();
    for (const [cssWidth, cssHeight, width, height] of [[1055, 660, 1600, 900], [1055, 660, 1439, 900], [377.5, 291.25, 472, 364]]) {
      const projected = projectPoint(camera, [3 * Q + Q / 2, 4 * Q + Q / 2, 3 * Q + Q / 2], width, height)!;
      expect(pickElementCell(scene, camera, projected.x * cssWidth / width, projected.y * cssHeight / height, cssWidth, cssHeight, width, height)).toEqual([...SUPPORT]);
    }
  });
});
