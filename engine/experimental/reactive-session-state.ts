/** Complete reactive/game save boundary; no simulation or policy execution. */
import { MAX_ENERGY_Q } from '../thermal.js';
import { copyPortableValue } from '../portable-data.js';
import type { PortableValue } from '../portable-data.js';
import { reactiveFields3D, reactiveInteger3D, type ReactiveMaterialRegistry3D } from './reactive-registry.js';
import { readReactiveDomainsSnapshot3D, reactiveDomainsEnergyQ3D, REACTIVE_DOMAINS_LIMITS_3D, type ReactiveDomainsSnapshot3D } from './reactive-domain-state.js';
export type ReactiveGameValue3D = PortableValue;
export const REACTIVE_SESSION_RULES_3D = 'reactive-session-1';
export const REACTIVE_SESSION_SCHEMA_3D = 1;
export const REACTIVE_SESSION_LIMITS_3D = Object.freeze({branches: 4, horizonTicks: 64, operations: 256, commandNodes: 65536, commandCharacters: 1048576});
export type ReactiveSessionInitial3D<T extends ReactiveGameValue3D> = {worldId: string; gameRulesVersion: string; domains: ReactiveDomainsSnapshot3D; game: T};
export type ReactiveSessionSnapshot3D<T extends ReactiveGameValue3D> = ReactiveSessionInitial3D<T> & {
  schemaVersion: 1; rulesVersion: typeof REACTIVE_SESSION_RULES_3D; revision: number; accounting: {initialQ: string; externalQ: string}};
export type ReactiveSessionRevision3D = {worldId: string; gameRulesVersion: string; sessionRulesVersion: typeof REACTIVE_SESSION_RULES_3D;
  materialCatalogHash: string; revision: number; tick: number};
const id = (value: unknown): string => {if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value)) throw Error('Invalid reactive session identity.'); return value;};
const MAX_Q = BigInt(REACTIVE_DOMAINS_LIMITS_3D.cells) * BigInt(MAX_ENERGY_Q);
function quantity(value: unknown): bigint {
  if (typeof value !== 'string' || value.length > 18 || !/^(0|-?[1-9][0-9]*)$/.test(value)) throw Error('Reactive accounting requires canonical exact decimals.');
  const q = BigInt(value); if (q < -MAX_Q || q > MAX_Q) throw Error('Reactive accounting exceeds the finite domain budget.'); return q;
}
export function readReactiveSessionSnapshot3D<T extends ReactiveGameValue3D>(registry: ReactiveMaterialRegistry3D, raw: unknown): ReactiveSessionSnapshot3D<T> {
  reactiveFields3D(raw, ['schemaVersion', 'rulesVersion', 'worldId', 'gameRulesVersion', 'revision', 'domains', 'game', 'accounting']);
  if (raw.schemaVersion !== 1 || raw.rulesVersion !== REACTIVE_SESSION_RULES_3D) throw Error('Incompatible reactive session snapshot.');
  const worldId = id(raw.worldId), gameRulesVersion = id(raw.gameRulesVersion), revision = reactiveInteger3D(raw.revision, 0, Number.MAX_SAFE_INTEGER);
  const domains = readReactiveDomainsSnapshot3D(registry, raw.domains), game = copyPortableValue(raw.game as T);
  reactiveFields3D(raw.accounting, ['initialQ', 'externalQ']); const initialQ = quantity(raw.accounting.initialQ), externalQ = quantity(raw.accounting.externalQ);
  if (initialQ < 0n || initialQ + externalQ !== reactiveDomainsEnergyQ3D(domains)) throw Error('Reactive session accounting does not balance.');
  return {schemaVersion: 1, rulesVersion: REACTIVE_SESSION_RULES_3D, worldId, gameRulesVersion, revision, domains, game,
    accounting: {initialQ: initialQ.toString(), externalQ: externalQ.toString()}};
}
export function createReactiveSessionSnapshot3D<T extends ReactiveGameValue3D>(registry: ReactiveMaterialRegistry3D, initial: ReactiveSessionInitial3D<T>): ReactiveSessionSnapshot3D<T> {
  reactiveFields3D(initial, ['worldId', 'gameRulesVersion', 'domains', 'game']);
  const domains = readReactiveDomainsSnapshot3D(registry, initial.domains);
  return readReactiveSessionSnapshot3D<T>(registry, {schemaVersion: 1, rulesVersion: REACTIVE_SESSION_RULES_3D,
    worldId: initial.worldId, gameRulesVersion: initial.gameRulesVersion, revision: 0, domains, game: initial.game,
    accounting: {initialQ: reactiveDomainsEnergyQ3D(domains).toString(), externalQ: '0'}});
}
export const reactiveSessionRevision3D = <T extends ReactiveGameValue3D>(s: ReactiveSessionSnapshot3D<T>): Readonly<ReactiveSessionRevision3D> => Object.freeze({
  worldId: s.worldId, gameRulesVersion: s.gameRulesVersion, sessionRulesVersion: REACTIVE_SESSION_RULES_3D,
  materialCatalogHash: s.domains.world.block.materialCatalogHash, revision: s.revision, tick: s.domains.tick});
