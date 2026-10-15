import { ActiveCavernGame, commandFor } from './game.js';

export const GPU_GAMEPLAY_RULES={goal:{minX:72*256,maxY:64*256+1,minZ:61*256,maxZ:66*256},fallY:125*256,toolCeiling:127};
export const actorState=game=>({player:{...game.player},look:[...game.look],status:game.status,carved:game.events.some(e=>e.type==='carved'),iceWalk:game.events.some(e=>e.type==='ice-walk')});

/** Optional SDK controller; the CPU class and portable game envelope are unchanged. */
export class GpuActiveCavernGame extends ActiveCavernGame {
  driver=null;lastCommit=null;
  async initialize(){await super.initialize();this.driver=await this.field.createGameplay(actorState(this),GPU_GAMEPLAY_RULES);}
  async restore(saved){
    await super.restore(saved);
    if(this.driver)await this.driver.restore(actorState(this));
    else this.driver=await this.field.createGameplay(actorState(this),GPU_GAMEPLAY_RULES);
    this.lastCommit=null;
  }
  async step(input={},presentation){
    if(this.busy)throw new Error('Game operation in flight.');
    const c=commandFor(input,this.field.tick+1);this.busy=true;
    try{
      const commit=await this.driver.step(c,presentation);
      this.player={...commit.player};this.look=[...commit.look];this.status=commit.status;
      this.events.push(...commit.events);this.commands.push(c);this.lastCommit=commit;return c;
    }finally{this.busy=false;}
  }
  async present(presentation){
    if(this.busy)throw new Error('Game operation in flight.');this.busy=true;
    try{this.lastCommit=await this.driver.present(presentation);return this.lastCommit;}
    finally{this.busy=false;}
  }
  // The target is sampled with the submitted view; a paused view change uses
  // present() before displaying a new target, with no simulation tick.
  target(){return this.lastCommit?.target?structuredClone(this.lastCommit.target):null;}
}
