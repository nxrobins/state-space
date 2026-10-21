/** Portable, synchronized finite reactive worlds. Internal helpers never publish. */
import {
  reactiveArray3D,
  reactiveFields3D,
  reactiveInteger3D,
  type ReactiveMaterialRegistry3D,
} from './reactive-registry.js';
import {
  readReactiveWorldSnapshot3D,
  type ReactiveWorldSnapshot3D,
} from './reactive-world-tick.js';
export const REACTIVE_DOMAINS_RULES_3D = 'reactive-domains-1';
export const REACTIVE_DOMAINS_SCHEMA_3D = 1;
export const REACTIVE_DOMAINS_LIMITS_3D = Object.freeze({ domains: 8, cells: 65536 });
export type ReactiveDomainId3D = string | null;
export type ReactiveReservoir3D = { id: string; world: ReactiveWorldSnapshot3D };
export type ReactiveDomainsSnapshot3D = {
  schemaVersion: 1;
  rulesVersion: typeof REACTIVE_DOMAINS_RULES_3D;
  tick: number;
  world: ReactiveWorldSnapshot3D;
  reservoirs: ReactiveReservoir3D[];
};
export function reactiveDomainId3D(value: unknown): ReactiveDomainId3D {
  if (
    value !== null &&
    (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value))
  )
    throw Error('Invalid reactive domain identity.');
  return value as ReactiveDomainId3D;
}
export const reactiveDomainList3D = (
  s: ReactiveDomainsSnapshot3D,
): { id: ReactiveDomainId3D; world: ReactiveWorldSnapshot3D }[] => [
  { id: null, world: s.world },
  ...s.reservoirs,
];
export function reactiveDomain3D(
  s: ReactiveDomainsSnapshot3D,
  id: ReactiveDomainId3D,
): ReactiveWorldSnapshot3D {
  reactiveDomainId3D(id);
  if (id === null) return s.world;
  const found = s.reservoirs.find((r) => r.id === id);
  if (!found) throw Error('Unknown reactive reservoir.');
  return found.world;
}
export const reactiveDomainsEnergyQ3D = (s: ReactiveDomainsSnapshot3D): bigint =>
  reactiveDomainList3D(s).reduce(
    (sum, d) => sum + d.world.block.energyQ.reduce((q, value) => q + BigInt(value), 0n),
    0n,
  );
export function replaceReactiveDomain3D(
  s: ReactiveDomainsSnapshot3D,
  id: ReactiveDomainId3D,
  world: ReactiveWorldSnapshot3D,
): ReactiveDomainsSnapshot3D {
  reactiveDomain3D(s, id);
  return id === null
    ? { ...s, world }
    : { ...s, reservoirs: s.reservoirs.map((r) => (r.id === id ? { id, world } : r)) };
}
export function readReactiveDomainsSnapshot3D(
  registry: ReactiveMaterialRegistry3D,
  raw: unknown,
): ReactiveDomainsSnapshot3D {
  reactiveFields3D(raw, ['schemaVersion', 'rulesVersion', 'tick', 'world', 'reservoirs']);
  if (raw.schemaVersion !== 1 || raw.rulesVersion !== REACTIVE_DOMAINS_RULES_3D)
    throw Error('Incompatible reactive domains snapshot.');
  const tick = reactiveInteger3D(raw.tick, 0, Number.MAX_SAFE_INTEGER),
    ids = new Set<string>();
  const rows = reactiveArray3D(raw.reservoirs, REACTIVE_DOMAINS_LIMITS_3D.domains - 1).map(
    (row) => {
      reactiveFields3D(row, ['id', 'world']);
      const id = reactiveDomainId3D(row.id);
      if (id === null || ids.has(id)) throw Error('Reservoir identities must be unique strings.');
      ids.add(id);
      return { id, world: row.world };
    },
  );
  // Preflight the combined allocation budget before copying any material arrays.
  let count = 0;
  for (const value of [raw.world, ...rows.map((r) => r.world)]) {
    reactiveFields3D(
      value,
      ['schemaVersion', 'rulesVersion', 'tick', 'block'],
      ['holds', 'holdRulesVersion'],
    );
    reactiveFields3D(value.block, [
      'schemaVersion',
      'rulesVersion',
      'materialCatalogHash',
      'width',
      'height',
      'depth',
      'packedCells',
      'energyQ',
      'structure',
    ]);
    const b = value.block,
      n =
        reactiveInteger3D(b.width, 1, 128) *
        reactiveInteger3D(b.height, 1, 128) *
        reactiveInteger3D(b.depth, 1, 128);
    if (n > 32768 || (count += n) > REACTIVE_DOMAINS_LIMITS_3D.cells)
      throw Error('Reactive domain cell budget exceeded.');
    if (value.tick !== tick) throw Error('Reactive domains must share one absolute tick.');
  }
  const world = readReactiveWorldSnapshot3D(registry, raw.world);
  const reservoirs = rows
    .map((r) => ({ id: r.id, world: readReactiveWorldSnapshot3D(registry, r.world) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { schemaVersion: 1, rulesVersion: REACTIVE_DOMAINS_RULES_3D, tick, world, reservoirs };
}
export function createReactiveDomainsSnapshot3D(
  registry: ReactiveMaterialRegistry3D,
  world: ReactiveWorldSnapshot3D,
  reservoirs: readonly ReactiveReservoir3D[] = [],
): ReactiveDomainsSnapshot3D {
  reactiveFields3D(
    world,
    ['schemaVersion', 'rulesVersion', 'tick', 'block'],
    ['holds', 'holdRulesVersion'],
  );
  return readReactiveDomainsSnapshot3D(registry, {
    schemaVersion: 1,
    rulesVersion: REACTIVE_DOMAINS_RULES_3D,
    tick: world.tick,
    world,
    reservoirs,
  });
}
export function compatibleReactiveDomains3D(
  a: ReactiveDomainsSnapshot3D,
  b: ReactiveDomainsSnapshot3D,
): void {
  const left = reactiveDomainList3D(a),
    right = reactiveDomainList3D(b);
  if (
    left.length !== right.length ||
    left.some(
      (d, i) =>
        d.id !== right[i].id ||
        (['width', 'height', 'depth'] as const).some(
          (k) => d.world.block[k] !== right[i].world.block[k],
        ),
    )
  )
    throw Error('Reactive domain topology differs.');
}
