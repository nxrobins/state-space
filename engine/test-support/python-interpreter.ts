/** The interpreter Python-backed fixtures call: an explicit override, the checkout's venv, else a bare name. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function pythonInterpreter(): string {
  if (process.env.STATE_SPACE_PYTHON) return process.env.STATE_SPACE_PYTHON;
  for (const local of ['.venv/Scripts/python.exe', '.venv/bin/python'])
    if (existsSync(local)) return resolve(local);
  // A host without the project venv: the first bare interpreter that runs.
  for (const name of ['python', 'python3']) {
    try {
      execFileSync(name, ['-c', 'pass'], { stdio: 'ignore', timeout: 5_000 });
      return name;
    } catch {
      continue;
    }
  }
  return 'python';
}
