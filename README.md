# SCRAPLANDS

A 3D open-world vehicle-building action RPG that runs in the browser. You play as a scavenger engineer in the Kessler Basin, a post-collapse desert. You build machines from individual functional parts, fight other machines, cut the good parts out of the wrecks and bring them home to build something better.

It has one persistent save and no permadeath. Every machine and part you own is kept.

```bash
npm install
npm run dev        # http://localhost:5173
```

## Controls

| Input | Action |
| --- | --- |
| W A S D | Drive / fly / walk |
| Mouse | Aim (turrets follow the crosshair) |
| LMB / RMB / MMB | Fire weapon groups 1 / 2 / 3 |
| Space | Handbrake · climb · jump jets |
| C / Ctrl | Descend (aircraft) |
| Shift | Boost · run |
| E | Interact · salvage · enter the workshop |
| Tab (hold) | Scan a target's components |
| F | Headlights |
| R (hold) | Self-right a flipped machine |
| M / J / Esc | Map · contracts · pause |

In the workshop:

- LMB selects a part; Del removes it.
- R / T rotate and tilt; the arrow keys slide a part along its mount.
- Ctrl+Z undoes; RMB orbits the camera and MMB pans it.

## What is in the game

**Three machine classes.** Ground vehicles, aircraft and walking mechs are all valid endgame choices. None of them is a later "tier" than the others.

- **Ground vehicles** use raycast suspension, slip-curve tyres, torque curves and gearboxes.
- **Aircraft** only fly if the parts allow it. Each rotor and jet is a thruster at its real position. A thrust allocator balances them against mass and centre of mass, so a lopsided build flies lopsided and losing a rotor sends you spinning.
- **Mechs** walk on legs that plant feet with two-bone IK against the terrain. Joint strength, hydraulics and power decide what they can carry. A broken knee makes a mech limp.

**Parts are the game.**

- There are over 150 parts across 32 categories, from frames and engines to weapons, rotors, legs and armour.
- Rarities run Common, Uncommon, Rare, Epic, Legendary, Exotic.
- Parts have real mass, power draw, heat, fuel use, torque, grip, thrust, lift, damage and armour. The machine's stats are computed from those numbers, never from a level.
- The workshop builder lets you add, remove, move, rotate, tilt, mirror, replace, paint, rename, save and repair.
- An engineering report flags builds that can't work, such as a machine that is too heavy to lift, legs that are overloaded or a power grid that is too small.

**Damage is per part.**

- Every part has its own hit volume, HP and armour.
- Damage shows on the mesh, and broken parts detach and fall off.
- The consequences are physical: a flat tyre wrecks handling, a broken spring makes the machine lean, a dead engine gives no power, a holed fuel tank leaks and burns, a broken knee makes a mech limp and a lost rotor means loss of control.

**Salvage.**

- Every part you see on an enemy machine is a real part, and you can cut it off once the machine is down. A part that is destroyed in the fight is gone.
- Your cargo capacity limits what you can carry home. Wrecks can also be stripped for raw resources.

**Getting parts.** There are four routes:

- **Salvage** from wrecks.
- **Research**, which unlocks part families rather than percentage bonuses.
- **Blueprints**, from contracts, traders and hidden sites.
- **Traders** at Rustwater and Dust Hollow. Their stock rotates daily, and prices improve with reputation.

**The world.** One hand-laid region, about 2 km across:

- The scrapyard home base, open desert and dunes, and the Route 9 highway.
- The Foundry factory, the Red Canyons and the Pit quarry.
- Fort Kessler, a military site, and two trading settlements.
- Hidden sites, including a crashed gunship and a Helix relay.
- Day and night, and weather: haze, overcast, dust and lightning storms.

**Factions.** Scrappers, the Iron Authority, Helix Industries and the Independents. Each builds enemies from the same parts catalogue in its own style.

**Contracts.**

- A story chain ends at **the Excavator**, a 12-tonne four-legged mining walker. You can target its mega-joints, bucket wheel and reactor, and salvage its unique parts.
- A daily job board offers bounties, salvage runs, deliveries, races, defence, captures and rescues.

## Project layout

```
src/
  core/       game loop, input, camera, events, math, noise
  render/     renderer + post (bloom, grade), sky, environment, particles, textures
  physics/    Rapier world, collision groups
  world/      heightfield, terrain LOD + shader, layout, props, debris
  machines/   part types, catalogue, procedural meshes, layout, stats, runtime, controllers
  combat/     weapons, projectiles, damage model
  ai/         enemy design generator, pilots
  gameplay/   profile/save, economy, research, salvage, director, missions, boss
  garage/     3D workshop environment and builder
  ui/         HUD, menus, garage UI, map, merchant, journal, salvage
  audio/      procedural WebAudio engine (no audio files)
```

All art and audio is procedural. Meshes are built in code by `machines/parts/kit.ts`, textures are generated noise, and sounds are synthesised at runtime.

## Testing

```bash
npm run typecheck
npm test          # vitest: catalogue, stats, enemy generator, boss design, physics heightfield
npm run e2e       # headless Chromium: progression loop, boss fight, app screens
```

- `npm run e2e` starts its own Vite server. It drives the real game through the build → fight → salvage → workshop loop, the Excavator fight and every screen, then asserts on the results.
- `http://localhost:5173/?debug` opens a sandbox with a starter machine and a scripting API (`window.__api`).
- `scripts/harness.mjs <script> <prefix>` runs a script from `scripts/t/` against the sandbox and saves screenshots.
