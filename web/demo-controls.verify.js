// Run by the browser frame verifier against the actual demo page and GPU field.
export async function verifyDemoControls() {
    const api = window.stateSpace, byId = id => document.getElementById(id);
    const equal = (a, b, message) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(message); };
    const initial = await api.snapshot();
    equal(initial.tick, 0, 'Demos must open paused before the first event');
    const rates = [1, 0.25, 0.1];
    for (const rate of rates) {
        byId('playback-rate').value = String(rate);
        byId('playback-rate').dispatchEvent(new Event('change', { bubbles: true }));
        equal(await api.snapshot(), initial, 'Changing playback speed mutated physics');
        byId('step').click(); const stepped = await api.snapshot();
        equal(stepped.tick, 1, 'Step button must run exactly one tick');
        await api.restore(initial); await api.step(1);
        equal(await api.snapshot(), stepped, 'Step button differs from the deterministic API');
        byId('reset-demo').click();
        equal(await api.snapshot(), initial, 'Restart must restore the complete initial state');
    }
    document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'Period', key: '.', bubbles: true }));
    equal((await api.snapshot()).tick, 1, 'Single-step shortcut failed');
    byId('reset-demo').click(); equal(await api.snapshot(), initial, 'Restart after keyboard step failed');
    api.setPlaybackRate(1);
    equal([...byId('scene-select').options].map(item => item.value),
        ['bridge', 'lighting', 'water', 'haze', 'heat', 'pressure'], 'Missing demo navigation');
    if (!byId('watch-guide').textContent.trim()) throw new Error('Missing scene viewing instructions');
    return { passed: true, startsPaused: true, rates, stepMatchesApi: true, restartExact: true, keyboardStep: true, sceneCount: 6 };
}
