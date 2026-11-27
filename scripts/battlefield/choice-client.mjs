import { distribution } from './slice.mjs';

// Use a distinct transport sequence for every operation, including overlapping requests.
export function choiceChannel(post) {
  const pending = new Map();
  let sequence = 0,
    fault;
  return {
    request(message) {
      if (fault) return Promise.reject(fault);
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          post({ ...message, sequence: id });
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    receive({ sequence, value, error }) {
      const call = pending.get(sequence);
      if (!call) return;
      pending.delete(sequence);
      if (error) call.reject(Error(error));
      else call.resolve(value);
    },
    fail(error) {
      fault = error;
      for (const call of pending.values()) call.reject(error);
      pending.clear();
    },
  };
}

// The serial benchmark selects once, waits for the visible frame, then commits that selection.
export function choicePass(request, prepare) {
  let generation,
    requestId = 0;
  return async (message) => {
    if (message.kind === 'init') {
      const result = await request({ ...message, prepare });
      generation = result.generation;
      return result;
    }
    if (message.kind === 'preview') requestId++;
    return request({ ...message, generation, requestId });
  };
}

export function forecastTimings(queries, field) {
  const summarize = (rows) => {
    if (!rows.length) return { count: 0, p95: null, within100: 0, meets100: null };
    const timings = distribution(rows.map((q) => q[field]));
    return {
      ...timings,
      within100: rows.filter((q) => q[field] <= 100).length,
      meets100: timings.p95 <= 100,
    };
  };
  return Object.fromEntries(
    ['all', 'prepared', 'in-flight', 'fresh'].map((path) => [
      path,
      summarize(path === 'all' ? queries : queries.filter((q) => q.path === path)),
    ]),
  );
}
