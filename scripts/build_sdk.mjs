/** Keep entries separate: each SDK bundle retains its existing private identities. */
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {build} from 'vite';
import {SDK_ROOT, SDK_ENTRIES, sdkConfig, validateSdkMetadata} from '../engine/sdk-build.mjs';
const read = path => JSON.parse(readFileSync(resolve(SDK_ROOT, path), 'utf8'));
validateSdkMetadata(read('package.json'), read('engine/tsconfig.sdk.json'));
for (const entry of SDK_ENTRIES) await build(sdkConfig(entry.key));
const types = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'engine/tsconfig.sdk.json'], {cwd: SDK_ROOT, stdio: 'inherit'});
if (types.error) throw types.error;
if (types.status !== 0) process.exit(types.status ?? 1);
