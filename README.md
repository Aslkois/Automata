# AUTOMATA

**Modular autonomous combat engineering sandbox.** You design the machine, you program its intelligence, and it fights on its own.

AUTOMATA is a browser-based 2D top-down game for desktop, tablet and phone. A drone is three structural sections (front / middle / rear, each light, medium or heavy) on a **wheeled, tracked, walking or flying** chassis. Every chassis carries its own propulsion, autonomous CPU, power core, coolant loop and proximity sensors, so a new drone is already a working machine. You add weapons, shields, sensors and optional power, cooling and ammunition in physical slots.

Each drone has **one brain**: a single program you can make with **Configure** (choose tactics; the program is written for the drone’s hardware) or edit as **Blocks**, **Nodes** or **Code**. These are four ways into the same program, not four programs. Combat is fully simulated: moving projectiles, armor penetration, component damage, joints and detachment, shields, power, heat and recoil.

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
| `npm test` | Simulation, runtime, brain (one program, four editors), Configure, roster, migration and battle-control tests (Vitest) |
| `npm run test:e2e` | Browser integration tests (Playwright; builds and serves the app) |
| `npm run sim:headless -- <seed> <seconds> [rapier-vs-kestrel]` | Run a duel between two starters headlessly and print the combat log |
| `npx vite-node scripts/evaluate.ts` | Re-measure the roster and Configure (writes docs/EVALUATION.md; `--quick` for a smoke run) |

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
   - **Mirror layout** in a section's properties flips its hardpoint arrangement left to right across the section's own centreline. Each section is independent, parts keep their slots and facing, and a second press undoes it.
   - Ammunition has calibre names: a weapon card reads *Ammo: 25×137mm*, and its properties name the storage (a Medium-Calibre Magazine). A weapon with no reserve gets a warning, never a block.
   - **Diagnostics** (the gauge button) shows mass and load per section, mobility, power, heat, ammunition endurance and recoil against each mount's rating, with the assumptions labelled.
   - The properties surface shows the part's model, power, mass, durability, mounting, facing, firing arc, mount stress and overheat time. It also has the part's own settings: fire mode, interceptor load, payload, braced joint. **Move…** relocates a part to another slot, swapping when both fit.
   - Every component has its own icon, and every hardpoint has its own top-down model. The same model appears on the stage, in the tray, in the inspector and on the battlefield. Open `?parts-sheet` to see all of them in every state.
   - A new drone starts with two machine guns, a magazine and a camera.
2. **Program**:
   - Choose **Configure**, **Blocks**, **Nodes** or **Code** at the top. Switching shows the same brain another way; it never creates another program.
   - **Configure**: pick a doctrine (Aggressive, Balanced, Defensive, Precision, Harassment, Interception, Area Control, Adaptive), an engagement distance, target selection, defensive behaviour and movement; expand **Advanced** for engagement, weapons, target weights, resources, defensive reactions and adaptation. The hardware panel says what was found on the drone and what the brain will do with it, and the program preview shows the AutoScript it writes. Edit the result in any other editor and Configure marks it *customised* and never overwrites it unless you ask (keeping your version under Recovered). See [docs/CONFIGURE.md](docs/CONFIGURE.md).
   - **Insert** (searchable, with the most common actions first) adds steps in any view. **Reference** documents the drone API.
   - **Debug** shows the live decision trace, the brain’s current state (Searching, Engaging, Reloading, Intercepting…) and variable values of the drone on the battlefield. Entries jump to the logic that produced them.
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

**Starters** (sixteen drones, each with its own hand-written brain, in five tiers — Beginner, Intermediate, Advanced, Expert and **Boss**; full write-ups in [docs/STARTERS.md](docs/STARTERS.md), measured results in [docs/EVALUATION.md](docs/EVALUATION.md)):

| Drone | Level | Chassis | Role | Brain opens in |
| --- | --- | --- | --- | --- |
| Picket | beginner | wheeled | two autocannons; keeps a steady distance | Blocks |
| Gnat | beginner | flying | two autocannons; circles and jinks | Blocks |
| Bulldog | beginner | tracked | two scatter cannons behind 60 mm of plate; each weapon fires inside its own range | Nodes |
| Hornet | intermediate | flying | rocket pod and tail gun; attack / break / return state machine with memory | Nodes |
| Rapier | intermediate | wheeled | dual autocannon duelist; always nose-on, range by target size, backs out to reload | Blocks |
| Kestrel | intermediate | wheeled | quad MG and autocannon with radar; hunts the fastest target, fires in bursts | Code |
| Citadel | intermediate | walking | guns facing four ways; holds the centre, each weapon picks its own target | Blocks |
| Longbow | advanced | walking | coilgun marksman; braces, settles, fires on an exact aim, ambushes where a target reappears | Code |
| Mauler | advanced | tracked | heavy cannon; aims at the rear section, fires from a still hull, shuffles between shots | Code |
| Jackal | advanced | wheeled | autocannon and scatter cannons with LIDAR; closes on a weave, finishes from behind | Code |
| Talon | advanced | wheeled | guided missiles; launches from radar range, relocates during the reload | Code |
| Warden | advanced | tracked | point defense and interceptors; triages incoming rounds and traces them to the shooter | Nodes |
| Viper | advanced | wheeled | rotary cannon flanker; reads the target’s heading and arcs round to its rear | Code |
| Paragon | expert | wheeled | generalist with memory, utility-scored tactics and explained decisions | Code |
| Juggernaut | expert | walking | twin heavy cannons, shield, reactor; manages joints, heat, fire and power | Code |
| **Sovereign** | **boss** | tracked | the final examination: four heavy cannons, 70 mm all round, shield, point defense, interceptors; a nine-system brain with threat analysis, memory, adaptive doctrine and explained decisions. Not balanced — built to dominate, within the same rules as every drone | Code |

**Training** (Simulate → Scenario → Course): basic maze, obstacle course, weapon range, armor test, interception test, missile test, and cooling and power stress. Each course has built-in targets and an objective: reach the goal, knock out every target, or survive.

**Sound** is off until you turn it on under **View**, where master, weapons and explosions, mechanical, environment and interface volumes are set and remembered. Every sound is synthesised in the browser; the game ships no recorded audio.

**Saved data:** libraries from earlier versions migrate automatically. Each design gets the program it was clearly paired with. Any other program is kept under **Program → Recovered**, and the original data is backed up in `localStorage` as `automata.library.v1-backup`.

When you load a design, it is migrated to schema 7:
- the AA Autocannon becomes the Autocannon;
- designs from before layouts existed get the layout that matches their old slots: light → Medium, medium → Medium, heavy → Maximum;
- schema 3 layouts map to the new table: medium Minimum → Medium, heavy Medium → Maximum, heavy Minimum → Medium;
- every section starts unmirrored (mirrors saved by the previous two versions are converted or undone);
- configuration fields are validated.

**The starter roster was replaced.** A library that still holds the old eleven examples exactly as shipped has them retired on load; their programs stay available under **Program → Recovered**, and the whole library is backed up first as `automata.library.before-roster-3`. An old example you changed in any way stays in your library as your own drone. Your own drones, duplicates and imports are never touched. The new starters are added once, and a deleted starter is not brought back. Sovereign joins an existing fifteen-starter library the same way: added once, nothing else touched. **Restore examples** brings back the current starters.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Programming API](docs/API.md)
- [Configure](docs/CONFIGURE.md)
- [Starter drones](docs/STARTERS.md)
- [Roster and Configure evaluation](docs/EVALUATION.md)
- [Drone construction reference](docs/CONSTRUCTION.md)
- [Simulation & combat rules](docs/COMBAT_RULES.md)
- [Weapons and ammunition](docs/WEAPONS.md)
- [Balance measurements and findings](docs/BALANCE.md) — regenerate with `npm run balance`
- [Roadmap & milestone checklist](docs/ROADMAP.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
- [Interface design](docs/DESIGN.md)
