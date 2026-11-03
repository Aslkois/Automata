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

**One-time setup:** in the repository go to *Settings → Pages → Build and deployment → Source* and choose **GitHub Actions**. The build uses relative asset paths (`base: './'`), so it works at `https://<owner>.github.io/<Repo>/ (the live site is https://aslkois.github.io/Automata/ — the path is case-sensitive)` with no per-repository configuration.

## Using the game

The interface is a workbench in the spirit of SPLICE: ink panels around a cutting-mat work surface, warm-white controls, and colour that always means something.

| Colour | Hardware (Hangar) | Programming (blocks, nodes, API) |
| --- | --- | --- |
| Pink | Weapons | Weapons |
| Teal | Sensors | Sensors |
| Violet | Shields | Logic & flow |
| Yellow | Power | Math & data constants; selected/active state |
| Cobalt | Propulsion | Movement |
| Sky | Thermal | Systems |
| Orange | Ammunition | Events |

Node wires are coloured by type: white = execution, yellow = number, teal = boolean, sky = contact, orange = string.

- **Hangar**: the left panel holds your designs and a categorised, searchable equipment library. Click a part to arm it (compatible slots light up), then click a slot, or drag the part onto a slot. The large central schematic shows sections, slots, turret facings, armor and firing arcs (red = blocked by a taller own section). Click a section, use the section rail, or click a slot to edit it in the inspector on the right. The inspector has three tabs: Selection, Performance and Checks. Construction problems also float over the canvas; click one to jump to the cause.
- **Programs**: the left panel holds the program library plus a palette for the current mode. Node programs get the node parts, code programs get API calls you can click to insert, and block programs get the colour key; the block toolbox itself sits inside the editor. The large centre editor shows blocks, a node graph or code. Block and node programs can switch to a read-only AutoScript view or be converted to code. The resizable inspector on the right shows build status (click an error to jump to it) and the API reference.
- **Battle**: a compact toolbar holds Play, Step tick, Step decision, Restart, the speed control, the clock, effects, sound and panel toggles. The battlefield takes the rest of the screen. Roster/Scenario (left), Debugger (right, resizable) and the event Timeline (bottom) are all collapsible. Click a drone to spectate it: the overlay offers Follow, Sensor view, Sensor cones, Weapon arcs, Freecam and Fit arena. The debugger shows live state, components, sensor contacts and the **decision trace**; click a trace entry to see the exact code line, block or node, then choose *Show in editor*.

Examples included: **Assault Platform** (tracked; heavy front with two heavy cannons, medium middle with MGs and radar, light rear with point defense), run by the code program *Assault Doctrine*. **AA Destroyer** (wheeled; light front and rear with AA autocannons, heavy middle with a directional shield, radar and reactor), run by the block program *AA Orbit*. **Skirmisher**, run by the node program *Brawler*.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Programming API](docs/API.md)
- [Drone construction reference](docs/CONSTRUCTION.md)
- [Simulation & combat rules](docs/COMBAT_RULES.md)
- [Roadmap & milestone checklist](docs/ROADMAP.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
