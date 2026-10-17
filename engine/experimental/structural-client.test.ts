import { afterEach, beforeEach, expect, test, vi } from 'vitest';

// Import the real application, clock and frame pump. Only SDK/DOM boundaries are
// mocked: rejected frames and recovery run through the actual browser handlers.
const mocks=vi.hoisted(()=>({create:vi.fn(),validate:vi.fn(),scene:vi.fn()}));
vi.mock('../../dist/sdk/state-space-structural-world-gpu.js',()=>({createStateSpaceStructuralWorld3DGPU:mocks.create,validateStructuralGameplayState3D:mocks.validate}));
vi.mock('../../dist/sdk/state-space-structural-world.js',()=>({MAT:{AIR:0},MATERIALS_3D:[]}));
vi.mock('../../examples/structural-cavern/scene.js',()=>({createStructuralLevel:mocks.scene,structuralAction:()=>[],fixtureEdits:()=>[],scriptedInput:()=>({}),SCENE_VERSION:'test'}));

type ElementStub={value:string;textContent:string;hidden:boolean;checked:boolean;onclick:()=>void;addEventListener:ReturnType<typeof vi.fn>};
type Api={ready:Promise<void>;stop:()=>Promise<void>;restore:(s:unknown)=>Promise<void>;present:()=>Promise<void>};
let elements:Map<string,ElementStub>,callbacks:Map<number,FrameRequestCallback>,nextHandle:number,api:Api;
let field:{tick:number;restore:ReturnType<typeof vi.fn>;close:ReturnType<typeof vi.fn>},driver:{step:ReturnType<typeof vi.fn>;present:ReturnType<typeof vi.fn>;restore:ReturnType<typeof vi.fn>};
let status:'playing'|'won'|'lost';
const element=(id:string)=>elements.get(id)!;
const actor=()=>({player:{x:3000,y:2000,z:5000},status,look:[256,0,0],carved:false,iceWalk:false});
function fire(now:number){const pending=[...callbacks.values()];callbacks.clear();pending.forEach(fn=>fn(now));}
async function drain(){for(let i=0;i<12;i++)await Promise.resolve();}
async function playFrame(){element('play').onclick();fire(0);await drain();fire(1000/60);await drain();}

beforeEach(async()=>{
  vi.resetModules();vi.clearAllMocks();status='playing';callbacks=new Map();nextHandle=0;
  elements=new Map(['world','size','scene','dimension','mode','error','tick','play','frame','solve','target','tool','energy','expectation','step','reset','script','cut','heat','melt','appearance','camera','crosshair','inspect','export','import','file'].map(id=>[id,{value:'',textContent:'',hidden:true,checked:false,onclick:()=>{},addEventListener:vi.fn()}]));
  vi.stubGlobal('document',{getElementById:(id:string)=>element(id),activeElement:null});
  vi.stubGlobal('location',{search:''});vi.stubGlobal('window',{addEventListener:vi.fn()});
  vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>{callbacks.set(++nextHandle,fn);return nextHandle;});
  vi.stubGlobal('cancelAnimationFrame',(id:number)=>callbacks.delete(id));
  mocks.validate.mockImplementation(value=>value);
  mocks.scene.mockImplementation(()=>({size:32,scenario:'control',actor:actor(),deckY:14,rules:{goal:{minX:2304,maxY:2048,minZ:1536,maxZ:2560}},field:{snapshot:()=>({chunkSize:8})}}));
  mocks.create.mockImplementation(async()=>{
    driver={step:vi.fn(async()=>{field.tick++;return actor();}),present:vi.fn(async()=>actor()),restore:vi.fn(async()=>{}),...{inspect:actor,close:vi.fn()}};
    field={tick:0,restore:vi.fn(async()=>{}),close:vi.fn(),...{inspectSolve:()=>({planReused:true}),createGameplay:async()=>driver,
      createRenderer:async()=>({setAppearance:async()=>{},setHeatDistortion:async()=>{},close:vi.fn()})}};
    return field;
  });
  // @ts-expect-error The public example is JavaScript, exercised as shipped.
  await import('../../examples/structural-cavern/app.js');
  api=(window as unknown as {structuralCavern:Api}).structuralCavern;await api.ready;
});
afterEach(async()=>{await api?.stop().catch(()=>{});vi.unstubAllGlobals();});

test('frame rejection, reset and Play resume ticks with one frame pump',async()=>{
  driver.step.mockRejectedValueOnce(Error('injected frame failure'));
  await playFrame();expect(element('error').hidden).toBe(false);expect(callbacks.size).toBe(0);expect(field.tick).toBe(0);
  element('reset').onclick();await drain();expect(mocks.create).toHaveBeenCalledTimes(2);expect(element('error').hidden).toBe(true);expect(callbacks.size).toBe(1);
  await playFrame();expect(field.tick).toBe(1);expect(callbacks.size).toBe(1);
  element('reset').onclick();await drain();expect(callbacks.size).toBe(1);
});

test('successful checkpoint recovery restarts frames while failed reset stays stopped',async()=>{
  driver.step.mockRejectedValueOnce(Error('injected frame failure'));await playFrame();
  await api.restore({version:'test',size:32,scenario:'control',field:{},actor:actor()});
  expect(callbacks.size).toBe(1);await playFrame();expect(field.tick).toBe(1);
  driver.step.mockRejectedValueOnce(Error('second failure'));fire(1000/30);await drain();expect(callbacks.size).toBe(0);
  mocks.create.mockRejectedValueOnce(Error('recovery failed'));element('reset').onclick();await drain();
  expect(element('error').hidden).toBe(false);expect(callbacks.size).toBe(0);
});

test('HUD follows committed status, including out-of-lane actors and losses',async()=>{
  // The stub meets X/Y but is outside Z: the old HUD falsely declared a win.
  await api.present();expect(element('mode').textContent).toBe('PAUSED');
  status='won';await api.present();expect(element('mode').textContent).toBe('CROSSING COMPLETE');
  status='lost';await api.present();expect(element('mode').textContent).toBe('FELL / RESET TO RETRY');
});
