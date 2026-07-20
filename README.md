# template-phaser

Template for browser-only 2D grid aerial-view games built with [Phaser 4](https://phaser.io/).
Fully offline: no backend, no API calls, no downloaded assets — all textures are generated
procedurally at boot. Toolchain is [Bun](https://bun.com) (runtime, dev server, bundler,
unit tests), TypeScript, Biome, and Playwright.

The demo game renders a procedurally generated terrain grid with a movable cursor tile,
pan/zoom camera controls, and publishes game state on `window` so tests and browser-driving
agents can observe it.

## Getting started

```bash
bun install
bun run dev        # dev server with HMR at http://localhost:3000
```

First time running browser tests, install the Playwright browser once:

```bash
bunx playwright install chromium
```

## Scripts

| Command              | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `bun run dev`        | Dev server with hot reload (Bun native HTML server)      |
| `bun run start`      | Dev server without HMR                                   |
| `bun run build`      | Production bundle to `dist/`                             |
| `bun run typecheck`  | `tsc --noEmit`                                           |
| `bun run lint`       | Biome lint + format check                                |
| `bun run format`     | Biome auto-fix (format, lint fixes, import order)        |
| `bun run test`       | Unit + functional tests (`bun:test`, no DOM required)    |
| `bun run test:e2e`   | Playwright e2e tests against a real Chromium             |
| `bun run test:agent` | Agent browser-automation probe (Playwright as a library) |
| `bun run check`      | typecheck + lint + test                                  |

## Controls (demo game)

- Arrow keys — move the cursor tile (clamped to the map)
- WASD or mouse drag — pan the camera
- Mouse wheel — zoom

## Project layout

```
index.html              Bun HTML entry point
src/
  main.ts               Game bootstrap
  config.ts             Phaser game config (scenes, scale, parent)
  state.ts              Publishes game state on window.__gameState (test/agent hook)
  grid/                 Pure grid logic — no Phaser/DOM imports, unit-testable
    Grid.ts             Fixed-size 2D cell container
    coords.ts           Tile <-> world coordinate conversions (TILE_SIZE)
    rng.ts              Seeded deterministic PRNG (mulberry32)
  world/
    terrain.ts          Seeded terrain generation + cellular smoothing
  scenes/
    BootScene.ts        Procedural texture generation, then starts GameScene
    GameScene.ts        Tilemap rendering, cursor, camera controls
tests/
  unit/                 bun:test — pure logic (grid, coords, rng)
  functional/           bun:test — multi-unit behaviour (terrain generation)
  e2e/                  @playwright/test — real browser (boot, input, screenshot)
  agent/
    probe.ts            Agent-runnable Playwright script; extend it for exploration
    artifacts/          Probe output (screenshot + JSON report), git-ignored
```

## Testing discipline

- **Unit/functional (`bun:test`)** run without a DOM, so they may only import pure-logic
  modules (`src/grid`, `src/world`). Importing `phaser` under Bun throws — anything
  DOM-dependent belongs in e2e instead.
- **E2E (`@playwright/test`)** boots the real game in Chromium. `playwright.config.ts`
  starts the Bun dev server automatically. A visual-baseline screenshot lives in
  `tests/e2e/game.spec.ts-snapshots/`; regenerate it deliberately with
  `bunx playwright test --update-snapshots` after intentional rendering changes.
- **Agent automation** uses Playwright as a library (`tests/agent/probe.ts`), not the test
  runner, so an agent can run/extend it freely. It writes a JSON report and screenshot to
  `tests/agent/artifacts/` and exits non-zero on failure.

## Test/agent hook: `window.__gameState`

The game publishes a snapshot on `window` (see `src/state.ts`):

```ts
window.__game       // the Phaser.Game instance
window.__gameState  // { ready, scene, cursor: {x, y}, mapSize: {width, height} }
```

E2e tests and agent scripts use this to observe the game; when you add game features,
extend `GameStateSnapshot` and call `publishState(...)` from your scenes.
