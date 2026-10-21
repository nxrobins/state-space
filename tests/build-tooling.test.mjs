import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { sources as volumeSources } from '../scripts/volume_evidence.mjs';
import { sources as volumeM2Sources } from '../scripts/volume_m2_evidence.mjs';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  readFileSync,
  copyFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { SDK_ENTRIES, sdkConfig, sdkEntries } from '../engine/sdk-build.mjs';
import { lintProject, lintSource } from '../engine/lint_ts.mjs';
import { STREAMING_REPORTER, VITEST, selectChecks } from '../scripts/verify_checks.mjs';

test('SDK entries preserve existing build targets and reject unknown entries', () => {
  for (const entry of SDK_ENTRIES) {
    const legacyTarget = [
      '.',
      './experimental/3d',
      './experimental/3d/gpu',
      './experimental/3d/world',
      './experimental/3d/world/gpu',
    ].includes(entry.key);
    assert.equal(sdkConfig(entry.key).build.target, legacyTarget ? 'es2022' : undefined);
  }
  assert.throws(() => sdkConfig('missing'), /Unknown/);
});

test('SDK metadata rejects missing roots, collisions and paths outside the package', () => {
  const root = { types: './dist/sdk/types/index.d.ts', import: './dist/sdk/state-space.js' };
  const added = { types: './dist/sdk/types/new/module.d.ts', import: './dist/sdk/new-module.js' };
  assert.throws(() => sdkEntries({}), /root SDK/);
  assert.throws(() => sdkEntries({ '.': root, './duplicate': root }), /Duplicate/);
  assert.throws(
    () => sdkEntries({ '.': root, './duplicate': { ...added, import: root.import } }),
    /Duplicate/,
  );
  assert.throws(
    () =>
      sdkEntries({ '.': root, './bad': { ...added, types: './dist/sdk/types/../outside.d.ts' } }),
    /Invalid/,
  );
  assert.throws(() => sdkEntries({ '.': { ...root, import: './outside.js' } }), /Invalid/);
});

test('build CLI publishes new exports and declarations, ignores unrelated roots, and fails on type errors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'state-space-sdk-'));
  try {
    for (const dir of ['engine/new', 'scripts']) mkdirSync(join(root, dir), { recursive: true });
    for (const path of [
      'engine/sdk-build.mjs',
      'engine/tsconfig.json',
      'engine/tsconfig.sdk.json',
      'scripts/build_sdk.mjs',
    ])
      copyFileSync(new URL('../' + path, import.meta.url), join(root, path));
    symlinkSync(
      fileURLToPath(new URL('../node_modules', import.meta.url)),
      join(root, 'node_modules'),
      'dir',
    );
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        type: 'module',
        exports: {
          './new': {
            types: './dist/sdk/types/new/module.d.ts',
            import: './dist/sdk/new-module.js',
          },
          '.': { types: './dist/sdk/types/index.d.ts', import: './dist/sdk/state-space.js' },
        },
      }),
    );
    writeFileSync(join(root, 'engine/index.ts'), 'export const first = 1;');
    writeFileSync(join(root, 'engine/new/module.ts'), 'export const added = 2;');
    writeFileSync(join(root, 'engine/unrelated.ts'), 'const invalid: string = 3;');
    const emit = (typesOnly = false) =>
      spawnSync(
        process.execPath,
        [join(root, 'scripts/build_sdk.mjs'), ...(typesOnly ? ['--types-only'] : [])],
        { cwd: tmpdir(), encoding: 'utf8' },
      );
    const result = emit();
    assert.equal(result.status, 0, result.stderr);
    assert.equal((await import(pathToFileURL(join(root, 'dist/sdk/new-module.js')))).added, 2);
    assert.equal((await import(pathToFileURL(join(root, 'dist/sdk/state-space.js')))).first, 1);
    assert.equal(
      readFileSync(join(root, 'dist/sdk/types/new/module.d.ts'), 'utf8').trim(),
      'export declare const added = 2;',
    );
    writeFileSync(join(root, 'engine/new/module.ts'), 'export const added: string = 2;');
    const failed = emit(true);
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /TS2322/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('new nested TS and JS files enter lint automatically; generated trees and links do not', () => {
  const root = mkdtempSync(join(tmpdir(), 'state-space-lint-'));
  try {
    for (const path of [
      'engine/deep',
      'examples/new-demo',
      'engine/dist',
      'examples/node_modules',
      'engine/.cache',
    ])
      mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, 'engine/deep/new.ts'), 'input[0] = 7;');
    writeFileSync(join(root, 'examples/new-demo/new.js'), "import './missing-extension';");
    for (const path of ['engine/dist', 'examples/node_modules', 'engine/.cache'])
      writeFileSync(join(root, path, 'ignored.ts'), 'input[0] = 7;');
    symlinkSync(join(root, 'engine'), join(root, 'engine', 'loop'), 'dir');
    const result = lintProject(root);
    assert.equal(result.files.length, 2);
    assert.equal(result.errors.length, 2);
    assert.ok(result.errors.some((error) => error.includes('SS009')));
    assert.ok(result.errors.some((error) => error.includes('SS021')));
    writeFileSync(join(root, 'engine/deep/new.ts'), 'const output = input[0];');
    writeFileSync(join(root, 'examples/new-demo/new.js'), "import './valid.js';");
    assert.deepEqual(lintProject(root).errors, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('lint distinguishes browser module URLs and tooling tests from application SDK imports', () => {
  assert.deepEqual(lintSource("import './view.js?revision=1#render';", 'examples/app.js'), []);
  assert.ok(
    lintSource("import '../../engine/internal.js';", 'examples/lab/app.js').some((error) =>
      error.startsWith('SS046'),
    ),
  );
  assert.deepEqual(
    lintSource("import '../../engine/lint_ts.mjs';", 'examples/lab/lab.test.mjs'),
    [],
  );
});

// Source-hash reports are retained evidence: nested implementation inputs must remain bound.
test('volume evidence hashes include moved modules', () => {
  for (const capture of [volumeSources, volumeM2Sources]) {
    const report = capture();
    for (const path of [
      'reactive/reactive-session.ts',
      'tactical/tactical-session-core.ts',
      'terrain/terrain-motion.ts',
    ]) {
      const source = 'engine/experimental/' + path;
      const expected = createHash('sha256')
        .update(readFileSync(new URL('../' + source, import.meta.url)))
        .digest('hex');
      assert.equal(report[source], expected, source);
    }
  }
});

test('supervised vitest checks select a reporter that streams one mark per completed test', () => {
  for (const suite of ['smoke', 'unit']) {
    const vitest = selectChecks(suite).checks.filter((args) => args[0] === VITEST);
    assert.ok(vitest.length > 0, suite);
    for (const args of vitest)
      assert.ok(args.includes(STREAMING_REPORTER), `${suite}: node ${args.join(' ')}`);
  }
  const native = selectChecks('native', [
    'node',
    'verify_checks.mjs',
    '--suite',
    'native',
    '--file',
    'engine/sdk.test.ts',
  ]);
  assert.equal(native.kind, 'gpu');
  assert.ok(native.checks[0].includes(STREAMING_REPORTER));
  assert.throws(
    () =>
      selectChecks('native', [
        'node',
        'verify_checks.mjs',
        '--suite',
        'native',
        '--file',
        'engine/nope.test.ts',
      ]),
    /Choose one native fixture/,
  );
  assert.throws(() => selectChecks('demos', [], {}), /quarantined/);
  assert.throws(() => selectChecks('bogus'), /Unknown verification suite/);
  // The supervisor stops a child that is silent for 40 s and reads it through a pipe.
  // The selected reporter must emit a progress mark per test before the summary; the
  // default reporter is the executed negative control and prints none to a pipe.
  const run = (reporter) =>
    spawnSync(
      process.execPath,
      [
        VITEST,
        'run',
        ...(reporter ? [reporter] : []),
        'engine/validation.test.ts',
        '--config',
        'engine/vitest.bounded.config.ts',
      ],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 120_000 },
    );
  const marks = (output) => (output.match(/\u00b7/g) ?? []).length;
  const streamed = run(STREAMING_REPORTER);
  assert.equal(streamed.status, 0, streamed.stderr);
  assert.ok(marks(streamed.stdout) >= 1, streamed.stdout);
  assert.ok(
    streamed.stdout.indexOf('\u00b7') < streamed.stdout.indexOf('Test Files'),
    streamed.stdout,
  );
  const control = run(null);
  assert.equal(control.status, 0, control.stderr);
  assert.equal(marks(control.stdout), 0, control.stdout);
});
