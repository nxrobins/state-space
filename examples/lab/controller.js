import { createStateSpaceField, createGpuField, createMaterialRegistry } from '../../dist/sdk/state-space.js';
import { scenarioById, scenarioRegistry } from './scenarios.js';

export const encode = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item);
const copy = value => JSON.parse(encode(value));
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export async function makeField(backend, width, height, registry) {
  if (backend === 'cpu') return createStateSpaceField(width, height, undefined, registry);
  if (backend === 'webgpu') return createGpuField(width, height, { registry });
  throw new Error(`Unknown backend: ${backend}`);
}

/** Serializes public SDK operations; publishes a view only after completion.
 * Backend changes and imports validate a candidate before replacing the live field.
 */
export class LabController {
  #world; #backend = 'cpu'; #scene; #tail = Promise.resolve(); #view; #closed = false;
  constructor(factory = makeField, registryFor = scenarioRegistry) { this.factory = factory; this.registryFor = registryFor; }
  get view() { return this.#view; }
  #queue(operation) {
    const result = this.#tail.then(async () => {
      if (this.#closed) throw new Error('The lab is closed');
      const value = await operation();
      this.#refresh(Array.isArray(value) ? value : []);
      return value;
    });
    this.#tail = result.catch(() => {});
    return result;
  }
  #refresh(reports = []) {
    if (!this.#world || this.#closed) return;
    const world = this.#world;
    this.#view = freeze(copy({ backend: this.#backend, backendInfo: world.backendInfo ?? null,
      scene: this.#scene, snapshot: world.packedSnapshot(), catalog: world.registry.toCatalog(),
      ledger: world.energyLedger(), balance: world.energyBalance(), plan: world.inspectStructure(),
      samples: Array.from({ length: world.width * world.height }, (_, i) => world.sample(i % world.width, Math.floor(i / world.width))),
      reports: reports.map(({ tick, passId, changes, before, after }) => ({ tick, passId, changes: changes.length, deltaQ: after.totalQ - before.totalQ })) }));
  }
  async #replace(backend, registry, snapshot, scene) {
    const candidate = await this.factory(backend, snapshot.width, snapshot.height, registry);
    try { candidate.restore(snapshot); }
    catch (error) { candidate.close(); throw error; }
    const previous = this.#world;
    this.#world = candidate; this.#backend = backend; this.#scene = scene;
    previous?.close();
  }
  load(id, backend) {
    return this.#queue(async () => {
      const scene = scenarioById(id), registry = await this.registryFor(scene);
      const seed = createStateSpaceField(scene.width, scene.height, undefined, registry);
      try { scene.build(seed); await this.#replace(backend ?? this.#backend, registry, seed.packedSnapshot(), scene.id); }
      finally { seed.close(); }
    });
  }
  switchBackend(backend) {
    return this.#queue(() => this.#replace(backend, this.#world.registry, this.#world.packedSnapshot(), this.#scene));
  }
  step(ticks = 1, inspect = false) {
    return this.#queue(async () => {
      const reports = await this.#world.step(ticks, { inspect });
      // Return the reports; the caller can display them without retaining GPU state.
      return reports;
    });
  }
  edit(x, y, action, material) {
    return this.#queue(() => {
      const world = this.#world;
      if (action === 'paint') world.setCell(x, y, material);
      else if (action === 'break') world.setIntegrity(x, y, 0);
      else if (action === 'weld') world.setIntegrity(x, y, 255, { weld: true });
      else if (action === 'pin') world.setAnchor(x, y, !world.sample(x, y).anchored);
      else if (action === 'heat') world.setEnergy(x, y, world.sample(x, y).energyQ + 200 * 256);
      else throw new Error(`Unknown edit: ${action}`);
    });
  }
  exportSession() {
    return this.#queue(() => copy({ formatVersion: 1, catalog: this.#world.registry.toCatalog(), snapshot: this.#world.packedSnapshot() }));
  }
  importSession(session) {
    // Capture caller-owned data before the queued operation can run.
    const captured = copy(session);
    return this.#queue(async () => {
      if (captured.formatVersion !== 1) throw new Error('Unsupported lab session version');
      const registry = await createMaterialRegistry(captured.catalog);
      await this.#replace(this.#backend, registry, captured.snapshot, 'imported');
    });
  }
  close() { return this.#queue(() => { this.#world?.close(); this.#closed = true; }); }
}
