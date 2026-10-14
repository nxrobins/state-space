import { createStateSpaceField3D } from '../../dist/sdk/state-space-3d.js';
import { createScene } from './scenes.js';

let field;
const balance = () => Object.fromEntries(Object.entries(field.energyBalance()).map(([k, v]) => [k, String(v)]));
function state() {
  const result = { grid: new Uint32Array(field.width * field.height * field.depth), energyQ: new Uint32Array(field.width * field.height * field.depth) };
  field.copyStateInto(result);
  const counts = {};
  for (const value of result.grid) counts[value & 255] = (counts[value & 255] || 0) + 1;
  return { ...result, width: field.width, height: field.height, depth: field.depth, tick: field.tick, balance: balance(), counts };
}
self.onmessage = ({ data: { id, operation, args = [] } }) => {
  const started = performance.now();
  try {
    let result;
    if (operation === 'scene') { field = createScene(args[0]); result = state(); }
    else if (operation === 'restore') {
      const saved = args[0];
      const next = createStateSpaceField3D(saved.width, saved.height, saved.depth); next.restore(saved);
      field = next; result = state();
    } else {
      if (!field) throw new Error('Load a scene first.');
      if (operation === 'step') { field.step(args[0] ?? 1); result = state(); }
      else if (operation === 'state') result = state();
      else if (operation === 'snapshot') result = field.snapshot();
      else if (operation === 'sample') result = field.sample(...args);
      else if (operation === 'setCell' || operation === 'setEnergy') { field[operation](...args); result = state(); }
      else throw new Error('Unknown worker operation.');
    }
    const transfer = result.grid ? [result.grid.buffer, result.energyQ.buffer] : [];
    self.postMessage({ id, result, workerMs: performance.now() - started }, transfer);
  } catch (error) { self.postMessage({ id, error: error.message }); }
};
