# Drone construction reference

All values come from `src/sim/content/*`. 1 world unit (u) = 0.1 m.

## Sections

A drone is laid out along its forward axis as **rear | middle | front**. Sections connect through two damageable joints (front–middle and middle–rear).

| Class | Size (L×W) | Height | Frame mass | Structure | Max armor | Equipment limit | Hardpoints | Internal bays |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Light | 16×22 | 1 | 250 kg | 130 | 15 mm | 700 kg | 2×S | 2×S |
| Medium | 20×26 | 2 | 450 kg | 230 | 35 mm | 1300 kg | 3×M | 2×S, 1×M |
| Heavy | 24×30 | 3 | 800 kg | 400 | 70 mm | 3000 kg | 2×L, 1×S | 1×S, 2×M, 1×L |

- Armor costs `0.16 kg × perimeter × mm`. It protects every face of the section.
- **Height** decides line of fire: a weapon cannot fire across one of its own sections that is *taller* than the section the weapon sits on. Light-section guns cannot shoot over a heavy middle. Heavy-section guns can fire over everything.
- A slot accepts components of its own size or smaller, of the matching type (hardpoint or internal).

## Chassis

| Chassis | Rolling resistance | Grip (long/lat) | Steering | Gear mass/side | Gear integrity |
| --- | --- | --- | --- | --- | --- |
| Wheeled | 0.035 | 0.75 / 0.62 | Ackermann: needs forward speed to turn | 60 kg | 45 |
| Tracked | 0.085 | 0.95 / 1.10 | Skid steer: can pivot in place | 170 kg | 90 |
| Walking | 0.06 | 1.05 / 1.30 | Turns on the spot; slow (low drive power) | 130 kg | 75 |
| Flying | 0.012 | 0.90 / 0.34 | Vectored thrust; fast, drifts in turns; still blocked by walls (it skims low) | 45 kg | 32 |

Every section carries a left and a right running-gear component (wheels, track, legs or thrusters). Grip, or thrust for the flyer, on each side depends on how healthy that side's gear is.

## Integrated systems

Every chassis builds these into the middle section automatically. The player never installs, wires or upgrades them.

| System | Provides |
| --- | --- |
| Propulsion (wheel motors, track drive, leg actuators or lift thrusters) | Force and power scale with the three section classes and the chassis. Output falls with damage, power shortage and heat. Heavier drones accelerate less. |
| Autonomous CPU | Runs the brain (20 000 operations per decision: a runaway-loop guard, not a constraint). |
| Power core | 30 PU/s plus 10 / 15 / 22 per light / medium / heavy section, and a 500 PU·s buffer. |
| Coolant loop | Baseline cooling of 6 heat/s. |
| Proximity array | 360° detection out to 420 u, with classification. Cameras and radar see further. |

They are real components: they take damage from penetrating hits, and losing the middle section loses them. A drone whose CPU is destroyed is disabled.

## Components

| Component | Slot | Mass | Key stats |
| --- | --- | --- | --- |
| Machine Gun | S hardpoint | 90 | 10 rds/s, 9 mm pen, 270° arc, small calibre |
| AA Autocannon | S hardpoint | 160 | 4.5 rds/s, 22 mm pen, 1250 u/s, 300° arc @ 260°/s |
| Point Defense Gun | S hardpoint | 110 | 20 rds/s, short range, shoots down shells |
| Rotary Cannon | M hardpoint | 380 | 13 rds/s, 17 mm pen, hot |
| Heavy Cannon | L hardpoint | 700 | 100 mm pen, 120 dmg, 3.2 s reload, 150° arc, big recoil, shell can be intercepted |
| Optical Camera | S hardpoint | 30 | 110° arc, 700 u, classifies targets and measures velocity, 2 PU/s |
| Search Radar | M hardpoint | 140 | 360°, 900 u, velocity, tracks shells, no classification, 12 PU/s |
| Directional Shield | M hardpoint | 240 | 260 capacity, 120° arc at radius 44, 40/s recharge for 30 PU/s, 6 PU/s upkeep, 3.5 s overload |
| Compact Generator | S internal | 180 | 45 PU/s |
| Reactor | L internal | 650 | 130 PU/s, runs hot |
| Battery / Capacitor | S internal | 120 / 50 | 700 PU·s @ 90/s, or 180 PU·s @ 300/s |
| Cooling Unit | S internal | 80 | 7 heat/s for its own section, half that for adjacent sections |
| Small / Medium magazine | S internal | 110/140 | 1500 small or 400 medium rounds |
| Shell Rack | M internal | 260 | 20 large shells. Cooks off when destroyed. |

## Validation

**Errors** (block deployment): a component in the wrong slot type or size, armor above the class maximum, equipment over the frame limit, or a drone too heavy for its propulsion to move.

**Warnings**: always-on demand above generation, peak demand above what generation and the buffers can supply, very low acceleration, firing arcs fully or partly obstructed, no ammunition storage for a weapon's calibre.

**Suggestions**: no weapons yet.

Drive motors and control units used to be equipment. Designs saved before schema 2 are migrated by removing them, because every chassis now integrates both.

Unusual designs are allowed as long as they physically work. The game has no fixed classes and assigns no labels to designs.
