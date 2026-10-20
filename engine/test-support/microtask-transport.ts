import type { TacticalTransport3D } from '../experimental/tactical/tactical-worker-wire.js';

/** Automatic microtask delivery; the reactive worker bus deliberately uses manual tasks. */
export function createMicrotaskTransport<M>() {
  const callbacks: ((value: unknown) => void)[] = [() => {}, () => {}];
  const faults: ((error: Error) => void)[] = [() => {}, () => {}];
  const closed = [false, false], sent: M[][] = [[], []];
  let rewrite: ((message: M, side: number) => M | null) | undefined;
  const ports: TacticalTransport3D[] = [0, 1].map(side => ({
    send(value) {
      if (closed[side]) throw Error('Mock endpoint closed');
      const message = structuredClone(value) as M;
      sent[side].push(structuredClone(message));
      const output = rewrite ? rewrite(message, side) : message;
      if (output !== null) queueMicrotask(() => {if (!closed[1 - side]) callbacks[1 - side](structuredClone(output));});
    },
    subscribe(receive, failed) {
      callbacks[side] = receive; faults[side] = failed;
      return () => {callbacks[side] = () => {}; faults[side] = () => {};};
    },
    close() {closed[side] = true;},
  }));
  return {ports, sent, closed, setRewrite: (fn: typeof rewrite) => {rewrite = fn;},
    // Deliberate fault injection bypasses the closed-endpoint check for stale-frame tests.
    deliver: (side: number, value: unknown) => callbacks[side](structuredClone(value)),
    fault: (side: number) => faults[side](Error('Disconnected'))};
}
