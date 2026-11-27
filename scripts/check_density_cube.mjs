/** Check the portable density cube against independently frozen Linux x64 binary64 results.
 * --reference additionally attests this Node executable and compares every result to its native cube. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import {
  BUNDLE,
  readDensityCubeFreeze,
  requireLiquidContactReference,
} from './liquid_contact_engine.mjs';
import { guardNode } from './verification_guard.mjs';

function* corpus() {
  // Sample both adjacent words of fdlibm's interval cutovers, across the
  // normal-input range for which the cube can round to a finite nonzero value.
  for (let exponent = -359; exponent <= 342; exponent++) {
    for (const fraction of [0n, 0x3988fn << 32n, 0xbb67an << 32n]) {
      const center = (BigInt(exponent + 1023) << 52n) + fraction;
      for (const delta of [-1n, 0n, 1n]) yield center + delta;
    }
  }
  // Bias every other sample toward the density kernel's practical range.
  let seed = 0x7a1b3def;
  const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  for (let i = 0; i < 65536; i++) {
    const exponent = i % 2 === 0 ? (next() % 86) - 74 : (next() % 701) - 359;
    const high = ((exponent + 1023) << 20) + (next() >>> 12);
    yield (BigInt(high) << 32n) | BigInt(next());
  }
}

const args = process.argv.slice(2);
assert.ok(
  !args.length || (args.length === 1 && args[0] === '--reference'),
  'Expected [--reference]',
);
await guardNode('cpu', 60);
const freeze = await readDensityCubeFreeze();
const reference = args[0] === '--reference';
if (reference) await requireLiquidContactReference(freeze.reference);
const directory = resolve('dist/liquid-contact', 'cube-' + randomUUID());
await mkdir(directory, { recursive: true });
const outfile = resolve(directory, 'cube.mjs');
await build({
  ...BUNDLE,
  entryPoints: ['engine/experimental/multiphysics/density-cube.ts'],
  outfile,
});
const { densityCube } = await import(pathToFileURL(outfile).href);
const bytes = Buffer.alloc(8);
function check(bits) {
  bytes.writeBigUInt64BE(bits);
  const input = bytes.readDoubleBE();
  const actual = densityCube(input);
  if (reference && !Object.is(actual, input ** 3))
    assert.fail('Native cube differs at input ' + bits.toString(16).padStart(16, '0'));
  bytes.writeDoubleBE(actual);
  return bytes;
}
for (const { description, input, output } of freeze.edges)
  assert.equal(check(BigInt('0x' + input)).toString('hex'), output, description);
assert.ok(Number.isNaN(densityCube(NaN)));
const digest = createHash('sha256');
let count = 0;
for (const input of corpus()) {
  digest.update(check(input));
  count++;
}
const result = { count, sha256: digest.digest('hex') };
assert.deepEqual(result, freeze.corpus);
const receipt = {
  reference: freeze.reference,
  nativeComparison: reference,
  runtime: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  },
  edges: freeze.edges.length,
  corpus: result,
};
await writeFile(resolve(directory, 'report.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt));
