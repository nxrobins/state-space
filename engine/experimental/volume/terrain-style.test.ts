import { expect, test } from 'vitest';
import { packTerrainStyle, resolveTerrainStyle, TERRAIN_STYLE_BYTES } from './terrain-style.js';

test('profiles are complete, independently owned and replace rather than accumulate overrides', () => {
  const input = { profile: 'geological', materials: { rockTint: [0.2, 0.3, 0.4] } };
  const first = resolveTerrainStyle(input);
  input.materials.rockTint[0] = 1;
  expect(first.materials.rockTint).toEqual([0.2, 0.3, 0.4]);
  const copy = resolveTerrainStyle(first);
  copy.lighting.lampIntensity = 0;
  expect(first.lighting.lampIntensity).toBeGreaterThan(0);
  expect(resolveTerrainStyle({}).profile).toBe('classic');
  expect(resolveTerrainStyle({ profile: 'geological' }).materials.rockTint).not.toEqual(
    first.materials.rockTint,
  );
});

test('exposure changes by stops without changing lighting or material settings', () => {
  const base = resolveTerrainStyle({ profile: 'geological', tone: { exposureEV: 0 } });
  const brighter = resolveTerrainStyle({ ...base, tone: { ...base.tone, exposureEV: 1 } });
  const a = packTerrainStyle(base),
    b = packTerrainStyle(brighter);
  expect(a.byteLength).toBe(TERRAIN_STYLE_BYTES);
  expect(b[0]).toBe(a[0] * 2);
  expect(Array.from(b.slice(1))).toEqual(Array.from(a.slice(1)));
  expect(brighter.materials).toEqual(base.materials);
  expect(brighter.lighting).toEqual(base.lighting);
});

test('malformed styles and out-of-budget values reject, including misspelled fields', () => {
  for (const value of [
    null,
    [],
    true,
    'geological',
    { profile: 'unknown' },
    { tone: null },
    { tone: { exposureEV: NaN } },
    { tone: { exposureEV: 4.01 } },
    { tone: { bloomThreshold: 0 } },
    { lighting: { lampIntensity: Infinity } },
    { lighting: { lampIntensity: -1 } },
    { lighting: { lampColor: [1, 1, 2] } },
    { materials: { rockNormalStrength: 2.01 } },
    { materials: { wetRoughness: 0 } },
    { materials: { rockTint: [0.2, 0.3] } },
    { materials: { rockTint: [0, , 1] } },
    { materials: { rockTint: new Float32Array(3) } },
    { materials: { rockTint: [0, 1, '0'] } },
    { materials: { rockTint: Object.assign([0, 1, 0], { extra: 1 }) } },
    { tone: { exposure: 1 } },
    { step: 1 },
    { lighting: undefined },
    new Date(),
  ])
    expect(() => resolveTerrainStyle(value)).toThrow('Invalid terrain style');
});

test('accessors and hidden properties reject without evaluating user code', () => {
  let calls = 0;
  const tone = Object.defineProperty({}, 'exposureEV', {
    enumerable: true,
    get() {
      calls++;
      return 0;
    },
  });
  const color = [1, 1, 1];
  Object.defineProperty(color, '0', {
    enumerable: true,
    get() {
      calls++;
      return 1;
    },
  });
  expect(() => resolveTerrainStyle({ tone })).toThrow();
  expect(() => resolveTerrainStyle({ materials: { rockTint: color } })).toThrow();
  expect(() =>
    resolveTerrainStyle(Object.defineProperty({}, 'profile', { value: 'classic' })),
  ).toThrow();
  expect(calls).toBe(0);
});

test('valid extremes produce bounded finite GPU uniforms and JSON-round-trip settings', () => {
  const settings = resolveTerrainStyle({
    profile: 'geological',
    tone: { exposureEV: 4, bloomStrength: 0, bloomThreshold: 16 },
    lighting: { ambientIntensity: 0, lampIntensity: 4, emissiveIntensity: 0, lampColor: [0, 1, 0] },
    materials: {
      rockTextureScale: 4,
      rockNormalStrength: 2,
      rockRoughness: 0.25,
      wetDarkening: 0.9,
      wetRoughness: 0.08,
      macroVariation: 1,
      frostStrength: 2,
    },
  });
  expect(Array.from(packTerrainStyle(settings)).every(Number.isFinite)).toBe(true);
  expect(resolveTerrainStyle(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
});
