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
| Heavy Cannon | 1 / 3.23 s | 1 / 3.2 s | none in 45 s | 57.1 s | 10.0 s | 13.2 s | 13.2 s | 10.2 s | 16.7 s | 16.7 s | 14.0 s | 20.5 s | 23.7 s |
| Coilgun | 1 / 5.03 s | 1 / 5 s | none in 45 s | 142.9 s | 20.3 s | 25.3 s | 30.3 s | 20.3 s | 30.4 s | 35.4 s | 20.5 s | 30.6 s | 35.6 s |
| Heavy Missile Launcher | 0.800 s interval | 0.8 s interval | none in 45 s | 200.0 s | 1.9 s | 17.5 s | 35.5 s | 3.1 s | 18.7 s | 35.9 s | 3.0 s | 19.4 s | — |

## 2. Interception

A heavy missile launcher (and, separately, a rocket pod or a heavy cannon) fires at a defender 800 u away for 6 s. Both carry radar. Counts are summed over the seeds; "arrived" = warheads that detonated or shells that struck, not shot down.

| Attack | Defense | Fired | Shot down | Hits that did not kill | Arrived | Shot down % | Defensive rounds fired | Seeds |
|---|---|---|---|---|---|---|---|---|
| Heavy Missile Launcher | Point defense gun | 32 | 5 | 73 | 27 | 16% | 182 | 8 |
| Heavy Missile Launcher | Rocket pod, interceptors | 32 | 30 | 0 | 2 | 94% | 45 | 8 |
| Rocket Pod | Point defense gun | 48 | 21 | 76 | 27 | 44% | 260 | 8 |
| Heavy Cannon | Point defense gun | 32 | 7 | 15 | 25 | 22% | 177 | 8 |

## 3. Starter duels

Every starter against every other starter with its own brain, Foundry Yard, 120 s limit, seeds 1, 2, 3; each pairing is played from both spawn sides. Cell = wins of the row drone over the column drone out of 6 games (draws are not wins).

| vs | Assa Plat | AA Dest | Skir | Stri | Wisp | Path | Need | Aegi | Mant | Harr | Bast |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Assault Platform** | · | 6 | 1 | 0 | 4 | 6 | 4 | 0 | 3 | 6 | 0 |
| **AA Destroyer** | 0 | · | 1 | 0 | 0 | 6 | 3 | 0 | 1 | 6 | 0 |
| **Skirmisher** | 0 | 0 | · | 0 | 0 | 6 | 0 | 0 | 2 | 6 | 0 |
| **Strider** | 0 | 0 | 0 | · | 0 | 6 | 1 | 0 | 3 | 6 | 0 |
| **Wisp** | 0 | 0 | 0 | 0 | · | 2 | 0 | 0 | 0 | 0 | 0 |
| **Pathfinder** | 0 | 0 | 0 | 0 | 3 | · | 0 | 0 | 0 | 1 | 0 |
| **Needle** | 0 | 0 | 0 | 0 | 2 | 0 | · | 0 | 6 | 2 | 0 |
| **Aegis** | 3 | 4 | 6 | 0 | 2 | 6 | 6 | · | 6 | 6 | 0 |
| **Mantis** | 0 | 3 | 2 | 0 | 0 | 6 | 0 | 0 | · | 6 | 0 |
| **Harrier** | 0 | 0 | 0 | 0 | 4 | 4 | 0 | 0 | 0 | · | 0 |
| **Bastion** | 0 | 5 | 4 | 6 | 6 | 6 | 6 | 0 | 3 | 5 | · |

| Starter | Wins | Losses | Draws | Win % | Brain runtime errors |
|---|---|---|---|---|---|
| Bastion | 41 | 0 | 19 | 68% | 0 |
| Aegis | 39 | 0 | 21 | 65% | 0 |
| Assault Platform | 30 | 3 | 27 | 50% | 0 |
| AA Destroyer | 17 | 18 | 25 | 28% | 0 |
| Mantis | 17 | 24 | 19 | 28% | 0 |
| Strider | 16 | 6 | 38 | 27% | 0 |
| Skirmisher | 14 | 14 | 32 | 23% | 0 |
| Needle | 10 | 20 | 30 | 17% | 0 |
| Harrier | 8 | 44 | 8 | 13% | 0 |
| Pathfinder | 4 | 48 | 8 | 7% | 0 |
| Wisp | 2 | 21 | 37 | 3% | 0 |

## 4. Starters on the training courses

Each starter alone (seed 1) with its own brain. Time = when the objective was met; "—" = not met within the course limit, with the outcome.

| Starter | Basic maze | Obstacle course | Weapon range | Armor test | Interception test | Missile test | Cooling and power stress |
|---|---|---|---|---|---|---|---|
| Assault Platform | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (2 of 4 targets knocked out in 150 s) | — (1 of 3 targets knocked out in 180 s) | 59.9 s | 35.1 s | 13.7 s |
| AA Destroyer | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | 37.0 s | — (1 of 3 targets knocked out in 180 s) | 50.2 s | 79.7 s | — (0 of 1 targets knocked out in 120 s) |
| Skirmisher | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | 36.7 s | — (0 of 3 targets knocked out in 180 s) | 60.0 s | 72.6 s | — (0 of 1 targets knocked out in 120 s) |
| Strider | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (2 of 4 targets knocked out in 150 s) | — (0 of 3 targets knocked out in 180 s) | 49.5 s | — (1 of 2 targets knocked out in 180 s) | — (0 of 1 targets knocked out in 120 s) |
| Wisp | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (2 of 4 targets knocked out in 150 s) | — (0 of 3 targets knocked out in 180 s) | — (Did not survive: Wisp: Disabled) | — (1 of 2 targets knocked out in 180 s) | — (0 of 1 targets knocked out in 120 s) |
| Pathfinder | 134.8 s | 124.3 s | — (3 of 4 targets knocked out in 150 s) | — (0 of 3 targets knocked out in 180 s) | — (Did not survive: Pathfinder: Disarmed) | 56.4 s | — (0 of 1 targets knocked out in 120 s) |
| Needle | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (2 of 4 targets knocked out in 150 s) | — (1 of 3 targets knocked out in 180 s) | 60.0 s | — (1 of 2 targets knocked out in 180 s) | 51.3 s |
| Aegis | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (2 of 4 targets knocked out in 150 s) | — (1 of 3 targets knocked out in 180 s) | 50.8 s | 87.2 s | 12.0 s |
| Mantis | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (3 of 4 targets knocked out in 150 s) | — (0 of 3 targets knocked out in 180 s) | — (Did not survive: Mantis: Disarmed) | 65.4 s | — (0 of 1 targets knocked out in 120 s) |
| Harrier | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (1 of 4 targets knocked out in 150 s) | — (0 of 3 targets knocked out in 180 s) | — (Did not survive: Harrier: Disarmed) | — (1 of 2 targets knocked out in 180 s) | — (0 of 1 targets knocked out in 120 s) |
| Bastion | — (Goal not reached within 240 s) | — (Goal not reached within 150 s) | — (2 of 4 targets knocked out in 150 s) | — (1 of 3 targets knocked out in 180 s) | 60.0 s | — (0 of 2 targets knocked out in 180 s) | 10.9 s |

_Generated by `npx vite-node scripts/balance.ts` in 150 s._
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
  - A single point-defense gun stopped 44% of offensive rockets, 22% of heavy-cannon shells and 16% of heavy missiles.
  - A rocket pod firing interceptor rockets stopped 94% of missiles, spending 45 interceptors on 32 missiles.
  - Interceptors are the hard counter to missiles but use up a medium hardpoint and storage. Point defense is a partial counter to everything.
- **Starters: heavy designs win straight duels.**
  - Bastion (68%), Aegis (65%) and the Assault Platform (50%) are never or almost never beaten.
  - Wisp (3%), Pathfinder (7%) and Harrier (13%) lose most of their games.
  - About 40% of games are draws at the 120 s limit.
  - Read this as "a 1-on-1 between unequal masses favours mass and armor", not as a ladder. Nothing equalises cost or weight. The light starters are built to teach: navigation (Pathfinder), flying (Wisp), hit-and-run (Harrier).
- **Training.**
  - Pathfinder is the only starter whose brain navigates: maze in 134.8 s, obstacle course in 124.3 s. The others have no navigation logic and never reach a goal, which is the point of the course.
  - No starter knocks out all three armor-test plates within 180 s. The brains target the nearest contact and keep firing at plates that are already knocked out but not disabled. That is a programming lesson, not a bug.
  - The heavy, cannon-armed starters (Bastion 10.9 s, Aegis 12.0 s, Assault Platform 13.7 s) finish the stress course. Designs built around sustained small-calibre fire do not.

### Changes made because of these measurements

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
- Many duels end in a draw at 120 s, because the defensive heavy brains (Aegis, Bastion) hold position rather than hunt.
