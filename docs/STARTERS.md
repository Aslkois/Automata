# Starter drones

AUTOMATA ships 16 starter drones. Fifteen are balanced teaching machines, each built around one combat problem with its own hand-written brain; they climb from a dozen-line beginner program to expert brains with memory and utility scoring. The sixteenth, **Sovereign**, is the only member of the **Boss** tier: it is not balanced, and it is built to dominate. All of them use only the public drone API and what their own sensors report — no starter sees through walls, reads enemy health or knows where an unseen enemy is — and all of them obey the same construction rules and physics.

This page is generated from the roster’s own data by `scripts/starters-doc.ts`. Measured results against each other are in [EVALUATION.md](EVALUATION.md).

| Starter | Complexity | Chassis | Role | Mass | Top speed | Brain | Opens in |
|---|---|---|---|---|---|---|---|
| [Picket](#picket) | beginner | wheeled | General-purpose wheeled gunner | 2.81 t | 176 u/s | 32 lines | Blocks |
| [Gnat](#gnat) | beginner | flying | Light flying harasser | 2.34 t | 183 u/s | 30 lines | Blocks |
| [Bulldog](#bulldog) | beginner | tracked | Tracked close-assault brawler | 5.07 t | 151 u/s | 27 lines | Nodes |
| [Hornet](#hornet) | intermediate | flying | Flying rocket striker | 2.39 t | 182 u/s | 74 lines | Nodes |
| [Rapier](#rapier) | intermediate | wheeled | Wheeled duelist | 3.36 t | 174 u/s | 75 lines | Blocks |
| [Kestrel](#kestrel) | intermediate | wheeled | Wheeled air-defence interceptor | 3.21 t | 175 u/s | 57 lines | Code |
| [Citadel](#citadel) | intermediate | walking | Walking area-control fortress | 6.60 t | 94 u/s | 49 lines | Blocks |
| [Longbow](#longbow) | advanced | walking | Walking coilgun marksman | 4.91 t | 98 u/s | 86 lines | Code |
| [Mauler](#mauler) | advanced | tracked | Tracked armour breaker | 6.82 t | 137 u/s | 68 lines | Code |
| [Jackal](#jackal) | advanced | wheeled | Wheeled close-quarters hunter | 3.19 t | 175 u/s | 90 lines | Code |
| [Talon](#talon) | advanced | wheeled | Wheeled missile artillery | 4.15 t | 180 u/s | 76 lines | Code |
| [Warden](#warden) | advanced | tracked | Tracked missile and rocket defence | 5.68 t | 146 u/s | 85 lines | Nodes |
| [Viper](#viper) | advanced | wheeled | Wheeled flanker | 2.86 t | 167 u/s | 74 lines | Code |
| [Paragon](#paragon) | expert | wheeled | Wheeled adaptive generalist | 4.67 t | 178 u/s | 234 lines | Code |
| [Juggernaut](#juggernaut) | expert | walking | Walking siege platform | 8.46 t | 90 u/s | 123 lines | Code |
| [Sovereign](#sovereign) | **boss** | tracked | Boss — the strongest legitimate machine we could engineer | 14.90 t | 113 u/s | 846 lines | Code |

## Beginner

### Picket

*General-purpose wheeled gunner* · wheeled

- **Problem it solves:** Any single opponent at medium range, with nothing clever about it.
- **Engineering:** Two autocannons and a camera on a medium front plate; two magazines of 25×137mm in the middle. Nothing it carries goes unused.
- **Behaviour:** Turns toward the nearest enemy, keeps it between 350 and 550 u (reversing when it is too close) and fires both guns when they bear. With nothing in sight it drives to the middle of the arena and circles there.
- **Strengths:** Steady at medium range; faces its front plate to the enemy; plenty of ammunition.
- **Weaknesses:** Its 26 mm autocannons cannot get through a thick front plate. Predictable.
- **Learning focus:** The whole loop of a brain on one screen: sense, decide, move, shoot. Why a wheeled drone steers the other way when it reverses.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | medium / medium | 25 mm | H1 Autocannon, H2 Autocannon, H3 Optical Camera |
| middle | light / medium | 12 mm | I1 Medium-Calibre Magazine, I2 Medium-Calibre Magazine |
| rear | light / medium | 8 mm | — |

### Gnat

*Light flying harasser* · flying

- **Problem it solves:** Light and slow-turning targets that a fast circling drone can out-turn.
- **Engineering:** Two autocannons and a camera on a light flying frame with 10–12 mm of plate, which stops machine-gun and point-defense rounds. Ammunition in the middle and rear keeps the front light enough to fly well.
- **Behaviour:** Never stops: circles the enemy about 240 u out, swinging its course to and fro so the enemy’s lead is always a little behind, and fires both guns when they bear.
- **Strengths:** Fast; hard to track for slow turrets; rifle-calibre fire barely marks it.
- **Weaknesses:** Light plate: anything from 17 mm up goes through. Cannot hurt heavy front armour.
- **Learning focus:** Movement as defence. Steering by an offset from the enemy’s bearing.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | light / min | 12 mm | H1 Autocannon, H2 Autocannon, H3 Optical Camera |
| middle | light / medium | 12 mm | I1 Medium-Calibre Magazine |
| rear | light / medium | 10 mm | I1 Medium-Calibre Magazine |

### Bulldog

*Tracked close-assault brawler* · tracked

- **Problem it solves:** Getting a short-range weapon to point-blank range against an enemy that shoots back.
- **Engineering:** Two scatter cannons and a machine gun behind 60 mm of front plate on tracks, with two magazines of 12-gauge buckshot. The plate is what lets short-range guns arrive.
- **Behaviour:** Asks the drone for its weapons and lets each one fire only inside 80 % of its own range — the machine gun on the way in, the scatter cannons up close. Charges nose-first, going round anything in the way.
- **Strengths:** Very hard to stop from the front. Simple and robust.
- **Weaknesses:** Slow; no camera (it only senses 420 u around itself); pellets cannot get through thick plate.
- **Learning focus:** Looping over drone.weapons() and using each weapon’s own data instead of hard-coding it.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | heavy / min | 60 mm | H1 Scatter Cannon, H2 Scatter Cannon, H3 Machine Gun, I1 Small-Calibre Magazine |
| middle | medium / medium | 25 mm | I1 Medium-Calibre Magazine [scatter], I2 Medium-Calibre Magazine [scatter] |
| rear | light / medium | 10 mm | — |

## Intermediate

### Hornet

*Flying rocket striker* · flying

- **Problem it solves:** Delivering a heavy burst of explosive damage and surviving the reply.
- **Engineering:** A six-rocket pod forward, a cassette of 70mm HE rockets, a camera looking each way and a tail gun that faces backwards to cover the break-away.
- **Behaviour:** A state machine with a memory: ATTACK (dive and release the salvo inside 700 u, crossing the target’s front when close), BREAK (turn away while the pod reloads, alternating sides), RETURN (back to where the target was last seen), SEARCH.
- **Strengths:** A full salvo wrecks light and medium drones; it is gone before the reply lands.
- **Weaknesses:** Light plate; long reloads; loses many duels against steady medium gunners.
- **Learning focus:** States and transitions, logged with drone.log; remembering a last sighting.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | light / max | 10 mm | H1 Rocket Pod |
| middle | light / medium | 10 mm | H1 Optical Camera, H2 Optical Camera (180°), I1 Small-Calibre Magazine, I2 Rocket Cassette |
| rear | light / min | 8 mm | H1 Machine Gun (180°) |

### Rapier

*Wheeled duelist* · wheeled

- **Problem it solves:** Winning one-on-one gunfights against drones of its own weight.
- **Engineering:** A dual autocannon (50 mm, 42-round magazine, sync or sequence fire) and a machine gun behind 28 mm of front plate; 12 mm and 8 mm further back.
- **Behaviour:** Always nose-on: it moves by driving forward and reversing, never by turning side-on. It fights closer against large targets and further from small ones, switches the dual autocannon to paired fire against large hulls, and backs out of reach while it reloads.
- **Strengths:** Hard-hitting; shows only its best plate; uses its reload time well.
- **Weaknesses:** Loses to heavier plate it cannot penetrate, and to anything that gets behind it.
- **Learning focus:** Armour is per section: facing matters. Range against penetration. Fire modes.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | medium / medium | 28 mm | H1 Dual Autocannon, H2 Machine Gun, H3 Optical Camera |
| middle | light / medium | 12 mm | I1 Medium-Calibre Magazine, I2 Small-Calibre Magazine |
| rear | light / medium | 8 mm | I1 Medium-Calibre Magazine |

### Kestrel

*Wheeled air-defence interceptor* · wheeled

- **Problem it solves:** Fast flyers and skirmishers that ordinary gunners cannot track.
- **Engineering:** A quad machine gun (1800 rpm) and an autocannon, a radar for early warning, a cooling unit next to the quad, and three magazines.
- **Behaviour:** Takes the fastest target it can see, leads each gun with its own intercept solution, fires the quad in 1.5 s bursts below 80 heat, and keeps fast targets in front where both guns overlap. Against slow targets it stands off at autocannon range.
- **Strengths:** Shreds light flyers; sees them coming on radar.
- **Weaknesses:** The quad cannot penetrate armour; against heavy drones it relies on one autocannon.
- **Learning focus:** Custom target scoring; heat management with bursts.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | medium / medium | 22 mm | H1 Quad Machine Gun, H2 Autocannon, H3 Search Radar, I1 Small-Calibre Magazine, I2 Cooling Unit |
| middle | light / medium | 10 mm | I1 Small-Calibre Magazine, I2 Medium-Calibre Magazine |
| rear | light / medium | 8 mm | — |

### Citadel

*Walking area-control fortress* · walking

- **Problem it solves:** Holding the middle of the arena against several enemies at once.
- **Engineering:** Rotary cannons forward-left and forward-right, a quad machine gun on each side, two machine guns astern, radar, cooling, a thermal reservoir and its own generator — on legs that brace when it stands still.
- **Behaviour:** Walks to a post near the middle and holds it. Every weapon independently picks the nearest enemy inside its own arc, so it fights in all directions without turning. It turns only for an enemy no gun can reach.
- **Strengths:** No blind side; braced, accurate fire; good against groups.
- **Weaknesses:** Slow; its guns are light against heavy plate; it cannot chase.
- **Learning focus:** Per-weapon decisions with drone.inArc; standing still on purpose.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | heavy / min | 45 mm | H1 Rotary Cannon (-30°), H2 Rotary Cannon (30°), H3 Search Radar, I1 Cooling Unit, I2 Medium-Calibre Magazine, I3 Thermal Reservoir, I4 Compact Generator |
| middle | medium / medium | 25 mm | H1 Quad Machine Gun (-90°), H2 Quad Machine Gun (90°), I1 Small-Calibre Magazine, I2 Medium-Calibre Magazine, I3 Small-Calibre Magazine |
| rear | light / medium | 12 mm | H1 Machine Gun (180°), H2 Machine Gun (180°), I1 Small-Calibre Magazine |

## Advanced

### Longbow

*Walking coilgun marksman* · walking

- **Problem it solves:** Killing armoured targets from beyond the range most weapons answer.
- **Engineering:** A coilgun (92 mm penetrator, 2200 u/s) with a capacitor, a stabilizer and a generator to feed its charge; radar and camera to see 900 u; two rear machine guns. Walking legs brace when it stands still.
- **Behaviour:** Plants itself 400–850 u away, gives weapons power priority while the coil charges, and fires only when braced, settled and exactly on the lead point. When a target disappears it keeps the gun on where it should reappear; when one gets close it backs off.
- **Strengths:** Each hit is devastating and almost certain; outranges nearly everything.
- **Weaknesses:** One shot every 5 s; slow; fast flankers and drones that close quickly.
- **Learning focus:** Stability, bracing and power allocation; firing on a condition rather than continuously.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | medium / max | 30 mm | H1 Coilgun, H2 Optical Camera, I1 Capacitor Bank, I2 Gyroscopic Stabilizer, I3 Shell Rack [penetrator] |
| middle | medium / medium | 22 mm | H1 Search Radar, I1 Compact Generator, I2 Capacitor Bank |
| rear | light / medium | 10 mm | H1 Machine Gun (180°), H2 Machine Gun (180°), I1 Small-Calibre Magazine |

### Mauler

*Tracked armour breaker* · tracked

- **Problem it solves:** Heavily armoured opponents.
- **Engineering:** A 100 mm heavy cannon with an autoloader and shell racks, a rotary cannon for light targets, 65 mm of front plate, fire suppression and a spall liner.
- **Behaviour:** Aims the cannon at the rear section of the target (estimated from its observed heading), fires only from a still hull on an exact aim, then shuffles along its hull axis with the plate angled so the enemy’s lead goes stale. The rotary handles fast and small targets and covers the reload.
- **Strengths:** Breaks anything; hard to hurt from the front.
- **Weaknesses:** One heavy shell every 2.6 s; fast flyers and flankers; slow to reposition.
- **Learning focus:** Aim points from observed geometry; timing shots; angling armour.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | heavy / medium | 65 mm | H1 Heavy Cannon, H2 Rotary Cannon, H3 Optical Camera, I1 Cooling Unit, I2 Autoloader, I3 Shell Rack |
| middle | medium / medium | 28 mm | H1 Search Radar, I1 Medium-Calibre Magazine, I2 Fire Suppression System, I3 Spall Liner |
| rear | light / medium | 12 mm | I1 Battery |

### Jackal

*Wheeled close-quarters hunter* · wheeled

- **Problem it solves:** Catching drones around cover and finishing them up close.
- **Engineering:** An autocannon to soften the target, two scatter cannons to finish it, a LIDAR to see cover, 28 mm of front plate and buckshot magazines in the middle.
- **Behaviour:** Closes on a weave toward a point beside its target, slips round cover with the LIDAR, follows a target it has lost along its last heading, finishes from behind and backs off nose-on to reload.
- **Strengths:** Deadly at close range against light and medium plate, turrets and running gear.
- **Weaknesses:** Short-ranged; has to cross open ground to arrive.
- **Learning focus:** LIDAR navigation (widestGap); memory of a lost target; approach geometry.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | medium / min | 28 mm | H1 Autocannon, H2 Scatter Cannon, H3 Scatter Cannon, H4 LIDAR Scanner |
| middle | light / medium | 14 mm | I1 Medium-Calibre Magazine [scatter], I2 Medium-Calibre Magazine [scatter] |
| rear | light / medium | 10 mm | I1 Medium-Calibre Magazine |

### Talon

*Wheeled missile artillery* · wheeled

- **Problem it solves:** Hitting targets that hide or move, from very far away.
- **Engineering:** A heavy missile launcher (four guided 150mm missiles, reserve of eight), radar uplink and camera, a battery, and machine guns facing backwards for when something gets close.
- **Behaviour:** Launches only at targets tracked for a moment and between 250 and 880 u, saves its last missiles for closer shots, relocates during the 14 s reload, and runs from anything inside 330 u with its rear guns working.
- **Strengths:** Guided hits from beyond most weapons’ reach; shoot-and-scoot is hard to answer.
- **Weaknesses:** Long reload; point defense and interceptors; fast attackers that get close.
- **Learning focus:** Guided weapons and designation; ammunition economy; relocation.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | medium / max | 22 mm | H1 Heavy Missile Launcher, H2 Optical Camera, I3 Missile Reserve |
| middle | medium / medium | 18 mm | H1 Search Radar, H3 Machine Gun (180°), I1 Small-Calibre Magazine, I2 Battery |
| rear | light / medium | 8 mm | H1 Machine Gun (180°) |

### Warden

*Tracked missile and rocket defence* · tracked

- **Problem it solves:** Long-range shooters: missiles, rockets and snipers.
- **Engineering:** Radar, two point-defense guns, a rocket pod with an interceptor share and a cassette of 70mm Interceptors, a single autocannon for offence, 50 mm of front plate.
- **Behaviour:** Triage of incoming rounds: missiles first, then the soonest impact, one point-defense gun per threat, interceptors at missiles. Each incoming round is traced back to its shooter’s bearing, and Warden advances along it even when it cannot see the shooter. Offence is deliberately modest: one autocannon.
- **Strengths:** Shrugs off guided weapons and rocket salvos; finds hidden shooters.
- **Weaknesses:** Slow; point defense does nothing against cannon shells or coilgun rounds; its one autocannon cannot get through heavy plate.
- **Learning focus:** Threat lists, sorting and assignment; inference from what the radar sees.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | heavy / medium | 50 mm | H1 Autocannon, H2 Rocket Pod [3 interceptors], H3 Point Defense Gun, I1 Medium-Calibre Magazine, I2 Rocket Cassette [8 interceptors] |
| middle | medium / medium | 28 mm | H1 Search Radar, H2 Point Defense Gun, I1 Small-Calibre Magazine, I2 Battery |
| rear | light / medium | 10 mm | I1 Medium-Calibre Magazine |

### Viper

*Wheeled flanker* · wheeled

- **Problem it solves:** Heavy drones whose front plate it cannot beat.
- **Engineering:** A rotary cannon on a light, fast frame with a camera, side machine guns angled outwards to cover the turn, and three magazines.
- **Behaviour:** Reads the target’s heading and drives an arc round the outside of its front sector to its side or rear, where forward guns cannot follow and the plate is thin; if the target turns to face it, it keeps circling the other way. It follows a lost target along its last heading.
- **Strengths:** Beats slow heavies from behind.
- **Weaknesses:** Light plate; anything that turns quickly or covers its rear.
- **Learning focus:** Aspect angles and geometry from heading; moving to a computed point.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | light / max | 15 mm | H1 Rotary Cannon, H2 Optical Camera, I1 Medium-Calibre Magazine |
| middle | light / medium | 14 mm | H1 Machine Gun (-60°), H2 Machine Gun (60°), I1 Small-Calibre Magazine, I2 Medium-Calibre Magazine |
| rear | light / medium | 8 mm | — |

## Expert

### Paragon

*Wheeled adaptive generalist* · wheeled

- **Problem it solves:** Any opponent, decided at run time.
- **Engineering:** A dual autocannon, a rocket pod with a few interceptors, a point-defense gun, radar, a rear machine gun, a cooler and a battery — a bit of everything, all of it used.
- **Behaviour:** Keeps a memory of contacts; scores targets by what its working weapons can do to them, their threat and how fresh the information is; scores PRESS, DUEL, STANDOFF and WITHDRAW against the situation and switches with hysteresis; assigns point defense and interceptors to incoming rounds; manages heat, power and getting unstuck. Every decision is logged with its reason.
- **Strengths:** No bad matchup by design; adapts to damage.
- **Weaknesses:** A master of none: specialists beat it at their speciality.
- **Learning focus:** Utility scoring, memory, hysteresis and explainable decisions.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | medium / medium | 30 mm | H1 Dual Autocannon, H2 Rocket Pod [2 interceptors], H3 Optical Camera, I1 Medium-Calibre Magazine, I2 Cooling Unit, I3 Rocket Cassette [4 interceptors] |
| middle | medium / medium | 22 mm | H1 Search Radar, H2 Point Defense Gun, I1 Small-Calibre Magazine, I2 Medium-Calibre Magazine |
| rear | light / medium | 10 mm | H1 Machine Gun (180°), I1 Battery |

### Juggernaut

*Walking siege platform* · walking

- **Problem it solves:** Long fights against anything, won by sustained fire.
- **Engineering:** Two 100 mm heavy cannons with an autoloader and two shell racks, a reactor, a compact shield, point defense forward, one machine gun astern, fire suppression, a coupling to stiffen the front joint, coolers and a thermal reservoir — on legs that carry it all. 55 mm in front, 30 mm on the sides, 12 mm behind.
- **Behaviour:** Stands braced to fire and alternates its cannons; fires one at a time when the front joint weakens; rests a hot cannon; puts fires out at once; faces the shield at the greater danger and drops it when power runs low; reassesses when damaged.
- **Strengths:** Enormous firepower and protection.
- **Weaknesses:** Very slow; its sides (30 mm) and rear (12 mm) are thin and only one machine gun covers the back.
- **Learning focus:** Structural, thermal and power management; reacting to damage.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | heavy / max | 55 mm | H1 Heavy Cannon, H2 Heavy Cannon, H3 Point Defense Gun, I1 Cooling Unit, I2 Autoloader, I3 Shell Rack, I4 Reactor |
| middle | heavy / min | 30 mm | H1 Search Radar, H2 Compact Shield Emitter, H3 Machine Gun (180°), I1 Fire Suppression System, I2 Shell Rack, I3 Reinforced Coupling, I4 Small-Calibre Magazine |
| rear | light / medium | 12 mm | I1 Cooling Unit, I2 Thermal Reservoir |

## Boss

Sovereign is the final examination. Its hardware was chosen by measuring eight candidate hulls in simulated combat, and its brain — about 800 lines, the largest in the roster — was rewritten and re-measured until further changes stopped paying off. Measured results, including against custom battleships, missile batteries and packs of two or three drones, are in [EVALUATION.md](EVALUATION.md) §7; how it was engineered is in §8.

### Sovereign

*Boss — the strongest legitimate machine we could engineer* · tracked

- **Problem it solves:** Everything: the starter roster, purpose-built battleships, missile batteries, swarms — and being outnumbered. It is not balanced and is not meant to be.
- **Engineering:** Chosen by measuring eight candidate hulls in simulated combat against the roster and a suite of custom opponents. Tracked (faster than legs at this weight, turns on the spot); 70 mm on all three heavy sections, so no face is weak; four heavy cannons forward on two autoloaders; a dual autocannon whose 50 mm rounds strip other drones’ turrets; a directional shield; point defense and an interceptor rocket pod with a cassette, against shells and missiles; radar; two reactors. All 60 shells ride in three racks in the rear section — a shell rack cooks off when hit, and in the measured trials a forward rack was the first thing to go — and a spall liner guards the middle section, which holds the CPU and power core. 14.9 t, 113 u/s.
- **Behaviour:** Nine cooperating systems: a self-model (sections, every weapon, power, damage intake); a memory of every contact (position history, velocity, behaviour — rushing, kiting, circling, static — and weapon evidence, from tracing each incoming round back to its shooter); a threat model (danger to us, what our working weapons can do to it); target choice with commitment; a doctrine — destroy, close, screen, recover, pursue, search — scored against the situation, held for a minimum time and abandoned when it costs structure without result (failed ranges are remembered per target); fire control by role (full heavy volleys on good solutions, turret-stripping secondaries, point defense and interceptors on their own); nose-on stance and shield toward the worst fire; wall-following navigation, clearing blocked lines of fire, looking round cover, backing out when enemies spread round it; ammunition and power management. Every decision is logged with its reason.
- **Strengths:** Beats every starter including Juggernaut, and most purpose-built custom opponents; wins most fights against two or three drones at once.
- **Weaknesses:** Two heavy-cannon battleships of its own class at once; its tracks (8 mm) can be shot off by machine guns; slow to bring its turrets round on a surprise contact at close range.
- **Learning focus:** How far engineering and a layered, explainable brain can go — and what you would have to build to beat it. Most of its edge is the hull: a Configure brain on the same hardware comes close; the hand-written brain shows in finishing fights and in being outnumbered.

| Section | Class / layout | Armour | Equipment |
|---|---|---|---|
| front | heavy / max | 70 mm | H1 Heavy Cannon, H2 Heavy Cannon, H3 Dual Autocannon, I1 Cooling Unit, I2 Autoloader, I3 Medium-Calibre Magazine, I4 Reactor |
| middle | heavy / max | 70 mm | H1 Heavy Cannon, H2 Heavy Cannon, H3 Directional Shield, I1 Small-Calibre Magazine, I2 Autoloader, I3 Spall Liner, I4 Reactor |
| rear | heavy / min | 70 mm | H1 Rocket Pod [6 interceptors], H2 Search Radar, H3 Point Defense Gun, I1 Rocket Cassette [8 interceptors], I2 Shell Rack, I3 Shell Rack, I4 Shell Rack |

## How the roster was put together

- **No quota.** Each starter answers a different question: what problem it solves, why its chassis, why every part is there, how it fights, what it does when the matchup is bad, what it teaches, and why the roster needs it. Designs that could not answer all seven were not kept.
- **All four chassis are used on purpose:** wheels for speed and duels (Picket, Rapier, Kestrel, Jackal, Talon, Viper, Paragon), tracks for armour that must arrive (Bulldog, Mauler, Warden, Sovereign), legs for braced firing platforms (Citadel, Longbow, Juggernaut), and thrusters for speed above all (Gnat, Hornet).
- **Every part is used by the brain.** A unit test fails if a starter carries a weapon or shield its brain never addresses.
- **The brains are separate programs,** not one template with different numbers: they share helper functions from the standard library, but the decision logic of each is its own (see the program-similarity line in EVALUATION.md).
- **Distinct behaviour is measured,** not assumed: EVALUATION.md fingerprints each starter’s movement, range, facing and fire from simulation telemetry.

## Retired starters

The previous eleven examples (Assault Platform, AA Destroyer, Skirmisher, Strider, Wisp, Pathfinder, Needle, Aegis, Mantis, Harrier, Bastion) are no longer registered. A library that still holds them unchanged has them retired on load — their programs are kept under **Program → Recovered**, and the whole library is backed up first in `localStorage` as `automata.library.before-roster-3`. Any old example you changed in any way (design or program) stays in your library as your own drone.
