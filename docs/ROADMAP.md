# Roadmap & milestone checklist

Status as of this build. "Verified" means covered by automated tests (`npm test`, `npm run test:e2e`) or by running the app.

## Phase 1 — Simulation foundation ✅
- [x] Headless simulation core, fixed 60 Hz timestep, arena with obstacles
- [x] Ground movement, drone entities, collision (SAT), moving projectiles with swept collision
- [x] Line of sight, target detection, combat resolution, battle start/reset, top-down rendering
- **Acceptance (verified):** two drones fight autonomously through simulated movement, detection and weapons (`npm run sim:headless`; test 16).

## Phase 2 — Modular construction ✅
- [x] Front/middle/rear sections; light/medium/heavy; wheeled and tracked chassis
- [x] Hardpoint and internal slots, installation, rotation, structural joints
- [x] Mass, centre of mass, inertia, power, speed and validation; independent weapon mounts
- [x] Design save/load (localStorage, JSON import/export, versioned schema); constructor UI
- **Acceptance (verified):** different configurations move and fight differently (tests 5, 7; Hangar stats).

## Phase 3 — Programming interfaces ✅
- [x] Block (Blockly), node (XYFlow) and code (CodeMirror) editors
- [x] Shared AutoScript runtime and drone API; sandbox with budget, depth and memory limits
- [x] Sensors, movement, independent weapon commands, conditions, variables, timers, hardware status, failure events
- **Acceptance (verified):** each interface drives and fires a real drone (test 13; e2e).

## Phase 4 — Combat & component damage ✅
- [x] Localized armor, angle-dependent penetration, ricochets, component hitboxes
- [x] Weapon, propulsion, sensor, power and shield damage; recoil; structural damage
- [x] Directional shields; ammunition, reloading and cook-off; power allocation; heat
- **Acceptance (verified):** hit location and configuration change outcomes and surviving functionality (tests 1–9, 14).

## Phase 5 — Spectating & debugging ✅
- [x] Freecam, drone selection, follow camera, sensor cones, sensor view, weapon arcs
- [x] Live statistics, component inspector, contacts, program state
- [x] Decision trace with block, node or line source locations; "Show in editor"; combat event log
- [x] Pause, single tick, single decision, restart, speed
- **Acceptance (verified):** a fire command can be traced to the exact line, block or node and the sensor state that produced it (e2e).

## Phase 6 — Destruction & VFX ✅ (first pass)
- [x] Structural detachment into physical debris; persistent wreckage; scorch decals
- [x] Directional sparks, ricochet sparks, penetration fragments, electrical arcs, smoke and fire emitters bound to the damaged component
- [x] Procedural combat audio; effects quality setting
- [ ] Mechanical destruction animation beyond debris/emitters (planned)

## Phase 7 — Advanced machines (planned)
Flying and walking chassis, more equipment, more shield types, complex propulsion, advanced sensors. The chassis and propulsion model is data-driven so these can be added as new `ChassisDef`s and steering models without touching combat or programming.

## Phase 8 — Fleets & coordination (partial)
- [x] Sandbox supports up to 6 drones on up to 4 teams
- [ ] Friendly communication, shared observations, target allocation, carriers (planned; no communication API yet)

## Phase 9 — Competitive systems (planned)
Tournaments, replays and timeline scrubbing (the deterministic core and `fingerprint()` are ready for recording), batch simulations, challenges, sharing.
