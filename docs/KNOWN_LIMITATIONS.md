# Known limitations

- **Determinism** is verified in tests by comparing seeded runs within the same runtime (Node/V8). Cross-browser and cross-platform bit-for-bit reproducibility has not been verified.
- **Armor** is one thickness per section, applied to all of that section's faces, and ablates as a single value. Impact location within a section matters for components, joints and angle, but not for the thickness itself.
- **Exposed equipment** (turrets, sensors) is hit by a seeded probability (its *profile*), not by 3D geometry.
- **Line of sight** for sensors checks static obstacles only. Wrecks and other drones do not block sensors, but they do block projectiles.
- **Detached sections** become inert debris. Equipment that is independently powered but detached does not keep operating, because programs run only on the drone that holds the control unit.
- **Mixed-interface programs** (for example navigation in blocks and targeting in code inside one program) are not supported yet. Each program uses a single interface; block and node programs can be converted to code.
- **Blocks/nodes ↔ code** conversion is one way only (to code).
- **Debugging** has no breakpoints. It uses the per-decision trace, history scrubbing, errors with locations, `drone.log`, and single-tick or single-decision stepping.
- **Replay and timeline scrubbing** are not implemented. Restart re-simulates from the recorded configuration.
- **Unavailable modes**: Team Battle, Fleet Battle, Challenges, Tournament and Replay Laboratory are marked unavailable in the UI. Sandbox already allows multi-drone, multi-team battles.
- **Friendly communication API**: not implemented yet. Electronic warfare is excluded by design.
- **Layout** targets desktop widths (min 1100 px). Panels are fixed width, not dockable.
- **Example programs** are reasonable but simple. With default settings the Assault Platform usually beats the AA Destroyer, as the design brief intends: heavy cannons counter it.
