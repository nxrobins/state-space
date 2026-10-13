// The independent CPU replay can allocate far more than the real-time GPU path.
// Give it a separate heap and finish/terminate it before measuring any frames.
export function frameReference(scene, checkpoints) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./frame-reference-worker.js', import.meta.url), { type: 'module' });
        const finish = (action, value) => { worker.terminate(); action(value); };
        worker.onmessage = ({ data }) => data.error ? finish(reject, new Error(data.error)) : finish(resolve, data);
        worker.onerror = event => finish(reject, new Error(event.message));
        worker.onmessageerror = () => finish(reject, new Error('CPU reference result could not be decoded'));
        worker.postMessage({ scene, checkpoints });
    });
}
