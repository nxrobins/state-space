// Mock-only transport regressions. Not executed while runtime review is pending.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installVerificationJournal } from '../examples/structural-cavern/verification-events.js';
import { Connection, validateRequest, withDeadline } from '../scripts/verification_browser.mjs';

test('journal waits for durable acknowledgement and sends one request at a time', async () => {
  const savedFetch = globalThis.fetch,
    savedWindow = globalThis.window;
  globalThis.window = globalThis;
  const sends = [];
  let respond;
  globalThis.fetch = (_url, options) => {
    sends.push(JSON.parse(options.body));
    return new Promise((r) => {
      respond = r;
    });
  };
  try {
    const j = installVerificationJournal('/journal'),
      first = j.emit({ kind: 'first' }),
      second = j.emit({ kind: 'second' });
    assert.equal(sends.length, 1);
    respond({ ok: true, json: async () => ({ sequence: 1, sha256: 'a'.repeat(64) }) });
    await first;
    assert.equal(sends.length, 2);
    respond({ ok: true, json: async () => ({ sequence: 2, sha256: 'b'.repeat(64) }) });
    await second;
    await j.flush();
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.window = savedWindow;
    delete globalThis.__stateSpaceVerification;
  }
});

test('overflow rejects the entire pending queue and flush', async () => {
  const savedFetch = globalThis.fetch,
    savedWindow = globalThis.window;
  globalThis.window = globalThis;
  let release;
  globalThis.fetch = () =>
    new Promise((r) => {
      release = r;
    });
  try {
    const j = installVerificationJournal('/journal'),
      pending = [];
    for (let i = 0; i < 65; i++)
      pending.push(
        j.emit({ kind: 'frame', tick: i }).then(
          () => false,
          () => true,
        ),
      );
    assert.equal((await Promise.all(pending)).every(Boolean), true);
    await assert.rejects(j.flush(), /full/);
    assert.throws(() => j.check(), /full/);
    release({ ok: true, json: async () => ({ sequence: 1, sha256: 'a'.repeat(64) }) });
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.window = savedWindow;
    delete globalThis.__stateSpaceVerification;
  }
});

test('wrong acknowledgement cannot become success', async () => {
  const savedFetch = globalThis.fetch,
    savedWindow = globalThis.window;
  globalThis.window = globalThis;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ sequence: 2, sha256: 'a'.repeat(64) }),
  });
  try {
    const j = installVerificationJournal('/journal');
    await assert.rejects(j.emit({ kind: 'start' }), /acknowledgement/);
    await assert.rejects(j.flush(), /acknowledgement/);
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.window = savedWindow;
    delete globalThis.__stateSpaceVerification;
  }
});

test('persistent protocol refuses wrong IDs and unknown commands', () => {
  assert.throws(() => validateRequest({ id: 2, method: 'eval', params: {} }, 1));
  assert.throws(() => validateRequest({ id: 1, method: 'launchAnotherBrowser', params: {} }, 1));
  assert.equal(validateRequest({ id: 1, method: 'errors', params: {} }, 1).method, 'errors');
});

test('completed operations cancel their timeout instead of delaying helper exit', async () => {
  const originalSet = globalThis.setTimeout,
    originalClear = globalThis.clearTimeout;
  const token = {};
  let cleared;
  globalThis.setTimeout = () => token;
  globalThis.clearTimeout = (value) => {
    cleared = value;
  };
  try {
    assert.equal(await withDeadline(Promise.resolve('done'), 1000, 'deadline'), 'done');
    assert.equal(cleared, token);
  } finally {
    globalThis.setTimeout = originalSet;
    globalThis.clearTimeout = originalClear;
  }
});

function fakeSocket() {
  const handlers = new Map(),
    sent = [];
  return {
    sent,
    addEventListener(name, callback) {
      handlers.set(name, [...(handlers.get(name) ?? []), callback]);
    },
    send(text) {
      sent.push(JSON.parse(text));
    },
    emit(name, value) {
      for (const callback of handlers.get(name) ?? []) callback(value);
    },
  };
}

test('CDP disconnect rejects pending requests and notifies the idle command loop', async () => {
  const socket = fakeSocket(),
    connection = new Connection(socket);
  let failure;
  connection.onFailure = (error) => {
    failure = error;
  };
  const pending = connection.call('Runtime.evaluate', { expression: '0' });
  const rejected = assert.rejects(pending, /closed/);
  socket.emit('close', {});
  await rejected;
  assert.match(failure.message, /closed/);
  assert.equal(connection.pending.size, 0);
  await assert.rejects(connection.call('Browser.getVersion'), /closed/);
});

test('CDP rejects unknown response IDs and bounds retained errors by bytes', async () => {
  const socket = fakeSocket(),
    connection = new Connection(socket);
  const pending = connection.call('Browser.getVersion'),
    rejected = assert.rejects(pending, /response ID/);
  socket.emit('message', { data: JSON.stringify({ id: 2, result: {} }) });
  await rejected;
  const secondSocket = fakeSocket(),
    second = new Connection(secondSocket);
  secondSocket.emit('message', {
    data: JSON.stringify({
      method: 'Runtime.exceptionThrown',
      params: { exceptionDetails: { text: 'x'.repeat(1024 * 1024) } },
    }),
  });
  assert.match(second.fault.message, /buffer overflow/);
  assert.equal(second.errors.length, 0);
});
