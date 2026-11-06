# Architecture

```
src/
  sim/            headless, deterministic simulation (no DOM)
    content/      data definitions: sections, chassis, components
    design.ts     versioned design schema, layout, stats, validation, (de)serialization
    drone.ts      design -> runtime state; transforms; mass properties
    physics.ts    rigid bodies, ground propulsion (skid / Ackermann), SAT collisions
    systems.ts    power distribution, weapons, shields, heat (per fixed tick)
    combat.ts     projectiles: swept collision, shields, armor, penetration
    damage.ts     component/section/joint damage, detachment, derived damage states
    sensors.ts    perception (range, arc, line of sight, power)
    world.ts      Simulation: fixed 60 Hz step, decision scheduling, events, results
  program/        player programming
    interpreter.ts  AutoScript: sandboxed tree-walking interpreter (acorn parser)
    api.ts          the drone API exposed to programs
    runtime.ts      per-drone controller: compile, budget, decision trace, variables, error isolation
    brain/          one brain per drone design, three editors
      ir.ts         canonical program: structured AutoScript tree with stable ids
      parse.ts      AutoScript -> IR (unsupported constructs become exact code modules)
      print.ts      IR -> AutoScript with a line map (what the runtime executes)
      reconcile.ts  keeps ids of unchanged logic across code edits
      blocks.ts     IR <-> Blockly workspace JSON (headless)
      graph.ts      IR <-> node graph, automatic layout (headless)
      model.ts      Brain record, per-view caches, drafts, edits
      catalog.ts    API/helper metadata and the Insert catalogue shared by all views
      stdlib.ts     helper functions (engageAll, aimAtContact…) appended when used
    configure/      Configure: settings -> readable AutoScript for the drone's hardware
      config.ts     settings, doctrine defaults, validation
      hardware.ts   what is installed (weapons by role, sensors, shields, power, armour)
      generate.ts   the generator (one plan shared with the explanation)
      explain.ts    the hardware-intelligence panel's sentences
      index.ts      sync state (none / synced / customised / hardware changed), apply, refresh
    legacy/         schema-1 block/node compilers, kept only for migration
  render/         canvas renderer, event-driven VFX, procedural audio (observe only)
  ui/             React app: rail shell, Construct, Program (Blockly / XYFlow / CodeMirror), Simulate
    migrate.ts      versioned library migration (schema 1 -> 2), starter sets, retiring untouched old examples
  data/
    roster.ts       starter drone hardware
    starters.ts     starter brains (hand-written, beginner to expert)
    defaults.ts     starter registration (set 3), editor per brain, documentation metadata
    legacy.ts       the retired examples, kept only to recognise them during migration
```

## Principles

- **The simulation is authoritative and headless.** `Simulation.step()` advances exactly 1/60 s. Rendering, audio and UI read its state and drain its event queue. They never write to it. Battles run identically with or without a renderer (`npm run sim:headless`, tests).
- **One brain, four editors.** Configure generates AutoScript from settings and the brain's IR is parsed from it; Blocks, Nodes and Code are projections of the IR. A configured brain stores its settings and the semantic hash of what they generated, so the editor can tell a synced brain from one customised elsewhere (never overwritten unless asked, and then kept under Recovered first). See [CONFIGURE.md](CONFIGURE.md).
- **The brain is one program.** Each design owns exactly one brain. Its authoritative content is a structured AutoScript IR in which every statement and expression has a stable id. Blocks, Nodes and Code are projections of that IR. Each view caches the document it last showed together with the IR hash it was made from, and the cache is used only while that hash still matches. An edit that converts replaces the IR; one that doesn't is kept as that view's draft. Constructs a visual view can't express (switch, arrow functions, object literals, templates…) appear there as code modules: exact source that can be edited in place and runs unchanged. The runtime executes the printed IR, and trace line numbers map back to ids, so the debugger can open any view at the originating logic. Lossless round trips and identical simulated behaviour across views are covered by `tests/program/brain.test.ts`.
- **Sandboxing.** Player source is never executed as host JavaScript. The interpreter enforces a syntax allow-list, a per-tick operation budget (the integrated CPU's runaway-loop guard), a call-depth limit, array and string size limits, null-prototype objects, no prototype access, read-only built-ins and seeded `Math.random`. A failing program records an error for that tick. The drone keeps its standing commands and the simulation continues.
- **No omniscience.** The API reads only the drone's own hardware state and its `perception`, which is computed each decision tick from functioning, powered sensors with range, arc and line of sight.
- **Data-driven content.** Sections, chassis and components are plain data. Systems switch only on component `kind`.
- **Determinism.** The simulation uses a fixed timestep, seeded `Rng` (mulberry32), stable update ordering (drone id order) and per-drone program RNGs. `Simulation.fingerprint()` hashes the physical and combat state. Tests verify that identical seeds give identical fingerprints, and that single-stepping matches batch stepping, in Node. Bit-for-bit determinism across different JS engines or platforms has **not** been verified.

## Tick order

1. On decision ticks (60 / decisionHz): for each drone, perceive, then deliver hardware-failure events (`onFailure`), then run `update()`
2. Per drone: power distribution, then ground forces, then weapons (traverse, reload, fire, recoil), then shields, then heat
3. Integrate drone and debris bodies
4. Projectiles: swept segment tests against obstacles, shields, sections, debris and (for point defense) shells
5. Collisions (bounding-circle broadphase, then SAT between section rectangles)
6. Joint processing and detachment; derived damage states; battle result

## Technology choices

- **Canvas 2D instead of PixiJS/Phaser**: the scene is a small number of rectangles, lines and particles. Canvas 2D needs no extra dependency and was enough for this scale.
- **CodeMirror 6 instead of Monaco**: much smaller and needs no web-worker setup in a static GitHub Pages build. It provides syntax highlighting, linting from the same parser the runtime uses, and API autocomplete.
- **Own block and node compilers instead of Blockly's generator**: programs compile headlessly (tests, headless battles) and the source-location markers are under our control.
