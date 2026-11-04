# AUTOMATA

**Modular autonomous combat engineering sandbox.** You design the machine, you program its intelligence, and it fights on its own.

AUTOMATA is a browser-based 2D top-down game for desktop, tablet and phone. A drone is three structural sections (front / middle / rear, each light, medium or heavy) on a **wheeled, tracked, walking or flying** chassis. Every chassis carries its own propulsion, autonomous CPU, power core, coolant loop and proximity sensors, so a new drone is already a working machine. You add weapons, shields, sensors and optional power, cooling and ammunition in physical slots.

Each drone has **one brain**: a single program you can edit as **Blocks**, **Nodes** or **Code**. These are three views of the same program, not three programs. Combat is fully simulated: moving projectiles, armor penetration, component damage, joints and detachment, shields, power, heat and recoil.

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
| `npm test` | Simulation, runtime, brain (one program, three views), migration and battle-control tests (Vitest) |
| `npm run test:e2e` | Browser integration tests (Playwright; builds and serves the app) |
| `npm run sim:headless -- <seed> <seconds> [assault-vs-aa\|skirm-vs-aa\|assault-vs-skirm]` | Run a duel headlessly and print the combat log |

## Deployment (GitHub Actions → GitHub Pages)

`.github/workflows/deploy.yml` runs on every push and pull request:

1. **test**: `npm ci`, `npm run typecheck`, `npm test`
2. **e2e**: installs Chromium, then runs `npm run test:e2e`. A failed run uploads its report.
3. **build**: `npm run build`, then uploads `dist/` as the Pages artifact
4. **deploy**: only on the default branch. Publishes the artifact with `actions/deploy-pages`.

**One-time setup:** in the repository go to *Settings → Pages → Build and deployment → Source* and choose **GitHub Actions**. The build uses relative asset paths (`base: './'`), so it works at `https://<owner>.github.io/<Repo>/ (the live site is https://aslkois.github.io/Automata/ — the path is case-sensitive)` with no per-repository configuration.

## Using the game

1. **Construct**:
   - Choose a chassis, then set each section's class and armour on the assembly strip.
   - To install equipment, select a slot on the drone and pick a part from the equipment tray. You can also pick a part first and then tap a highlighted slot, or drag it onto the drone.
   - The properties surface shows power, mass, durability, mounting, facing and firing arc.
   - A new drone starts with two machine guns, a magazine and a camera.
2. **Program**:
   - Choose **Blocks**, **Nodes** or **Code** at the top. Switching shows the same brain another way; it never creates another program.
   - **Insert** (searchable, with the most common actions first) adds steps in any view. **Reference** documents the drone API.
   - **Debug** shows the live decision trace and variable values of the drone on the battlefield. Entries jump to the logic that produced them.
   - Anything a visual editor can't draw appears there as an editable **code module** that runs unchanged.
   - Edits that don't convert yet are kept as a draft; the drone keeps running the last complete brain.
3. **Simulate**:
   - The battlefield fills the screen. Use the transport to play, pause, step a tick or a decision, change speed and restart.
   - The Scenario sheet picks the drones. **Test** in Construct or Program deploys the current drone immediately.
   - Selecting a drone (on the field or from the list) opens its spectator card: integrity, weapons, power and heat, sensors, components, the current action and the decision trace. Close it to return to freecam.
   - Pan with drag or WASD, zoom with the wheel or a pinch. The app pauses when it goes to the background.

**Examples:**

| Drone | Chassis | Build | Brain opens in |
| --- | --- | --- | --- |
| Assault Platform | tracked | heavy cannons, MGs, radar, point defence | Code |
| AA Destroyer | wheeled | AA autocannons, directional shield; circles its target | Blocks |
| Skirmisher | wheeled | rotary cannon and shield; charges | Nodes |
| Strider | walking | plants its feet at cannon range | Blocks |
| Wisp | flying | light; strafes in orbit | Blocks |

**Saved data:** libraries from earlier versions migrate automatically. Each design gets the program it was clearly paired with. Any other program is kept under **Program → Recovered**, and the original data is backed up in `localStorage` as `automata.library.v1-backup`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Programming API](docs/API.md)
- [Drone construction reference](docs/CONSTRUCTION.md)
- [Simulation & combat rules](docs/COMBAT_RULES.md)
- [Roadmap & milestone checklist](docs/ROADMAP.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Interface design](docs/DESIGN.md)
