/** Read-only aggregation. Never imports or runs either physics engine. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { readPacket, hash, json, holdRecord } from './packet.mjs';
import { assembleReport, markdownReport } from './report.mjs';

if (process.argv.length !== 3) throw Error('Usage: node collect-cpu.mjs CPU_PACKET');
const directory = resolve(process.argv[2]);
const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const reviewPath = join(directory, 'review.json'),
  review = read(reviewPath);
if (review.schema !== 'collision-cpu-review-v1' || review.mode !== 'cpu-only')
  throw Error('Unknown CPU review');
const reviewHash = hash(readFileSync(reviewPath));
const { packet, sha256 } = readPacket(review.benchmark.directory);
if (sha256 !== review.benchmark.packetSha256 || holdRecord().sha256 !== review.hold.sha256)
  throw Error('Changed benchmark packet or incident hold');
const stateRows = [],
  mujocoRows = [],
  containment = [];
let world = { status: 'not-run' };
for (const name of review.cases) {
  const path = join(directory, name),
    reportPath = join(path, 'report.json');
  if (!existsSync(reportPath)) {
    containment.push({ case: name, status: 'not-run' });
    continue;
  }
  const report = read(reportPath);
  if (report.reviewSha256 !== reviewHash) throw Error('Unbound containment receipt');
  containment.push({
    case: name,
    passed: report.passed,
    durationSeconds: report.durationSeconds,
    error: report.error ?? null,
    cleanupError: report.cleanupError ?? null,
    namedJobAbsent: report.namedJobAbsent,
    holdUnchanged: report.holdUnchanged,
    sourcesUnchanged: report.sourcesUnchanged,
    protectedWorktreeUnchanged: report.protectedWorktreeUnchanged,
  });
  const resultPath = join(path, 'result.json');
  if (!existsSync(resultPath)) continue;
  const result = read(resultPath);
  if (name === 'world-reference') world = result;
  else {
    if (result.packetSha256 !== sha256) throw Error('Unbound backend result');
    (name.startsWith('ss-') ? stateRows : mujocoRows).push(...result.rows);
  }
}
const report = {
  ...assembleReport(packet, stateRows, mujocoRows, world),
  cpuScope: {
    reviewSha256: reviewHash,
    packetSha256: sha256,
    limits: review.limits,
    containment,
    timingInterpretation:
      'Diagnostic wall timings under a 6% Windows Job CPU cap; no performance qualification.',
    binaries: review.binaries,
    hold: review.hold,
  },
};
if (
  containment.some(
    (r) =>
      r.passed !== true ||
      r.namedJobAbsent !== true ||
      r.holdUnchanged !== true ||
      r.sourcesUnchanged !== true ||
      r.protectedWorktreeUnchanged !== true,
  )
)
  report.status = 'incomplete';
json(join(directory, 'comparison.json'), report);
writeFileSync(
  join(directory, 'comparison.md'),
  '# Contained CPU collision diagnostic\n\n' +
    report.cpuScope.timingInterpretation +
    '\n\n' +
    markdownReport(report),
  { flag: 'wx' },
);
console.log(
  JSON.stringify({
    directory,
    status: report.status,
    rows: report.rows.length,
    containmentPassed: containment.filter((r) => r.passed).length,
  }),
);
