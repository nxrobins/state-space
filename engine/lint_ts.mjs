// TypeScript structural properties for deterministic CPU physics.
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function lintSource(source, name = 'cpu_physics.ts') {
  const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true);
  const errors = [];
  const structural = /(?:^|[\\/])structure\.ts$/.test(name);
  const lab = /(?:^|[\\/])examples[\\/]lab[\\/]/.test(name);
  const nativeFixture = /(?:^|[\\/])(?:conformance|structure|sdk)\.test\.ts$/.test(name);
  const inputs = ['input', 'inputEnergy', 'inputStructure'];
  const inputElement = node => ts.isElementAccessExpression(node) && inputs.includes(node.expression.getText(file));
  const visit = (node, inHash = false) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'canFall' && node.initializer) {
      const expression = node.initializer.getText(file).replace(/\s+/g, '');
      if (!expression.includes('!bound(source)') || !expression.includes('!bound(target)')) {
        errors.push('SS040 independent movement must protect both source and destination structures and pins');
      }
    }
    if (nativeFixture && ts.isCallExpression(node) && node.expression.getText(file) === 'execFileSync') {
      errors.push('SS039 native GPU evidence fixtures must use asynchronous child processes so test-worker progress stays responsive');
    }
    if (ts.isParameter(node) && !node.type && node.initializer && /\bMAT\.[A-Z_]+$/.test(node.initializer.getText(file))) {
      errors.push('SS020 material factory defaults require an explicit numeric parameter type');
    }
    if (lab && ts.isParameter(node) && node.initializer?.getText(file).includes('this.#')) {
      errors.push('SS048 queued client defaults must resolve mutable state when the operation executes');
    }
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const path = node.moduleSpecifier.text;
      if (lab && /(?:^|\/)engine\//.test(path)) errors.push('SS046 engine lab clients must use the public SDK entry point');
      if (path.startsWith('.') && !/\.m?js$/.test(path)) errors.push('SS021 runtime relative imports need explicit JavaScript extensions for portable ESM declarations');
    }
    if (ts.isParameter(node) && !node.type && node.initializer && /\bbuildColdTable\s*\(/.test(node.initializer.getText(file))) {
      errors.push('SS016 shared typed-array factory defaults require an explicit parameter type');
    }
    const hash = inHash || (ts.isFunctionDeclaration(node) && node.name?.text === 'hashPair');
    if (ts.isBinaryExpression(node)) {
      if (lab && node.operatorToken.kind === ts.SyntaxKind.AmpersandToken && ts.isNumericLiteral(node.right) && /\bbonds\b/.test(node.left.getText(file))) {
        errors.push('SS042 public bond words require exported structure masks, not compact direction bits');
      }
      if (structural && node.operatorToken.kind === ts.SyntaxKind.SlashToken) {
        const parent = node.parent;
        if (!(ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) &&
            parent.expression.expression.getText(file) === 'Math' && ['floor', 'ceil'].includes(parent.expression.name.text))) {
          errors.push('SS033 structural division must explicitly produce an integer');
        }
      }
      if (structural && [ts.SyntaxKind.BarToken, ts.SyntaxKind.AmpersandToken, ts.SyntaxKind.CaretToken,
          ts.SyntaxKind.LessThanLessThanToken, ts.SyntaxKind.GreaterThanGreaterThanToken, ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken].includes(node.operatorToken.kind) &&
          /\b(loads|capacities|reactions|supportedWeight|nominal)\b/.test(node.getText(file))) {
        errors.push('SS033 structural loads and capacity products must not narrow to 32-bit arithmetic');
      }
      if (hash && node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) errors.push('SS008 u32 hashes require Math.imul, not floating-point multiplication');
      if (node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment && inputElement(node.left)) {
        errors.push('SS009 physics pass input must remain immutable');
      }
    }
    if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && inputElement(node.operand) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken)) errors.push('SS009 physics pass input must remain immutable');
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && inputs.includes(node.expression.expression.getText(file)) &&
        ['set', 'fill', 'copyWithin', 'reverse', 'sort'].includes(node.expression.name.text)) errors.push('SS009 physics pass input must remain immutable');
    ts.forEachChild(node, child => visit(child, hash));
  };
  visit(file);
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = ['cpu_physics.ts', 'thermal.ts', 'structure.ts', 'browser_state_space.ts', 'registry.ts', 'contracts.ts', 'inspection.ts', 'webgpu_field.ts', 'index.ts', 'conformance.test.ts', 'structure.test.ts', 'sdk.test.ts',
    '../examples/lab/app.js', '../examples/lab/controller.js', '../examples/lab/scenarios.js', '../examples/lab/view.js', '../examples/lab/verify.js'].flatMap(name => lintSource(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'), name));
  for (const error of errors) process.stderr.write(`${error}\n`);
  if (errors.length) process.exitCode = 1;
  else process.stdout.write('CPU physics structural lint passed\n');
}
