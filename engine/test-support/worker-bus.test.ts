import { describe, expect, it, vi } from 'vitest';
import { createWorkerBus } from './worker-bus.js';
type Message = { kind: string; seq: number; payload: { value: number } };
const message = (seq = 1): Message => ({ kind: 'work', seq, payload: { value: 1 } });

describe('manual worker bus', () => {
  it('clones sender, log and receiver ownership boundaries', async () => {
    const bus = createWorkerBus<Message>(),
      received: Message[] = [];
    bus.ports[1].subscribe(
      (value) => received.push(value as Message),
      () => {},
    );
    const input = message();
    bus.ports[0].send(input);
    input.payload.value = 2;
    expect(received).toHaveLength(0);
    bus.sent[0][0].payload.value = 3;
    await bus.until(() => received.length === 1);
    expect(received[0].payload.value).toBe(1);
    received[0].payload.value = 4;
    expect(input.payload.value).toBe(2);
    expect(bus.sent[0][0].payload.value).toBe(3);
  });
  it('holds and reorders messages explicitly while accounting for duplicates once', async () => {
    const bus = createWorkerBus<Message>(),
      values: number[] = [];
    bus.ports[1].subscribe(
      (value) => bus.ports[1].send(value),
      () => {},
    );
    bus.ports[0].subscribe(
      (value) => values.push((value as Message).seq),
      () => {},
    );
    bus.config.mapReply = (m) => [m, m];
    bus.config.hold = (_message, side) => side === 1;
    bus.ports[0].send(message(1));
    bus.ports[0].send(message(2));
    await bus.until(() => bus.held.length === 4);
    expect(values).toEqual([]);
    expect(bus.outstanding()).toBe(2);
    bus.held.reverse();
    expect(bus.releaseHeld()).toBe(4);
    expect(bus.releaseHeld()).toBe(0);
    await bus.until(() => values.length === 4);
    expect(values).toEqual([2, 2, 1, 1]);
    expect(bus.outstanding()).toBe(0);
    expect(bus.maximum()).toBe(2);
  });
  it('drops or corrupts replies without rewriting the sent log', async () => {
    const bus = createWorkerBus<Message>(),
      received: Message[] = [];
    bus.ports[0].subscribe(
      (value) => received.push(value as Message),
      () => {},
    );
    bus.config.mapReply = () => null;
    bus.ports[1].send(message());
    expect(bus.tasks).toHaveLength(0);
    bus.config.mapReply = (m) => {
      m.payload.value = 99;
      return m;
    };
    bus.ports[1].send(message(2));
    await bus.until(() => received.length === 1);
    expect(received[0].payload.value).toBe(99);
    expect(bus.sent[1][1].payload.value).toBe(1);
  });
  it('honors unsubscribe, endpoint closure and scheduler cancellation', async () => {
    const bus = createWorkerBus<Message>(),
      next = vi.fn(),
      failed = vi.fn(),
      slice = vi.fn();
    const remove = bus.ports[1].subscribe(next, failed);
    bus.ports[0].send(message());
    remove();
    bus.errors[1](Error('late'));
    const cancel = bus.schedule(slice);
    cancel();
    await bus.until(() => bus.tasks.length === 0);
    expect(next).not.toHaveBeenCalled();
    expect(failed).not.toHaveBeenCalled();
    expect(slice).not.toHaveBeenCalled();
    bus.ports[1].subscribe(next, failed);
    bus.ports[0].send(message(2));
    bus.ports[1].close();
    await bus.until(() => bus.tasks.length === 0);
    expect(next).not.toHaveBeenCalled();
    expect(() => bus.ports[1].send(message())).toThrow('send failed');
  });
  it('injects send, endpoint and scheduling failures', () => {
    const bus = createWorkerBus<Message>(),
      failed = vi.fn();
    bus.ports[0].subscribe(() => {}, failed);
    bus.errors[0](Error('offline'));
    expect(failed).toHaveBeenCalledOnce();
    bus.config.sendFailure = 'work';
    expect(() => bus.ports[0].send(message())).toThrow('send failed');
    expect(bus.sent[0]).toHaveLength(0);
    bus.config.scheduleFailure = true;
    expect(() => bus.schedule(() => {})).toThrow('Scheduler failed');
  });
  it('bounds stalled and runaway queues and preserves falsy rejection reasons', async () => {
    const bus = createWorkerBus<Message>();
    await expect(bus.until(() => false)).rejects.toThrow('stalled');
    for (const reason of [undefined, null, false, 0, ''])
      await expect(bus.settle(Promise.reject(reason))).rejects.toBe(reason);
    expect(await bus.settle(Promise.resolve(42))).toBe(42);
    const bounded = createWorkerBus<Message>(3);
    const recurse = () => {
      bounded.schedule(recurse);
    };
    recurse();
    await expect(bounded.until(() => false)).rejects.toThrow('task limit');
    expect(() => createWorkerBus(0)).toThrow('Invalid task bound');
  });
});
