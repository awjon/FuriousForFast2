# Furious For Fast 2

A minimalist Three.js arcade racer — **Need For Speed Underground 2**'s wet neon
streets and garage customisation, crossed with **Hot Pursuit**'s escalating
police chases.

No physics engine, no 3D model files, no UI framework. Cars and city are built
from primitives and shaders.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

Requires Node 20.19+ (or 22.12+) and a browser with WebGL2.

| Script | |
| --- | --- |
| `npm run dev` | dev server with hot reload |
| `npm run build` | production bundle into `dist/` |
| `npm run preview` | serve the built bundle |
| `npm run lint` | eslint |
| `npm run format` | prettier |

## Controls

| | |
| --- | --- |
| `W` / `S` or `↑` / `↓` | throttle / brake |
| `A` / `D` or `←` / `→` | steer |
| `Space` | handbrake — this is how you start a drift |
| `Shift` | nitrous (earned by drifting) |
| `B` | look back |
| `G` | garage |
| `R` | reset to the track |
| `Esc` | pause |

A gamepad is picked up automatically: left stick steers, triggers are throttle
and brake, A/cross is the handbrake, B/circle is nitrous.

Debug flags are URL parameters — `?debug`, `?stats`, `?vectors`, `?spline`,
`?freecam`, `?nofx`. They combine: `localhost:5173/?debug&spline`.

## Status

Phase 0 (scaffold) is complete and runnable: it boots, renders a neon grid and a
placeholder chassis, and the upgrade, save, input and loop systems work. Physics,
track generation, the police chase, HUD and garage are documented API stubs
awaiting implementation.

See **[CLAUDE.md](./CLAUDE.md)** for the architecture, the per-module contracts,
the phased implementation plan and the tuning notes.

## Layout

```
index.html          canvas + DOM UI layer
src/main.js         entry point
src/Config.js       every tuning constant; imports nothing
src/core/           Game (composition root), Loop, Input
src/physics/        Physics — arcade car dynamics
src/world/          Track, Environment
src/entities/       Car, Police
src/systems/        UpgradeSystem, HeatSystem, SaveSystem
src/render/         Renderer, CameraRig, PostFX, NeonGrid
src/ui/             HUD, Garage, styles.css
src/utils/          MathUtils, Random (seeded — worldgen is deterministic)
```
