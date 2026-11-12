import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pythonInterpreter } from '../engine/test-support/python-interpreter.mjs';
export const SAFETY_HOLD = new URL('../dist/verification/safety-hold.json', import.meta.url);
/** Refuse while an incident hold blocks runtime work. Unsupervised workload entry
 * points (benchmarks, direct verifiers) call this before doing anything else. */
export function assertRuntimeNotBlocked(hold = SAFETY_HOLD) {
  if (!existsSync(hold)) return;
  let state;
  try {
    state = JSON.parse(readFileSync(hold, 'utf8'));
  } catch {
    state = null; // A damaged hold fails closed.
  }
  if (
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    (Object.hasOwn(state, 'blockRecovery') && state.blockRecovery !== false)
  )
    throw Error('Runtime verification remains blocked pending incident review');
}
/** All entry points share one OS lease and one bounded descendant process tree. */
export async function guardNode(kind, timeout = 600) {
  assertRuntimeNotBlocked();
  if (process.env.STATE_SPACE_VERIFICATION_JOB) return;
  const child = spawn(
    pythonInterpreter(),
    [
      '-m',
      'scripts.verification_guard',
      '--kind',
      kind,
      '--timeout',
      String(timeout),
      '--',
      process.execPath,
      ...process.argv.slice(1),
    ],
    { stdio: 'inherit', windowsHide: true },
  );
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  process.exit(code);
}
export const verificationYield = () =>
  new Promise((resolve) =>
    setTimeout(resolve, Number(process.env.STATE_SPACE_VERIFY_YIELD_MS ?? 5)),
  );
