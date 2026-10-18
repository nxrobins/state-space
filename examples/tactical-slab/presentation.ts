/** Public SDK composition adapter. Does not acquire a GPU or start a frame loop. */
import { prepareTacticalScene3D, TACTICAL_RENDER_COORDINATES_3D, type TacticalDecoration3D } from 'state-space-engine/experimental/3d/tactical-renderer';
import type { GeometryVector3D, TacticalPreview3D } from 'state-space-engine/experimental/3d/tactical-session';
import type { SlabGame, SlabSnapshot, inspectSlab } from './scenario.js';

export function prepareSlabScene(state: SlabSnapshot | TacticalPreview3D<SlabGame>, observation: ReturnType<typeof inspectSlab>) {
  const q = TACTICAL_RENDER_COORDINATES_3D.fixedPointScale;
  const actors: TacticalDecoration3D[] = state.game.units.map(unit => ({id: unit.id,
    box: {minQ: unit.body.minQ, maxQ: unit.body.minQ.map((n, i) => n + unit.body.sizeQ[i]) as unknown as GeometryVector3D}, color: [0.3, 0.7, 0.95, 1]}));
  const overlays: TacticalDecoration3D[] = state.game.slab.map(i => {
    const {width, height} = state.terrain, p = [i % width, Math.floor(i / width) % height, Math.floor(i / (width * height))];
    return {id: `slab:${i}`, box: {minQ: p.map(v => v * q) as unknown as GeometryVector3D, maxQ: p.map(v => (v + 1) * q) as unknown as GeometryVector3D}, color: [1, 0.7, 0.2, 0.8]};
  });
  return prepareTacticalScene3D(state, {stamp: observation.stamp, actors, overlays});
}
