/**
 * The interpreter every Python-backed check spawns, shared by the Vitest fixtures and the Node
 * verification entry points: an explicit PYTHON, the interpreter the supervisor propagates as
 * STATE_SPACE_PYTHON, the checkout's own venv, then the first bare python3 or python that runs.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKOUT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @param {NodeJS.Platform} [platform]
 * @param {string} [root] The checkout whose `.venv` is preferred.
 * @param {(name: string) => boolean} [runs] Whether a bare interpreter name starts.
 * @returns {string}
 */
export function pythonInterpreter(
  env = process.env,
  platform = process.platform,
  root = CHECKOUT,
  runs = startsInterpreter,
) {
  if (env.PYTHON) return env.PYTHON;
  if (env.STATE_SPACE_PYTHON) return env.STATE_SPACE_PYTHON;
  const venv = resolve(
    root,
    platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
  );
  if (existsSync(venv)) return venv;
  for (const name of ['python3', 'python']) if (runs(name)) return name;
  return 'python';
}

/** @param {string} name */
function startsInterpreter(name) {
  try {
    execFileSync(name, ['-c', 'pass'], { stdio: 'ignore', timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}
