// Read-only historical evidence. Never import/evaluate a saved engine or use HEAD as its source.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

export function verifyDigest(bytes, expected, label) {
  assert.match(expected, /^[a-f0-9]{64}$/, `${label}: invalid digest`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expected, label);
  return bytes;
}

const archive = JSON.parse(
  gunzipSync(
    verifyDigest(
      readFileSync(new URL('../fixtures/collision-history.json.gz', import.meta.url)),
      '625a4c744a8721da4260a852891fbbfe01d7b35087858820a051bf003cc13cd6',
      'collision history archive',
    ),
    { maxOutputLength: 2 * 1024 * 1024 },
  ),
);
assert.equal(archive.schema, 'collision-test-history-v1');

export function readHistorical(path) {
  assert(Object.hasOwn(archive.files, path), `Missing historical evidence: ${path}`);
  return verifyDigest(
    Buffer.from(archive.files[path], 'base64'),
    archive.origins[path].sha256,
    path,
  );
}

const stages = {
  owned: {
    checkpoint: 'COLLISION_OWNED_OPTIMIZATION',
    rigid: 'dist/verification/collision-normal-cache-review-20261109/rigid.ts.before',
  },
  normal: {
    checkpoint: 'COLLISION_NORMAL_CACHE',
    rigid: 'dist/verification/collision-offset-cache-review-20261109/rigid.ts.before',
  },
  offset: {
    checkpoint: 'COLLISION_OFFSET_CACHE',
    rigid: 'source/engine/experimental/multiphysics/rigid.ts',
  },
};

export function historicalPacket(stage) {
  assert(Object.hasOwn(stages, stage), `Unknown historical stage: ${stage}`);
  const checkpoint = JSON.parse(
    readFileSync(
      new URL(`../../docs/checkpoints/${stages[stage].checkpoint}.json`, import.meta.url),
    ),
  );
  const { path, sha256 } = checkpoint.benchmark;
  return JSON.parse(verifyDigest(readHistorical(path), sha256, path));
}

export function historicalSource(stage, path) {
  assert(Object.hasOwn(stages, stage), `Unknown historical stage: ${stage}`);
  return readHistorical(
    path === 'engine/experimental/multiphysics/rigid.ts' ? stages[stage].rigid : `source/${path}`,
  );
}

// A reader argument lets negative controls prove that current/modified sources are rejected.
export function verifySourceManifest(packet, prefixes, readSource) {
  assert(packet.files.length > 0, 'Empty historical source manifest');
  assert.equal(
    new Set(packet.files.map((file) => file.path)).size,
    packet.files.length,
    'Duplicate historical source',
  );
  for (const prefix of prefixes)
    assert(
      packet.files.some((file) => file.path.startsWith(prefix)),
      `Missing source: ${prefix}`,
    );
  for (const file of packet.files.filter((file) => prefixes.some((p) => file.path.startsWith(p))))
    verifyDigest(readSource(file.path), file.sha256, file.path);
}

export function verifyHistoricalSources(stage, prefixes) {
  const packet = historicalPacket(stage);
  verifySourceManifest(packet, prefixes, (path) => historicalSource(stage, path));
  return packet;
}
