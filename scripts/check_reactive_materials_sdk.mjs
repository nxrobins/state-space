/** Public data/edit and one tiny local reaction cycle. No M5 steps, worker or GPU. */
import assert from 'node:assert/strict';
import { createReactiveMaterialRegistry3D, createThermalMaterialRegistry3D, THERMAL_MAT_3D, createReactiveMaterialBlock3D, editReactiveMaterialBlock3D,
  readReactiveMaterialBlock3D, reactiveMaterialEnergyLedger3D, createReactiveReactionState3D, readReactiveReactionState3D,
  createReactiveReactionJob3D, advanceReactiveReactions3D, createReactiveEvolutionState3D, readReactiveEvolutionState3D,
  createReactiveEvolutionJob3D, advanceReactiveEvolution3D, createReactiveStructureJob3D, createReactiveWorld3D,
  createReactiveWorldSnapshot3D, createReactiveDomainsSnapshot3D, createReactiveDomainSet3D, createReactiveSession3D,
  createReactiveBody3D, stepReactiveBody3D, createReactiveDisplacement3D, createReactiveTranslationDisplacement3D,
  createReactiveActorGroup3D, createReactiveTranslatedActorGroup3D, moveReactiveActors3D,
  createReactiveMaterialTransport3D, readReactiveMaterialTransport3D, applyReactiveMaterialTransport3D, createReactiveMaterialTransportJob3D, createReactiveTransportedActorGroup3D,
  captureReactiveMaterialTransportMemory3D, restoreReactiveMaterialTransportMemory3D, followReactiveMaterialTransport3D,
  createReactiveWorkerHost3D, createReactiveWorkerClient3D, createReactiveChangeJob3D,
  defaultReactiveMaterialCatalog3D, BONDS_3D, ANCHOR_3D, MAT } from 'state-space-engine/experimental/3d/reactive-materials';
export async function checkReactiveMaterialsSdk() {
  const thermal = await createThermalMaterialRegistry3D();
  assert.equal(thermal.material(THERMAL_MAT_3D.WAX).name, 'wax');
  assert.equal((await createReactiveMaterialRegistry3D(thermal.toCatalog())).hash, thermal.hash);
  const base = await createReactiveMaterialRegistry3D();
  const registry = await base.extend([{...structuredClone(base.material(MAT.WOOD)), id: 200, name: 'resin'}]);
  const air = createReactiveMaterialBlock3D(registry, {width: 3, height: 1, depth: 1});
  const placed = editReactiveMaterialBlock3D(registry, air, [0, 1].map(x => ({kind: 'place', x, y: 0, z: 0, material: 200, thermal: 210})));
  const position = {x: 0, y: 0, z: 0};
  assert.equal(reactiveMaterialEnergyLedger3D(registry, placed.block).chemicalQ, 2n * 80n * 256n);
  assert.equal(BigInt(placed.receipt.externalEnergyQ), reactiveMaterialEnergyLedger3D(registry, placed.block).totalQ - reactiveMaterialEnergyLedger3D(registry, air).totalQ);
  const damaged = editReactiveMaterialBlock3D(registry, placed.block, [{...position, kind: 'bond', direction: 1, bonded: true},
    {...position, kind: 'integrity', integrity: 73}, {...position, kind: 'anchor', anchored: true}]).block;
  assert.equal(damaged.structure[0], 73 | ANCHOR_3D | BONDS_3D[1]);
  assert.throws(() => editReactiveMaterialBlock3D(registry, damaged, [{...position, kind: 'integrity', integrity: 0}, {...position, kind: 'energy', energyQ: 0}]));
  assert.equal(damaged.structure[0], 73 | ANCHOR_3D | BONDS_3D[1]);
  const continued = [{...position, kind: 'energy', energyQ: damaged.energyQ[0] + 999}];
  const restoredRegistry = await createReactiveMaterialRegistry3D(JSON.parse(JSON.stringify(registry.toCatalog())));
  assert.equal(restoredRegistry.hash, registry.hash);
  assert.deepEqual(editReactiveMaterialBlock3D(restoredRegistry, readReactiveMaterialBlock3D(restoredRegistry, JSON.parse(JSON.stringify(damaged))), continued),
    editReactiveMaterialBlock3D(registry, damaged, continued));
  const replaced = editReactiveMaterialBlock3D(registry, damaged, [{...position, kind: 'place', material: MAT.STONE}]);
  assert.deepEqual(replaced.receipt.changedCells, [0, 1]); assert.deepEqual(replaced.block.structure, [255, 255, 0]);
  const reactionState = createReactiveReactionState3D(registry, damaged, 3), reactionJob = createReactiveReactionJob3D(registry, reactionState);
  for (let i = 0; i < 8; i++) {assert.throws(() => reactionJob.result()); reactionJob.advance();}
  const reaction = reactionJob.result();
  assert.equal(reaction.state.cycle, 4); assert.equal(reaction.report.reactedPairs.length, 1);
  assert.equal(reaction.report.energy.beforeQ, reaction.report.energy.afterQ);
  assert.deepEqual(reaction, advanceReactiveReactions3D(restoredRegistry, readReactiveReactionState3D(restoredRegistry, JSON.parse(JSON.stringify(reactionState)))));
  const cancelled = createReactiveReactionJob3D(registry, reactionState); cancelled.advance(); assert.equal(cancelled.cancel(), true); assert.throws(() => cancelled.result());
  const profile = defaultReactiveMaterialCatalog3D(); for (const m of profile.propertiesCatalog.materials) m.properties.conductivity = 0;
  const movingRegistry = await createReactiveMaterialRegistry3D(profile);
  const chamber = editReactiveMaterialBlock3D(movingRegistry, createReactiveMaterialBlock3D(movingRegistry, {width: 1, height: 3, depth: 1}),
    [{kind: 'place', x: 0, y: 2, z: 0, material: MAT.WOOD, thermal: 181}]).block;
  const initial = createReactiveEvolutionState3D(movingRegistry, chamber), burned = advanceReactiveEvolution3D(movingRegistry, initial);
  const restarted = readReactiveEvolutionState3D(movingRegistry, JSON.parse(JSON.stringify(burned.state))), movingJob = createReactiveEvolutionJob3D(movingRegistry, restarted);
  for (let i = 0; i < 28; i++) {assert.throws(() => movingJob.result()); movingJob.advance();}
  const smoke = movingJob.result(); assert.deepEqual(smoke, advanceReactiveEvolution3D(movingRegistry, burned.state));
  assert.deepEqual(smoke.state.block.packedCells.map(v => v & 255), [MAT.SMOKE, MAT.AIR, MAT.ASH]);
  assert.deepEqual(smoke.report.movement.moves, [{from: 0, to: 1}, {from: 1, to: 0}]);
  assert.equal(smoke.report.reactions.energy.afterQ, burned.report.reactions.energy.beforeQ);
  const dropped = createReactiveEvolutionJob3D(movingRegistry, initial); for (let i = 0; i < 21; i++) dropped.advance(); assert.equal(dropped.cancel(), true); assert.throws(() => dropped.result());
  const slab = editReactiveMaterialBlock3D(movingRegistry, createReactiveMaterialBlock3D(movingRegistry, {width: 2, height: 2, depth: 1}),
    [{kind: 'place', x: 0, y: 0, z: 0, material: MAT.STONE, thermal: 70},
      {kind: 'place', x: 1, y: 0, z: 0, material: MAT.STONE}, {kind: 'bond', x: 0, y: 0, z: 0, direction: 1, bonded: true},
      {kind: 'integrity', x: 0, y: 0, z: 0, integrity: 73}]).block;
  const structureJob = createReactiveStructureJob3D(movingRegistry, slab);
  while (structureJob.progress().status === 'running') {assert.throws(() => structureJob.result()); assert.ok(structureJob.advance(3).lastAdvanceWork <= 3);}
  const structure = structureJob.result(); assert.deepEqual(structure.report.movingCells, [0, 1]);
  assert.deepEqual(structure.block.structure.slice(2), slab.structure.slice(0, 2));
  assert.equal(structure.report.energy.beforeQ, structure.report.energy.afterQ);
  const structureRestart = createReactiveStructureJob3D(movingRegistry, JSON.parse(JSON.stringify(slab)));
  while (structureRestart.progress().status === 'running') structureRestart.advance(1);
  assert.deepEqual(structureRestart.result(), structure);
  const structureCancelled = createReactiveStructureJob3D(movingRegistry, slab); structureCancelled.advance(1);
  assert.equal(structureCancelled.cancel(), true); assert.throws(() => structureCancelled.result());
  const mixed = editReactiveMaterialBlock3D(movingRegistry, createReactiveMaterialBlock3D(movingRegistry, {width: 2, height: 2, depth: 1}),
    [{kind: 'place', x: 0, y: 0, z: 0, material: MAT.STONE}, {kind: 'place', x: 1, y: 0, z: 0, material: MAT.WATER, thermal: 40}]).block;
  const liveWorld = createReactiveWorld3D(movingRegistry, mixed), tickJob = liveWorld.prepareTick(), original = liveWorld.snapshot();
  while (tickJob.progress().status === 'running') {tickJob.advance(3); assert.deepEqual(liveWorld.snapshot(), original);}
  const worldCommit = liveWorld.commitTick(tickJob); assert.equal(worldCommit.toRevision, 1);
  assert.deepEqual(worldCommit.report.moves, [{from: 0, to: 2}, {from: 1, to: 0}, {from: 2, to: 3}, {from: 3, to: 1}]);
  assert.equal(liveWorld.energyBalance().driftQ, 0n); assert.throws(() => liveWorld.commitTick(tickJob));
  const continuedWorld = createReactiveWorld3D(movingRegistry, mixed); continuedWorld.restore(JSON.parse(JSON.stringify(liveWorld.snapshot())));
  const continuationReports = [];
  for (const current of [liveWorld, continuedWorld]) {
    const candidate = current.prepareTick(); while (candidate.progress().status === 'running') candidate.advance(7);
    continuationReports.push(current.commitTick(candidate).report);
  }
  assert.deepEqual(continuationReports[0], continuationReports[1]); assert.deepEqual(liveWorld.snapshot(), continuedWorld.snapshot());
  const stale = liveWorld.prepareTick(); liveWorld.edit([]); assert.throws(() => liveWorld.commitTick(stale), /stale/); assert.equal(stale.cancel(), true);
  const translatedWorld = createReactiveWorld3D(movingRegistry, slab), oldTick = translatedWorld.prepareTick();
  const translation = translatedWorld.prepareTranslation({cells: [[0, 0, 0], [1, 0, 0]], path: [[0, 1, 0]]});
  translation.advance(); assert.throws(() => translatedWorld.commitTranslation(translation)); assert.deepEqual(translatedWorld.snapshot().block, slab);
  translation.advance(); const translated = translatedWorld.commitTranslation(translation);
  assert.equal(translated.receipt.externalEnergyQ, '0'); assert.equal(translatedWorld.tick, 0);
  assert.deepEqual(translatedWorld.snapshot().block.structure.slice(2), slab.structure.slice(0, 2));
  assert.deepEqual(translatedWorld.snapshot().block.energyQ.slice(2), slab.energyQ.slice(0, 2));
  assert.throws(() => translatedWorld.commitTick(oldTick), /stale/); oldTick.cancel();
  const translatedRestart = createReactiveWorld3D(movingRegistry, slab); translatedRestart.restore(JSON.parse(JSON.stringify(translatedWorld.snapshot())));
  const translatedReports = [];
  for (const current of [translatedWorld, translatedRestart]) {
    const candidate = current.prepareTick(); while (candidate.progress().status === 'running') candidate.advance(7);
    translatedReports.push(current.commitTick(candidate).report); assert.equal(current.energyBalance().driftQ, 0n);
  }
  assert.deepEqual(translatedReports[0], translatedReports[1]); assert.deepEqual(translatedWorld.snapshot(), translatedRestart.snapshot());
  const heldWorld = createReactiveWorld3D(movingRegistry, slab);
  heldWorld.hold({id: 'lift', expiresAtTick: 2, cells: [[0, 0, 0]]});
  const heldStep = current => {
    const candidate = current.prepareTick(); let calls = 0;
    while (candidate.progress().status === 'running') {assert.ok(++calls <= 20 * 4 + 64); candidate.advance(7);}
    return current.commitTick(candidate).report;
  };
  heldStep(heldWorld); assert.deepEqual(heldWorld.snapshot().block, slab);
  const heldRestart = createReactiveWorld3D(movingRegistry, slab); heldRestart.restore(JSON.parse(JSON.stringify(heldWorld.snapshot())));
  for (let i = 0; i < 2; i++) {
    const first = heldStep(heldWorld), second = heldStep(heldRestart);
    assert.deepEqual(first, second); assert.deepEqual(heldWorld.snapshot(), heldRestart.snapshot());
    assert.deepEqual(heldWorld.holds(), []); assert.equal(heldWorld.energyBalance().driftQ, 0n);
    assert.equal(heldRestart.energyBalance().driftQ, 0n);
    assert.ok(heldWorld.snapshot().block.structure.every(word => !(word & ANCHOR_3D)));
    if (i === 0) {assert.deepEqual(first.holds.expired, ['lift']); assert.deepEqual(heldWorld.snapshot().block, slab);}
  }
  assert.deepEqual(heldWorld.snapshot().block.structure.slice(2), slab.structure.slice(0, 2));
  assert.deepEqual(heldWorld.snapshot().block.energyQ.slice(2), slab.energyQ.slice(0, 2));
  const stored = createReactiveDomainSet3D(movingRegistry, createReactiveWorldSnapshot3D(movingRegistry, slab),
    [{id: 'vault', world: createReactiveWorldSnapshot3D(movingRegistry, createReactiveMaterialBlock3D(movingRegistry, {width: 2, height: 2, depth: 1}))}]);
  const transfer = stored.prepareTransfer({from: null, to: 'vault', cells: [[0, 0, 0], [1, 0, 0]], offset: [0, 0, 0]});
  while (transfer.progress().status === 'running') transfer.advance(1);
  const transferred = stored.commitTransfer(transfer); assert.equal(transferred.receipt.externalEnergyQ, '0');
  assert.deepEqual(stored.domain('vault').block.structure.slice(0, 2), slab.structure.slice(0, 2));
  assert.deepEqual(stored.domain('vault').block.energyQ.slice(0, 2), slab.energyQ.slice(0, 2));
  const savedDomains = stored.snapshot(), resumedDomains = createReactiveDomainSet3D(movingRegistry, savedDomains.world, savedDomains.reservoirs);
  resumedDomains.restore(JSON.parse(JSON.stringify(savedDomains))); const domainReports = [];
  for (const current of [stored, resumedDomains]) {
    const candidate = current.prepareTick(); let calls = 0;
    while (candidate.progress().status === 'running') {assert.ok(++calls <= 20 * 8 + 128); candidate.advance(7);}
    domainReports.push(current.commitTick(candidate).receipt); assert.equal(current.energyBalance().driftQ, 0n);
  }
  assert.deepEqual(domainReports[0], domainReports[1]); assert.deepEqual(stored.snapshot(), resumedDomains.snapshot());
  assert.equal(stored.tick, 1); assert.equal(stored.domain('vault').tick, 1);
  assert.deepEqual(stored.domain('vault').block.structure.slice(2), slab.structure.slice(0, 2));
  const sessionInitial = {worldId: 'sdk-chamber', gameRulesVersion: 'sdk-ability-1', domains: savedDomains, game: {ap: 2, turn: 0}};
  const policy = {validateGame: value => value.game.ap >= 0, reduceTick: value => ({...value.game, turn: value.game.turn + 1})};
  const session = createReactiveSession3D(movingRegistry, sessionInitial, policy), beforeAbility = session.snapshot();
  const stalePreview = session.branch({horizonTicks: 0}), ability = session.branch({horizonTicks: 1, motion: {maxEntries: 512}});
  ability.enqueue({kind: 'game', game: {ap: 1, turn: 0}});
  ability.enqueue({kind: 'transfer', request: {from: 'vault', to: null, cells: [[0, 0, 0], [1, 0, 0]], offset: [0, 0, 0]}});
  const finishPreview = candidate => {
    let calls = 0; while (['preparing', 'running'].includes(candidate.progress().status)) {assert.ok(++calls <= 20 * 8 + 160); candidate.advance(7);}
    return candidate.inspect();
  };
  const sourceQueries = session.queries('vault'), sourceBox = {minQ: [0, 0, 0], maxQ: [1024, 1024, 1024]};
  assert.equal(sourceQueries.fit({box: sourceBox}).blocker.structure, slab.structure[0]);
  const actorBlock = editReactiveMaterialBlock3D(movingRegistry, createReactiveMaterialBlock3D(movingRegistry, {width: 1, height: 4, depth: 1}),
    [{kind: 'place', x: 0, y: 2, z: 0, material: MAT.STONE, thermal: 100}, {kind: 'integrity', x: 0, y: 2, z: 0, integrity: 73}]).block;
  const actorInitial = {worldId: 'sdk-actor', gameRulesVersion: 'sdk-actor-1', domains: createReactiveDomainsSnapshot3D(movingRegistry, createReactiveWorldSnapshot3D(movingRegistry, actorBlock)), game: {ap: 2}};
  const actorBody = createReactiveBody3D(createReactiveSession3D(movingRegistry, actorInitial).queries(), {minQ: [0, 1024, 0], sizeQ: [1024, 1024, 1024], gravityQ: 0});
  const actorStart = {...actorInitial, game: {ap: 2, body: actorBody}}, actorPolicy = {reduceTick(c) {
    const response = createReactiveDisplacement3D(c.beforeQueries(), c.queries(), c.movement()).resolve(c.game.body);
    assert.equal(response.status, 'resolved'); return {...c.game, body: stepReactiveBody3D(c.queries(), response.body).body};
  }, reduceCommand(c) {
    if (c.command.kind !== 'translate') return c.game;
    const observed = c.translation(); assert.equal(observed.rulesVersion, 'reactive-translation-motion-1');
    const response = createReactiveTranslationDisplacement3D(c.beforeQueries(), c.queries(), observed).resolve(c.game.body);
    assert.equal(response.rulesVersion, 'reactive-translation-displacement-1'); assert.equal(response.status, 'resolved');
    assert.deepEqual(response.carries[0].requestedQ, c.command.request.path[0].map(v => v * 1024)); return {...c.game, body: response.body};
  }};
  const actorSession = createReactiveSession3D(movingRegistry, actorStart, actorPolicy), actorCandidate = actorSession.branch({horizonTicks: 1, motion: {}, translation: {}});
  actorCandidate.enqueue({kind: 'game', game: {...actorStart.game, ap: 1}});
  actorCandidate.enqueue({kind: 'translate', domain: null, request: {cells: [[0, 2, 0]], path: [[0, 1, 0]]}});
  while (actorCandidate.progress().completedCommands < 2) actorCandidate.advance(7);
  assert.deepEqual(actorSession.snapshot().game, actorStart.game);
  for (const key of ['packedCells', 'energyQ', 'structure']) assert.equal(actorCandidate.inspect().state.domains.world.block[key][3], actorBlock[key][2]);
  assert.deepEqual(actorCandidate.inspect().state.game.body.minQ, [0, 2048, 0]);
  finishPreview(actorCandidate); actorSession.commit(actorCandidate);
  assert.equal(actorSession.snapshot().game.ap, 1);
  assert.deepEqual(actorSession.snapshot().game.body.minQ, [0, 2048, 0]); assert.equal(actorSession.snapshot().game.body.step, 1);
  const actorRestart = createReactiveSession3D(movingRegistry, actorStart, actorPolicy); actorRestart.restore(JSON.parse(JSON.stringify(actorSession.snapshot())));
  const actorResults = [];
  for (const current of [actorSession, actorRestart]) {
    const b = current.branch({horizonTicks: 1, motion: {}, translation: {}});
    b.enqueue({kind: 'translate', domain: null, request: {cells: [[0, 3, 0]], path: [[0, -1, 0]]}});
    finishPreview(b); actorResults.push(current.commit(b));
  }
  assert.deepEqual(actorResults[0], actorResults[1]); assert.equal(actorSession.energyBalance().driftQ, 0n);
  const groupBlock = editReactiveMaterialBlock3D(movingRegistry, createReactiveMaterialBlock3D(movingRegistry, {width: 4, height: 4, depth: 1}),
    [0, 3].map(x => ({kind: 'place', x, y: 2, z: 0, material: MAT.STONE, thermal: 70}))).block;
  const groupInitial = {worldId: 'sdk-group', gameRulesVersion: 'sdk-group-1', domains: createReactiveDomainsSnapshot3D(movingRegistry, createReactiveWorldSnapshot3D(movingRegistry, groupBlock)), game: {ap: 2, units: []}};
  const groupView = createReactiveSession3D(movingRegistry, groupInitial).queries();
  groupInitial.game.units = [0, 3].map((x, i) => ({id: i ? 'b' : 'a', body: createReactiveBody3D(groupView, {minQ: [x * 1024 + 256, 1536, 256], sizeQ: [512, 512, 512], gravityQ: 0})}));
  const acceptGroup = result => {if (result.status !== 'resolved') throw Error('Unsafe SDK group: ' + result.reason); return result.bodies;};
  const groupPolicy = {reduceCommand(c) {
    if (c.command.kind !== 'translate') return c.game;
    const result = createReactiveTranslatedActorGroup3D(c.beforeQueries(), c.queries(), c.translation()).resolve(c.game.units);
    assert.equal(result.rulesVersion, 'reactive-actor-group-1'); return {...c.game, units: acceptGroup(result)};
  }, reduceTick(c) {
    const units = acceptGroup(createReactiveActorGroup3D(c.beforeQueries(), c.queries(), c.movement()).resolve(c.game.units));
    const moved = moveReactiveActors3D(c.queries(), units, [{id: 'a', impulseQ: [7, 0, 0]}]);
    assert.equal(moved.rulesVersion, 'reactive-actor-movement-1'); assert.equal(moved.status, 'resolved'); return {...c.game, units: moved.bodies};
  }};
  const groupSession = createReactiveSession3D(movingRegistry, groupInitial, groupPolicy), groupBefore = groupSession.snapshot(), groupCandidate = groupSession.branch({horizonTicks: 1, translation: {}, motion: {}});
  groupCandidate.enqueue({kind: 'game', game: {...groupBefore.game, ap: 1}});
  groupCandidate.enqueue({kind: 'translate', domain: null, request: {cells: [[0, 2, 0], [3, 2, 0]], path: [[0, 1, 0]]}});
  finishPreview(groupCandidate); assert.deepEqual(groupSession.snapshot(), groupBefore); groupSession.commit(groupCandidate);
  assert.equal(groupSession.snapshot().game.ap, 1); assert.deepEqual(groupSession.snapshot().game.units.map(u => u.body.minQ), [[263, 2560, 256], [3328, 2560, 256]]);
  const groupRestart = createReactiveSession3D(movingRegistry, groupInitial, groupPolicy); groupRestart.restore(JSON.parse(JSON.stringify(groupSession.snapshot())));
  const groupResults = [];
  for (const owner of [groupSession, groupRestart]) {const b = owner.branch({horizonTicks: 1, translation: {}, motion: {}}); b.enqueue({kind: 'translate', domain: null, request: {cells: [[0, 3, 0], [3, 3, 0]], path: [[0, -1, 0]]}}); finishPreview(b); groupResults.push(owner.commit(b));}
  assert.deepEqual(groupResults[0], groupResults[1]); assert.equal(groupSession.energyBalance().driftQ, 0n);
  const collisionGame = structuredClone(groupSession.snapshot().game);
  collisionGame.units[1].body = createReactiveBody3D(groupSession.queries(), {minQ: [1280, 2304, 256], sizeQ: [512, 512, 512], gravityQ: 0});
  collisionGame.units[1].body.step = collisionGame.units[0].body.step;
  const collision = createReactiveSession3D(movingRegistry, {...groupInitial, domains: groupSession.snapshot().domains, game: collisionGame}, groupPolicy), collisionBefore = collision.snapshot(), conflict = collision.branch({horizonTicks: 0, translation: {}});
  conflict.enqueue({kind: 'game', game: {...collisionGame, ap: 0}}); conflict.enqueue({kind: 'translate', domain: null, request: {cells: [[0, 3, 0]], path: [[1, 0, 0]]}});
  assert.throws(() => finishPreview(conflict), /peer-contact/); assert.deepEqual(collision.snapshot(), collisionBefore);
  const preview = finishPreview(ability); assert.deepEqual(session.snapshot(), beforeAbility);
  const previewQueries = ability.queries(), landedBox = {minQ: [0, 1024, 0], maxQ: [1024, 2048, 1024]};
  assert.equal(previewQueries.fit({box: landedBox}).fits, false); assert.equal(session.queries().fit({box: landedBox}).fits, true);
  assert.equal(previewQueries.stamp.completedTicks, 1); assert.equal(previewQueries.stamp.rulesVersion, 'reactive-geometry-1');
  const executed = ability.lastMovement();
  assert.equal(executed.status, 'complete'); assert.equal(executed.rulesVersion, 'reactive-motion-1');
  assert.equal(executed.trace.passes.length, 29); assert.deepEqual(executed.to, previewQueries.stamp);
  assert.equal(executed.from.tick + 1, executed.to.tick);
  assert.ok(executed.trace.passes[28].segments.some(s => s.mode === 'linear' && s.component !== null));
  executed.trace.passes.length = 0; assert.equal(ability.lastMovement().trace.passes.length, 29);
  assert.deepEqual(preview.state.game, {ap: 1, turn: 1}); assert.deepEqual(preview.state.domains.world.block.structure.slice(2), slab.structure.slice(0, 2));
  const abilityCommit = session.commit(ability); assert.deepEqual(abilityCommit.snapshot, {...preview.state, revision: 1});
  assert.throws(() => session.commit(stalePreview), /stale/); assert.equal(session.energyBalance().driftQ, 0n);
  const resumedSession = createReactiveSession3D(movingRegistry, sessionInitial, policy); resumedSession.restore(JSON.parse(JSON.stringify(session.snapshot())));
  const sessionResults = [];
  for (const current of [session, resumedSession]) {
    const candidate = current.branch({horizonTicks: 1, ...(current === session ? {motion: {maxEntries: 512}} : {})});
    finishPreview(candidate); assert.equal(candidate.lastMovement().status, current === session ? 'complete' : 'disabled');
    sessionResults.push(current.commit(candidate));
  }
  assert.deepEqual(sessionResults[0], sessionResults[1]); assert.deepEqual(session.snapshot(), resumedSession.snapshot());
  assert.deepEqual(session.queries().exposure({box: landedBox}), resumedSession.queries().exposure({box: landedBox}));
  assert.equal(sourceQueries.fit({box: sourceBox}).blocker.structure, slab.structure[0]);
  const controlBlock = editReactiveMaterialBlock3D(movingRegistry, createReactiveMaterialBlock3D(movingRegistry, {width: 3, height: 1, depth: 1}),
    [{kind: 'place', x: 0, y: 0, z: 0, material: MAT.SMOKE, thermal: 70}]).block;
  const controlInitial = {worldId: 'reactive-control', gameRulesVersion: 'control-1', domains: createReactiveDomainsSnapshot3D(movingRegistry, createReactiveWorldSnapshot3D(movingRegistry, controlBlock, 3)), game: {memory: null}};
  const controlView = createReactiveSession3D(movingRegistry, controlInitial).queries();
  const control = createReactiveMaterialTransport3D(movingRegistry, controlView, [{id: 'smoke', cell: [0, 0, 0], velocityQ: [400, 0, 0]}]);
  const plan1 = applyReactiveMaterialTransport3D(movingRegistry, control).state;
  const plan2 = applyReactiveMaterialTransport3D(movingRegistry, plan1).state;
  const plan3 = applyReactiveMaterialTransport3D(movingRegistry, plan2);
  assert.deepEqual(plan3, applyReactiveMaterialTransport3D(movingRegistry, readReactiveMaterialTransport3D(movingRegistry, JSON.parse(JSON.stringify(plan2)))));
  assert.equal(plan3.state.parcels[0].cell, 1); assert.equal(plan3.state.parcels[0].remainderQ[0], 176); assert.equal(plan3.state.world.tick, 3);
  assert.deepEqual(reactiveMaterialEnergyLedger3D(movingRegistry, plan3.state.world.block), reactiveMaterialEnergyLedger3D(movingRegistry, control.world.block));
  const controlMemory = captureReactiveMaterialTransportMemory3D(movingRegistry, control);
  assert.deepEqual(restoreReactiveMaterialTransportMemory3D(movingRegistry, controlView, JSON.parse(JSON.stringify(controlMemory))), control);
  const controlPolicy = {reduceCommand(c) {return c.command.kind === 'translate' ? {memory: followReactiveMaterialTransport3D(movingRegistry, c.beforeQueries(), c.queries(), c.translation(), c.game.memory).memory} : c.game;},
    reduceTick(c) {return {memory: followReactiveMaterialTransport3D(movingRegistry, c.beforeQueries(), c.queries(), c.movement(), c.game.memory).memory};}};
  const controlled = createReactiveSession3D(movingRegistry, {...controlInitial, game: {memory: controlMemory}}, controlPolicy);
  const controlBranch = controlled.branch({horizonTicks: 1, translation: {}, motion: {}});
  controlBranch.enqueue({kind: 'translate', domain: null, request: {cells: [[0, 0, 0]], path: [[1, 0, 0]]}});
  finishPreview(controlBranch); controlled.commit(controlBranch);
  const controlSave = controlled.snapshot(), controlRestart = createReactiveSession3D(movingRegistry, {...controlInitial, game: {memory: controlMemory}}, controlPolicy);
  controlRestart.restore(JSON.parse(JSON.stringify(controlSave)));
  const controlContinued = [];
  for (const owner of [controlled, controlRestart]) {const candidate = owner.branch({horizonTicks: 1, motion: {}}); finishPreview(candidate); controlContinued.push(owner.commit(candidate));}
  assert.deepEqual(controlContinued[0], controlContinued[1]); assert.equal(controlled.snapshot().game.memory.cycle, 0); assert.equal(controlled.energyBalance().driftQ, 0n);
  const boundedTransport = createReactiveMaterialTransportJob3D(movingRegistry, control);
  assert.equal(boundedTransport.advance().phase, 'publish'); assert.throws(() => boundedTransport.result());
  assert.equal(boundedTransport.advance().status, 'complete'); assert.deepEqual(boundedTransport.result().state, plan1);
  const cancelledTransport = createReactiveMaterialTransportJob3D(movingRegistry, control); cancelledTransport.advance(); assert.equal(cancelledTransport.cancel(), true); assert.throws(() => cancelledTransport.result());
  const abilityBlock = editReactiveMaterialBlock3D(movingRegistry, createReactiveMaterialBlock3D(movingRegistry, {width: 4, height: 2, depth: 1}),
    [{kind: 'place', x: 0, y: 1, z: 0, material: MAT.SAND, thermal: 70}]).block;
  const transportInitial = {worldId: 'transport-ability', gameRulesVersion: 'ability-1', domains: createReactiveDomainsSnapshot3D(movingRegistry, createReactiveWorldSnapshot3D(movingRegistry, abilityBlock, 3)), game: {ap: 2, memory: null, units: []}};
  const transportView = createReactiveSession3D(movingRegistry, transportInitial).queries();
  transportInitial.game.memory = captureReactiveMaterialTransportMemory3D(movingRegistry, createReactiveMaterialTransport3D(movingRegistry, transportView, [{id: 'slab', cell: [0, 1, 0], velocityQ: [1024, 0, 0]}]));
  transportInitial.game.units = [{id: 'rider', body: createReactiveBody3D(transportView, {minQ: [256, 512, 256], sizeQ: [512, 512, 512], gravityQ: 0})}];
  const transportPolicy = {readTransport(c) {assert.equal(c.command.control, 'wind'); return c.game.memory;}, reduceCommand(c) {
    const t = c.transport(); if (!t) return c.game; assert.equal(t.movement.rulesVersion, 'reactive-transport-motion-1'); assert.ok(c.game.ap > 0);
    const units = acceptGroup(createReactiveTransportedActorGroup3D(c.beforeQueries(), c.queries(), t.movement).resolve(c.game.units));
    return {...c.game, ap: c.game.ap - 1, memory: t.memory, units};
  }, reduceTick(c) {return {...c.game, memory: followReactiveMaterialTransport3D(movingRegistry, c.beforeQueries(), c.queries(), c.movement(), c.game.memory).memory,
    units: acceptGroup(createReactiveActorGroup3D(c.beforeQueries(), c.queries(), c.movement()).resolve(c.game.units))};}};
  const transportSession = createReactiveSession3D(movingRegistry, transportInitial, transportPolicy), transportBefore = transportSession.snapshot();
  const transportAbility = transportSession.branch({horizonTicks: 1, transport: {}, motion: {}}); transportAbility.enqueue({kind: 'transport', domain: null, control: 'wind'});
  transportAbility.advance(); transportAbility.advance(); assert.deepEqual(transportAbility.inspect().state.domains, transportBefore.domains); assert.deepEqual(transportAbility.inspect().state.game, transportBefore.game);
  finishPreview(transportAbility); assert.deepEqual(transportSession.snapshot(), transportBefore); transportSession.commit(transportAbility);
  assert.equal(transportSession.snapshot().game.units[0].body.minQ[0], 1280); assert.equal(transportSession.snapshot().game.memory.cycle, 1);
  const transportSaved = transportSession.snapshot(), transportRestart = createReactiveSession3D(movingRegistry, transportInitial, transportPolicy); transportRestart.restore(JSON.parse(JSON.stringify(transportSaved)));
  const transportResults = [];
  for (const owner of [transportSession, transportRestart]) {const b = owner.branch({horizonTicks: 1, transport: {}, motion: {}}); b.enqueue({kind: 'transport', domain: null, control: 'wind'}); finishPreview(b); transportResults.push(owner.commit(b));}
  assert.deepEqual(transportResults[0], transportResults[1]); assert.equal(transportSession.snapshot().game.memory.cycle, 2); assert.equal(transportSession.energyBalance().driftQ, 0n);
  const blockedInitial = {...transportInitial, domains: transportSaved.domains, game: structuredClone(transportSaved.game)};
  blockedInitial.game.units.push({id: 'peer', body: createReactiveBody3D(createReactiveSession3D(movingRegistry, blockedInitial).queries(), {minQ: [2304, 256, 256], sizeQ: [512, 512, 512], gravityQ: 0})});
  const blockedTransport = createReactiveSession3D(movingRegistry, blockedInitial, transportPolicy), blockedBefore = blockedTransport.snapshot(), blockedAbility = blockedTransport.branch({horizonTicks: 0, transport: {}});
  blockedAbility.enqueue({kind: 'transport', domain: null, control: 'wind'}); assert.throws(() => finishPreview(blockedAbility), /peer-contact/); assert.deepEqual(blockedTransport.snapshot(), blockedBefore);
  // Structured-clone mock endpoints, using real task yields but no native Worker.
  const createWorkerPair = () => {
    const receivers = [() => {}, () => {}], closed = [false, false]; let pending = 0, maximum = 0;
    const ports = [0, 1].map(side => ({send(message) {
      assert.equal(closed[side], false); const copied = structuredClone(message);
      if (!side) {pending++; maximum = Math.max(maximum, pending);}
      queueMicrotask(() => {if (side) pending--; receivers[1 - side](copied);});
    }, subscribe(receive) {receivers[side] = receive; return () => {receivers[side] = () => {};};}, close() {closed[side] = true;}}));
    const host = createReactiveWorkerHost3D(ports[1], movingRegistry, transportInitial, transportPolicy, {channel: 'public-worker'});
    const client = createReactiveWorkerClient3D(ports[0], movingRegistry, {channel: 'public-worker', worldId: transportInitial.worldId, gameRulesVersion: transportInitial.gameRulesVersion});
    return {client, host, closed, maximum: () => maximum};
  };
  const workerA = createWorkerPair(), workerB = createWorkerPair();
  try {
    await workerA.client.ready; await workerB.client.ready;
    const superseded = workerA.client.request([], {horizonTicks: 0});
    const first = workerA.client.request([{kind: 'transport', domain: null, control: 'wind'}], {horizonTicks: 1, transport: {}, motion: {}});
    assert.equal((await superseded.result).status, 'superseded'); assert.equal((await first.result).status, 'ready');
    const queries = [{kind: 'exposure', request: {box: {minQ: [0, 0, 0], maxQ: [4096, 2048, 1024]}}}];
    const previewQueries = await workerA.client.queryPreview(first, queries), previewChanges = await workerA.client.changesPreview(first);
    assert.equal(previewQueries.results[0].value.stamp.kind, 'preview'); assert.equal(previewChanges.scope, 'endpoints');
    const firstCommit = await workerA.client.commit(first); assert.deepEqual(firstCommit.snapshot, transportSaved);
    const commitChanges = await workerA.client.changes(firstCommit), commitQueries = await workerA.client.query(queries);
    assert.deepEqual(commitChanges.channels, previewChanges.channels); assert.equal(commitChanges.to.kind, 'committed');
    const beforeView = createReactiveSession3D(movingRegistry, transportInitial).queries();
    const observedSession = createReactiveSession3D(movingRegistry, transportInitial); observedSession.restore(firstCommit.snapshot);
    const directChanges = createReactiveChangeJob3D(movingRegistry, beforeView, observedSession.queries());
    for (let n = 0; directChanges.progress().status === 'running'; n++) {assert.ok(n < 10000); directChanges.advance(64);}
    assert.deepEqual(commitChanges.channels, directChanges.result().channels);
    assert.deepEqual(commitQueries.results[0].value, observedSession.queries().exposure(queries[0].request));
    await workerB.client.restore(JSON.parse(JSON.stringify(firstCommit.snapshot)));
    const workerResults = [];
    for (const owner of [workerA, workerB]) {
      const ticket = owner.client.request([{kind: 'transport', domain: null, control: 'wind'}], {horizonTicks: 1, transport: {}, motion: {}});
      assert.equal((await ticket.result).status, 'ready'); workerResults.push(await owner.client.commit(ticket));
      assert.equal(owner.maximum(), 1);
    }
    assert.deepEqual(workerResults[0], workerResults[1]); assert.deepEqual(workerResults[0], transportResults[0]);
    await workerA.client.close(); await workerB.client.close(); assert.deepEqual(workerA.closed, [true, true]); assert.deepEqual(workerB.closed, [true, true]);
  } finally {workerA.host.close(); workerB.host.close();}
  return {passed: true, entry: 'state-space-engine/experimental/3d/reactive-materials', cells: 3, customMaterial: 200,
    atomicEdits: true, accountedChemicalEnergy: true, portableContinuation: true, physicsTicks: 0, gpu: false,
    localReactionCycle: true, stagedPublication: true, cancellation: true, reactionStateCycle: 4,
    conservativeEvolution: true, transportedSmoke: true, evolutionTick: 2,
    boundedStructure: true, structureCells: 4, structureRules: 'reactive-structure-1', budgetIndependentStructure: true,
    reactiveWorld: true, worldRules: 'reactive-world-1', worldCells: 4, completedReactiveWorldTicks: 3,
    atomicWorldPublication: true, revisionBoundCommit: true, worldContinuation: true,
    reactiveTranslation: true, translationRules: 'reactive-translation-1', translationCells: 4,
    translationWorldTicks: 2, preservesMaterialHistory: true,
    reactiveHolds: true, constrainedWorldRules: 'reactive-world-2', holdRules: 'reactive-holds-1',
    holdCells: 4, holdWorldTicks: 5, holdExpiryContinuation: true, noTemporaryAnchorResidue: true,
    reactiveDomains: true, domainRules: 'reactive-domains-1', transferRules: 'reactive-transfer-1', domainCells: 8,
    completedDomainSetTicks: 2, containedWorldTicks: 4, storedMaterialHistory: true, synchronizedReservoirContinuation: true,
    reactiveSession: true, sessionRules: 'reactive-session-1', sessionCells: 8, completedSessionTicks: 3,
    sessionContainedWorldTicks: 6, atomicGamePhysicsCommit: true, previewContinuation: true, stalePreviewRejected: true,
    reactiveGeometry: true, geometryRules: 'reactive-geometry-1', revisionStampedQueries: true, retainedQueryIsolation: true, exactExposureContinuation: true,
    reactiveMotion: true, motionRules: 'reactive-motion-1', boundedExecutedPaths: true, capturePhysicsExact: true,
    reactiveActors: true, bodyRules: 'reactive-body-1', displacementRules: 'reactive-displacement-1', actorCells: 4, actorSessionTicks: 3,
    causalPlatformCarry: true, actorSnapshotContinuation: true, reactiveCommandActors: true,
    translationMotionRules: 'reactive-translation-motion-1', translationBodyRules: 'reactive-translation-displacement-1',
    atomicCommandPolicy: true, controlledCarry: true, commandContinuation: true,
    reactiveActorGroups: true, actorGroupRules: 'reactive-actor-group-1', actorMovementRules: 'reactive-actor-movement-1',
    groupCells: 16, groupSessionTicks: 3, peerAwareMovement: true, peerConflictRollback: true, groupContinuation: true,
    reactiveTransportPlanner: true, transportRules: 'reactive-transport-1', transportMemoryRules: 'reactive-transport-memory-1',
    transportCells: 3, transportCandidateCycles: 3, transportSessionTicks: 3, transportPrivateContinuity: true, transportJSONContinuation: true,
    atomicTransportCommand: true, boundedTransportJobs: true, transportMovementRules: 'reactive-transport-motion-1', transportActorRules: 'reactive-transport-displacement-1',
    transportAbilityCells: 8, transportAbilityTicks: 3, transportActorRollback: true, transportAbilityContinuation: true,
    reactiveWorker: true, reactiveWorkerProtocol: 'reactive-worker-2', workerCells: 8, workerExecutedTicks: 3,
    workerDirectEquivalence: true, workerJSONContinuation: true, workerBackpressure: true, workerSupersession: true, nativeWorker: false,
    workerQueryBatches: true, workerChangeReports: true, workerObservationDirectEquivalence: true,
    queryRules: 'reactive-query-batches-1', changeRules: 'reactive-changes-1', endpointMotionObserved: false};
}
