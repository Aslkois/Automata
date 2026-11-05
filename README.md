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
   - Each section chooses a **hardpoint layout** next to its class:

     | Class | Maximum | Medium | Minimum |
     | --- | --- | --- | --- |
     | Light | 1 M + 1 S | 2 S | 3 S |
     | Medium | 1 L + 1 S | 3 M | 4 S |
     | Heavy | 2 L + 1 M | 1 L + 2 M | 3 M |

     Changing the layout previews where every part goes. Parts move to fitting slots; anything that would not fit is listed and you are asked first. Nothing is removed silently, and **Undo** (Ctrl+Z) restores the previous version.
   - There are no weight limits. Only a part that does not physically fit a mount is an error. Weight has continuous consequences instead:
     - Each chassis carries a rated load: wheeled ×1, tracked ×1.25, walking ×1.6, flying ×0.55.
     - Overloading a section costs traction, adds rolling resistance and running-gear wear, and on a flyer eats into lift and shared thrust.
     - Recoil above a mount's rating fatigues the mount and loads the joints.
   - **Mirror layout** in a section's properties reflects its hardpoints left/right. Each section is independent, parts keep their slots, and a second press undoes it.
   - Weapon cards say what ammunition they need and where it is stored, e.g. *Requires: Autocannon rounds (Medium) · Storage: Medium-Calibre Magazine*. Selecting a weapon marks the storage that feeds it; a weapon with no reserve gets a warning, never a block.
   - **Diagnostics** (the gauge button) shows mass and load per section, mobility, power, heat, ammunition endurance and recoil against each mount's rating, with the assumptions labelled.
   - The properties surface shows the part's model, power, mass, durability, mounting, facing, firing arc, mount stress and overheat time. It also has the part's own settings: fire mode, interceptor load, payload, braced joint. **Move…** relocates a part to another slot, swapping when both fit.
   - Every component has its own icon, and every hardpoint has its own top-down model. The same model appears on the stage, in the tray, in the inspector and on the battlefield. Open `?parts-sheet` to see all of them in every state.
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
   - Parts move only when the simulation makes them:
     - recoil on the barrel that fired;
     - rotary barrels at their real spin;
     - coilgun coils lit by the real charge;
     - launcher tubes that empty round by round and refill only when the reload completes.
   - Detached sections and wrecks stay physical for 2 s, then fade and are removed, leaving a scorch mark.
   - Pan with drag or WASD, zoom with the wheel or a pinch. The app pauses when it goes to the background.

**Examples** (eleven starters, one brain each):

| Drone | Level | Chassis | Build | Brain opens in |
| --- | --- | --- | --- | --- |
| Pathfinder | beginner | wheeled | LIDAR, machine gun; follows walls, solves the maze | Blocks |
| Assault Platform | intermediate | tracked | heavy cannons, MGs, radar, point defence | Code |
| AA Destroyer | intermediate | wheeled | autocannons, directional shield; circles its target | Blocks |
| Skirmisher | intermediate | wheeled | rotary cannon and shield; charges | Nodes |
| Strider | intermediate | walking | plants its feet at cannon range | Blocks |
| Wisp | intermediate | flying | light; strafes in orbit | Blocks |
| Mantis | intermediate | walking | two scatter cannons, spall liner; closes to point-blank range | Blocks |
| Harrier | intermediate | flying | rocket pod on a Maximum-layout light front; rocket runs, breaks away to reload | Nodes |
| Needle | advanced | wheeled | coilgun with capacitor and generator; shoots from a standstill | Code |
| Aegis | advanced | tracked | radar, two point-defense guns, compact and directional shields, dual autocannon | Nodes |
| Bastion | expert | tracked | twin heavy cannons, autoloader, spall liner, braced joint, fire suppression; angles its armor | Code |

**Training** (Simulate → Scenario → Course): basic maze, obstacle course, weapon range, armor test, interception test, missile test, and cooling and power stress. Each course has built-in targets and an objective: reach the goal, knock out every target, or survive.

**Sound** is off until you turn it on under **View**, where master, weapons and explosions, mechanical, environment and interface volumes are set and remembered. Every sound is synthesised in the browser; the game ships no recorded audio.

**Saved data:** libraries from earlier versions migrate automatically. Each design gets the program it was clearly paired with. Any other program is kept under **Program → Recovered**, and the original data is backed up in `localStorage` as `automata.library.v1-backup`.

When you load a design, it is migrated to schema 5:
- the AA Autocannon becomes the Autocannon;
- designs from before layouts existed get the layout that matches their old slots: light → Medium, medium → Medium, heavy → Maximum;
- schema 3 layouts map to the new table: medium Minimum → Medium, heavy Medium → Maximum, heavy Minimum → Medium;
- every section starts unmirrored;
- configuration fields are validated.

The six new example drones are added to an existing library once. Drones you made or edited are never replaced, and a deleted example is not brought back.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Programming API](docs/API.md)
- [Drone construction reference](docs/CONSTRUCTION.md)
- [Simulation & combat rules](docs/COMBAT_RULES.md)
- [Weapons and ammunition](docs/WEAPONS.md)
- [Balance measurements and findings](docs/BALANCE.md) — regenerate with `npm run balance`
- [Roadmap & milestone checklist](docs/ROADMAP.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Interface design](docs/DESIGN.md)
