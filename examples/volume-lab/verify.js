import { snapshotHash } from './app.js';

/** Runs through the public worker/client boundary against fresh Node receipts. */
export async function verifyVolumeBrowser(expected) {
  const api = window.volumeLab, rows = [];
  const require = (condition, message) => { if (!condition) throw new Error(message); };
  const equal = (actual, wanted) => JSON.stringify(actual) === JSON.stringify(wanted);
  for (const reference of expected.rows) {
    document.getElementById('status').textContent = `${reference.scene} · Node / browser worker equality`;
    await api.scene(reference.scene);
    require(await api.hash() === reference.hashes[0], 'Initial scene differs from Node.');
    await api.step(3); const early = await api.snapshot();
    require(await snapshotHash(early) === reference.hashes[3], 'Odd-tick checkpoint differs.');
    await api.step(506); const later = await api.snapshot();
    require(await snapshotHash(later) === reference.hashes[509], 'Ordering checkpoint differs.');
    await api.step(515);
    const final = await api.snapshot();
    require(equal(final, reference.final), 'Complete Node / browser state differs at tick 1024.');
    require(api.balance().driftQ === '0', 'Browser worker energy drift.');
    for (const saved of [early, later]) {
      await api.restore(saved); await api.step(1024 - saved.tick);
      require(equal(await api.snapshot(), final), 'Browser split restart differs.');
    }
    const before = await api.hash();
    await api.renderOptions({ temperature: true, steam: false, cut: 16, yaw: 1.9 });
    require(await api.hash() === before, 'Rendering changed physics.');
    await api.renderOptions({ temperature: false, steam: true, cut: 32, yaw: .72 });
    require(await api.hash() === before, 'Restoring presentation changed physics.');
    let rejected = false;
    try { await api.restore({ ...final, rulesVersion: 'ca-v4' }); } catch { rejected = true; }
    require(rejected && await api.hash() === before, 'Invalid restore was not atomic.');
    let cloneRejected = false;
    try { await api.restore({ ...final, width: () => 32 }); } catch { cloneRejected = true; }
    await api.step(0);
    require(cloneRejected && await api.hash() === before, 'Uncloneable input blocked later worker requests.');
    let editRejected = false;
    try { await api.setEnergy(0, 0, 0, -1); } catch { editRejected = true; }
    require(editRejected && await api.hash() === before, 'Invalid edit was not atomic.');
    const balance = api.balance(), old = await api.sample(0, 0, 0);
    await api.setEnergy(0, 0, 0, old.energyQ + 256);
    require(BigInt(api.balance().externalQ) === BigInt(balance.externalQ) + 256n && api.balance().driftQ === '0', 'External edit accounting differs.');
    await api.restore(final);
    rows.push({ scene: reference.scene, ticks: 1024, completeNodeEquality: true, restartTicks: [3,509], restartExact: true,
      presentationIsolated: true, invalidRestoreAtomic: true, uncloneableInputRecovery: true, invalidEditAtomic: true, editAccountingExact: true,
      finalHash: await api.hash(), energyDriftQ: api.balance().driftQ });
  }
  // Exercise actual controls as well as the automation API.
  await api.scene('flow');
  document.getElementById('step').click();
  for (let i = 0; i < 100 && (await api.snapshot()).tick === 0; i++) await new Promise(resolve => setTimeout(resolve, 20));
  require((await api.snapshot()).tick === 1, 'Step button did not advance exactly one tick.');
  // Wait until the control transaction (including its render) has completed.
  while (document.getElementById('play').disabled) await new Promise(resolve => setTimeout(resolve, 20));
  document.getElementById('play').click(); await new Promise(resolve => setTimeout(resolve, 180)); document.getElementById('play').click();
  const played = await api.snapshot(); require(played.tick > 1, 'Playback did not advance.');
  const stable = await api.hash(); await new Promise(resolve => setTimeout(resolve, 80)); require(await api.hash() === stable, 'Pause did not stop physics.');
  return { passed: true, rows, controls: { step: true, playback: true, pause: true }, backendInfo: api.backendInfo, userAgent: navigator.userAgent };
}
