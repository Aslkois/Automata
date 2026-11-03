# AUTOMATA — THE MACHINE

Design specification for the interface. **Design read:** a precision-machine desktop interface for players who build and program autonomous drones. ENERGY 2 · RHYTHM 3 · MOTION 1: calm surfaces, spatially varied compositions per workspace, almost no animation.

## 1. Identity

AUTOMATA is an instrument for making autonomous machines and watching them work. The interface takes its cues from machined parts and instrument faces: brushed metal bezels, engraved scales, precise rectangular selections, and diagrams drawn with real dimensions. It is warm (ivory and stone, not white), quiet (one interaction accent), and exact (every number is real simulation data).

Do not use: paper labels, tape, receipts, cutting mats, colourful patch cables, glassmorphism, neon, gradients used for decoration, or another game's interface.

## 2. Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--bone` | `#f3efe6` | primary work surface (stages, editors) |
| `--linen` | `#e9e3d6` | secondary surface, trays |
| `--stone` | `#d6cebe` | borders on light, idle controls |
| `--steel` | `#9a978f` | metallic mid-tone, scales, disabled |
| `--iron` | `#5d5c58` | secondary text on light |
| `--graphite` | `#2c2c2a` | primary text, dark chrome |
| `--carbon` | `#1d1d1c` | navigation rail, battlefield frame |
| `--signal` | `#2f6f8f` | the one interaction accent: selection, focus, primary action |
| `--signal-wash` | `#d9e6ec` | selected row/background |
| `--ok` `#4c7a52` · `--warn` `#b07d22` · `--fault` `#a8402b` | states: working / caution / damage, failure, errors |

* **Teams:** Cobalt `#4f7fb8`, Amber `#c98a2e`, Verdigris `#4a9a83`, Iris `#8c6bb3`. They're always shown with a name, never by colour alone.
* **Programming categories:** Events (graphite), Logic (signal blue), Math (ochre), Values (stone), Sensors (verdigris), Movement (cobalt), Weapons (brick), Systems (olive), Functions (iris), Code (carbon).
* **Equipment kinds:** each has its own glyph and a tint shared with the matching programming category (weapon = brick, sensor = verdigris, …).
* **Geometry:** radius 3 px on controls and 6 px on floating surfaces. Borders 1 px. Elevation is one soft shadow for floating surfaces only.
* **Spacing scale:** 4 · 8 · 12 · 16 · 24 · 32 · 48.

## 3. Typography

* **Instrument Sans** carries the interface. Body text is 14 px and never smaller than 12 px.
  * Workspace title: 22/600
  * Object name: 18/600
  * Property label: 13/500 in iron
  * Value: 14/500
* **JetBrains Mono** is used only for code, telemetry numbers, component ids (`F.H1`) and coordinates. Numerals are tabular.
* Uppercase appears only in the three activity names and two-letter section marks. Everything else is sentence case.

## 4. Navigation

* A narrow **carbon rail** on the left holds the AUTOMATA mark, three activities (**Construct**, **Program**, **Simulate**, each with a glyph and a label), and at the bottom the **active drone** (its three-segment silhouette and name), which opens the drone switcher.
* The active drone is global. Construct edits it, Program edits its brain, and Simulate deploys it.
* Workspaces stay mounted, so editor state, camera, undo history and unsaved drafts survive switching.
* Direct links:
  * Construct → "Program this drone"
  * Program → "Hardware"
  * Simulate diagnostic → "Open brain at this decision" / "Open hardware"

## 5. Workspaces

### Construct

* A full-bleed **assembly stage**: a calibrated grid with pan (drag), zoom (wheel, buttons) and fit.
* The drone is drawn at true proportions, with distinct front, middle and rear sections and equipment at its mounted position and facing.
* **Selection:** a precise rectangular bracket. Unrelated parts dim slightly, and nothing covers the machine.
* **Assembly strip:** a compact three-segment bar floating at the top of the stage. Each segment shows the section's class, armour and fill; click it to focus the section.
* **Properties surface:** a floating card on the right that appears only for a selected slot or section (power, mass, durability, mounting and capability). With nothing selected the stage is unobstructed.
* **Equipment tray:** docked at the bottom. It's collapsed to a strip of category tabs and expands to show a searchable equipment grid with comparison against the selected mount. Install by dragging onto the stage or by clicking with a slot selected.
* **Design summary:** mass, speed, power and issues as a small readout in the top-left. Issues expand on click.

### Program

* The editor owns the screen.
* **Top bar:** drone identity · `Blocks | Nodes | Code` · compile state · save state · Test.
* Tools are summoned rather than permanent:
  * the **Insert** drawer (searchable, by category), also opened with `/` or Ctrl+K;
  * the **Reference** drawer (drone API);
  * the **Debug** drawer, which shows the latest real decision trace with branch outcomes and variable values; clicking an entry highlights its source in the active view.
* **Compatibility diagnostics** appear as a quiet badge ("2 code modules") with an explanation.

### Simulate

* The battlefield is the screen.
* Floating instruments:
  * a transport capsule at the bottom centre (pause/play, step, speed, restart);
  * a scenario button at the top left (opens the deployment sheet);
  * a camera chip at the top right;
  * an event timeline: a thin bar of real event ticks that expands into a drawer.
* Selecting a drone opens a **spectator card** on the right edge. It summarises identity, condition, weapons, power/heat, sensors, the current action and the program state, with expandable sections for components, the full trace and source. Deselecting returns to freecam.

## 6. One brain, three editors

* Each drone design owns exactly one **brain**.
* The brain's authoritative content is a structured AutoScript **IR**: statements and expressions with stable ids.
* Each editor is a view of that IR:
  * Blocks and Nodes are generated from it and converted back when edited.
  * Code is printed from it, and parsed back on every valid edit.
* Constructs a visual view can't express are shown there as **code modules**. A code module holds the exact source, can be edited in place, and runs unchanged.
* What is cached per view:
  * Code keeps the player's own text while its meaning is unchanged.
  * Blocks and Nodes keep their positions.
  * Unattached fragments stay in the view where they were left. They are not part of the brain and don't run.
* Invalid code never replaces the last valid brain. The draft and its diagnostics are kept until fixed.

## 7. Interaction states

* Hover lifts a control's surface one step.
* Focus is a 2 px signal ring offset by 2 px.
* Selection is a signal bracket (on the stage) or a signal-wash row with a signal edge (in lists).
* Pressed controls invert to graphite.
* Disabled controls use steel text with no hover.
* Errors use fault text plus an icon, never colour alone.

## 8. Motion

Motion is limited to 120–160 ms opacity and translate for drawers and cards. There's no idle animation. The only effect is a brief signal-loss stutter on the spectator card when hardware is actually destroyed. `prefers-reduced-motion` removes all of it.

## 9. Responsive behaviour

* The layout targets 1280×720 and up.
* Floating cards cap their width at 360 px (420 px at ≥1600 px) and scroll internally.
* At narrow widths:
  * the tray shows fewer columns;
  * the rail keeps its labels;
  * the Program top bar wraps its secondary actions into a menu below 1360 px.
* No horizontal page scroll at any supported size.
