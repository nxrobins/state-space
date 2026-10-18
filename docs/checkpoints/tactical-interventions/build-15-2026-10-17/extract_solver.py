"""Source transformation only. No engine, SDK, test or harness execution."""
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
source = (OUT / 'terrain-displacement.before.txt').read_text()
core = source.replace('/** Exact one-way kinematic response to observed terrain. Never advances physics. */', '/** Shared exact one-way contact solver. Internal adapters supply trusted paths. */')
core = core.replace("import { tickMovementSource3D, type TickMovement3D } from './path-journal.js';\n", '')
core = core.replace("export const TERRAIN_DISPLACEMENT_RULES_3D = 'terrain-displacement-1';\n", '')
core = core.replace('TERRAIN_DISPLACEMENT_LIMITS_3D', 'DISPLACEMENT_LIMITS_3D')
core = core.replace('TerrainDisplacementContact3D', 'DisplacementContact3D').replace('TerrainDisplacementOptions3D', 'DisplacementOptions3D')
core = core.replace('TerrainDisplacementResult3D', 'DisplacementResult3D<R>')
core = core.replace('export type DisplacementResult3D<R>', 'export type DisplacementResult3D<R extends string>')
core = core.replace('typeof TERRAIN_DISPLACEMENT_RULES_3D', 'R')
core = core.replace('export interface TerrainDisplacement3D {', 'export interface DisplacementCore3D<R extends string> {')
core = core.replace('resolve(body: TerrainBodyState3D, options?: DisplacementOptions3D)', 'resolve(body: TerrainBodyState3D, options?: DisplacementOptions3D, carry?: DisplacementCarry3D)')
marker = 'const ZERO: F'
assert core.count(marker) == 1
definitions = '''export type DisplacementPass3D = {index: number; segments: readonly MotionPathSegment3D[]};
export type DisplacementCarry3D = (pass: DisplacementPass3D, body: TerrainBodyState3D, positions: ReadonlyMap<number, number>, spend: () => boolean) => V | null;
export type DisplacementSource3D<R extends string> = {
  rulesVersion: R; from: Readonly<GeometryStamp3D>; to: Readonly<GeometryStamp3D>;
  before: object; after: object; complete: boolean; passes: readonly DisplacementPass3D[];
  members: ReadonlyMap<number, number>; lastPass: number;
};
'''
core = core.replace(marker, definitions + marker)
start = core.index('export function createTerrainDisplacement3D(')
end = core.index('  const cell = ', start)
core = core[:start] + '''export function createDisplacementCore3D<R extends string>(before: GameplayGeometry3D, after: GameplayGeometry3D, observed: DisplacementSource3D<R>): DisplacementCore3D<R> {
  const source = gameplayGeometrySource3D(before), target = gameplayGeometrySource3D(after);
  if (source.token !== observed.before || target.token !== observed.after || JSON.stringify(before.stamp) !== JSON.stringify(observed.from) || JSON.stringify(after.stamp) !== JSON.stringify(observed.to)) throw Error('Displacement geometry differs from its observed boundaries.');
  const {complete, members} = observed;
  const [width, height] = source.shape, extent = source.shape.map(v => v * Q) as V;
  const coord = (i: number): V => [i % width * Q, Math.floor(i / width) % height * Q, Math.floor(i / (width * height)) * Q];
''' + core[end:]
core = core.replace('Object.freeze<TerrainDisplacement3D>', 'Object.freeze<DisplacementCore3D<R>>')
core = core.replace('rulesVersion: TERRAIN_DISPLACEMENT_RULES_3D', 'rulesVersion: observed.rulesVersion')
core = core.replace('resolve(input, request = {}) {', 'resolve(input, request = {}, carry) {')
core = core.replace('for (const pass of frame.paths.passes)', 'for (const pass of observed.passes)')
old = '        let offset: V = [...body.minQ], velocity: V = pass.index === 0 && fragments.length ? [0, Q, 0] : [0, 0, 0], time: F = {...ZERO};'
assert core.count(old) == 1
core = core.replace(old, '''        const carried = carry ? carry(pass, body, positions, spend) : pass.index === 0 && fragments.length ? [0, Q, 0] as V : [0, 0, 0] as V;
        if (carried === null) return finish('incomplete', 'budget', null);
        let offset: V = [...body.minQ], velocity: V = carried, time: F = {...ZERO};''')
assert core.count("'phase-overlap', 27)") == 1 and core.count("finish('resolved', null, 27)") == 1
core = core.replace("'phase-overlap', 27)", "'phase-overlap', observed.lastPass)").replace("finish('resolved', null, 27)", "finish('resolved', null, observed.lastPass)")
assert 'frame.' not in core and 'TerrainDisplacement' not in core and 'TERRAIN_DISPLACEMENT' not in core
target = ROOT / 'engine/experimental/terrain-displacement-core.ts'
if target.exists(): raise RuntimeError('Refusing to overwrite shared solver')
target.write_text(core)
wrapper = '''/** Tick adapter for the unchanged terrain-displacement-1 response contract. */
import type { GameplayGeometry3D, GeometryStamp3D } from './gameplay-geometry.js';
import { tickMovementSource3D, type TickMovement3D } from './path-journal.js';
import type { TerrainBodyState3D } from './terrain-body.js';
import { createDisplacementCore3D, DISPLACEMENT_LIMITS_3D, type DisplacementContact3D, type DisplacementOptions3D, type DisplacementResult3D } from './terrain-displacement-core.js';

export const TERRAIN_DISPLACEMENT_RULES_3D = 'terrain-displacement-1';
export const TERRAIN_DISPLACEMENT_LIMITS_3D = DISPLACEMENT_LIMITS_3D;
export type TerrainDisplacementContact3D = DisplacementContact3D;
export type TerrainDisplacementOptions3D = DisplacementOptions3D;
export type TerrainDisplacementResult3D = DisplacementResult3D<typeof TERRAIN_DISPLACEMENT_RULES_3D>;
export interface TerrainDisplacement3D {
  readonly rulesVersion: typeof TERRAIN_DISPLACEMENT_RULES_3D;
  readonly from: Readonly<GeometryStamp3D>; readonly to: Readonly<GeometryStamp3D>;
  resolve(body: TerrainBodyState3D, options?: TerrainDisplacementOptions3D): TerrainDisplacementResult3D;
}
export function createTerrainDisplacement3D(before: GameplayGeometry3D, after: GameplayGeometry3D, movement: TickMovement3D): TerrainDisplacement3D {
  const observed = tickMovementSource3D(movement), frame = observed.frame;
  const complete = !!frame && frame.motion.status === 'complete' && frame.paths.status === 'complete';
  const members = new Map<number, number>();
  if (complete) for (const f of frame.motion.fragments) for (const [start, length] of f.sourceRuns) for (let i = start; i < start + length; i++) members.set(i, f.id);
  const solver = createDisplacementCore3D(before, after, {...observed, rulesVersion: TERRAIN_DISPLACEMENT_RULES_3D,
    complete, members, passes: complete ? frame.paths.passes : [], lastPass: 27});
  return Object.freeze<TerrainDisplacement3D>({rulesVersion: TERRAIN_DISPLACEMENT_RULES_3D, from: solver.from, to: solver.to,
    resolve(body, options) {return solver.resolve(body, options);}});
}
'''
(ROOT / 'engine/experimental/terrain-displacement.ts').write_text(wrapper)
print('Extracted shared solver and tick adapter; no runtime execution.')
