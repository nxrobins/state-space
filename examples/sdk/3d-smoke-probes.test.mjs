import test from 'node:test';
import assert from 'node:assert/strict';
import {createStructuralSmokeFixture} from './3d-smoke-probes.js';
import {MAT} from '../../dist/sdk/state-space-3d.js';

test('bounded structural fixture falls coherently across chunk seams and restarts exactly',()=>{
  const {cpu,initial,plate,expectedStoneCells}=createStructuralSmokeFixture();
  assert.equal(initial.packedCells.length,512);
  assert.equal(plate.length,4);
  assert.ok(plate.every(i=>initial.packedCells[i]===initial.packedCells[plate[0]]));
  cpu.step(3);const checkpoint=cpu.snapshot();cpu.step(3);const final=cpu.snapshot();
  assert.deepEqual(final.packedCells.flatMap((word,i)=>(word&255)===MAT.STONE?[i]:[]),expectedStoneCells);
  assert.equal(cpu.energyBalance().driftQ,0n);
  cpu.restore(checkpoint);cpu.step(3);assert.deepEqual(cpu.snapshot(),final);
});
