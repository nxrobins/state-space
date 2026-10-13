import { validateSnapshot, DEFAULT_REGISTRY } from '../../dist/sdk/state-space.js';
import { commandFor, GAME_VERSION, MAX_TICKS } from './game.js';

export async function digest(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
}

export async function recording(game) {
    return { format: 'state-space-replay-1', gameVersion: GAME_VERSION, initial: structuredClone(game.initial),
        commands: structuredClone(game.commands), expected: await digest(game.snapshot()), endTick: game.field.tick };
}

// Import validates the complete file before touching the running game. This
// reference level pins its initial world and game rules; saves never guess a migration.
export async function readRecording(value, initial) {
    if (!value || value.format !== 'state-space-replay-1' || value.gameVersion !== GAME_VERSION ||
        !Array.isArray(value.commands) || value.commands.length > MAX_TICKS || value.endTick !== value.commands.length ||
        typeof value.expected !== 'string' || !/^[a-f0-9]{64}$/.test(value.expected)) throw new Error('Incompatible replay file');
    validateSnapshot(value.initial?.field, DEFAULT_REGISTRY);
    if (await digest(value.initial) !== await digest(initial)) throw new Error('Replay initial state differs from this version of Spillway');
    const commands = value.commands.map((command, i) => {
        if (!command || command.tick !== i + 1) throw new Error('Replay ticks must be contiguous');
        return commandFor(command, i + 1);
    });
    return { ...value, initial: structuredClone(initial), commands };
}

// Used by the built-in replay inspector and the benchmark's independent CPU run.
export async function replayInto(game, record) {
    const valid = await readRecording(record, game.initial);
    game.reset();
    for (const command of valid.commands) await game.step(command);
    const actual = await digest(game.snapshot());
    return { exact: actual === valid.expected, expected: valid.expected, actual, ticks: game.field.tick,
        driftQ: String(game.field.energyBalance().driftQ), events: game.events, player: { ...game.player }, status: game.status };
}
