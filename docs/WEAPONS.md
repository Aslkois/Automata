# Weapons and ammunition

All values come from `src/sim/content/components.ts`. Rates are **per mount**: a Quad Machine Gun's 1800 rpm is the four barrels together, not each barrel. Measured behaviour (rates, heat, time to knock out armor, interception) is in [BALANCE.md](BALANCE.md).

## The eleven weapons

| Weapon | Mount | Mass | Ammunition | Rate | Penetration / damage | Magazine · reload | Range* | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Machine Gun | S | 90 kg | small | 600 rpm | 9 mm / 5 | 60 · 3 s | ~730 u | Useless against plate; shreds exposed equipment and thin hulls |
| Autocannon | S | 160 kg | medium | 300 rpm | 26 mm / 13 | 35 · 3.5 s | ~920 u | 1350 u/s, 0.6° spread, 280°/s traverse. Replaces the AA Autocannon |
| Point Defense Gun | S | 110 kg | small | 1200 rpm | 5 mm / 2.5 | 100 · 3 s | ~350 u | 720°/s traverse; its rounds can strike incoming shells, rockets and missiles |
| Scatter Cannon | S | 135 kg | scatter shells | 120 shells/min | 10 pellets × 13 mm / 4 | 8 · 3.2 s | ~340 u | Ten physical pellets in a 5° cone; both values fall quickly with distance |
| Quad Machine Gun | M | 360 kg | small | 1800 rpm combined | 9 mm / 4.5 | 240 · 5 s | ~710 u | Four barrels, staggered order 1-3-2-4 |
| Rotary Cannon | M | 380 kg | medium | 800 rpm | 17 mm / 7 | 120 · 5 s | ~800 u | 0.7 s spin-up at 8 PU/s; overheats before its magazine is empty without extra cooling |
| Dual Autocannon | M | 620 kg | medium | 420 rpm combined | 50 mm / 15 | 42 · 5.5 s | ~925 u | Two barrels: alternating, or synchronised (pairs, double kick, same combined rate) |
| Rocket Pod | M | 320 kg | rockets / interceptors | one per 0.4 s | 36 mm / 38 + blast | 6 · 4.5 s | ~1050 u | Six tubes. Ready load split between offensive and interceptor rockets |
| Heavy Cannon | L | 700 kg | shells | one per 3.2 s | 100 mm / 120 | 1 · 3.2 s | ~1130 u | 60 000 recoil; its shells can be shot down |
| Coilgun | L | 680 kg | penetrators | one per 5 s charge | 92 mm / 95 | 1 · 5 s charge | ~1200 u | 2200 u/s, 0.15° spread; the charge draws 34 PU/s |
| Heavy Missile Launcher | L | 800 kg | missiles | one per 0.8 s | 65 mm / 75 + blast | 4 · 14 s | ~1800 u | Guided; a reload consumes Missile Reserve stock |

\*Range is the distance at which the round still has useful energy (muzzle velocity × lifetime × 0.85), or the stated engagement range for rockets and missiles.

## Ammunition families

Each weapon accepts one family, except the rocket pod, which takes two. Magazines reload from **storage modules** in internal bays, from any section, while the store and the weapon both work.

| Ammo | Id | Used by | Stored in |
| --- | --- | --- | --- |
| 7.62×51mm | `small` | MG, Quad MG, Point Defense | Small-Calibre Magazine: 1500 |
| 25×137mm | `medium` | Autocannon, Rotary, Dual Autocannon | Medium-Calibre Magazine (payload `medium`): 400 |
| 12-gauge Buckshot | `scatter` | Scatter Cannon | Medium-Calibre Magazine (payload `scatter`): 60 |
| 120mm AP | `shell` | Heavy Cannon | Shell Rack (payload `shell`): 20 |
| 30mm Tungsten Penetrator | `penetrator` | Coilgun | Shell Rack (payload `penetrator`): 24 |
| 70mm HE Rocket / 70mm Interceptor | `rocket` / `interceptor` | Rocket Pod | Rocket Cassette: 12, with a configurable interceptor split |
| 150mm Guided Missile | `missile` | Heavy Missile Launcher | Missile Reserve: 8 |

The id is what programs and saved designs use (e.g. `drone.selectAmmo('F.H1', 'interceptor')`).

A Medium-Calibre Magazine or a Shell Rack holds **one** payload at a time, chosen on the mount in Construct. Every store cooks off when destroyed, releasing energy in proportion to what is still inside. Shells and missiles are the most violent.

## Multi-barrel weapons

Barrels have real positions across the mount. Each round leaves from its own barrel, recoil is applied at that barrel, and the shot event carries the barrel index for effects and sound. A multi-barrel gun below half integrity jams half its barrels and fires at half rate. Launcher tubes do not jam.

The fire scheduler works below the 60 Hz tick: when two or more events fall inside one tick, each projectile starts with the part of the tick it has already flown. That is how 1800 rpm (30 rounds/s) is exact at 60 Hz. Tests measure it.

## Pellets

A scatter shell becomes ten separate projectiles spread evenly across the 5° cone, with a little seeded jitter. Each pellet flies, decelerates and strikes on its own. Ten pellets in one place is devastating; at range most of them miss a small target and the survivors have lost penetration.

## Rockets

Rockets accelerate under thrust: offensive rockets reach 700 u/s, interceptors 820 u/s. They do not lose energy to drag while the motor burns.

- **Offensive rockets** explode on impact: 36 mm direct penetration and 38 damage, then a blast of 15 damage within 35 u.
- **Interceptor rockets** carry a 60° / 320 u seeker that locks the nearest hostile interceptable round. They steer at up to 260°/s and detonate within 9 u of it.
  - Their 14 u blast destroys each round in reach with a chance that falls from 80% at the burst point to 0 at the edge.
  - The seeker measures bearing with a 1.5° error.
  - A miss is possible, and recorded in BALANCE.md.

`drone.selectAmmo(id, "interceptor" | "rocket")` chooses what fires next. A reload refills in the configured split.

## Guided missiles

- At launch, a missile takes the **designated** contact (`drone.designate`), or else the enemy nearest the aim line that the drone can currently see. It never gets a target the drone cannot see.
- In flight it updates its track from:
  - its own **seeker**: 40° cone, 380 u, line of sight, 0.5° bearing error;
  - the **uplink**: the launching drone's latest sensor contact for that target.
- With no fresh track for 1.5 s it flies straight on. It steers toward a predicted intercept point at no more than 95°/s.
- It arms after 0.25 s. A missile on a collision course strikes directly (65 mm, 75 damage). One passing within 6 u of a hull detonates by proximity. Either way the 40 u, 24-damage blast follows.
- `drone.missiles()` reports each missile's tracking source ("seeker", "uplink" or "lost").

## Interception

Interceptable rounds are cannon shells, rockets and missiles. Point-defense bullets must physically cross them; there is no hit roll. Each hit subtracts the bullet's current damage from the round's **integrity**, and the round breaks up when integrity reaches zero.

| Round | Integrity | Point-defense hits needed |
| --- | --- | --- |
| Offensive rocket | 6 | 3 |
| Cannon shell | 4 | 2 |
| Heavy missile | 10 | 4 |

A warhead that breaks up releases 35% of its blast over 60% of its radius.

## Explosions

A blast affects each section and each exposed component at most once:

- **Falloff**: damage falls linearly to zero at the radius, measured from the blast to the nearest point of each section.
- **Occlusion**: walls between the blast and a section block it (line of sight).
- **Shields**: a raised shield whose arc faces the blast absorbs it first.
- **Armor**: structure damage is scaled by `1 − armor/90` (minimum 25%).
- **Fragments** reach internal equipment only through plate thinner than their penetration (6 mm rockets, 8 mm missiles). A Spall Liner cuts that damage by 30%.
- **Push**: drones and wrecks are shoved away from the blast.

## Coilgun charging

A coilgun fires one penetrator per charge:

1. After a shot the next penetrator is chambered and the capacitor bank charges for 5 s.
2. While charging, the weapon asks for 34 PU/s of weapons power on top of its 4 PU/s.
3. Each tick, progress advances by `dt × weapons satisfaction / 5`, so it advances exactly as fast as power is delivered.
4. **Interruption rule**: below 25% weapons satisfaction, or while overheated, the charge is interrupted. A `charge-interrupted` failure and a `charge` event are emitted, and the stored charge bleeds away at 15% per second. Charging resumes from what is left once power returns.
5. A coilgun starts the battle charged.

The Construct power figure includes charging demand. A capacitor bank in the drone supplies charging bursts first.

## Heat

Every shot adds the weapon's heat. Above 100 the weapon locks out until it cools below 70.

- Each component sheds 1.5 heat/s, plus the cooling that reaches its section: own coolers in full, adjacent coolers at half, and the integrated coolant loop in the middle section.
- A **Thermal Reservoir** absorbs up to 30 heat/s from components above 55 in its section, up to 80 in total, and releases it slowly into cooling. It delays saturation; it does not remove heat faster in the long run.
- Construct warns when a weapon would overheat in less than 12 s of continuous fire. That estimate ignores reload pauses; BALANCE.md shows both the estimate and the measured time.

## Recoil and mounts

Recoil is an impulse at the firing barrel. It pushes and turns the hull, and adds aim disturbance that decays over ~0.2 s; a Gyroscopic Stabilizer reduces it by 25%.

Each section's mounts carry a recoil rating:
- light 9 000, medium 30 000, heavy 75 000;
- 30% more on a Maximum layout, 10–15% less on Minimum.

Recoil beyond the rating has two costs on every shot:
- it damages the section's joints by 6 × the excess fraction;
- it wears the mount itself by 2% of the part's integrity × the excess fraction. A weapon below half integrity traverses at half speed and its spread widens.

A Reinforced Coupling cuts the joint damage by 35%.

How much a shot moves the drone depends on the whole machine, as Diagnostics shows per weapon:
- velocity change = impulse ÷ mass;
- spin = arm × impulse ÷ inertia.

A braced walker or a tracked hull barely moves. A light flyer is shoved and turned by the same gun.
