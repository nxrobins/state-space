// Observe the same live browser when agent-browser's Windows response transport
// fails. The browser and simulation are not restarted.
import { writeFile } from 'node:fs/promises';
const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Pass the live browser CDP port.');
const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const tab = tabs.find(t => t.url === 'http://127.0.0.1:8765/web/' && t.type === 'page');
if (!tab) throw new Error('The verified sandbox tab is no longer live.');
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
try {
  const expression = `(async()=>{
    const api = window.stateSpace;
    api.setPaused(true);
    const before = window.__c3PaintBefore;
    api.restore(before);
    const canvas = document.querySelector('#canvas');
    canvas.dispatchEvent(new MouseEvent('mousedown',{clientX:400,clientY:180,button:0,buttons:1,bubbles:true}));
    canvas.dispatchEvent(new MouseEvent('mouseup',{clientX:400,clientY:180,button:0,bubbles:true}));
    const after = await api.snapshot();
    const changed = after.packedCells.flatMap((v,i)=>v!==before.packedCells[i]?[i]:[]);
    const sum = a=>a.reduce((s,v)=>s+BigInt(v),0n);
    let rejected=false;
    try { const bad={...after}; delete bad.energyQ; api.restore(bad); } catch(e) { rejected=true; }
    const unchanged = JSON.stringify(await api.snapshot())===JSON.stringify(after);
    const paint = { changedCells:changed.length, allWood:changed.every(i=>(after.packedCells[i]&255)===7),
      allWoodEnergy:changed.every(i=>after.energyQ[i]===25600), energyDeltaQ:(sum(after.energyQ)-sum(before.energyQ)).toString(),
      expectedDeltaQ:changed.reduce((s,i)=>s+25600n-BigInt(before.energyQ[i]),0n).toString(),
      otherEnergyUnchanged:after.energyQ.every((e,i)=>changed.includes(i)||e===before.energyQ[i]),
      invalidRestoreRejected:rejected, invalidRestoreAtomic:unchanged, tick:after.tick };
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'c',code:'KeyC',bubbles:true}));
    const cleared = await api.snapshot();
    const clear = { tick:cleared.tick, totalEnergyQ:sum(cleared.energyQ).toString(),
      allAmbient:cleared.energyQ.every(e=>e===5120), stoneCells:cleared.packedCells.filter(v=>(v&255)===1).length };
    return { paint, clear };
  })()`;
  const response = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Live browser evaluation timed out')), 45000);
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id === 1) { clearTimeout(timeout); resolve(message); }
    });
  });
  socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true, timeout: 40000 } }));
  const result = await response;
  if (result.error || result.result?.exceptionDetails) throw new Error(JSON.stringify(result));
  const evidence = result.result.result.value;
  await writeFile('docs/checkpoints/c3-browser-edit-validation.json', JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence));
  if (evidence.paint.changedCells !== 29 || !evidence.paint.allWood || !evidence.paint.allWoodEnergy ||
      evidence.paint.energyDeltaQ !== evidence.paint.expectedDeltaQ || !evidence.paint.otherEnergyUnchanged || !evidence.paint.invalidRestoreRejected || !evidence.paint.invalidRestoreAtomic ||
      evidence.clear.tick !== 0 || !evidence.clear.allAmbient || evidence.clear.stoneCells !== 5120) {
    throw new Error('Browser edit/clear validation failed');
  }
} finally { socket.close(); }
