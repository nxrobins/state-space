import { createStateSpaceField } from '../dist/sdk/state-space.js';
import { seedScene } from './demo.js';
import { stateHash } from './state-hash.js';

self.onmessage = async ({ data: { scene, checkpoints } }) => {
    const cpu = createStateSpaceField(256, 256);
    try {
        if (!Array.isArray(checkpoints) || checkpoints.some(tick => !Number.isSafeInteger(tick) || tick < 0)) throw new Error('Invalid reference checkpoints');
        seedScene(cpu, scene);
        const initial = cpu.packedSnapshot(), hashes = {};
        for (const tick of [...new Set(checkpoints)].sort((a, b) => a - b)) {
            cpu.step(tick - cpu.tick);
            hashes[tick] = await stateHash(cpu);
        }
        self.postMessage({ initial, hashes });
    } catch (error) { self.postMessage({ error: String(error.stack || error) }); }
    finally { cpu.close(); }
};
