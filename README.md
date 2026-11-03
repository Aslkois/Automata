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

The interface is presented as **the Machine Archive**: an operating system left behind by the makers of autonomous machines. It is almost monochrome, built from parchment and ivory records, graphite instruments, and one muted rust reserved for faults and damage. See [docs/DESIGN.md](docs/DESIGN.md) for the design system.

- **I · Hangar (specimen archive)**:
  - The left index lists catalogued specimens (*No. 001…*, each with a READY / CAUTION / FAULT mark) and the equipment catalogue. Equipment is told apart by schematic glyph and catalogue code rather than by colour.
  - To install equipment, click a part to arm it (compatible slots are marked), then click a slot, or drag the part onto a slot.
  - The drawing sheet shows the specimen as a technical record: hatched armor bands, a centreline, chain dimensions per section, numbered callouts with leader lines, firing arcs (rust hatching where an arc is blocked by the drone's own hull), and a title block of real figures.
  - The three-segment selector under the sheet chooses rear, middle or front.
  - The specification sheet on the right has four tabs: Selection, Performance, Register (numbered to match the callouts) and Checks.
- **II · Programs (intelligence laboratory)**:
  - The left index holds intelligence records (*IR-001…*) and an instrument palette that changes with the record type: node parts for node records, drone API calls for code records (click one to insert it), and the category key for block records.
  - The record is edited in the centre. A dark compiler transcript sits under the editor; click a listed problem to jump to it.
  - The reference volume on the right can be resized. Block and node records can switch to their compiled AutoScript or be converted to code.
- **III · Battle (observation)**:
  - The field is a graphite scope with calibrated edges and stays dominant.
  - The thin strip above it holds transport controls (Play, Step tick, Step decision, Restart, the speed scale and the clock), plus the Scenario drawer, the Specimens tags overlay and the event Ledger.
  - Freecam leaves the field unobstructed. Selecting a machine (on the field or from its tag) opens a **diagnostic report**: a live silhouette of its actual structure and failed components, plus Diagnostics, Components, Sensors and Program tabs with the full decision trace and *Show in editor*.
  - The report briefly loses signal only when real hardware is destroyed.

Examples included: **Assault Platform** (tracked; heavy front with two heavy cannons, medium middle with MGs and radar, light rear with point defense), run by the code program *Assault Doctrine*. **AA Destroyer** (wheeled; light front and rear with AA autocannons, heavy middle with a directional shield, radar and reactor), run by the block program *AA Orbit*. **Skirmisher**, run by the node program *Brawler*.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Programming API](docs/API.md)
- [Drone construction reference](docs/CONSTRUCTION.md)
- [Simulation & combat rules](docs/COMBAT_RULES.md)
- [Roadmap & milestone checklist](docs/ROADMAP.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)
