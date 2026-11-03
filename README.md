# AUTOMATA

**Modular autonomous combat engineering sandbox.** You design the machine, you program its intelligence, and it fights on its own.

AUTOMATA is a browser-based 2D top-down game. Drones are assembled from three structural sections (front / middle / rear, each light, medium or heavy) on a wheeled or tracked chassis, with weapons, sensors, shields, power, cooling, ammunition and control units mounted in physical slots. Their behaviour is written as **blocks**, **nodes** or **code**. All three compile to the same sandboxed language and run against the same drone API. Combat is fully simulated: moving projectiles, armor penetration, component damage, joints and detachment, shields, power, heat and recoil.

## Quick start

```bash
npm ci
npm run dev          # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Typecheck + production build into `dist/` |
| `npm run typecheck` | Strict TypeScript check |
| `npm test` | Simulation, runtime, compiler and battle-control tests (Vitest) |
| `npm run test:e2e` | Browser integration tests (Playwright; builds and serves the app) |
| `npm run sim:headless -- <seed> <seconds> [assault-vs-aa\|skirm-vs-aa\|assault-vs-skirm]` | Run a duel headlessly and print the combat log |

## Deployment (GitHub Actions → GitHub Pages)

`.github/workflows/deploy.yml` runs on every push and pull request:

1. **test**: `npm ci`, `npm run typecheck`, `npm test`
2. **e2e**: installs Chromium, then runs `npm run test:e2e`. A failed run uploads its report.
3. **build**: `npm run build`, then uploads `dist/` as the Pages artifact
4. **deploy**: only on the default branch. Publishes the artifact with `actions/deploy-pages`.

**One-time setup:** in the repository go to *Settings → Pages → Build and deployment → Source* and choose **GitHub Actions**. The build uses relative asset paths (`base: './'`), so it works at `https://<owner>.github.io/<repo>/` with no per-repository configuration.

## Using the game

- **Hangar**: pick a chassis and a class for each section, set armor, click slots to mount equipment and rotate hardpoints. Firing arcs are drawn with self-obstructed parts in red. Mass, speed, power, cooling, ammunition and validation update live. Designs can be saved, imported and exported as JSON.
- **Programs**: create Block, Node or Code programs. The Build panel shows compile errors (click one to jump to it) and the API reference. Block and node programs can show their compiled AutoScript or be converted to a code program.
- **Battle**: choose Duel or Sandbox, assign a design and a program to each combatant, then Deploy. Play, Pause, Step tick, Step decision, Restart and Speed control the simulation. The default camera is a freecam. Click a drone to spectate it: you get follow, sensor cones, weapon arcs, and a *sensor view* that shows only what that drone perceives. The Inspector shows live structure, power, weapons, shields, components, contacts and the **decision trace**. Click a trace entry to see the exact code line, block or node, then choose *Show in editor*.

Examples included: **Assault Platform** (tracked; heavy front with two heavy cannons, medium middle with MGs and radar, light rear with point defense), run by the code program *Assault Doctrine*. **AA Destroyer** (wheeled; light front and rear with AA autocannons, heavy middle with a directional shield, radar and reactor), run by the block program *AA Orbit*. **Skirmisher**, run by the node program *Brawler*.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Programming API](docs/API.md)
- [Drone construction reference](docs/CONSTRUCTION.md)
- [Simulation & combat rules](docs/COMBAT_RULES.md)
- [Roadmap & milestone checklist](docs/ROADMAP.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
