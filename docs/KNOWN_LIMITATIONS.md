# Known limitations

- **Determinism** is verified in tests by comparing seeded runs within the same runtime (Node/V8). Cross-browser and cross-platform bit-for-bit reproducibility has not been verified.
- **Armor** is one thickness per section, applied to all of that section's faces, and ablates as a single value. Impact location within a section matters for components, joints and angle, but not for the thickness itself.
- **Exposed equipment** (turrets, sensors) is hit by a seeded probability (its *profile*), not by 3D geometry.
- **Line of sight** for sensors checks static obstacles only. Wrecks and other drones do not block sensors, but they do block projectiles.
- **Detached sections** become inert debris. Equipment that is independently powered but detached does not keep operating, because brains run only on the part of the drone that still holds the integrated CPU (the middle section).
- **Visual coverage of the language.** Blocks and Nodes draw the common structured subset natively: declarations, assignment, calls, if/else, while, do-while, for, for-of, return/break/continue, operators, member and index access, lists and comments. Other constructs are shown as editable code modules, not as native blocks or nodes. They round-trip exactly and run unchanged.
- **Formatting and comment placement.** Code keeps your own text while the program's meaning is unchanged. After an edit in Blocks or Nodes, code is regenerated: indentation and quote style are normalised, and a comment placed inside an expression moves to just before its statement. Code modules keep their text verbatim.
- **Shared values in Nodes.** If one value node feeds several inputs, it is evaluated at each use. After a round trip through another view, such a node appears as one copy per use.
- **Unattached pieces.** Loose blocks and unconnected nodes are kept in the view where you left them; they don't run and don't appear in the other views.
- **Flying chassis** is simulated on the same ground plane: it skims low, so it is still blocked by walls and terrain.
- **Saved-data migration.** A schema-1 program is assigned to a design only when the association is clear: the example pairing, or one best name match. Everything else goes to Recovered programs. Migrated block procedures with parameters use ordinary function parameters, where the old compiler bound them as globals.
- **Debugging** has no breakpoints. It uses the per-decision trace, history scrubbing, errors with locations, `drone.log`, and single-tick or single-decision stepping.
- **Replay and timeline scrubbing** are not implemented. Restart re-simulates from the recorded configuration.
- **Modes**: only Duel and Sandbox exist. Team Battle, Fleet Battle, Challenges, Tournament and Replay Laboratory are not implemented. Sandbox already allows multi-drone, multi-team battles.
- **Friendly communication API**: not implemented yet. Electronic warfare is excluded by design.
- **Layout** adapts from 375 px phones (portrait and landscape) to large desktops. Panels are not dockable or resizable. Code editing on phones relies on the system keyboard plus a symbol bar. Node ports have enlarged touch targets, but dense graphs are still easiest to edit on a tablet or desktop.
- **Example programs** are reasonable but simple. With default settings the Assault Platform usually beats the AA Destroyer, as the design brief intends: heavy cannons counter it.
