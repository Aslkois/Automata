# Balance measurements

Recorded from the simulation by `npm run balance` (scripts/balance.ts). The simulation is deterministic for a given seed, so the tables reproduce exactly on the same build.

<!-- measurements:start -->
## 1. Weapons: measured rate, heat and time to knock out a plate

Stationary platform (weapon on F.H1, matching ammunition store, camera), stationary target with uniform plate on all three sections. "Knocked out" = a section destroyed or the target disabled (training-course rule). 60 s cap; "—" = not achieved. Rate is measured from shot events over the first magazine (per projectile; per shell for the scatter cannon). First lockout = seconds of holding the trigger from cold until the weapon overheats, with only the integrated coolant reaching the front section; reload pauses are included. The construct estimate is the warning shown in Construct, which assumes fire never pauses. L/M/H = light 15 mm / medium 35 mm / heavy 70 mm plate; @ = range in u.

| Weapon | Rate (measured) | Spec | First lockout (sim, with reloads) | Continuous-fire estimate (construct) | L @150 | M @150 | H @150 | L @400 | M @400 | H @400 | L @800 | M @800 | H @800 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Machine Gun | 600 rpm | 600 rpm | 30.2 s | 15.4 s | — | — | — | — | — | — | — | — | — |
| Autocannon | 300 rpm | 300 rpm | 16.8 s | 11.8 s | 4.0 s | 28.1 s | — | 4.5 s | 29.5 s | — | 6.0 s | — | — |
| Point Defense Gun | 1200 rpm | 1200 rpm | 35.6 s | 15.4 s | — | — | — | — | — | — | — | — | — |
| Scatter Cannon | 120 rpm | 120 rpm | none in 45 s | 18.2 s | 8.5 s | — | — | — | — | — | — | — | — |
| Quad Machine Gun | 1800 rpm | 1800 rpm | 15.2 s | 8.3 s | — | — | — | — | — | — | — | — | — |
| Rotary Cannon | 800 rpm | 800 rpm | 7.0 s | 6.5 s | 3.4 s | — | — | 4.9 s | — | — | 31.6 s | — | — |
| Dual Autocannon | 420 rpm | 420 rpm | 14.4 s | 7.3 s | 3.0 s | 3.3 s | — | 3.7 s | 4.0 s | — | 6.2 s | 4.8 s | — |
| Rocket Pod | 0.400 s interval | 0.4 s interval | none in 45 s | 33.3 s | 2.3 s | 8.4 s | — | 2.6 s | 9.1 s | — | 7.7 s | 15.0 s | — |
| Heavy Cannon | 1 / 3.23 s | 1 / 3.2 s | none in 45 s | 57.1 s | 6.7 s | 13.2 s | 13.2 s | 7.0 s | 13.4 s | 16.7 s | 14.0 s | 20.5 s | 23.7 s |
| Coilgun | 1 / 5.03 s | 1 / 5 s | none in 45 s | 142.9 s | 15.3 s | 25.3 s | 30.3 s | 20.3 s | 30.4 s | 35.4 s | 20.5 s | 30.6 s | 35.6 s |
| Heavy Missile Launcher | 0.800 s interval | 0.8 s interval | none in 45 s | 200.0 s | 1.9 s | 17.5 s | 35.5 s | 3.1 s | 17.9 s | 35.9 s | 3.0 s | 19.4 s | — |

## 2. Interception

A heavy missile launcher (and, separately, a rocket pod or a heavy cannon) fires at a defender 800 u away for 6 s. Both carry radar. Counts are summed over the seeds; "arrived" = warheads that detonated or shells that struck, not shot down.

| Attack | Defense | Fired | Shot down | Hits that did not kill | Arrived | Shot down % | Defensive rounds fired | Seeds |
|---|---|---|---|---|---|---|---|---|
| Heavy Missile Launcher | Point defense gun | 32 | 4 | 65 | 28 | 13% | 168 | 8 |
| Heavy Missile Launcher | Rocket pod, interceptors | 32 | 30 | 0 | 2 | 94% | 45 | 8 |
| Rocket Pod | Point defense gun | 48 | 21 | 76 | 27 | 44% | 260 | 8 |
| Heavy Cannon | Point defense gun | 32 | 7 | 21 | 25 | 22% | 183 | 8 |

## 3. Starter duels

Every starter against every other starter with its own brain, Foundry Yard, 120 s limit, seeds 1, 2, 3; each pairing is played from both spawn sides. Cell = wins of the row drone over the column drone out of 6 games (draws are not wins).

| vs | Pick | Gnat | Bull | Horn | Rapi | Kest | Cita | Long | Maul | Jack | Talo | Ward | Vipe | Para | Jugg | Sove |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Picket** | · | 6 | 1 | 2 | 5 | 3 | 0 | 4 | 0 | 2 | 4 | 0 | 5 | 2 | 0 | 0 |
| **Gnat** | 0 | · | 4 | 4 | 5 | 3 | 0 | 1 | 0 | 3 | 2 | 0 | 6 | 0 | 0 | 0 |
| **Bulldog** | 3 | 2 | · | 4 | 5 | 3 | 0 | 0 | 0 | 4 | 0 | 0 | 2 | 0 | 0 | 0 |
| **Hornet** | 2 | 2 | 0 | · | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 0 | 0 | 0 |
| **Rapier** | 1 | 1 | 1 | 4 | · | 0 | 0 | 3 | 0 | 3 | 4 | 0 | 1 | 2 | 0 | 0 |
| **Kestrel** | 3 | 3 | 3 | 4 | 6 | · | 0 | 3 | 0 | 2 | 4 | 0 | 1 | 0 | 0 | 0 |
| **Citadel** | 6 | 6 | 6 | 6 | 6 | 6 | · | 0 | 4 | 6 | 4 | 0 | 6 | 6 | 0 | 0 |
| **Longbow** | 1 | 2 | 0 | 5 | 1 | 2 | 0 | · | 2 | 5 | 4 | 0 | 6 | 0 | 0 | 0 |
| **Mauler** | 6 | 6 | 6 | 6 | 6 | 6 | 2 | 4 | · | 6 | 5 | 4 | 6 | 1 | 0 | 0 |
| **Jackal** | 4 | 3 | 2 | 2 | 3 | 4 | 0 | 0 | 0 | · | 1 | 1 | 1 | 0 | 0 | 0 |
| **Talon** | 0 | 1 | 6 | 6 | 2 | 1 | 0 | 0 | 0 | 4 | · | 0 | 4 | 1 | 0 | 0 |
| **Warden** | 4 | 5 | 4 | 6 | 6 | 3 | 0 | 6 | 2 | 4 | 6 | · | 4 | 2 | 0 | 0 |
| **Viper** | 1 | 0 | 2 | 3 | 5 | 5 | 0 | 0 | 0 | 4 | 1 | 0 | · | 0 | 0 | 0 |
| **Paragon** | 4 | 6 | 6 | 4 | 4 | 5 | 0 | 5 | 5 | 5 | 4 | 4 | 6 | · | 0 | 0 |
| **Juggernaut** | 6 | 6 | 0 | 6 | 6 | 6 | 0 | 0 | 6 | 2 | 6 | 6 | 6 | 5 | · | 0 |
| **Sovereign** | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 4 | · |

| Starter | Wins | Losses | Draws | Win % | Brain runtime errors |
|---|---|---|---|---|---|
| Sovereign | 88 | 0 | 2 | 98% | 0 |
| Mauler | 64 | 25 | 1 | 71% | 0 |
| Citadel | 62 | 8 | 20 | 69% | 0 |
| Juggernaut | 61 | 4 | 25 | 68% | 0 |
| Paragon | 58 | 25 | 7 | 64% | 0 |
| Warden | 52 | 21 | 17 | 58% | 0 |
| Picket | 34 | 47 | 9 | 38% | 0 |
| Kestrel | 29 | 55 | 6 | 32% | 0 |
| Gnat | 28 | 55 | 7 | 31% | 0 |
| Longbow | 28 | 32 | 30 | 31% | 0 |
| Talon | 25 | 51 | 14 | 28% | 0 |
| Bulldog | 23 | 47 | 20 | 26% | 0 |
| Jackal | 21 | 56 | 13 | 23% | 0 |
| Viper | 21 | 62 | 7 | 23% | 0 |
| Rapier | 20 | 67 | 3 | 22% | 0 |
| Hornet | 9 | 68 | 13 | 10% | 0 |

## 4. Starters on the training courses

Each starter alone (seed 1) with its own brain. Time = when the objective was met; "—" = not met within the course limit, with the outcome.

| Starter | Basic maze | Obstacle course | Weapon range | Armor test | Interception test | Missile test | Cooling and power stress |
|---|---|---|---|---|---|---|---|
| Picket | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | 72.1 s | — (2 of 3 targets knocked out in 180 s) | — (Did not survive: Picket: Disarmed) | 66.1 s | — (0 of 1 targets knocked out in 120 s) |
| Gnat | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | 96.7 s | — (1 of 3 targets knocked out in 180 s) | — (Did not survive: Gnat: Disarmed) | 52.0 s | — (0 of 1 targets knocked out in 120 s) |
| Bulldog | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (3 of 4 targets knocked out in 150 s) | — (0 of 3 targets knocked out in 180 s) | — (Did not survive: Bulldog: Disarmed) | 93.5 s | — (0 of 1 targets knocked out in 120 s) |
| Hornet | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (0 of 4 targets knocked out in 150 s) | — (0 of 3 targets knocked out in 180 s) | — (Did not survive: Hornet: Disabled) | 88.8 s | — (0 of 1 targets knocked out in 120 s) |
| Rapier | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | 76.9 s | — (1 of 3 targets knocked out in 180 s) | — (Did not survive: Rapier: Disarmed) | 41.6 s | 12.1 s |
| Kestrel | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | 55.2 s | — (1 of 3 targets knocked out in 180 s) | — (Did not survive: Kestrel: Disarmed) | 38.7 s | — (0 of 1 targets knocked out in 120 s) |
| Citadel | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (3 of 4 targets knocked out in 150 s) | — (0 of 3 targets knocked out in 180 s) | — (Did not survive: Citadel: Disabled) | 29.4 s | — (0 of 1 targets knocked out in 120 s) |
| Longbow | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (3 of 4 targets knocked out in 150 s) | — (1 of 3 targets knocked out in 180 s) | — (Did not survive: Longbow: Disabled) | 72.5 s | 51.3 s |
| Mauler | — (Goal not reached within 240 s) | 33.8 s | — (3 of 4 targets knocked out in 150 s) | — (2 of 3 targets knocked out in 180 s) | — (Did not survive: Mauler: Disarmed) | 40.2 s | 80.7 s |
| Jackal | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | 88.5 s | — (2 of 3 targets knocked out in 180 s) | — (Did not survive: Jackal: Disarmed) | 46.5 s | — (0 of 1 targets knocked out in 120 s) |
| Talon | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (2 of 4 targets knocked out in 150 s) | — (1 of 3 targets knocked out in 180 s) | — (Did not survive: Talon: Disabled) | 52.4 s | 36.4 s |
| Warden | — (Goal not reached within 240 s) | 56.6 s | — (3 of 4 targets knocked out in 150 s) | — (1 of 3 targets knocked out in 180 s) | — (Did not survive: Warden: Disarmed) | 71.8 s | — (0 of 1 targets knocked out in 120 s) |
| Viper | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | 73.5 s | — (1 of 3 targets knocked out in 180 s) | — (Did not survive: Viper: Disarmed) | 37.2 s | — (0 of 1 targets knocked out in 120 s) |
| Paragon | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | 73.0 s | — (2 of 3 targets knocked out in 180 s) | 51.5 s | 25.6 s | 38.3 s |
| Juggernaut | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (0 of 4 targets knocked out in 150 s) | — (0 of 3 targets knocked out in 180 s) | 35.4 s | 28.5 s | — (0 of 1 targets knocked out in 120 s) |
| Sovereign | — (Goal not reached within 240 s) | 40.6 s | 42.8 s | 29.5 s | 5.6 s | 19.6 s | 3.1 s |

_Generated by `npx vite-node scripts/balance.ts` in 218 s._
<!-- measurements:end -->

## Findings

These were written after reading the tables above. The "before" numbers come from earlier runs of the same script during development; the changes they led to are listed under **Changes made**.

### What the tables show

- **Every rate is exact.** All eleven weapons fire at their specified rate, measured from shot events, including the Quad MG's 1800 rpm and the Dual Autocannon's 420 rpm combined at a 60 Hz tick. The scheduler places each event inside the tick, and unit tests assert it.
- **Small calibres cannot defeat plate.** The Machine Gun, Point Defense Gun and Quad MG (5–9 mm) knock out none of the plates, even the 15 mm light one. That is their intended role: exposed equipment, running gear and hulls thinner than ~9 mm.
- **Medium plate is the dividing line.**
  - The Dual Autocannon (50 mm) knocks out 35 mm plate in 3–5 s at every range.
  - The single Autocannon (26 mm) needs ~28 s, and only by wearing the plate down.
  - Rotary and Scatter only beat light plate.
- **Heavy plate needs heavy weapons.** Only the Heavy Cannon, Coilgun and Heavy Missile Launcher knock out 70 mm plate. The Heavy Cannon is the fastest at 13–24 s.
- **Missiles strike over distance.** Their times barely change with range: light plate is knocked out in ~2–3 s at every range. Against heavy plate at 800 u, 8 missiles did not succeed within 60 s.
- **The overheat warning is conservative.** The Construct estimate assumes the trigger never stops. Measured first-lockout times, with reload pauses, are about twice as long for magazine-fed guns (MG 15.4 s estimated, 30.2 s measured).
  - The Rotary Cannon is the exception: it overheats in 7 s, before its 9 s magazine is empty. Sustained rotary fire needs a Cooling Unit or Thermal Reservoir, as its description says.
- **Interception is real and never certain.**
  - A single point-defense gun stopped 44% of offensive rockets, 22% of heavy-cannon shells and 13% of heavy missiles.
  - A rocket pod firing interceptor rockets stopped 94% of missiles, spending 45 interceptors on 32 missiles.
  - Interceptors are the hard counter to missiles but use up a medium hardpoint and storage. Point defense is a partial counter to everything.
- **Starters: heavy designs still win most straight duels.** The roster was replaced by fifteen balanced starters and one boss, Sovereign (see [STARTERS.md](STARTERS.md)); the fuller measurement — three arenas, three starting positions, categories, 2 v 2, 1 v 2, Configure and the Sovereign trials — is in [EVALUATION.md](EVALUATION.md). On Foundry Yard alone (720 games):
  - Sovereign wins 88 of its 90 games (98%) and loses none; both draws are against Juggernaut. Every balanced starter also plays it, so each balanced win rate below includes six losses or draws against it; the results between the fifteen balanced starters are exactly those of the previous recording.
  - Among the balanced starters, Mauler (71%), Citadel (69%), Juggernaut (68%; it loses only to Sovereign: 61 wins, 4 losses, 25 draws) and Paragon (64%) win most of their games; Warden is at 58% after its offence was cut to one autocannon.
  - Hornet (10%), Rapier (22%), Viper (23%) and Jackal (23%) lose most of theirs. Every starter still wins at least once against every opponent category (EVALUATION.md §3).
  - 13% of games (97 of 720) are draws at the 120 s limit, mostly involving the slow walkers that hold position (Longbow is in 30 of them, Juggernaut 25, Citadel 20).
  - As before: a 1-on-1 between unequal masses favours mass and armour, and armour being one thickness per section rewards keeping the front plate toward the enemy.
- **Training.**
  - No new starter is built for the goal courses: none reaches the maze goal, and only Mauler (33.8 s), Warden (56.6 s) and Sovereign (40.6 s) finish the obstacle course. The retired Pathfinder brain still solves the maze in the unit tests, so the course itself is solvable with sensors alone.
  - No balanced starter knocks out all three armour-test plates within 180 s (Picket, Mauler, Jackal and Paragon get two).
  - Every starter completes the missile test; only Paragon (51.5 s), Juggernaut (35.4 s) and Sovereign (5.6 s) complete the interception test.
  - Rapier (12.1 s), Paragon, Talon, Longbow and Mauler finish the cooling and power stress course.
  - Sovereign completes every course except the maze, including the weapon range (42.8 s) and the cooling and power stress course (3.1 s), and is the only starter to knock out all three armour-test plates (29.5 s). Its search pattern is built to find enemies, not to solve mazes.

### What changed since the previous recording, and why

The tables were re-run after three changes: temporary debris, the new layout table with the load model, and the engineering physics. To find which change moved which number, I ran the same measurements on each commit:
- `34c9a45`, before debris;
- `46c7620`, debris;
- `54a067e`, layouts and load;
- the current head.

- **Duels resolve instead of timing out. Cause: debris cleanup.**
  - Evidence: Assault Platform vs Skirmisher, Strider, Mantis and Bastion, seeds 1–3, both sides:

    | Opponent | Before debris (`34c9a45`) | After debris (`46c7620`) |
    | --- | --- | --- |
    | Skirmisher | 1 win, 5 draws | 5 wins, 1 draw |
    | Strider | 6 draws | 6 wins |
    | Mantis | 3 wins, 3 draws | 6 wins |
    | Bastion | 6 draws | 2 wins, 4 losses |

  - In the old Assault Platform vs Strider game (seed 1), Strider's detached section stayed in the arena for good. Strider's own rounds struck that debris 1,382 times and the Assault Platform's shells 16 times, and the game ended in a draw at 120 s.
  - With wrecks losing their colliders after 2 s, the same game ends at 19.5 s with Strider disabled.
  - The layout and physics commits changed these duels by at most one game per pairing.
- **Heavy cannon and coilgun knock out light plate sooner. Cause: `54a067e`.**
  - Heavy cannon: light plate at 150 u in 10.0 → 6.7 s; medium plate at 400 u in 16.7 → 13.4 s.
  - Coilgun: light plate at 150 u in 20.3 → 15.3 s.
  - Rates, heat and every other cell are unchanged.
  - That commit moved the test platform's large mount (heavy Medium layout, H1: (2, −7) → (3, −7.5)) and added the load model's ground resistance. I did not separate the two effects. Either way it is one fewer hit needed on some seeds, not a change to the weapons.
- **Point defense against missiles: 16% → 13%** (5 → 4 of 32). This also came with `54a067e`, the defender's mount moving with the new layout coordinates. Rockets and shells are unchanged.
- **Engineering physics (`8a6fcb9`) changed no starter's mobility.**
  - Ground starters' top speeds and accelerations from `computeStats` match the earlier build to within 2%. The +140 kg Maximum-layout frame shows on the Assault Platform and Bastion.
  - The flyers changed with the shared-thrust retune: Wisp 181 → 191 u/s, Harrier 180 → 178 u/s.
  - The heaviest starter section load is the Harrier's front at 1.19 of rated.

### Changes made because of these measurements

_"After" is the value at the time of the change; current values are in the tables above._

| Change | Evidence before | After |
| --- | --- | --- |
| Missile proximity fuze no longer fires when the missile is on a collision course | 8 missiles vs a 35 mm plate at 400 u: 8 proximity blasts, **0 direct hits**, plate never knocked out (65 mm / 75 direct-hit values never applied) | Direct hits penetrate; medium plate @400 knocked out in 18.7 s |
| Scatter pellets 8 mm / 3 → 13 mm / 4 | Knocked out no plate at any range; Mantis won 15% of duels | Light plate @150 in 8.5 s; Mantis 28% |
| Quad MG heat per shot 0.85 → 0.55; Dual Autocannon 3.4 → 2.6 | Both overheated before emptying one magazine (Quad after 143 of 240 rounds) | Quad empties a magazine with a Cooling Unit fitted; first lockout 15.2 s / 14.4 s with reloads |
| Interceptable rounds got integrity (rocket 6, shell 4, missile 10); point-defense spread 2.2° → 3°; shell collision radius 2.2 → 1.0 | One point-defense gun shot down **100%** of a 4-missile stream, 100% of rockets and 75% of heavy shells | 16% missiles, 44% rockets, 22% shells (8 seeds) |
| Interceptor rockets detonate on contact (blast kill chance 80% → 0 at the edge) and their seeker has 1.5° bearing error | 80 of 80 missiles intercepted head-on: interception was guaranteed | 94% (30 of 32) |
| Harrier brain: searches toward the arena centre and breaks away clear of walls | 0 wins in 20 games; trace showed it circling into the boundary wall (53 collisions) before ever seeing the enemy | 13% (8 wins in 60) |
| Needle brain: shoots from a standstill instead of reversing to "keep range" | Fired the coilgun **0** times in 60 s on the weapon range (never still enough to aim) | 25 shots in 150 s, 2 of 4 targets knocked out |

None of the numbers fixed in the brief changed. Unchanged values include:
- missile launcher 4 / 0.8 s / 14 s / 65 mm / 75;
- rocket and missile blasts 15 / 35 u and 24 / 40 u;
- rocket pod 0.4 s; coilgun 5 s charge; Quad MG 1800 rpm; Dual Autocannon 420 rpm;
- LIDAR 900 u / 180°;
- compact shield 90° / 110 / 25 per s / 3 s / 240°/s.

### Not resolved

- Light starters lose most straight duels against heavy ones. There is no points or weight budget to make unequal builds fair; that would be a game-mode decision.
- Juggernaut is not beaten by any balanced starter on Foundry Yard, and lost once in 252 duels across all three arenas in EVALUATION.md; only the boss, Sovereign, beats it (four wins and two draws in six here). Reducing its plate and shield did not change that; its weak sides and rear are rarely reached because the walker turns on the spot.
- About one duel in seven ends in a draw at 120 s, mostly against the walkers, whose brains hold their ground rather than hunt.
