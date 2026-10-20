import { assertRecordFields } from '../portable-data.js';
/** Shared defensive validation of bounded geometry answers; no query execution. */
import { checkedInteger } from '../validation.js';
import { GEOMETRY_LIMITS_3D, EXPOSURE_RULES_VERSION_3D } from './geometry-kernel.js';
export type GeometryQueryCells3D = {width: number; height: number; packedCells: readonly number[]; energyQ: readonly number[]; structure: readonly number[]};
function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): asserts value is Record<string, unknown> {
  assertRecordFields(value, required, optional, 'Invalid worker message fields.');
}
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER) {return checkedInteger(value as number, min, max, 'worker query result');}
function boolean(value: unknown) {if (typeof value !== 'boolean') throw Error('Invalid worker query boolean.'); return value;}
function decimal(value: unknown) {
  if (typeof value !== 'string' || value.length > 32 || !/^(0|[1-9][0-9]*)$/.test(value)) throw Error('Invalid worker query integer string.'); return BigInt(value);
}
function cell(value: unknown, terrain: GeometryQueryCells3D) {
  if (value === null) return;
  fields(value, ['index', 'coordinate', 'material', 'energyQ', 'structure']);
  const i = integer(value.index, 0, terrain.packedCells.length - 1), expected = [i % terrain.width, Math.floor(i / terrain.width) % terrain.height, Math.floor(i / (terrain.width * terrain.height))];
  const coordinate = value.coordinate;
  if (!Array.isArray(coordinate) || coordinate.length !== 3 || expected.some((n, axis) => coordinate[axis] !== n) ||
      value.material !== (terrain.packedCells[i] & 255) || value.energyQ !== terrain.energyQ[i] || value.structure !== terrain.structure[i]) throw Error('Worker query cell differs from queried terrain.');
}
function contact(value: unknown, terrain: GeometryQueryCells3D) {
  if (value === null) return;
  fields(value, ['time', 'normal', 'boundary', 'cell', 'startedOverlapping']); fields(value.time, ['numerator', 'denominator']);
  const d = integer(value.time.denominator, 1); integer(value.time.numerator, 0, d);
  if (!Array.isArray(value.normal) || value.normal.length !== 3 || value.normal.some(v => !Number.isInteger(v) || Math.abs(v) > 1) ||
      value.normal.reduce((sum, n) => sum + Math.abs(n), 0) > 1) throw Error('Invalid worker contact normal.');
  boolean(value.startedOverlapping); if (boolean(value.boundary) !== (value.cell === null)) throw Error('Invalid worker boundary contact.'); cell(value.cell, terrain);
}
export function validateGeometryQueryResults3D(results: unknown[], requests: readonly {kind: string; domain?: string | null}[], getTerrain: (id: string | null) => GeometryQueryCells3D, materials: ReadonlySet<number>, validateStamp: (stamp: unknown, id: string | null) => void) {
  results.forEach((answer: unknown, index: number) => {
    fields(answer, ['kind', 'domain', 'value']); const request = requests[index], id = request.domain ?? null, terrain = getTerrain(id);
    if (answer.kind !== request.kind || answer.domain !== id) throw Error('Worker query result order or domain differs.');
    const r = answer.value;
    const keys = request.kind === 'fit' ? ['stamp', 'fits', 'outside', 'blocker'] : request.kind === 'support' ? ['stamp', 'bodyFits', 'distanceQ', 'surfaces'] :
      request.kind === 'exposure' ? ['rulesVersion', 'stamp', 'volumeQ3', 'inBoundsVolumeQ3', 'outsideVolumeQ3', 'materials'] : ['stamp', 'contact'];
    fields(r, keys); validateStamp(r.stamp, id);
    if (request.kind === 'fit') {
      const fits = boolean(r.fits), outside = boolean(r.outside); cell(r.blocker, terrain);
      if (fits !== (!outside && r.blocker === null) || (outside && r.blocker !== null)) throw Error('Inconsistent worker fit result.');
    } else if (request.kind === 'sweep' || request.kind === 'raycast') contact(r.contact, terrain);
    else if (request.kind === 'support') {
      const fits = boolean(r.bodyFits);
      if (!Array.isArray(r.surfaces)) throw Error('Invalid worker support surfaces.');
      if (r.distanceQ !== null) integer(r.distanceQ, 0, GEOMETRY_LIMITS_3D.coordinateQ);
      if ((!fits && r.distanceQ !== null) || ((r.distanceQ === null) !== (r.surfaces.length === 0))) throw Error('Inconsistent worker support result.');
      for (const surface of r.surfaces) {
        fields(surface, ['cell', 'boundary', 'areaQ2']); integer(surface.areaQ2, 1); cell(surface.cell, terrain);
        if (boolean(surface.boundary) !== (surface.cell === null)) throw Error('Invalid worker support boundary.');
      }
    } else {
      if (r.rulesVersion !== EXPOSURE_RULES_VERSION_3D || !Array.isArray(r.materials)) throw Error('Invalid worker exposure result.');
      const volume = decimal(r.volumeQ3), inside = decimal(r.inBoundsVolumeQ3), outside = decimal(r.outsideVolumeQ3);
      if (volume !== inside + outside) throw Error('Worker exposure volumes do not balance.');
      let sum = 0n, last = -1;
      for (const material of r.materials) {
        fields(material, ['material', 'cells', 'volumeQ3', 'minTemperatureQ', 'maxTemperatureQ', 'meanTemperatureQ', 'maxImmersionDepthQ']);
        const m = integer(material.material, 0, 255); if (!materials.has(m) || m <= last) throw Error('Worker exposure materials are not ordered or supported.'); last = m;
        integer(material.cells, 1, GEOMETRY_LIMITS_3D.cells); const lo = integer(material.minTemperatureQ), hi = integer(material.maxTemperatureQ, lo);
        integer(material.maxImmersionDepthQ, 0, 2 * GEOMETRY_LIMITS_3D.coordinateQ);
        const v = decimal(material.volumeQ3); if (v === 0n) throw Error('Empty worker material exposure.'); sum += v;
        fields(material.meanTemperatureQ, ['numerator', 'denominator']); const n = decimal(material.meanTemperatureQ.numerator), d = decimal(material.meanTemperatureQ.denominator);
        if (d !== v || n < BigInt(lo) * d || n > BigInt(hi) * d) throw Error('Invalid worker mean temperature.');
      }
      if (sum !== inside) throw Error('Worker material volumes do not balance.');
    }
  });
}
