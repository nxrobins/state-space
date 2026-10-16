/** Canonical, partition-independent bytes for complete committed M5 state. */
export function structuralStateBytes(state){
 const header=new TextEncoder().encode(JSON.stringify([state.schemaVersion,state.rulesVersion,state.worldVersion,state.materialCatalogHash,state.width,state.height,state.depth,state.tick]));
 const length=state.width*state.height*state.depth;
 const bytes=new Uint8Array(4+header.length+length*12),view=new DataView(bytes.buffer);
 view.setUint32(0,header.length,true);bytes.set(header,4);let offset=4+header.length;
 for(const key of ['packedCells','energyQ','structure']){
  if(state[key].length!==length)throw Error('Incomplete structural state');
  for(let i=0;i<length;i++,offset+=4)view.setUint32(offset,state[key][i],true);
 }
 return bytes;
}
export async function structuralStateDigest(state){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',structuralStateBytes(state))),v=>v.toString(16).padStart(2,'0')).join('');
}
