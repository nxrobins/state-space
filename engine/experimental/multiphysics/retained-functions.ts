/** Keeps the functions that recent jobs created reachable after those jobs have finished.
 *
 * V8 attaches a function's optimized machine code to the function objects that run it, and
 * remembers that code for later function objects only weakly. A tick's jobs create their inner
 * functions afresh every time, so between two ticks nothing holds the code. Each major
 * garbage collection that completes there discards it, and the next tick runs those functions
 * unoptimized until V8 has compiled them again. A host that paces its ticks returns to its
 * event loop between them, which is where V8 completes such a collection. Holding earlier
 * sets of the same functions keeps the code alive; measured under such a host, that removed a
 * sixth to a quarter of the liquid scenes' CPU time. In a loop that never returns to the event
 * loop it changes little either way.
 *
 * Nothing is computed differently. This changes only how long objects stay reachable: the
 * held functions keep the working arrays of their own job, so a few finished jobs' worth stays
 * in memory per site, and each new job replaces the oldest.
 *
 * A site holds the set of the job now starting and of the job before it. The earlier set is
 * needed because a new function object takes the remembered code only when it is first
 * called: were the previous set released as soon as the next existed, a collection between
 * those two moments could still discard the code. A site whose consecutive jobs do not call
 * the same functions holds one set more, so that the last job to have called each function
 * is still held when the next one that will call it starts. */
const held = new Map<string, readonly (readonly unknown[])[]>();

/** Hold `functions`, which the job now starting at `site` created, with the `sets - 1` sets
 * held before them. */
export function retainJobFunctions(site: string, functions: readonly unknown[], sets = 2): void {
  held.set(site, [functions, ...(held.get(site) ?? []).slice(0, sets - 1)]);
}
/** What `site` holds, latest set first. For tests. */
export function heldJobFunctions(site: string): readonly (readonly unknown[])[] {
  return held.get(site) ?? [];
}
