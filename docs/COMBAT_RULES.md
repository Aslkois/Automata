# Simulation & combat rules

## Time
- Physics runs at a fixed 60 Hz. Programs run at the decision rate (default 10 Hz, configurable to 5, 10, 20 or 30).

## Movement
- Motors provide force limited by power (`force ≤ power / speed`), by the propulsion power supplied, by motor health and heat, and by traction (`μ·m·g` per side, scaled by gear health).
- Tracked: left/right drive = throttle ± steer. A Coulomb skid resistance opposes turning, so the drone pivots only when the drive torque exceeds it.
- Wheeled: the steering angle sets the target yaw rate (`v·tan δ / wheelbase`), so a wheeled drone cannot turn at standstill. Uneven gear damage makes it pull to one side.
- Load: each section's running gear carries that section. Above its rated equipment load, traction falls, rolling resistance rises and the gear fatigues. A flyer whose thrusters cannot hold a section up drags it on the ground and has no thrust left from that section to drive with. Legs and thrusters spend power holding weight up. Walkers with no drive command brace on planted feet. Details and coefficients are in [CONSTRUCTION.md](CONSTRUCTION.md#load-ratings).
- Rolling resistance, aerodynamic drag and lateral friction limited by grip act every tick. Recoil and impacts are impulses at their actual contact point. They produce linear and angular velocity, which friction then absorbs, so lighter drones are shoved further.

## Projectiles
- Projectiles are real bodies with velocity, drag, lifetime and travel time. Each tick a swept segment is tested against obstacles, shields, drone sections, debris and (for point defense rounds) interceptable shells. Fast rounds cannot tunnel through targets.
- Penetration and damage scale with remaining speed: penetration ∝ v/v₀, damage ∝ (v/v₀)². Rocket and missile warheads keep their full values (shaped charge).
- **Fire scheduling** is finer than the tick. A weapon fires every event whose time falls inside the tick, and each projectile starts with the part of the tick it has already flown. Rates above 60 per second are therefore exact.
- Weapons, ammunition, rockets, guided missiles, pellets, explosions, interception and coilgun charging are specified in [WEAPONS.md](WEAPONS.md).

## Armor
For a hit on a section face at angle θ from the surface normal:
1. **Exposed equipment**: turrets, sensors, emitters and running gear stand above the hull. If the round's path crosses one, it hits that component with probability equal to the component's *profile* (seeded RNG). The round then faces the component's own plate.
2. **Ricochet** if θ exceeds the weapon's ricochet angle (68–72°) and penetration < 2.5 × effective armor. The round reflects and loses speed.
3. **Effective armor** = thickness / cos θ. If penetration is below it, the round is **stopped**. A near-penetration (≥70%) is **partial**: it cracks the plate slightly, and only large calibres also damage structure. Small arms can never wear down armor they cannot nearly penetrate.
4. **Penetration**: the round damages section structure (and any joint within 7 u of the impact), then travels through the internal components on its path. Each component takes damage and absorbs penetration. If enough penetration remains, the round exits the far side and keeps flying.

## Components & structure
- Components have their own integrity. A destroyed component stops working: weapons stop firing, motors lose force, sensors lose contacts, generators stop supplying, shields drop. Below 50% integrity, turrets traverse at half speed, spread worsens and outputs fall.
- Joints take damage from recoil above a mount rating and from collision shocks. In a shock, a joint must carry the mass beyond it through the hull's sudden change of velocity. Loads above 600 × the weaker section's structure points (kg·u/s) damage it, so heavy equipment far out on the hull loads its joint most. A Reinforced Coupling cuts joint damage by 35%.
- A section at 0 structure is destroyed. All its components are destroyed and its joints fail.
- When a joint fails, the drone splits into connected groups. The group with the working integrated CPU (normally the middle section) stays the drone. Every other group becomes **debris**: a separate rigid body that keeps the same motion, mass and collision shape, plus a small separation push and spin. Detached equipment loses power, control and ammunition feed. The drone's mass, centre of mass and inertia are recomputed.
- **Debris is temporary.**
  - For 2 s after separation a piece is fully physical: it tumbles, slides and collides, rounds strike it, and distance sensors and LIDAR see it.
  - It then loses its collider. Drones, projectiles, blasts and sensors pass through it.
  - It fades out over 1.2 s and is removed from the simulation, leaving only a scorch mark that is never physical.
  - A drone that is structurally destroyed follows the same timeline from the moment of destruction.
  - All timings are counted in simulation ticks, so they are deterministic.
- A destroyed ammunition module **cooks off**, damaging its section and the components inside it.

## Damage states (derived, never a health bar)
- **Degraded**: any component destroyed or below 50%, or any section detached or below 50%.
- **Immobilized**: no working motor, or no running gear left.
- **Disarmed**: no working weapon with ammunition available.
- **Disabled**: the integrated CPU is destroyed or detached, or there is no power at all. The program halts and all commands clear.
- **Destroyed**: no intact section remains.
- A team is defeated when none of its drones remains combat-effective (combat-ineffective = disabled, destroyed or disarmed). If both sides are still effective when the time limit expires, the battle is a draw.

## Explosions
- Rockets, missiles, interceptor rockets, warheads that break up when shot down, and cook-offs explode.
- A blast's damage falls linearly to zero at its radius, measured to the nearest point of each section. Walls between the blast and a section block it.
- A raised shield facing the blast absorbs it first.
- Structure damage is reduced by armor (`1 − armor/90`, at least 25%). Fragments reach internal equipment only through plate thinner than their penetration. Exposed equipment within the radius is hit directly.
- Every section and component is affected at most once per blast.

## Fire
- Fires start, deterministically:
  - when an ammunition store cooks off with enough stock;
  - when a generator of 60 PU/s or more, or a battery holding over 150 PU·s, is wrecked;
  - when ammunition, a generator or a battery exceeds 210 heat.
- A burning section damages its equipment (1.6 × intensity per second) and its structure (1.2 × intensity per second), and heats its equipment. A fire burns until its fuel runs out.
- A Fire Suppression System in the section, or an adjacent one, puts it out after 0.5 s and spends one of its three charges. Programs can turn automatic release off and call `drone.suppressFire(section)` instead.

## Shields
- A shield is a 120° barrier arc of radius 44 u, centred on its emitter. Its facing can be rotated by the program. It intercepts only rounds that cross into the barrier from outside and within the arc.
- Each hit subtracts the round's energy (damage) from the charge. If the charge is insufficient, the shield **overloads** for 3.5 s and the round passes through with the leftover energy.
- Recharge consumes power. Upkeep is needed while the shield is raised. If less than 50% of shield power is supplied, the shield is unpowered and does not block.

## Power
- Supply = generation + battery discharge. Systems (the CPU, sensors, coolers) are served first. The integrated power core contributes generation and a buffer. The rest goes to propulsion, weapons and shields by the program's priority weights (`setPower`), water-filled so unused shares are redistributed. Surplus charges batteries.
- When a category is under-supplied: propulsion force drops, turret traverse and reloading slow, shields recharge more slowly or fail, and sensors go offline when systems power falls below 50%.

## Heat
- Weapons add heat per shot. Motors and generators add heat in proportion to load. Every component sheds 1.5 heat/s passively, plus cooling from units in its own and adjacent sections.
- Above 100, weapons lock out until they cool below 70, and motors and generators run at 50%. Above 150, the component takes damage.

## Sensors
- A target is detected if any sensor that works and is powered has any point of it (centre of mass or a section centre) within range and arc, with clear line of sight past obstacles.
- Cameras classify targets (size, heading, disabled) and measure velocity. Radar measures velocity and is 360°, but does not classify. It tracks incoming shells and rockets on a collision course, and guided missiles closing within 900 u.
- **Distance sensors** (front, left, right) are built into every chassis. Each casts one ray up to 500 u against walls, obstacles, other hulls and wrecks, sampled at every decision. A reading is a number, or `null` when nothing is in range. A separate status tells "nothing there" apart from a sensor that is destroyed, detached or unpowered. Damage shortens the range.
- **Bumpers** report which side of the hull (front, rear, left, right) was in physical contact during the last 0.15 s, with the contact impulse. They come from the collision solver.
- **LIDAR** casts 31 rays across 180° every 0.25 s. Each ray reports its angle relative to the hull heading and the distance, or `null`. It measures geometry only and never creates contacts.

## Objectives
- **Battle** (duel or sandbox): a side wins when no opposing drone is combat-effective. A battle still running at the time limit is a draw.
- **Training** courses use one of three objectives:
  - reach the goal point (`drone.goal()` gives its position, never the route);
  - knock out every target (a target is out when disabled, destroyed or missing a section — an unarmed target is not out);
  - survive the time limit.
