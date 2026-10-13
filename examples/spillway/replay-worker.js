import { createStateSpaceField } from '../../dist/sdk/state-space.js';
import { ReferenceGame } from './game.js';
import { replayInto } from './replay.js';
self.onmessage = async ({ data }) => {
    const field = createStateSpaceField(256, 256);
    try { self.postMessage({ result: await replayInto(new ReferenceGame(field), data) }); }
    catch (error) { self.postMessage({ error: error.message }); }
    finally { field.close(); self.close(); }
};
