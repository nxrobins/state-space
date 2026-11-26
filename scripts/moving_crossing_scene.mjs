import { crossingSolid, crossingWater } from './crossing_reference.mjs';

export const dt = 1 / 480,
  gravity = 9.8,
  ticks = 250,
  deckY = 1.0251;
export const deckTop = deckY + 0.125,
  halfFoot = 0.075,
  startX = -1.4,
  speed = 5,
  bondLength = 1.53;
export const cases = [
  { id: 'unloaded', mass: 0, strength: 135 },
  { id: 'light', mass: 1, strength: 135 },
  { id: 'heavy', mass: 10, strength: 135 },
  { id: 'reinforced', mass: 10, strength: 500 },
];
export function movingCrossingScene(api, profiles, { mass, strength }, speedX = speed, crew = []) {
  const solid = (...args) => crossingSolid(api, profiles, ...args);
  return api.createMultiphysicsSnapshot3D(profiles, {
    parcels: [
      solid('abutment', [-bondLength, deckY, 0], [0.5, 0.125, 0.4], 1),
      solid('deck', [0, deckY, 0], [1, 0.125, 0.4], 1),
      solid('far-bank', [2.03, deckTop - 0.01, 0], [1, 0.01, 0.4], 1),
      solid('floor', [0, -0.5, 0], [2.5, 0.5, 2.5], 1),
      ...crossingWater(api, profiles),
      ...crew,
      ...(mass
        ? [
            solid('unit', [startX, deckTop + halfFoot, 0], [halfFoot, halfFoot, 0.12], mass, [
              speedX,
              0,
              0,
            ]),
          ]
        : []),
    ],
    anchors: ['abutment', 'far-bank', 'floor'],
    bonds: [{ a: 'abutment', b: 'deck', strength, restLength: bondLength }],
    settings: { dt, gravity: [0, -gravity, 0], restitution: 0, friction: 0 },
  });
}

export function twoUnitCrossingScene(api, profiles, x = -1.57) {
  const crew =
    x === null
      ? []
      : [
          crossingSolid(
            api,
            profiles,
            'engineer',
            [x, deckTop + 0.075, 0.26],
            [0.075, 0.075, 0.12],
            1,
          ),
        ];
  return movingCrossingScene(api, profiles, { mass: 10, strength: 135 }, 0, crew);
}
