/** Keep entries separate: each SDK bundle retains its existing private identities. */
import {resolve, relative} from 'node:path';
import {build} from 'vite';
import ts from 'typescript';
import {SDK_ROOT, SDK_ENTRIES, sdkConfig} from '../engine/sdk-build.mjs';
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--types-only')) throw Error('Usage: build_sdk.mjs [--types-only]');
const root = resolve(SDK_ROOT, 'engine');
const config = ts.readConfigFile(resolve(root, 'tsconfig.sdk.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent({...config.config,
  files: SDK_ENTRIES.map(entry => relative(root, resolve(SDK_ROOT, entry.source))),
}, ts.sys, root);
function check(diagnostics) {
  if (!diagnostics.length) return;
  process.stderr.write(ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => SDK_ROOT, getNewLine: () => ts.sys.newLine,
  }));
  process.exit(1);
}
check(config.error ? [config.error] : parsed.errors);
if (!args.length) for (const entry of SDK_ENTRIES) await build(sdkConfig(entry.key));
const program = ts.createProgram(parsed.fileNames, parsed.options);
check(ts.getPreEmitDiagnostics(program));
check(program.emit().diagnostics);
