/** Assemble the static demo site served by GitHub Pages.
 *
 * Copies the landing page, each demo page and exactly the files those pages reference,
 * keeping repository-relative paths so the pages work unchanged. Every local reference is
 * checked. Reads built output and sources only: no simulation, worker, browser or GPU.
 */
import ts from '@typescript/typescript6';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

/** Landing-page sources. They are published at the site root. */
export const SITE_SOURCE = 'site';
/** Demo entry pages. `whole` publishes a complete build directory, not only what the
 * entry references, because a bundle can name its sibling files at run time. */
export const DEMOS = Object.freeze([
  { entry: 'web/index.html' },
  { entry: 'examples/lab/index.html' },
  { entry: 'examples/spillway/index.html' },
  { entry: 'examples/volume-lab/index.html' },
  { entry: 'examples/first-person/index.html' },
  { entry: 'examples/cavern/index.html' },
  { entry: 'examples/active-cavern/index.html' },
  { entry: 'examples/structural-cavern/index.html' },
  { entry: 'dist/reactive-chamber/index.html', whole: 'dist/reactive-chamber' },
  { entry: 'dist/multiphysics-builder/index.html', whole: 'dist/multiphysics-builder' },
]);
/** The only trees a published file may come from. A checkout's receipts, evidence and
 * incident hold under dist/verification are never published, whatever a page references.
 * The site serves its own hold status from site/dist/verification/ instead: the bundled
 * demos ask for it at startup and refuse to start unless the answer is a clean 404 or a
 * released hold, and a static host does not always answer a missing file with 404. */
export const PUBLISHED = Object.freeze([
  /^examples\//,
  /^web\//,
  /^dist\/sdk\//,
  /^dist\/reactive-chamber\//,
  /^dist\/multiphysics-builder\//,
  /^docs\/(?:sdk\/)?[^/]+\.md$/,
]);

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
/** Build provenance written beside a bundle; nothing on the site reads it. */
const BUILD_METADATA = /\/bundle-inputs\.json$/;

/** Local references in one file, as written. `module` marks JavaScript module specifiers. */
export function references(path, text) {
  const found = [];
  const add = (specifier, module = false) => {
    if (specifier && !EXTERNAL.test(specifier)) found.push({ specifier, module });
  };
  if (/\.html?$/.test(path)) {
    for (const match of text.matchAll(/\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
      add(match[1] ?? match[2]);
  } else if (/\.css$/.test(path)) {
    for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")\s]+))\s*\)/g))
      add(match[1] ?? match[2] ?? match[3]);
    for (const match of text.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/g))
      add(match[1] ?? match[2]);
  } else if (/\.m?js$/.test(path)) {
    const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    const literal = (node) => (node && ts.isStringLiteralLike(node) ? node.text : undefined);
    const importMetaUrl = (node) =>
      node &&
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'url' &&
      ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword;
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        add(literal(node.moduleSpecifier), true);
      else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
        add(literal(node.arguments[0]), true);
      else if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'URL' &&
        node.arguments?.length === 2 &&
        importMetaUrl(node.arguments[1])
      )
        add(literal(node.arguments[0]));
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return found;
}

const isFile = (path) => existsSync(path) && statSync(path).isFile();
const isDirectory = (path) => existsSync(path) && statSync(path).isDirectory();

/** The source file for one published path, or the reason it cannot be published. */
function locate(root, path) {
  const landing = join(root, SITE_SOURCE, path);
  if (isFile(landing)) return { source: landing };
  if (!PUBLISHED.some((pattern) => pattern.test(path)))
    return { problem: 'is outside the published trees' };
  const source = join(root, path);
  return isFile(source) ? { source } : { problem: 'does not exist' };
}

/** Resolve one reference to a published path, or describe why it is not allowed. */
function target(root, from, { specifier, module }) {
  if (specifier.startsWith('/'))
    return { problem: 'is root-absolute and breaks under a project site path' };
  if (module && !specifier.startsWith('.'))
    return { problem: 'is a bare module specifier; a static page cannot resolve it' };
  const clean = specifier.replace(/[?#].*$/, '');
  let path = posix.normalize(posix.join(posix.dirname(from), clean));
  if (path === '..' || path.startsWith('../')) return { problem: 'leaves the site root' };
  if (path === '.' || path.endsWith('/')) path = posix.join(path, 'index.html');
  else if (isDirectory(join(root, SITE_SOURCE, path)) || isDirectory(join(root, path)))
    path = posix.join(path, 'index.html');
  return { path };
}

function listFiles(root, directory) {
  const found = [];
  const walk = (relative) => {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = posix.join(relative, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) found.push(path);
    }
  };
  if (isDirectory(join(root, directory))) walk(directory);
  return found.sort();
}

/** Every file the site needs, as published path -> source file. Throws one error that
 * lists every missing, disallowed or unlinked reference. */
export function collect(root, demos = DEMOS) {
  const files = new Map();
  const problems = [];
  const queue = [{ path: 'index.html', from: 'the site root' }];
  // Everything under site/ is site content, including files that no page links.
  for (const path of listFiles(root, SITE_SOURCE))
    queue.push({ path: path.slice(SITE_SOURCE.length + 1), from: 'the landing tree' });
  for (const demo of demos) {
    queue.push({ path: demo.entry, from: 'the demo list' });
    if (demo.whole)
      for (const path of listFiles(root, demo.whole))
        if (!BUILD_METADATA.test(path)) queue.push({ path, from: demo.whole });
  }
  const linked = new Set();
  while (queue.length) {
    const { path, from } = queue.shift();
    if (files.has(path)) continue;
    const { source, problem } = locate(root, path);
    if (problem) {
      problems.push(`${path} (referenced by ${from}) ${problem}`);
      continue;
    }
    files.set(path, source);
    if (!/\.(?:html?|css|m?js)$/.test(path)) continue;
    for (const reference of references(path, readFileSync(source, 'utf8'))) {
      const next = target(root, path, reference);
      if (next.problem) problems.push(`${reference.specifier} (in ${path}) ${next.problem}`);
      else {
        if (path === 'index.html') linked.add(next.path);
        queue.push({ path: next.path, from: path });
      }
    }
  }
  for (const demo of demos)
    if (!linked.has(demo.entry)) problems.push(`${demo.entry} is not linked from the landing page`);
  if (problems.length)
    throw Error(
      `The demo site is incomplete:\n  ${[...new Set(problems)].join('\n  ')}\n` +
        'Build the SDK and the bundled demos first (npm run build:sdk, ' +
        'build:reactive-chamber, build:multiphysics-builder).',
    );
  return files;
}

/** Copy the collected files into a new or empty output directory. */
export function assemble(root, output, demos = DEMOS) {
  const files = collect(root, demos);
  if (existsSync(output) && readdirSync(output).length)
    throw Error(`Output directory is not empty: ${output}`);
  let bytes = 0;
  for (const [path, source] of files) {
    const destination = join(output, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
    bytes += statSync(source).size;
  }
  return { files: files.size, bytes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]))) {
  const { values } = parseArgs({ options: { output: { type: 'string', default: 'dist/site' } } });
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { files, bytes } = assemble(root, resolve(values.output));
  console.log(
    `Assembled ${DEMOS.length} demos: ${files} files, ${(bytes / 1024 / 1024).toFixed(1)} MiB in ${values.output}`,
  );
}
