(async () => {
  const api = window.stateSpace;
  api.setPaused(true);
  const c = await import('/web/materials.generated.js');
  const { seedState, thermalView } = await import('/web/thermal.generated.js');
  const cold = c.buildColdTable();
  const snapshot = await api.snapshot();
  const pack = (m, t, flags = 0) => (m | (t << 8) | (c.MAT_PHASE[m] << 24) | (flags << 28)) >>> 0;
  const grid = new Uint32Array(snapshot.width * snapshot.height).fill(pack(c.MAT.AIR, 20));
  for (let y = snapshot.height - 5; y < snapshot.height; y++) {
    for (let x = 0; x < snapshot.width; x++) grid[y * snapshot.width + x] = pack(c.MAT.STONE, 20);
  }
  const materials = Object.values(c.MAT);
  for (let y = 100; y < 124; y++) {
    for (let x = 100; x < 132; x++) {
      const index = y * snapshot.width + x;
      grid[index] = pack(materials[(index * 7) % materials.length], (index * 19) % 256, index % 16);
    }
  }
  const state = seedState(grid, cold);
  for (let y = 100; y < 124; y++) {
    for (let x = 100; x < 132; x++) {
      const index = y * snapshot.width + x;
      state.energyQ[index] += index % 256 + (index % 5 === 0 ? 1000 * 256 : 0);
      state.grid[index] = thermalView(state.grid[index], state.energyQ[index], cold);
    }
  }
  const initial = { ...snapshot, tick: 3, packedCells: Array.from(state.grid), energyQ: Array.from(state.energyQ) };
  api.restore(initial);
  api.step(7);
  const split = await api.snapshot();
  api.step(13);
  const final = await api.snapshot();
  api.restore(split);
  api.step(13);
  const resumed = await api.snapshot();
  const replayEqual = JSON.stringify(resumed) === JSON.stringify(final);
  const sum = values => values.reduce((total, value) => total + BigInt(value), 0n).toString();
  window.__c3PaintBefore = final;
  const hash = async values => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint32Array.from(values).buffer)))
    .map(value => value.toString(16).padStart(2, '0')).join('');
  return { schemaVersion: final.schemaVersion, rulesVersion: final.rulesVersion, width: final.width, height: final.height,
    initialTick: initial.tick, finalTick: final.tick, replayEqual,
    initialGridHash: await hash(initial.packedCells), initialEnergyHash: await hash(initial.energyQ),
    finalGridHash: await hash(final.packedCells), finalEnergyHash: await hash(final.energyQ),
    initialEnergyQ: sum(initial.energyQ), finalEnergyQ: sum(final.energyQ) };
})()
