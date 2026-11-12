// Static source guards only: TypeScript parsing never evaluates the engine.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from '@typescript/typescript6';
const oldPath = new URL(
  '../dist/verification/collision-owned-review-20261108/rigid.ts.before',
  import.meta.url,
);
// Preserve this historical ownership-only proof; cache changes have a separate source guard.
const newPath = new URL(
  '../dist/verification/collision-normal-cache-review-20261109/rigid.ts.before',
  import.meta.url,
);
const parse = (path) =>
  ts.createSourceFile(
    'rigid.ts',
    readFileSync(path, 'utf8').replaceAll('\r\n', '\n'),
    ts.ScriptTarget.Latest,
    true,
  );
const before = parse(oldPath),
  after = parse(newPath);
function functions(source) {
  const result = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) result.set(node.name.text, node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}
test('time-of-impact, integration and contact-solver functions are textually unchanged', () => {
  const old = functions(before),
    current = functions(after);
  for (const name of [
    'translationImpact',
    'boundedContactAdvance',
    'contactWithinTolerance',
    'manifold',
    'effective',
    'nextImpact',
    'solve',
    'project',
    'kick',
    'drift',
    'restoreTrial',
  ]) {
    assert(old.has(name) && current.has(name), name);
    assert.equal(current.get(name).getText(after), old.get(name).getText(before), name);
  }
});
test('already-admitted helpers remain private and preserve the exported entry points', () => {
  const exports = (source) =>
    [...functions(source).values()]
      .filter((n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword))
      .map((n) => n.name.text)
      .sort();
  assert.deepEqual(exports(after), exports(before));
  for (const name of [
    'validateOwnedParcel',
    'admitAssembly',
    'assemblyMassPropertiesOfAdmitted',
    'assemblyMotionOfAdmitted',
  ]) {
    assert(functions(after).has(name));
    assert(!exports(after).includes(name));
  }
});
