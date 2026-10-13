/** CPU-side edit profile of a recorded game; full-frame timing stays in the browser benchmark. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createStateSpaceField } from '../dist/sdk/state-space.js';
import { ReferenceGame } from '../examples/spillway/game.js';
import { digest, readRecording } from '../examples/spillway/replay.js';

const [receiptPath, route, outputPath] = process.argv.slice(2);
if (!receiptPath || !route || !outputPath) throw new Error('Usage: node scripts/profile_spillway.mjs <receipt.json> <route> <output.json>');
const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
const record = receipt.rows.find(row => row.kind === route)?.replay;
if (!record) throw new Error('Route is absent from the receipt');
const field = createStateSpaceField(256, 256), game = new ReferenceGame(field);
// Browser CLI receipts may reorder JSON object keys. Check every initial value
// before restoring the canonical snapshot order used by the game's digest.
if (!isDeepStrictEqual(record.initial, game.initial)) throw new Error('Recorded initial state differs');
const valid = await readRecording({ ...record, initial: game.initial }, game.initial), rows = [];
let row;
function timeMethod(owner, name, metric, calls) {
    const original = owner[name].bind(owner);
    owner[name] = (...args) => {
        const started = performance.now();
        try { return original(...args); }
        finally {
            if (row) { row[metric] += performance.now() - started; if (calls) row[calls]++; }
        }
    };
}
timeMethod(game, 'tool', 'toolMs');
timeMethod(field, 'setCell', 'setCellMs', 'setCellCalls');
timeMethod(field, 'step', 'cpuPhysicsMs');
timeMethod(game, 'refresh', 'copyMs');
try {
    for (const command of valid.commands) {
        row = { tick: command.tick, toolMs: 0, setCellMs: 0, setCellCalls: 0, cpuPhysicsMs: 0, copyMs: 0 };
        const started = performance.now();
        const events = await game.step(command);
        row.totalMs = performance.now() - started;
        row.events = events;
        rows.push(row);
    }
    row = undefined;
    const actual = await digest(game.snapshot());
    const report = { scope: 'CPU edit/copy attribution; CPU tick duration is not browser full-frame timing.',
        route, sdkSha256: createHash('sha256').update(await readFile(new URL('../dist/sdk/state-space.js', import.meta.url))).digest('hex'),
        exactReplay: actual === valid.expected, expected: valid.expected, actual,
        ticks: field.tick, energyDriftQ: String(field.energyBalance().driftQ), rows };
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
    const edits = rows.filter(frame => frame.setCellCalls);
    console.log(JSON.stringify({ exactReplay: report.exactReplay, energyDriftQ: report.energyDriftQ,
        edits: edits.length, worstEdit: edits.toSorted((a, b) => b.toolMs - a.toolMs)[0], tick205: rows.find(frame => frame.tick === 205) }, null, 2));
    if (!report.exactReplay || report.energyDriftQ !== '0') process.exitCode = 1;
} finally { field.close(); }
