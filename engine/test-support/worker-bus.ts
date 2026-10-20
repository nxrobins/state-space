/** Test-only manual transport: no browser, timers, physics or production imports. */
export type BusMessage = { kind: string; seq: number };
type Task = { kind: 'host' | 'reply' | 'slice'; run(): void };
export function createWorkerBus<M extends BusMessage>(maxSteps = 4096) {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) throw Error('Invalid task bound');
  const tasks: Task[] = [],
    held: Task[] = [],
    sent: M[][] = [[], []];
  const receive: ((value: unknown) => void)[] = [() => {}, () => {}];
  const errors: ((error: Error) => void)[] = [() => {}, () => {}];
  const closed = [false, false],
    removed = [false, false],
    pending = new Set<number>();
  let maximum = 0;
  const config = {
    mapReply: (message: M): M | M[] | null => message,
    hold: (_message: M, _side: number) => false,
    sendFailure: '',
    scheduleFailure: false,
  };
  const deliver = (side: number, value: M) => {
    if (side === 0) pending.delete(value.seq);
    if (!closed[side]) receive[side](structuredClone(value));
  };
  const ports = [0, 1].map((side) => ({
    send(raw: unknown) {
      const message = structuredClone(raw) as M;
      if (closed[side] || config.sendFailure === message.kind) throw Error('Mock send failed');
      // Fault injection cannot rewrite the evidence of what the sender emitted.
      sent[side].push(structuredClone(message));
      if (side === 0) {
        pending.add(message.seq);
        maximum = Math.max(maximum, pending.size);
      }
      const mapped = side === 1 ? config.mapReply(message) : message;
      if (mapped === null) return;
      for (const value of Array.isArray(mapped) ? mapped : [mapped]) {
        const captured = structuredClone(value);
        let delivered = false;
        const task: Task = {
          kind: side === 1 ? 'reply' : 'host',
          run() {
            if (delivered) return;
            delivered = true;
            deliver(1 - side, captured);
          },
        };
        (config.hold(captured, side) ? held : tasks).push(task);
      }
    },
    subscribe(next: (value: unknown) => void, failed: (error: Error) => void) {
      receive[side] = next;
      errors[side] = failed;
      return () => {
        removed[side] = true;
        receive[side] = () => {};
        errors[side] = () => {};
      };
    },
    close() {
      closed[side] = true;
    },
  }));
  const schedule = (task: () => void) => {
    if (config.scheduleFailure) throw Error('Scheduler failed');
    let cancelled = false;
    tasks.push({
      kind: 'slice',
      run() {
        if (!cancelled) {
          cancelled = true;
          task();
        }
      },
    });
    return () => {
      cancelled = true;
    };
  };
  const until = async (done: () => boolean) => {
    let idle = 0;
    for (let n = 0; n < maxSteps; n++) {
      if (done()) return;
      const task = tasks.shift();
      task?.run();
      await Promise.resolve();
      idle = task ? 0 : idle + 1;
      if (idle >= 8 && !done()) throw Error('Mock transport stalled');
    }
    if (!done()) throw Error('Mock task limit');
  };
  const settle = async <T>(promise: Promise<T>): Promise<T> => {
    let done = false,
      failed = false,
      value!: T,
      error: unknown;
    void promise.then(
      (result) => {
        value = result;
        done = true;
      },
      (reason) => {
        failed = true;
        error = reason;
        done = true;
      },
    );
    await until(() => done);
    if (failed) throw error;
    return value;
  };
  return {
    ports,
    tasks,
    held,
    sent,
    closed,
    removed,
    config,
    schedule,
    until,
    settle,
    receive,
    errors,
    releaseHeld() {
      const count = held.length;
      tasks.push(...held.splice(0));
      return count;
    },
    maximum: () => maximum,
    outstanding: () => pending.size,
  };
}
