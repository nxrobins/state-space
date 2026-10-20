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
  const errors = ['cpu_physics.ts', 'thermal.ts', 'pressure.ts', 'structure.ts', 'structure_compiled.ts', 'browser_state_space.ts', 'registry.ts', 'contracts.ts', 'inspection.ts', 'webgpu_field.ts', 'index.ts', 'conformance.test.ts', 'structure.test.ts', 'sdk.test.ts', 'experimental/3d.ts',
    'experimental/reactive-chamber.test.ts', 'experimental/reactive-chamber-client.test.ts', 'experimental/reactive-chamber-lifecycle.test.ts', '../examples/reactive-chamber/lifecycle.ts', '../examples/reactive-chamber/view.ts', '../examples/shared/frame-pump.ts', '../examples/reactive-chamber/scenario.ts', '../examples/reactive-chamber/recording.ts', '../examples/reactive-chamber/client.ts', '../examples/reactive-chamber/worker-entry.ts', '../examples/reactive-chamber/presentation.ts', '../examples/reactive-chamber/renderer.ts', '../examples/reactive-chamber/browser-entry.ts', '../examples/reactive-chamber/verification.ts',
    'experimental/reactive-structure.ts', 'experimental/reactive-structure.test.ts',
    'experimental/reactive-world.ts', 'experimental/reactive-world-tick.ts', 'experimental/reactive-world.test.ts', 'vitest.reactive-world.config.ts',
    'experimental/reactive-translation.ts', 'experimental/reactive-translation.test.ts', 'vitest.reactive-translation.config.ts',
    'experimental/reactive-holds.ts', 'experimental/reactive-holds.test.ts', 'vitest.reactive-holds.config.ts',
    'experimental/reactive-domain-state.ts', 'experimental/reactive-transfer.ts', 'experimental/reactive-domains.ts', 'experimental/reactive-domains.test.ts', 'vitest.reactive-domains.config.ts',
    'experimental/reactive-session-state.ts', 'experimental/reactive-session.ts', 'experimental/reactive-session.test.ts', 'vitest.reactive-session.config.ts',
    'experimental/geometry-kernel.ts', 'experimental/reactive-geometry.ts', 'experimental/reactive-geometry.test.ts', 'vitest.reactive-geometry.config.ts',
    'experimental/reactive-motion-capture.ts', 'experimental/reactive-motion.ts', 'experimental/reactive-motion.test.ts', 'vitest.reactive-motion.config.ts',
    'experimental/body-kernel.ts', 'experimental/displacement-kernel.ts', 'experimental/reactive-body.ts', 'experimental/reactive-displacement.ts', 'experimental/reactive-actors.test.ts', 'vitest.reactive-actors.config.ts',
    'experimental/reactive-translation-motion.ts', 'experimental/reactive-translation-displacement.ts', 'experimental/reactive-command-actors.test.ts', 'vitest.reactive-command-actors.config.ts',
    'experimental/body-group-kernel.ts', 'experimental/actor-group-kernel.ts', 'experimental/actor-movement-kernel.ts', 'experimental/displacement-carry-options.ts',
    'experimental/reactive-actor-group.ts', 'experimental/reactive-actor-group.test.ts', 'vitest.reactive-actor-group.config.ts',
    'experimental/reactive-movement.ts', 'experimental/reactive-movement.test.ts', 'experimental/reactive-evolution.ts', 'experimental/reactive-evolution.test.ts',
    'experimental/reactive-block.ts', 'experimental/reactive-reactions.ts', 'experimental/reactive-reactions.test.ts', 'experimental/reactive-reaction-jobs.test.ts',
    'experimental/reactive-registry.ts', 'experimental/reactive-registry.test.ts', 'experimental/reactive-materials.ts', 'experimental/reactive-materials.test.ts', 'vite.reactive-materials.config.ts',
    'experimental/terrain-body.ts', 'experimental/terrain-body.test.ts',
    'experimental/tactical-worker-queries.ts', 'experimental/tactical-worker-queries.test.ts',
    'experimental/tactical-worker-changes.ts', 'experimental/tactical-worker-changes.test.ts',
    'experimental/tactical-worker-motion.ts', 'experimental/tactical-worker-motion.test.ts',
    'experimental/tactical-worker-preview-queries.test.ts',
    'experimental/tactical-slab.test.ts', 'experimental/tactical-slab.runtime-cases.ts', 'vitest.tactical-slab-runtime.config.ts',
    '../examples/tactical-slab/index.ts', '../examples/tactical-slab/scenario.ts', '../examples/tactical-slab/controller.ts', '../examples/tactical-slab/worker.ts',
    'experimental/tactical-worker-action.ts', 'experimental/tactical-worker-journal.ts', 'experimental/tactical-worker-journal.test.ts',
    'experimental/tactical-worker-paths.ts', 'experimental/tactical-worker-paths.test.ts',
    'experimental/tactical-worker-wire.ts', 'experimental/tactical-worker-host.ts', 'experimental/tactical-worker-client.ts', 'experimental/tactical-worker.test.ts', '../examples/tactical-worker/client.js', '../examples/tactical-worker/worker.js',
    'experimental/tactical-previews.ts', 'experimental/tactical-previews.test.ts', 'experimental/tactical-previews.runtime-cases.ts', 'vitest.tactical-previews-runtime.config.ts',
    'experimental/tactical-preview-capture.ts', 'experimental/tactical-preview-capture.test.ts',
    'experimental/translation-paths.ts', 'experimental/translation-paths.test.ts', 'experimental/translation-paths.runtime-cases.ts', 'vitest.tactical-translation-runtime.config.ts',
    'experimental/terrain-displacement-core.ts', 'experimental/translation-displacement.ts', 'experimental/translation-displacement.test.ts', 'experimental/translation-displacement.runtime-cases.ts', 'vitest.tactical-translation-displacement-runtime.config.ts',
    'experimental/terrain-body-group.ts', 'experimental/terrain-body-group.test.ts', 'experimental/terrain-body-group.runtime-cases.ts', 'vitest.tactical-body-group-runtime.config.ts',
    'experimental/terrain-motion.ts', 'experimental/terrain-motion.test.ts', 'experimental/terrain-motion.runtime-cases.ts', 'vitest.tactical-terrain-motion-runtime.config.ts',
    'experimental/terrain-motion.fixtures.ts', 'experimental/terrain-displacement.ts', 'experimental/terrain-displacement.test.ts', 'experimental/terrain-displacement.runtime-cases.ts', 'vitest.tactical-displacement-runtime.config.ts',
    'experimental/path-journal.ts', 'experimental/path-journal.test.ts', 'experimental/path-journal.runtime-cases.ts', 'vitest.tactical-path-journal-runtime.config.ts',
    'experimental/motion-paths.ts', 'experimental/motion-paths.test.ts', 'experimental/motion-paths.runtime-cases.ts', 'vitest.tactical-paths-runtime.config.ts',
    'experimental/action-journal.ts', 'experimental/action-journal.test.ts', 'experimental/action-journal.runtime-cases.ts', 'vitest.tactical-journal-runtime.config.ts',
    'experimental/motion-trace.ts', 'experimental/motion-trace.test.ts', 'experimental/motion-trace.runtime-cases.ts', 'experimental/structural-material.motion-baseline.ts', 'experimental/change-reports.ts', 'experimental/change-reports.test.ts', 'experimental/change-reports.runtime-cases.ts', 'experimental/gameplay-geometry.ts', 'experimental/gameplay-geometry.test.ts', 'experimental/material-reservoirs.ts', 'experimental/material-reservoirs.test.ts', 'experimental/tactical-actions.ts', 'experimental/tactical-actions.test.ts', 'experimental/tactical-session.ts', 'experimental/tactical-session-core.ts', 'experimental/tactical-session-view.ts', 'experimental/tactical-session.test.ts', 'vitest.tactical-session.config.ts', 'vite.tactical-session.config.ts',
    'experimental/tactical-snapshot-reuse.ts', 'experimental/tactical-snapshot-reuse.test.ts',
    'experimental/actor-movement.ts', 'experimental/actor-movement.test.ts',
    'experimental/material-transport.ts', 'experimental/material-transport.test.ts', 'experimental/material-transport-kernel.ts',
    'experimental/reactive-transport.ts', 'experimental/reactive-transport-coupling.ts', 'experimental/reactive-transport.test.ts', 'vitest.reactive-transport.config.ts',
    'experimental/reactive-controlled-displacement.ts', 'experimental/reactive-transport-motion.ts', 'experimental/reactive-transport-displacement.ts',
    'experimental/reactive-transport-session.test.ts', 'vitest.reactive-transport-session.config.ts',
    'experimental/reactive-worker-wire.ts', 'experimental/reactive-worker-host.ts', 'experimental/reactive-worker-client.ts',
    'experimental/reactive-worker.test.ts', 'vitest.reactive-worker.config.ts',
    'experimental/geometry-query-wire.ts', 'experimental/reactive-changes.ts', 'experimental/reactive-worker-queries.ts', 'experimental/reactive-worker-changes.ts',
    'experimental/reactive-worker-observations.test.ts', 'vitest.reactive-worker-observations.config.ts',
    'experimental/material-transport-coupling.ts', 'experimental/material-transport-coupling.test.ts',
    'experimental/material-transport-translation.test.ts', 'experimental/tactical-slab-wind.test.ts',
    'experimental/terrain-actor-group.ts', 'experimental/terrain-actor-group.test.ts',
    'experimental/material-transport-coupling.runtime-cases.ts', 'vitest.tactical-transport-runtime.config.ts',
    'experimental/tactical-slab-air.test.ts',
    'experimental/tactical-slab-ui.test.ts', '../examples/tactical-slab/ui-model.ts', '../examples/tactical-slab/ui-runtime.ts', '../examples/tactical-slab/ui-host.ts', '../examples/tactical-slab/ui-app.ts', '../examples/tactical-slab/browser-entry.ts', '../examples/tactical-slab/worker-entry.ts',
    'experimental/tactical-renderer.ts', 'experimental/tactical-presentation.ts', 'experimental/tactical-render-shaders.ts', 'experimental/tactical-renderer.test.ts', 'vite.tactical-renderer.config.ts', '../examples/tactical-slab/presentation.ts',
    'experimental/interventions.ts', 'experimental/interventions.test.ts', 'vitest.interventions.config.ts', 'vite.interventions.config.ts',
    'experimental/lighting-cache.ts', 'experimental/lighting-cache.test.ts', 'experimental/cavern-appearance.test.ts', 'vitest.lighting.config.ts',
    'experimental/structural-gameplay.ts', 'experimental/structural-gameplay.test.ts', 'experimental/structural-client.test.ts', '../examples/structural-cavern/verify-review.js',
    'experimental/structural-view.ts', '../examples/structural-cavern/app.js', '../examples/structural-cavern/replay.js', '../examples/structural-cavern/state-evidence.js', '../examples/structural-cavern/scale-probe.js', '../examples/structural-cavern/scene.js', '../examples/structural-cavern/verify.js', '../examples/structural-cavern/benchmark.js', 'experimental/structural-world-gpu.ts', 'experimental/structural-active-shader.ts', 'experimental/structural-probe.ts', 'experimental/structural-world.ts', 'experimental/structural-world-core.ts', 'experimental/structural-mechanics.ts', 'experimental/structural-material.ts', 'experimental/structural-shader.ts', 'experimental/structural-world.test.ts',
    'experimental/gameplay-view.ts', 'experimental/gameplay-shader.ts', 'experimental/gameplay-gpu.ts', 'experimental/gameplay.test.ts', 'experimental/latency.ts', 'experimental/3d-gpu.ts', 'experimental/3d-core.ts', 'experimental/3d-gpu-core.ts', 'experimental/world.ts', 'experimental/world-core.ts', 'experimental/world-gpu.ts', 'experimental/world-renderer.ts', 'experimental/cavern-appearance.ts', 'experimental/cavern-optics.ts', 'experimental/cavern-haze.ts', 'experimental/active-shader.ts', 'experimental/active-world-core.ts', 'experimental/active-world.ts', 'experimental/active-world-gpu.ts', 'experimental/3d-shader.ts', 'experimental/3d-renderer.ts', 'experimental/3d-view.ts',
    '../examples/active-cavern/gpu-game.js', '../examples/active-cavern/verify-gameplay.js', '../examples/active-cavern/app.js', '../examples/active-cavern/game.js', '../examples/active-cavern/scene.js', '../examples/active-cavern/verify.js', '../examples/first-person/app.js', '../examples/first-person/game.js', '../examples/first-person/scene.js', '../examples/first-person/verify.js',
    '../examples/volume-lab/app.js', '../examples/volume-lab/worker.js', '../examples/volume-lab/renderer.js', '../examples/volume-lab/scenes.js', '../examples/volume-lab/verify.js',
    '../examples/lab/app.js', '../examples/lab/controller.js', '../examples/lab/scenarios.js', '../examples/lab/view.js', '../examples/lab/verify.js'].flatMap(name => lintSource(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'), name));
  for (const error of errors) process.stderr.write(`${error}\n`);
  if (errors.length) process.exitCode = 1;
  else process.stdout.write('CPU physics structural lint passed\n');
}
