export async function stateHash(field) {
    const state = field.snapshot(), count = field.width * field.height;
    const bytes = new Uint8Array(count * 12), view = new DataView(bytes.buffer);
    [state.grid, state.energyQ, state.structure].forEach((values, coordinate) => {
        values.forEach((value, i) => view.setUint32((coordinate * count + i) * 4, value, true));
    });
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}
