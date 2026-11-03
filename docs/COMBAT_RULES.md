# Simulation & combat rules

## Time
- Physics runs at a fixed 60 Hz. Programs run at the decision rate (default 10 Hz, configurable to 5, 10, 20 or 30).

## Movement
- Motors provide force limited by power (`force ≤ power / speed`), by the propulsion power supplied, by motor health and heat, and by traction (`μ·m·g` per side, scaled by gear health).
- Tracked: left/right drive = throttle ± steer. A Coulomb skid resistance opposes turning, so the drone pivots only when the drive torque exceeds it.
- Wheeled: the steering angle sets the target yaw rate (`v·tan δ / wheelbase`), so a wheeled drone cannot turn at standstill. Uneven gear damage makes it pull to one side.
- Rolling resistance, aerodynamic drag and lateral friction limited by grip act every tick. Recoil and impacts are impulses at their actual contact point. They produce linear and angular velocity, which friction then absorbs, so lighter drones are shoved further.

## Projectiles
- Projectiles are real bodies with velocity, drag, lifetime and travel time. Each tick a swept segment is tested against obstacles, shields, drone sections, debris and (for point defense rounds) interceptable shells. Fast rounds cannot tunnel through targets.
- Penetration and damage scale with remaining speed: penetration ∝ v/v₀, damage ∝ (v/v₀)².

## Armor
For a hit on a section face at angle θ from the surface normal:
1. **Exposed equipment**: turrets, sensors, emitters and running gear stand above the hull. If the round's path crosses one, it hits that component with probability equal to the component's *profile* (seeded RNG). The round then faces the component's own plate.
2. **Ricochet** if θ exceeds the weapon's ricochet angle (68–72°) and penetration < 2.5 × effective armor. The round reflects and loses speed.
3. **Effective armor** = thickness / cos θ. If penetration is below it, the round is **stopped**. A near-penetration (≥70%) is **partial**: it cracks the plate slightly, and only large calibres also damage structure. Small arms can never wear down armor they cannot nearly penetrate.
4. **Penetration**: the round damages section structure (and any joint within 7 u of the impact), then travels through the internal components on its path. Each component takes damage and absorbs penetration. If enough penetration remains, the round exits the far side and keeps flying.

## Components & structure
- Components have their own integrity. A destroyed component stops working: weapons stop firing, motors lose force, sensors lose contacts, generators stop supplying, shields drop. Below 50% integrity, turrets traverse at half speed, spread worsens and outputs fall.
- A section at 0 structure is destroyed. All its components are destroyed and its joints fail.
- When a joint fails, the drone splits into connected groups. The group with the working integrated CPU (normally the middle section) stays the drone. Every other group becomes **debris**: a separate rigid body that keeps the same motion, mass and collision shape. Detached equipment loses power, control and ammunition feed. The drone's mass, centre of mass and inertia are recomputed.
- A destroyed ammunition module **cooks off**, damaging its section and the components inside it.

## Damage states (derived, never a health bar)
- **Degraded**: any component destroyed or below 50%, or any section detached or below 50%.
- **Immobilized**: no working motor, or no running gear left.
- **Disarmed**: no working weapon with ammunition available.
- **Disabled**: the integrated CPU is destroyed or detached, or there is no power at all. The program halts and all commands clear.
- **Destroyed**: no intact section remains.
- A team is defeated when none of its drones remains combat-effective (combat-ineffective = disabled, destroyed or disarmed). If both sides are still effective when the time limit expires, the battle is a draw.

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
- Cameras classify targets (size, heading, disabled) and measure velocity. Radar measures velocity, tracks incoming shells and is 360°, but does not classify.
