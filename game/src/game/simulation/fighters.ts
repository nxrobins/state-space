import { MaterialType } from './constants';
import { FIGHTER_MOVES } from './moves';
import type { FighterSpec, FighterSpecId } from './types';

export const FIGHTER_SPECS: Record<FighterSpecId, FighterSpec> = {
  water: {
    id: 'water',
    name: 'Tide Warden',
    element: 'water',
    styleName: 'Flow Control',
    difficulty: 'Balanced',
    summary: 'Controls lanes with water lash, ice footing, and steam lift. Strong when the arena is wet.',
    portraitUrl: '/assets/fighters/water/portrait.png',
    color: 0x2f80ed,
    accentColor: 0x9ee7ff,
    spawn: { x: 310, y: 560 },
    width: 34,
    height: 58,
    moveSpeed: 4.2,
    jumpVelocity: -15.2,
    dashVelocity: 10.5,
    moves: FIGHTER_MOVES.water,
  },
  earth: {
    id: 'earth',
    name: 'Stone Breaker',
    element: 'earth',
    styleName: 'Arena Lockdown',
    difficulty: 'Deliberate',
    summary: 'Builds walls, creates footing, and wins space with heavy knockback. Slower, harder to move.',
    portraitUrl: '/assets/fighters/earth/portrait.png',
    color: 0xb8955a,
    accentColor: 0xe2c66f,
    spawn: { x: 970, y: 560 },
    width: 38,
    height: 62,
    moveSpeed: 3.7,
    jumpVelocity: -14.4,
    dashVelocity: 9.3,
    moves: FIGHTER_MOVES.earth,
  },
  fire: {
    id: 'fire',
    name: 'Ember Striker',
    element: 'fire',
    styleName: 'Burst Rushdown',
    difficulty: 'Volatile',
    summary: 'Turns openings into pressure with flame lanes, smoke cover, and lava traps. Fast but risky.',
    portraitUrl: '/assets/fighters/fire/portrait.png',
    color: 0xff5a1f,
    accentColor: 0xffd166,
    spawn: { x: 970, y: 560 },
    width: 34,
    height: 58,
    moveSpeed: 4.5,
    jumpVelocity: -15,
    dashVelocity: 11.2,
    moves: FIGHTER_MOVES.fire,
  },
};

export const BOOST_MATERIALS: Record<FighterSpecId, Set<MaterialType>> = {
  water: new Set([MaterialType.Water, MaterialType.Ice, MaterialType.Steam]),
  earth: new Set([MaterialType.Stone, MaterialType.Sand, MaterialType.Metal, MaterialType.Glass]),
  fire: new Set([MaterialType.Fire, MaterialType.Lava, MaterialType.Smoke]),
};

export function cpuOpponentFor(playerSpec: FighterSpecId): FighterSpecId {
  if (playerSpec === 'water') return 'earth';
  if (playerSpec === 'earth') return 'fire';
  return 'water';
}
