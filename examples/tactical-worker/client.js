// Explicit application bootstrap; importing this module launches no worker.
import {createTacticalWorkerClient3D,tacticalBrowserWorkerTransport3D} from 'state-space-engine/experimental/3d/tactical-session';

export function startTacticalWorker(initial,channel) {
  const worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  try {
    worker.postMessage({kind:'initialize',channel,initial});
    return createTacticalWorkerClient3D(tacticalBrowserWorkerTransport3D(worker),{
      channel,worldId:initial.worldId,gameRulesVersion:initial.gameRulesVersion,
    });
  } catch(error) {worker.terminate();throw error;}
}
