import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  historicalPacket,
  historicalSource,
  readHistorical,
  verifyDigest,
  verifySourceManifest,
  verifyHistoricalSources,
} from './helpers/collision-history.mjs';

test('frozen packets bind original source bytes independently of the current engine', () => {
  for (const stage of ['owned', 'normal', 'offset'])
    verifyHistoricalSources(stage, ['engine/', 'scripts/collision-reference/state-space.mjs']);
  const path = 'engine/experimental/multiphysics/conservation.ts';
  assert.throws(
    () =>
      verifySourceManifest(historicalPacket('offset'), [path], (name) =>
        readFileSync(new URL('../' + name, import.meta.url)),
      ),
    /conservation.ts/,
  );
});

test('historical validation rejects altered bytes, changed hashes, omissions and duplicates', () => {
  const packet = historicalPacket('offset');
  const prefixes = ['engine/', 'scripts/collision-reference/state-space.mjs'];
  const read = (path) => historicalSource('offset', path);
  assert.throws(() =>
    verifySourceManifest(packet, prefixes, (path) => {
      const bytes = read(path);
      bytes[0] ^= 1;
      return bytes;
    }),
  );
  const changed = structuredClone(packet);
  changed.files.find((file) => file.path.startsWith('engine/')).sha256 = '0'.repeat(64);
  assert.throws(() => verifySourceManifest(changed, prefixes, read));
  assert.throws(() => verifySourceManifest({ files: [] }, prefixes, read), /Empty/);
  assert.throws(() => verifySourceManifest(packet, ['absent/'], read), /Missing/);
  assert.throws(
    () => verifySourceManifest({ files: [...packet.files, packet.files[0]] }, prefixes, read),
    /Duplicate/,
  );
  assert.throws(() => readHistorical('missing-file'), /Missing historical evidence/);
  assert.throws(() => historicalPacket('unknown'), /Unknown historical stage/);
});

test('original packet digests reject corrupted evidence before source comparison', () => {
  const checkpoint = JSON.parse(
    readFileSync(new URL('../docs/checkpoints/COLLISION_OFFSET_CACHE.json', import.meta.url)),
  );
  const { path, sha256 } = checkpoint.benchmark;
  const bytes = readHistorical(path);
  verifyDigest(bytes, sha256, path);
  bytes[0] ^= 1;
  assert.throws(() => verifyDigest(bytes, sha256, path), /packet.json/);
  // Reading returns independent buffers; a negative control cannot mutate the fixture.
  verifyDigest(readHistorical(path), sha256, path);
});
