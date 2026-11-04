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

Drawers and cards slide 18 px and fade over 280 ms on `cubic-bezier(.2,.7,.1,1)`. Workspaces cross-fade. There's no idle animation. `prefers-reduced-motion` removes all motion.

## Touch and devices

* Touch targets are at least 44 px on coarse pointers.
* Equipment is placed by tapping a part and then a slot; drag is optional.
* Node ports have a 36 px invisible hit area, and tapping one port and then another connects them.
* Code shows a symbol bar on touch devices.
* Safe-area insets are respected.
* Rendering stops and the battle pauses while the app is in the background. Panels refresh only while visible.
* Tested at 375×812, 390×844, 430×932, 768×1024, 1024×768, 844×390, 1280×720, 1440×900 and 1920×1080.
