# Box Rooms

A top-down zombie survival shooter that runs in the browser. You move in 8 directions and shoot where you walk. Play solo or with 2 players on one keyboard or gamepads.

## Modes

| Mode | What it is |
| --- | --- |
| **Expedition** | 8 dark, hand-made maps (warehouse, suburb, hospital, sewers, mall, military base, lab, city). Find the objective items, then get everyone to the extraction pad while hordes come in. Clearing a map unlocks the next. You earn up to 3 stars per map based on your time against par. |
| **Survival** | Endless waves in 14 arenas. An Abomination boss arrives every 5th wave. |
| **Outbreak** | Maps generated from a seed: rooms and corridors, or outdoor areas with houses and trees. There's a daily challenge, random rerolls, and a seed you can type in to share a map. |

## Zombie AI

- **Perception:** zombies see in a cone and need line of sight. Darkness shortens how far they see, and players who are firing are easier to spot. Gunfire, explosions and broken barricades make noise, and walls muffle it.
- **States:** idle, wander, investigate (go to a noise), chase, and search (lose track of you, then hunt around where they last saw you). Crawlers start dormant.
- **Group behaviour:** a zombie that spots you groans and alerts others nearby, so whole packs can wake up. Chasers spread out and flank to surround you. Screamers alert and enrage everything in range.
- **Navigation:** a flow field toward the players is shared by the whole horde, and A* handles wandering and investigating. Zombies smash through wooden barricades when that route is much shorter.
- **Types:** Walker, Runner (lunges), Crawler (plays dead, then ambushes), Brute (telegraphed charge that stuns it if it hits a wall), Spitter (keeps its distance and lobs acid that leaves pools), Bloater (swells and bursts, which also damages zombies), Screamer, Devil (fireballs you can shoot down) and the Abomination boss (slam, charge, acid volley, summon, and an enraged second phase).

## Controls

|  | Player 1 | Player 2 |
| --- | --- | --- |
| Move | WASD | Arrows |
| Fire / place | Space (or mouse in mouse-aim mode) | Enter / Right Ctrl |
| Shove | F / Left Shift / right mouse button | `/` / Right Shift |
| Weapons | Q / E, 1–9, mouse wheel | `,` / `.` / Numpad |
| Pause | Esc / P | |

- **Gamepads:** left stick moves, right stick aims, RT or A fires, X or B shoves, LB/RB switch weapons, Start pauses.
- **Touch:** controls appear automatically on phones.
- **Aiming:** you can switch from classic aiming to twin-stick mouse aiming in Settings.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # map validation, generator, pathfinding tests
npm run build    # type-check + production build to dist/
```

The game is plain TypeScript with Canvas 2D and Vite. It has no runtime dependencies, and all sound is generated with Web Audio.

```
src/
  main.ts        screens, HUD, game loop
  game.ts        simulation: players, weapons, projectiles, directors (waves / hordes / extraction)
  ai.ts          zombie perception, state machine, steering, special abilities
  world.ts       tile grid, collision, line of sight, flow field, A*
  vision.ts      visibility polygons for fog of war
  render.ts      renderer (y-sorted pseudo-3D, fog, minimap, telegraphs)
  zombies.ts     zombie stat definitions
  weapons.ts     weapons + score-based upgrade track
  audio.ts       procedural SFX, positional groans, adaptive ambient music
  maps/          map format, arenas, expeditions, procedural generator, themes
```

### Adding a map

Maps are ASCII grids. The legend is documented in `src/maps/types.ts`. Add a `MapDef` to `src/maps/arenas.ts` or `src/maps/expeditions.ts`, then run `npm test`. The validator checks borders, reachability, doors and objectives.
