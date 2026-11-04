# Drone construction reference

All values come from `src/sim/content/*`. 1 world unit (u) = 0.1 m.

## Sections

A drone is laid out along its forward axis as **rear | middle | front**. Sections connect through two damageable joints (front–middle and middle–rear).

| Class | Size (L×W) | Height | Frame mass | Structure | Max armor | Equipment limit | Mount rating | Internal bays |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Light | 16×22 | 1 | 250 kg | 130 | 15 mm | 700 kg | 9 000 | 2×S |
| Medium | 20×26 | 2 | 450 kg | 230 | 35 mm | 1300 kg | 30 000 | 2×S, 1×M |
| Heavy | 24×30 | 3 | 800 kg | 400 | 70 mm | 3000 kg | 75 000 | 1×S, 2×M, 1×L |

- Armor costs `0.16 kg × perimeter × mm`. It protects every face of the section.
- **Height** decides line of fire: a weapon cannot fire across one of its own sections that is *taller* than the section the weapon sits on. Light-section guns cannot shoot over a heavy middle. Heavy-section guns can fire over everything.
- A slot accepts components of its own size or smaller, of the matching type (hardpoint or internal).
- **Mount rating**: the recoil impulse per firing event that a section's mounts absorb. Recoil above it damages that section's joints on every shot (see [WEAPONS.md](WEAPONS.md#recoil-and-mounts)).

### Hardpoint layouts

Each section chooses one of three hardpoint layouts. Internal bays are the same in every layout.

| Class | Maximum | Medium (standard) | Minimum |
| --- | --- | --- | --- |
| Light | 1 M + 1 S · +60 kg | 2 S | 1 S · −25 kg |
| Medium | 1 L + 1 S · +90 kg | 3 M | 1 M + 1 S · −40 kg |
| Heavy | 2 L + 1 M · +140 kg | 2 L + 1 S | 1 L + 1 M · −60 kg |

- **Maximum** mounts larger equipment on a heavier frame. Its equipment sits higher and is 15% more exposed to hits, and the mounts are rated 30% higher.
- **Minimum** saves weight and sits lower: equipment is 15% less exposed.
- Every mount's footprint stays inside the hull and never overlaps another mount (tested for all nine layouts).
- Every design made before layouts existed uses **Medium**, which is exactly the old arrangement.
- **Changing class or layout** keeps each part in its slot when it still fits, otherwise moves it to the nearest free compatible slot. If some parts fit nowhere, Construct lists them and asks before taking them off. Undo restores the previous version.

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
| Distance sensors | Front (on the front section), left and right (on the middle section): the distance to the nearest surface along a ray, up to 500 u. |

They are real components: they take damage from penetrating hits, and losing the middle section loses them. A drone whose CPU is destroyed is disabled.

## Components

Weapons, ammunition, recoil and heat are described in [WEAPONS.md](WEAPONS.md).

| Component | Slot | Mass | Key stats |
| --- | --- | --- | --- |
| Machine Gun, Autocannon, Point Defense Gun, Scatter Cannon | S hardpoint | 90–160 | see WEAPONS.md |
| Quad Machine Gun, Rotary Cannon, Dual Autocannon, Rocket Pod | M hardpoint | 320–620 | see WEAPONS.md |
| Heavy Cannon, Coilgun, Heavy Missile Launcher | L hardpoint | 680–800 | see WEAPONS.md |
| Optical Camera | S hardpoint | 30 | 110°, 700 u, classifies targets and measures velocity, 2 PU/s |
| LIDAR Scanner | S hardpoint | 45 | 31 rays over 180°, 900 u, refreshed every 0.25 s. Distances to walls and hulls only: it does not create contacts. 6 PU/s |
| Search Radar | M hardpoint | 140 | 360°, 900 u, velocity, tracks incoming shells, rockets and missiles, no classification, 12 PU/s |
| Compact Shield Emitter | S hardpoint | 120 | 110 capacity, 90° arc at radius 34, 25/s recharge (16 PU/s), 3 PU/s upkeep, 3 s overload, turns 240°/s |
| Directional Shield | M hardpoint | 240 | 260 capacity, 120° arc at radius 44, 40/s recharge (30 PU/s), 6 PU/s upkeep, 3.5 s overload, turns 140°/s |
| Compact Generator | S internal | 180 | 45 PU/s |
| Reactor | L internal | 650 | 130 PU/s, runs hot |
| Battery / Capacitor Bank | S internal | 120 / 50 | 700 PU·s @ 90/s, or 180 PU·s @ 300/s (capacitors discharge first) |
| Cooling Unit | S internal | 80 | 7 heat/s for its own section, half that for adjacent sections |
| Thermal Reservoir | S internal | 90 | Soaks up to 30 heat/s from hot parts in its section (80 total), sheds 5/s |
| Gyroscopic Stabilizer | S internal | 65 | −25% aim disturbance from hull motion, turning and recoil, for every weapon. 5 PU/s |
| Autoloader | M internal | 160 | −20% reload time for guns, −15% for launchers in its section; one per section takes effect. 7 PU/s while reloading |
| Spall Liner | M internal | 230 | −30% damage to internal equipment in its section after penetration and from blast fragments |
| Reinforced Coupling | M internal | 180 | −35% damage to one adjacent joint (in the middle section: choose front or rear) |
| Fire Suppression System | S internal | 75 | 3 charges; puts out fires in its own and adjacent sections after 0.5 s, or on `drone.suppressFire()` |
| Small-Calibre Magazine | S internal | 110 | 1500 small rounds |
| Medium-Calibre Magazine | S internal | 140 | 400 autocannon rounds **or** 60 scatter shells |
| Shell Rack | M internal | 260 | 20 cannon shells **or** 24 coilgun penetrators |
| Rocket Cassette | S internal | 110 | 12 rockets, split between offensive and interceptor |
| Missile Reserve | M internal | 220 | 8 heavy missiles |

### Mount configuration

The properties surface shows only the settings that apply to the selected part:

| Part | Setting |
| --- | --- |
| Dual Autocannon | Fire mode: alternating or synchronised |
| Rocket Pod | Interceptors in the ready load (0–6) |
| Medium-Calibre Magazine, Shell Rack | Payload |
| Rocket Cassette | Interceptor split (0–12) |
| Reinforced Coupling (middle section) | Which joint it braces |

These settings are saved with the design.

## Validation

**Errors** (block deployment):
- a component in the wrong slot type or size, or in a slot the layout does not have;
- overlapping mounts;
- armor above the class maximum;
- equipment over the frame limit;
- a drone too heavy for its propulsion to move.

**Warnings**:
- always-on demand above generation, or peak demand above what generation and the buffers supply;
- coilgun charging demand that the power supply cannot meet;
- very low acceleration;
- firing arcs fully or partly obstructed;
- a weapon with no storage for its ammunition family (the message names the store it needs);
- a Reinforced Coupling in the middle section that has no joint chosen;
- recoil above the section's mount rating.

**Information**:
- a weapon that would overheat within 12 s of continuous fire where it is mounted;
- a rocket pod with no interceptors (it cannot shoot down missiles);
- fewer reserve missiles than one launcher reload;
- an autoloader with no weapon to serve, or a second autoloader in one section;
- no weapons yet.

Drive motors and control units used to be equipment. Designs saved before schema 2 are migrated by removing them, because every chassis now integrates both. In schema 3, the AA Autocannon became the **Autocannon** (`aa_gun` → `autocannon` on load), and every section without a layout receives the Medium layout.

Unusual designs are allowed as long as they physically work. The game has no fixed classes and assigns no labels to designs.
