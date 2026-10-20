/** Versioned, bounded application saves. Digests cover every complete commit boundary. */
import {
  type ReactiveMaterialRegistry3D,
  type ReactiveMaterialCatalog3D,
} from 'state-space-engine/experimental/3d/reactive-materials';
import {
  CHAMBER,
  snapshotScenario,
  fields,
  readCommand,
  readChamberSnapshot,
  type ChamberCommand,
  type ChamberSnapshot,
} from './scenario.js';
export const SAVE_FORMAT = 'reactive-chamber-save-1';
export const MAX_SAVE_BYTES = 1024 * 1024;
export type ChamberStep = { command: ChamberCommand; sha256: string };
export type ChamberSave = {
  format: typeof SAVE_FORMAT;
  catalog: ReactiveMaterialCatalog3D;
  initial: ChamberSnapshot;
  snapshot: ChamberSnapshot;
  steps: ChamberStep[];
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + canonical((value as Record<string, unknown>)[k]))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export async function stateHash(snapshot: ChamberSnapshot): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonical(snapshot)),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
function readSave(text: string) {
  if (
    typeof text !== 'string' ||
    text.length > MAX_SAVE_BYTES ||
    new TextEncoder().encode(text).length > MAX_SAVE_BYTES
  )
    throw Error('Save exceeds the 1 MiB limit.');
  const raw: unknown = JSON.parse(text);
  fields(raw, ['format', 'catalog', 'initial', 'snapshot', 'steps']);
  return raw;
}
export function readSaveScenario(text: string) {
  const raw = readSave(text);
  if (raw.format !== SAVE_FORMAT || !raw.initial || typeof raw.initial !== 'object')
    throw Error('Save application version differs.');
  return snapshotScenario(raw.initial as ChamberSnapshot);
}
export function parseSave(
  registry: ReactiveMaterialRegistry3D,
  text: string,
  initial: ChamberSnapshot,
): ChamberSave {
  const raw = readSave(text);
  if (raw.format !== SAVE_FORMAT || canonical(raw.catalog) !== canonical(registry.toCatalog()))
    throw Error('Save catalog or application version differs.');
  const origin = readChamberSnapshot(registry, raw.initial),
    snapshot = readChamberSnapshot(registry, raw.snapshot);
  if (snapshot.worldId !== origin.worldId || canonical(origin) !== canonical(initial))
    throw Error('Save does not begin at the chamber reference state.');
  if (
    !Array.isArray(raw.steps) ||
    raw.steps.length > CHAMBER.maxCommands ||
    snapshot.revision !== raw.steps.length ||
    snapshot.domains.tick !== raw.steps.length * CHAMBER.horizon
  )
    throw Error('Invalid command recording boundary.');
  const steps = raw.steps.map((row) => {
    fields(row, ['command', 'sha256']);
    if (typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256))
      throw Error('Invalid boundary digest.');
    return { command: readCommand(row.command, snapshotScenario(initial)), sha256: row.sha256 };
  });
  return { format: SAVE_FORMAT, catalog: registry.toCatalog(), initial: origin, snapshot, steps };
}
/** The caller supplies an isolated executor. Never publish a partially replayed save. */
export async function verifyRecording(
  save: ChamberSave,
  apply: (command: ChamberCommand) => Promise<ChamberSnapshot>,
) {
  let current = save.initial;
  for (const [i, step] of save.steps.entries()) {
    current = await apply(step.command);
    if ((await stateHash(current)) !== step.sha256)
      throw Error(`Recording differs at commit ${i + 1}.`);
  }
  if (canonical(current) !== canonical(save.snapshot))
    throw Error('Recording does not reproduce the saved complete state.');
  return current;
}
