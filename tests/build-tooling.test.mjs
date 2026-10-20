import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {SDK_ENTRIES, sdkConfig, sdkEntries} from '../engine/sdk-build.mjs';
import {lintProject, lintSource} from '../engine/lint_ts.mjs';

test('package exports drive independent SDK bundles with their existing targets', () => {
  const packageData = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  assert.equal(SDK_ENTRIES.length, Object.keys(packageData.exports).length);
  assert.equal(SDK_ENTRIES[0].key, '.');
  for (const entry of SDK_ENTRIES) {
    const config = sdkConfig(entry.key), exported = packageData.exports[entry.key];
    assert.equal('./dist/sdk/' + config.build.lib.fileName(), exported.import);
    assert.equal('./dist/sdk/types/' + entry.source.slice('engine/'.length).replace(/\.ts$/, '.d.ts'), exported.types);
    assert.equal(config.build.emptyOutDir, entry.key === '.');
    assert.deepEqual(config.build.lib.formats, ['es']);
    const legacyTarget = ['.', './experimental/3d', './experimental/3d/gpu', './experimental/3d/world', './experimental/3d/world/gpu'].includes(entry.key);
    assert.equal(config.build.target, legacyTarget ? 'es2022' : undefined);
  }
  assert.throws(() => sdkConfig('missing'), /Unknown/);
});

test('new exports supply source and output paths without another entry list', () => {
  const root = {types: './dist/sdk/types/index.d.ts', import: './dist/sdk/state-space.js'};
  const added = {types: './dist/sdk/types/new/module.d.ts', import: './dist/sdk/new-module.js'};
  const entries = sdkEntries({'./new': added, '.': root});
  assert.deepEqual(entries.map(({key, source, filename}) => ({key, source, filename})), [
    {key: '.', source: 'engine/index.ts', filename: 'state-space.js'},
    {key: './new', source: 'engine/new/module.ts', filename: 'new-module.js'},
  ]);
  assert.throws(() => sdkEntries({}), /root SDK/);
  assert.throws(() => sdkEntries({'.': root, './duplicate': root}), /Duplicate/);
  assert.throws(() => sdkEntries({'.': root, './duplicate': {...added, import: root.import}}), /Duplicate/);
  assert.throws(() => sdkEntries({'.': root, './bad': {...added, types: './dist/sdk/types/../outside.d.ts'}}), /Invalid/);
  assert.throws(() => sdkEntries({'.': {...root, import: './outside.js'}}), /Invalid/);
});

test('declaration CLI follows new exports, ignores unrelated roots, and fails on type errors', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-space-sdk-'));
  try {
    for (const dir of ['engine', 'scripts']) mkdirSync(join(root, dir));
    for (const path of ['engine/sdk-build.mjs', 'engine/tsconfig.json', 'engine/tsconfig.sdk.json', 'scripts/build_sdk.mjs'])
      copyFileSync(new URL('../' + path, import.meta.url), join(root, path));
    symlinkSync(fileURLToPath(new URL('../node_modules', import.meta.url)), join(root, 'node_modules'), 'dir');
    writeFileSync(join(root, 'package.json'), JSON.stringify({exports: {
      '.': {types: './dist/sdk/types/index.d.ts', import: './dist/sdk/state-space.js'},
      './new': {types: './dist/sdk/types/new.d.ts', import: './dist/sdk/new.js'},
    }}));
    writeFileSync(join(root, 'engine/index.ts'), 'export const first = 1;');
    writeFileSync(join(root, 'engine/new.ts'), 'export const added = 2;');
    writeFileSync(join(root, 'engine/unrelated.ts'), 'const invalid: string = 3;');
    const emit = () => spawnSync(process.execPath, [join(root, 'scripts/build_sdk.mjs'), '--types-only'], {cwd: tmpdir(), encoding: 'utf8'});
    const result = emit(); assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, 'dist/sdk/types/new.d.ts'), 'utf8').trim(), 'export declare const added = 2;');
    writeFileSync(join(root, 'engine/new.ts'), 'export const added: string = 2;');
    const failed = emit(); assert.equal(failed.status, 1); assert.match(failed.stderr, /TS2322/);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('new nested TS and JS files enter lint automatically; generated trees and links do not', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-space-lint-'));
  try {
    for (const path of ['engine/deep', 'examples/new-demo', 'engine/dist', 'examples/node_modules', 'engine/.cache']) mkdirSync(join(root, path), {recursive: true});
    writeFileSync(join(root, 'engine/deep/new.ts'), 'input[0] = 7;');
    writeFileSync(join(root, 'examples/new-demo/new.js'), "import './missing-extension';");
    for (const path of ['engine/dist', 'examples/node_modules', 'engine/.cache']) writeFileSync(join(root, path, 'ignored.ts'), 'input[0] = 7;');
    symlinkSync(join(root, 'engine'), join(root, 'engine', 'loop'), 'dir');
    const result = lintProject(root);
    assert.equal(result.files.length, 2);
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.some(error => error.includes('SS009')));
    assert.ok(result.errors.some(error => error.includes('SS021')));
    writeFileSync(join(root, 'engine/deep/new.ts'), 'const output = input[0];');
    writeFileSync(join(root, 'examples/new-demo/new.js'), "import './valid.js';");
    assert.deepEqual(lintProject(root).errors, []);
  } finally {rmSync(root, {recursive: true, force: true});}
});

test('lint distinguishes browser module URLs and tooling tests from application SDK imports', () => {
  assert.deepEqual(lintSource("import './view.js?revision=1#render';", 'examples/app.js'), []);
  assert.ok(lintSource("import '../../engine/internal.js';", 'examples/lab/app.js').some(error => error.startsWith('SS046')));
  assert.deepEqual(lintSource("import '../../engine/lint_ts.mjs';", 'examples/lab/lab.test.mjs'), []);
});
