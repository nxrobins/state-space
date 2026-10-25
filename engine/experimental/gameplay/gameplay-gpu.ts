/** Internal resident controller resources. Public types never expose GPU handles. */
import { checkedInteger } from '../../validation.js';
import { createStateSpaceField3D } from '../3d.js';
import { gameplayShader } from './gameplay-shader.js';
import type { LatencyProfiler, Trace } from '../volume/latency.js';
import type {
  GameplayCommand3D,
  GameplayCommit3D,
  GameplayRules3D,
  GameplayState3D,
} from './gameplay-view.js';

const statuses = ['playing', 'won', 'lost'] as const;
const tools = ['none', 'carve', 'freeze'] as const;
function look(v: readonly number[]) {
  if (!Array.isArray(v) || v.length !== 3) throw new Error('Invalid gameplay look.');
  const owned: number[] = [v[0], v[1], v[2]];
  for (const n of owned) checkedInteger(n, -256, 256, 'look');
  const length = owned.reduce((s, n) => s + n * n, 0);
  if (length < 250 ** 2 || length > 262 ** 2) throw new Error('Invalid gameplay look length.');
  return owned;
}
export function checkedGameplayState(state: GameplayState3D, shape: readonly number[]) {
  if (!state || Object.keys(state).sort().join(',') !== 'carved,iceWalk,look,player,status')
    throw new Error('Invalid gameplay state.');
  const p = state.player;
  if (!p || Object.keys(p).sort().join(',') !== 'blocked,cooldown,grounded,jumpHeld,vy,wet,x,y,z')
    throw new Error('Invalid gameplay player.');
  checkedInteger(p.x, 77, shape[0] * 256 - 77, 'player x');
  checkedInteger(p.y, 448, shape[1] * 256, 'player y');
  checkedInteger(p.z, 77, shape[2] * 256 - 77, 'player z');
  checkedInteger(p.vy, -150, 150, 'player velocity');
  checkedInteger(p.cooldown, 0, 6, 'cooldown');
  for (const v of [p.grounded, p.wet, p.jumpHeld, p.blocked, state.carved, state.iceWalk])
    if (typeof v !== 'boolean') throw new Error('Invalid gameplay flag.');
  if (!statuses.includes(state.status)) throw new Error('Invalid gameplay status.');
  return {
    player: { ...p },
    look: look(state.look),
    status: state.status,
    carved: state.carved,
    iceWalk: state.iceWalk,
  };
}
export function checkedGameplayRules(rules: GameplayRules3D, shape: readonly number[]) {
  if (
    !rules ||
    Object.keys(rules).sort().join(',') !== 'fallY,goal,toolCeiling' ||
    !rules.goal ||
    Object.keys(rules.goal).sort().join(',') !== 'maxY,maxZ,minX,minZ'
  )
    throw new Error('Invalid gameplay rules.');
  const g = rules.goal;
  checkedInteger(g.minX, 0, shape[0] * 256, 'goal x');
  checkedInteger(g.maxY, 0, shape[1] * 256, 'goal y');
  checkedInteger(g.minZ, 0, shape[2] * 256, 'goal z');
  checkedInteger(g.maxZ, g.minZ, shape[2] * 256, 'goal max z');
  checkedInteger(rules.fallY, 448, shape[1] * 256, 'fall threshold');
  checkedInteger(rules.toolCeiling, 1, shape[1] - 1, 'tool ceiling');
  return { ...rules, goal: { ...g } };
}
export function checkedGameplayCommand(c: GameplayCommand3D, tick: number) {
  if (!c || Object.keys(c).sort().join(',') !== 'jump,look,moveX,moveZ,tick,tool')
    throw new Error('Invalid gameplay command.');
  checkedInteger(c.tick, tick, tick, 'command tick');
  checkedInteger(c.tick, 1, 7200, 'gameplay tick');
  checkedInteger(c.moveX, -256, 256, 'moveX');
  checkedInteger(c.moveZ, -256, 256, 'moveZ');
  if (
    c.moveX ** 2 + c.moveZ ** 2 > 257 ** 2 ||
    typeof c.jump !== 'boolean' ||
    !tools.includes(c.tool)
  )
    throw new Error('Invalid gameplay input.');
  return { ...c, look: look(c.look) };
}

export async function makeGameplayResources(
  device: GPUDevice,
  shape: readonly number[],
  edge: number,
  cold: GPUBuffer,
  dirty: GPUBuffer,
  activity: GPUBuffer | undefined,
  rules: GameplayRules3D,
  profiler: LatencyProfiler,
) {
  const seed = createStateSpaceField3D(1, 1, 1).snapshot();
  const module = device.createShaderModule({
    code: gameplayShader(shape, edge, Boolean(activity), rules, [
      seed.packedCells[0],
      seed.energyQ[0],
    ]),
  });
  const errors = (await module.getCompilationInfo()).messages.filter((m) => m.type === 'error');
  if (errors.length) throw new Error(errors.map((m) => `${m.lineNum}: ${m.message}`).join('\n'));
  const pipelines: Record<string, GPUComputePipeline> = {};
  for (const entryPoint of ['tools', 'noTools', 'cacheRegion', 'locomotion', 'present'])
    pipelines[entryPoint] = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module, entryPoint },
    });
  const buffers: GPUBuffer[] = [];
  const buffer = (size: number, usage: number) => {
    const b = device.createBuffer({ size, usage });
    buffers.push(b);
    return b;
  };
  const storage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const actor = buffer(128, storage),
    cache = buffer(4096 * 4, storage),
    result = buffer(512, storage),
    read = buffer(512, GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ),
    uniform = buffer(48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  const params = new Int32Array(12),
    groups = new Map<GPUBuffer, Record<string, GPUBindGroup>>();
  function bindings(grid: GPUBuffer, energy: GPUBuffer) {
    let g = groups.get(grid);
    if (g) return g;
    g = {};
    const resources = [grid, energy, cold, actor, cache, result, uniform, dirty, activity];
    const entries: Record<string, number[]> = {
      tools: [0, 1, 2, 3, 4, 5, 6, 7, ...(activity ? [8] : [])],
      noTools: [3, 5],
      cacheRegion: [0, 3, 4],
      locomotion: [3, 4, 5, 6],
      present: [3, 4, 5, 6],
    };
    for (const name of Object.keys(pipelines))
      g[name] = device.createBindGroup({
        layout: pipelines[name].getBindGroupLayout(0),
        entries: entries[name].map((binding) => ({
          binding,
          resource: { buffer: resources[binding]! },
        })),
      });
    groups.set(grid, g);
    return g;
  }
  function dispatch(
    encoder: GPUCommandEncoder,
    name: string,
    grid: GPUBuffer,
    energy: GPUBuffer,
    count = 1,
    trace?: Trace,
    label = name,
  ) {
    const pass = encoder.beginComputePass(profiler.pass(trace, label));
    pass.setPipeline(pipelines[name]);
    pass.setBindGroup(0, bindings(grid, energy)[name]);
    pass.dispatchWorkgroups(count);
    pass.end();
  }
  return {
    result,
    read,
    writeState(s: GameplayState3D) {
      const p = s.player,
        a = new Int32Array(32);
      a.set([
        p.x,
        p.y,
        p.z,
        p.vy,
        +p.grounded,
        +p.wet,
        +p.jumpHeld,
        p.cooldown,
        +p.blocked,
        statuses.indexOf(s.status),
        +s.carved | (+s.iceWalk << 1),
        ...s.look,
      ]);
      device.queue.writeBuffer(actor, 0, a);
    },
    prepare(c: GameplayCommand3D, view: readonly number[] = c.look) {
      const v = look(view);
      params.set([c.moveX, c.moveZ, +c.jump, tools.indexOf(c.tool), ...c.look, c.tick, ...v, 0]);
      device.queue.writeBuffer(uniform, 0, params);
    },
    initialize(e: GPUCommandEncoder, grid: GPUBuffer, energy: GPUBuffer) {
      dispatch(e, 'cacheRegion', grid, energy, 64);
    },
    tools(
      e: GPUCommandEncoder,
      grid: GPUBuffer,
      energy: GPUBuffer,
      canEdit: boolean,
      trace?: Trace,
    ) {
      dispatch(e, canEdit ? 'tools' : 'noTools', grid, energy, 1, trace, 'tools');
    },
    controller(e: GPUCommandEncoder, grid: GPUBuffer, energy: GPUBuffer, trace?: Trace) {
      dispatch(e, 'cacheRegion', grid, energy, 64, trace, 'collisionCache');
      dispatch(e, 'locomotion', grid, energy, 1, trace, 'controller');
    },
    present(e: GPUCommandEncoder, grid: GPUBuffer, energy: GPUBuffer, trace?: Trace) {
      dispatch(e, 'present', grid, energy, 1, trace, 'controller');
    },
    decode(words: Uint32Array, tick: number): GameplayCommit3D {
      if (words[25] || words[14] > 4 || words[15] > 27)
        throw new Error(`GPU gameplay rejected its bounded neighborhood (${words[25]}).`);
      const signed = new Int32Array(words.buffer, words.byteOffset, words.length),
        types = ['carved', 'cooled', 'trapped', 'ice-walk', 'crossed', 'fell'] as const;
      const state = checkedGameplayState(
        {
          player: {
            x: signed[0],
            y: signed[1],
            z: signed[2],
            vy: signed[3],
            grounded: Boolean(words[4]),
            wet: Boolean(words[5]),
            jumpHeld: Boolean(words[6]),
            cooldown: words[7],
            blocked: Boolean(words[8]),
          },
          status: statuses[words[9]],
          carved: Boolean(words[10] & 1),
          iceWalk: Boolean(words[10] & 2),
          look: [signed[11], signed[12], signed[13]],
        },
        shape,
      );
      const events = [];
      for (let i = 0; i < words[14]; i++) {
        const b = 32 + i * 8,
          type = types[words[b] - 1];
        if (!type || words[b + 1] !== tick) throw new Error('Invalid GPU gameplay event.');
        events.push({
          tick,
          type,
          ...(words[b] <= 2
            ? { cells: words[b + 2], target: [words[b + 3], words[b + 4], words[b + 5]] }
            : {}),
        });
      }
      return {
        ...state,
        tick,
        events,
        target:
          words[20] === 0xffffffff
            ? null
            : { cell: [words[22], words[23], words[24]], material: words[21] },
        submissions: 1,
        completionBoundaries: 1,
        actorReadbackBytes: 512,
      };
    },
    close() {
      for (const b of buffers) b.destroy();
      groups.clear();
    },
  };
}
