import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SDK_ENTRIES, sdkConfig, sdkExports, validateSdkMetadata} from '../engine/sdk-build.mjs';
import {lintProject, lintSource} from '../engine/lint_ts.mjs';

test('all declared SDK entries have checked exports, types and independent output configs', () => {
  const declarations = JSON.parse(readFileSync(new URL('../engine/tsconfig.sdk.json', import.meta.url)));
  const packageData = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  validateSdkMetadata(packageData, declarations);
  for (const entry of SDK_ENTRIES) {
    const config = sdkConfig(entry.key);
    assert.equal(config.build.lib.fileName(), entry.filename);
    assert.equal(config.build.emptyOutDir, entry.key === '.');
    assert.deepEqual(config.build.lib.formats, ['es']);
    assert.equal(config.build.target, entry.target);
  }
  assert.throws(() => sdkConfig('missing'), /Unknown/);
  assert.throws(() => validateSdkMetadata({exports: {}}, declarations), /exports differ/);
  assert.throws(() => validateSdkMetadata(packageData, {include: []}), /include differs/);
  assert.throws(() => validateSdkMetadata(packageData, declarations, [...SDK_ENTRIES, SDK_ENTRIES[0]]), /Duplicate/);
  assert.deepEqual(sdkExports(), packageData.exports);
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
