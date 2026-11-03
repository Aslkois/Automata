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
    runtime.ts      per-drone controller: compile, budget, decision trace, error isolation
    compile/        blocks -> AutoScript, nodes -> AutoScript, code validation
    blockDefs.ts / nodeDefs.ts  block and node catalogues shared by editors and compilers
  render/         canvas renderer, event-driven VFX, procedural audio (observe only)
  ui/             React app: Hangar, Programs (Blockly / XYFlow / CodeMirror), Battle
  data/defaults.ts  example designs and programs
```

## Principles

- **The simulation is authoritative and headless.** `Simulation.step()` advances exactly 1/60 s. Rendering, audio and UI read its state and drain its event queue. They never write to it. Battles run identically with or without a renderer (`npm run sim:headless`, tests).
- **One runtime for three interfaces.** Blocks (Blockly JSON) and nodes (graph JSON) are compiled headlessly to AutoScript, a JavaScript subset. Code programs are AutoScript. All of them run in the same `Interpreter` with the same `drone` API. Compiled block and node programs contain `__at("<id>")` markers, so each trace entry points to its source block or node. Code programs report line numbers.
- **Sandboxing.** Player source is never executed as host JavaScript. The interpreter enforces a syntax allow-list, a per-tick operation budget (set by the control unit), a call-depth limit, array and string size limits, null-prototype objects, no prototype access, read-only built-ins and seeded `Math.random`. A failing program records an error for that tick. The drone keeps its standing commands and the simulation continues.
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
