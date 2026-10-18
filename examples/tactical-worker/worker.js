// Application-owned rules stay here. Bundle this module with the public SDK.
import {createTacticalSession3D,createTacticalWorkerHost3D} from 'state-space-engine/experimental/3d/tactical-session';

function initialize(event) {
  const value=event.data;
  if(!value||value.kind!=='initialize'||Object.keys(value).sort().join(',')!=='channel,initial,kind')throw Error('Invalid worker initialization.');
  self.removeEventListener('message',initialize);
  const session=createTacticalSession3D(value.initial,{
    validateGame:({game})=>Number.isSafeInteger(game.ap)&&game.ap>=0,
  });
  createTacticalWorkerHost3D({
    send:message=>self.postMessage(message),
    subscribe(receive,failed) {
      const message=e=>receive(e.data),error=()=>failed(Error('Worker message could not be cloned.'));
      self.addEventListener('message',message);self.addEventListener('messageerror',error);
      return ()=>{self.removeEventListener('message',message);self.removeEventListener('messageerror',error);};
    },
    close:()=>self.close(),
  },session,(editor,command)=>{
    const game=editor.inspect().game;
    if(!command||Object.keys(command).sort().join(',')!=='cost,x,y,z'||!Number.isSafeInteger(command.cost)||command.cost<0||game.ap<command.cost)throw Error('Invalid lift command or insufficient AP.');
    editor.translate({cells:[[command.x,command.y,command.z]],path:[[0,-1,0]]});
    editor.setGame({...game,ap:game.ap-command.cost});
  },value.channel);
}
self.addEventListener('message',initialize);
