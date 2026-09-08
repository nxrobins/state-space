# Relic Line

Relic Line is a dedicated Phaser/Vite tower-defense roguelite prototype inside the `state-space` repo. It is intentionally separate from the existing `game/` fighter prototype and the older `web/` sandbox.

## Run

```powershell
npm install
npm run assets
npm run dev
```

The Vite dev server uses `http://127.0.0.1:5174`.

## Build And Test

```powershell
npm test
npm run build
```

## Game Shape

- Tower defense: build towers on pads, start waves, protect the relay core.
- Roguelite run structure: earn reward choices after each wave, then choose a route node that changes next-wave pressure and rewards.
- Deck building: every run has draw, hand, discard, card rewards, field cards, command cards, economy cards, and persistent card unlocks.
- State-space terrain: cards and maps paint water, oil, fire, ice, sand, smoke, glass, metal, and lava into the imported browser physics field.
- Starting terrains: each map rolls a seeded terrain heuristic such as Brook Braids, Smoke Fen, Frost Mirror, Slag Lattice, or Dustglass Steppe, then generates extra constrained pockets around path, pads, and core.
- Relics and charge: run relics change economy, damage, energy, route options, field reactions, and charge-to-scrap conversion.
- Heroes: autonomous recruitable units attack, defend, or support; command cards steer them and hero powerups alter their behavior.
- Core axes: persistent Fieldcraft, Engineering, Command, and Archive ranks grow from different play styles and feed back into later runs.
- Axis directives: each run rolls visible objectives for all four Core Axes with in-run rewards such as charge, scrap, relay life, and relic scouting.
- Axis surges: completed directives now arm one tactical surge for that axis; the next matching card costs 0 and gains an axis-specific bonus.
- Axis masteries: completed directives can add branch choices to reward drafts, letting a run specialize terrain reactions, tower engineering, hero command, or route/reward scouting.
- Axis momentum: using an axis during a run builds a 0-6 momentum meter that feeds back into that axis through wider terrain, stronger towers, faster heroes, deeper drafts, and richer routes.
- Axis breakthroughs: each axis now has three in-run tiers at 2/4/6 momentum with stronger terrain, tower, hero, route, reward, and technique effects.
- Axis keystones: breakthrough tier 2 can draft run-defining branch upgrades for field reactions, tower automation, hero command, or archive drafting.
- Axis resonance: paired breakthrough tier 2 axes unlock cross-axis synergies such as elemental machinery, war rigs, terrain indexing, and strategic planning.
- Axis techniques: momentum can now be spent on active Fieldcraft, Engineering, Command, and Archive plays for emergency terrain reactions, fabrication, hero rallies, or deck reindexing.
- Axis trials: route choices can carry axis-themed pressure modifiers that alter the next wave and pay momentum, surge, and resource rewards when cleared.
- Core Axis protocols: persistent axis ranks 2/4/6 now unlock protocol tiers that give Fieldcraft reaction pulses, Engineering auto-assembly shots, Command veteran musters, Archive deeper planning and reward drafts, and protocol infusion reward choices.
- Axis focus: each planning phase can arm a Fieldcraft, Engineering, Command, or Archive focus for a wave-start bonus that also gives the difficulty director extra pressure.
- Difficulty director: wave starts now read player power and route/trial pressure, then spend enemy budgets on affixes, miniboss variants, multi-pack synergies, and adaptive bonus packs.
- Persistent profile: cards, relics, heroes, map choices, core axes, wins, best wave, and memory shards survive through local storage.
- Sprite pipeline: `scripts/generate_sprites.py` creates shaded fixed-frame PNG sprite strips, terrain/object icons, and a preview sheet under `public/assets/sprites/`.
- Combat presentation: Phaser layers add path atmosphere, pad/core glow, soft unit shadows, projectile trails, enemy health bars, affix pips, and miniboss rings.
