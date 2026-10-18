/** Queue capture is opt-in; callers cannot disable a session's required paths. */
import { motionEntryLimit3D } from './motion-trace.js';
import { motionPathLimits3D } from './motion-paths.js';
import { actionRunLimit3D } from './action-journal.js';
import type { TacticalBranchOptions3D } from './tactical-session-view.js';

export type TacticalPreviewCapture3D = {
  motion?: {maxEntries?: number};
  paths?: {maxEntries?: number};
  /** May perform global support observations while staging interventions. */
  journal?: {maxRuns?: number};
};
function fields(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Reflect.ownKeys(value).some(k => typeof k !== 'string' || !allowed.includes(k)) ||
      Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !('value' in d) || !d.enumerable)) throw Error('Invalid preview capture options.');
}
/** Validates and detaches options before the queue invalidates any accepted work. */
export function previewCaptureOptions3D(value: TacticalPreviewCapture3D): Omit<TacticalBranchOptions3D, 'horizonTicks'> {
  fields(value, ['motion', 'paths', 'journal']);
  const result: Omit<TacticalBranchOptions3D, 'horizonTicks'> = {};
  if (Object.hasOwn(value, 'motion') && value.motion !== undefined) {
    fields(value.motion, ['maxEntries']);
    result.captureMotion = true; result.motionMaxEntries = motionEntryLimit3D(value.motion);
  }
  if (Object.hasOwn(value, 'paths') && value.paths !== undefined) {
    fields(value.paths, ['maxEntries']);
    result.capturePaths = true;
    result.pathMaxEntries = motionPathLimits3D({maxPathEntries: Object.hasOwn(value.paths, 'maxEntries') ? value.paths.maxEntries : undefined}).pathLimit;
  }
  if (Object.hasOwn(value, 'journal') && value.journal !== undefined) {
    fields(value.journal, ['maxRuns']);
    result.captureJournal = true;
    result.journalMaxRuns = actionRunLimit3D(Object.hasOwn(value.journal, 'maxRuns') ? value.journal.maxRuns : undefined);
  }
  return result;
}
