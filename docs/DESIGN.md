# AUTOMATA: interface design

**Design read:** an elegant, melancholic operating system built for autonomous machines. It is precise, quiet and slightly distant, ancient and futuristic at once. ENERGY 2 · RHYTHM 3 · MOTION 1: calm surfaces, compositions that differ by workspace, and slow, deliberate movement.

It should feel like a beautifully designed operating system for artificial life. Not an industrial dashboard, an electronics workbench, a conventional desktop app or a neon cyberpunk interface.

## Material

| Token | Value | Role |
| --- | --- | --- |
| `--ivory` | `#efe8da` | primary surface |
| `--vellum` / `--sepia` / `--dune` | `#e6dcc8` / `#d6c8ad` / `#bfae8e` | secondary surfaces, rules, tracks |
| `--umber` | `#7d6548` | muted brown: kickers, section marks, calibration |
| `--iron` / `--stone` | `#5b554b` / `#8e8576` | secondary and tertiary text |
| `--graphite` / `--carbon` / `--pitch` | `#2a2723` / `#1e1c19` / `#141311` | text, inverted selection, rail, battlefield |
| `--signal` | `#3d6e7d` | the one cool hue: focus, the stage selection bracket, trace highlight |
| `--ok` `#5d7a4f` · `--warn` `#a8792a` · `--fault` `#9e3f2a` | states |

* **Teams:** Cobalt, Amber, Verdigris, Iris, always named. **Programming categories** have muted, distinct hues shared by blocks, nodes, the Insert drawer and the reference.
* **Equipment kinds** use a glyph plus the tint of their programming category.
* **Analog texture:** light surfaces carry a faint fibre grain (an SVG noise tile) and a warm vignette. The battlefield and rail carry faint scan lines. Both are low enough never to compete with text.
* **Electronic imperfection is an event, not a decoration:** a brief signal breakup on the spectator card when hardware is destroyed, and a flicker on failed rows. Nothing else distorts.

## Typography

* **Cormorant Garamond** (500–600) names things: drone names, workspace and card titles, the tray heading.
* **Instrument Sans** carries the interface. Body text is 14–15 px; labels are sentence case at 12.5–13 px.
* Uppercase is limited to the three activity names, the editor switch and small section kickers. These are tracked out (0.1–0.16 em).
* **JetBrains Mono** (tabular numerals, no ligatures) is used only for code, measurements, telemetry and ids such as `F.H1`.

## Ornament and geometry

* Hairline rules (1 px at 16–32 % graphite), dotted leaders in property lists, and lozenge joints between assembly segments.
* Calibration corners on cards, tick scales on the stage axis and arena edges, and the three-segment front/middle/rear mark, used only where it encodes real sections: the logo, drone chips and the integrity of each section.
* Radius is 3 px on controls and 6 px on floating cards. Floating surfaces get a single soft shadow.
* **Selection is a clean inversion** (graphite ground, ivory text), animated over 280 ms. Pressed controls dip by 1 px.

## Composition per workspace

* **Navigation.** A carbon rail holds the mark, Construct, Program and Simulate, and the active drone, which opens the drone switcher. On phones the rail becomes a bottom bar. Workspaces stay mounted, so editors, camera and simulation keep their state.
* **Construct.**
  * A full-bleed calibrated stage shows the drone at true proportions, with pan, pinch and wheel zoom.
  * The title, chassis and live figures float top-left. A status pill expands into plain-language problems.
  * The assembly strip sits above the drone. The properties surface appears only for a selection, and the equipment tray is docked below.
  * Tablets and short screens stack these as header, strip, stage and tray. On phones, properties become a bottom sheet.
* **Program.**
  * The brain bar shows the drone, **BLOCKS | NODES | CODE**, compile state, save state and Test.
  * A slim tool rail opens Insert, Reference, Debug and Recovered drawers. On phones these become bottom sheets that leave the editor visible.
  * The editor owns the rest.
* **Simulate.**
  * The field is the screen. Instruments float over it in translucent charcoal: the scenario chip, the drone list, the camera chips, a transport capsule and an event timeline.
  * The spectator card is a dark instrument on the right edge, or a bottom sheet on phones.
  * Labels on the field are drawn as in-world annotations, not panels.

## Motion

Drawers and cards slide 18 px and fade over 280 ms on `cubic-bezier(.2,.7,.1,1)`. Workspaces cross-fade. There's no idle animation: parts move only when the simulation makes them (see below). `prefers-reduced-motion` removes all motion.

## Components: icons, models and animation

Every component has its own icon; every hardpoint has its own top-down model. Both are original vector drawings in code: no emoji, Unicode glyphs, icon fonts or external libraries.

**Where they live.**

* `src/render/parts/icons.ts`: `ICONS`, one 24 × 24 stroke path per component id (32).
* `src/render/parts/models.ts`: `MODELS`, one model per hardpoint id (16), each with an `identity` line, the number of barrels or tubes it draws, and a `draw(pen, visual)` function.
* `src/render/parts/animator.ts`: `PartAnimator`, which turns simulation events and state into a `PartVisual` per mount.
* `src/render/parts/palette.ts`: materials; `canvasPen.ts` (battlefield) and the SVG pen in `src/ui/parts.tsx` (Construct, tray, inspector, spectator) draw the same geometry.
* `?parts-sheet` opens a specimen sheet of every icon at 20, 24 and 40 px and every model in six states.

**Rules.**

* Models never read simulation objects. They draw a `PartVisual` (aim, per-barrel recoil, spin, charge, loaded tubes, reload progress, heat, damage, jammed barrels, powered, sweep) and never modify it. The animator reads the simulation and never writes to it; a test runs the same battle with and without it and compares the state.
* Static geometry (housing, barrels, tubes) and animated state are separate: the same model draws the tray preview at rest and the live turret on the field.
* Scale is world units. A model's base sits inside its mount footprint (S 3, M 4.5, L 6 u half-width); barrels may overhang it.

**Icons.** 24-unit grid, 1.5-unit stroke, round caps and joins, no fill; legible at 20–24 px, detailed at 32–48 px. Each shows the part's defining feature: four barrels on the quad MG, six tubes on the rocket pod, nose cones on the missile launcher, coil bands on the coilgun, a lens on the camera, an antenna bar on the radar. The tint is the theme colour of the part’s kind. Integrated systems without a part of their own use the category glyph.

**Models.**

* Materials:

  | Role | Colour | Used for |
  | --- | --- | --- |
  | mount | `#2b2925` | mount ring |
  | hull | `#57524a` | housings |
  | plate | `#777064` | armour |
  | metal | `#9a9284` | barrels |
  | glass | `#6f8e94` | optics |
  | warm | `#e3a46a` | heat |
  | charge | `#f4f6f2` | coil charge and raised emitters |
  | fault | `#c9735e` | interruption and damage |
  | ammo | `#e2d8c0` | rounds |

* Outlines are dark on paper and light on the battlefield, at least 0.8 screen px.
* On the field, the mount ring takes the team colour.
* A destroyed part is drawn in a burnt wreck palette.

**Animation.** Event-driven only; there is no idle loop.

* *Recoil*: a `shot` event kicks back the barrel that fired (the event names it). The barrel returns to battery over the weapon's return time: MG 0.06 s, quad MG 0.045 s, rotary 0.05 s, autocannon 0.14 s, dual autocannon 0.16 s, scatter 0.28 s, coilgun 0.25 s, rocket pod 0.35 s, missile launcher 0.5 s, heavy cannon 0.6 s. The autocannon and heavy cannon breeches recoil with their barrels.
* *Rotary spin*: the cluster turns at the simulated spin (it spins up before the first round and winds down). It freezes when the part stops working.
* *Coilgun*: six coils light in proportion to the capacitor charge. They turn to the fault colour when the simulation marks the charge interrupted, and flash white on discharge.
* *Launchers*: each tube shows a round only while the magazine holds it. Tubes empty in the simulation's firing order and refill only when the simulation completes the reload. A reload cradle shows reload progress while the reload timer runs, and nothing when it is interrupted or the launcher is destroyed. With no reserve, the tubes stay empty.
* *Aim*: turrets draw the simulated aim each frame, so they traverse at their real rate and never snap.
* *Sensors*: the radar antenna rotates and the LIDAR head sweeps one 180° pass per real scan, only while the sensor works and has power. The camera has no moving parts. Shields light their emitters only while raised and powered.
* *Heat*: barrels warm in colour above 60 % heat.

**Damage states.** Integrity sets the level:

| Level | Integrity | Shown as |
| --- | --- | --- |
| Functional | at least 66 % | clean |
| Damaged | 33–66 % | two scorch marks |
| Critical | below 33 % | four scorch marks |
| Destroyed | 0 | wreck palette, bent barrel, no motion |

* Any hit that damages a working part gives one brief flicker (0.3 s); it follows the simulation's `component-damaged` event.
* A destroyed part keeps its last pose but drops any motion in progress.
* Below half integrity a multi-barrel gun shows its odd barrels jammed. These are exactly the barrels the simulation stops firing (`activeBarrels`). Nothing else implies a malfunction the simulation does not model.

**Internals.** In Construct each internal shows its own schematic icon. In the spectator silhouette an internal shows a fill bar only where it holds real state:

* ammunition stock;
* battery charge;
* thermal reservoir;
* suppression charges;
* generator output under heat.

**Reduced motion.** With `prefers-reduced-motion`, nothing moves: no recoil, spin or sweep. Charge, loaded tubes, heat, damage and aim are still shown.

**Performance.**

* Models are a few dozen vector operations each, drawn directly into the battlefield's transform with one reused pen. There are no bitmaps or offscreen caches to invalidate.
* Palettes (live and wreck) are cached per team colour, and preview framing is cached per model.
* Tray previews are memoised.

## Touch and devices

* Touch targets are at least 44 px on coarse pointers.
* Equipment is placed by tapping a part and then a slot; drag is optional.
* Node ports have a 36 px invisible hit area, and tapping one port and then another connects them.
* Code shows a symbol bar on touch devices.
* Safe-area insets are respected.
* Rendering stops and the battle pauses while the app is in the background. Panels refresh only while visible.
* Tested at 375×812, 390×844, 430×932, 768×1024, 1024×768, 844×390, 1280×720, 1440×900 and 1920×1080.
