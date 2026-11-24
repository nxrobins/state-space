import { expect, test } from 'vitest';
import { appendReplayFrame, createReplayLog, recoverReplay, replayBattle, unpackActions } from './replay';

test('a recovered prefix can be saved and resumed again after recording new input', () => {
  const original = createReplayLog('fire', 7, 'recovery');
  original.frames = [{ tick: 0, input: 0 }, { tick: 2, input: 0 }];
  const recovery = recoverReplay(original)!;
  expect(recovery.state.tick).toBe(1);
  expect(recovery.log.frames).toHaveLength(1);
  expect(original.frames).toHaveLength(2);
  appendReplayFrame(recovery.log, recovery.state.tick, unpackActions(0));
  const saved = JSON.parse(JSON.stringify(recovery.log));
  expect(replayBattle(saved)?.tick).toBe(2);
  expect(recoverReplay(saved)?.log.frames).toEqual(saved.frames);
});

test('a contiguous replay retains all accepted inputs', () => {
  const log = createReplayLog('water', 3, 'control');
  log.frames = [{ tick: 0, input: 0 }, { tick: 1, input: 0 }];
  expect(recoverReplay(log)?.log).toEqual(log);
  expect(recoverReplay({ ...log, schemaVersion: -1 })).toBeNull();
});
