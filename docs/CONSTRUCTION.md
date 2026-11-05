# Drone construction reference

All values come from `src/sim/content/*`. 1 world unit (u) = 0.1 m.

## Sections

A drone is laid out along its forward axis as **rear | middle | front**. Sections connect through two damageable joints (front–middle and middle–rear).

| Class | Size (L×W) | Height | Frame mass | Structure | Max armor | Rated equipment load (wheeled) | Mount rating | Internal bays |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Light | 16×22 | 1 | 250 kg | 130 | 15 mm | 700 kg | 9 000 | 2×S |
| Medium | 20×26 | 2 | 450 kg | 230 | 35 mm | 1300 kg | 30 000 | 2×S, 1×M |
| Heavy | 24×30 | 3 | 800 kg | 400 | 70 mm | 3000 kg | 75 000 | 1×S, 2×M, 1×L |

- Armor costs `0.16 kg × perimeter × mm`. It protects every face of the section.
- **Height** decides line of fire: a weapon cannot fire across one of its own sections that is *taller* than the section the weapon sits on. Light-section guns cannot shoot over a heavy middle. Heavy-section guns can fire over everything.
- A slot accepts components of its own size or smaller, of the matching type (hardpoint or internal).
- **Mount rating**: the recoil impulse per firing event that a section's mounts absorb. Recoil above it damages the section's joints and wears the mount itself (2% of the part's integrity × the excess fraction per shot). See [WEAPONS.md](WEAPONS.md#recoil-and-mounts).

### Hardpoint layouts

Each section independently chooses one of three hardpoint layouts (design schema 4) and can mirror it: left/right (schema 5) or front/back (schema 6). Internal bays are the same in every layout. Smaller equipment fits larger mounts; each part occupies one mount.

| Class | Maximum | Medium | Minimum |
| --- | --- | --- | --- |
| Light | 1 M + 1 S · +60 kg | 2 S | 3 S · +15 kg |
| Medium | 1 L + 1 S · +90 kg | 3 M | 4 S · +20 kg |
| Heavy | 2 L + 1 M · +140 kg | 1 L + 2 M · +40 kg | 3 M · +10 kg |

- **Maximum** mounts the largest equipment on reinforced mounts. They are rated 30% higher for recoil, and their equipment is 15% more exposed to hits.
- **Minimum** carries more, smaller mounts that sit lower (less exposed) but are rated 10–15% lower for recoil. Minimum is not weaker: three Dual Autocannons on a heavy Minimum section is a valid build.
- Every mount has a real position. Footprints stay inside the hull and never overlap; tests check all nine layouts.
- **Earlier designs** keep their mount ids, parts and rotations:
  - designs from before layouts existed: light → Medium, medium → Medium, heavy → **Maximum**;
  - designs saved with the previous layout table: heavy Medium → Maximum, heavy Minimum → Medium, medium Minimum → Medium; the others are unchanged.

  Every target layout has the same mount ids at the same or larger size, so nothing is removed. A part that somehow did not fit would stay in the design, flagged, until you move it.
- **Changing class or layout** in Construct keeps each part in its slot when it still fits, otherwise moves it to the nearest free compatible slot. Parts that fit nowhere are listed and you are asked first. Undo restores the previous version.

### Mirroring

**Mirror layout** (in the section's properties) reflects that section's hardpoints across the drone's long axis: (x, y) → (x, −y). Left and right swap; front and rear do not.
- Each section mirrors independently. The setting is saved per section (`mirror: true`) and survives export, import and duplication. Designs from before schema 5 load unmirrored.
- Every part keeps its slot id, component and settings, so programs that address `F.H1` keep working. Hardpoint facings are reflected (r → −r; dead ahead and astern stay), so a turret, sensor or shield faces the mirror direction.
- It is real geometry. The simulation places each mount from the same slot list the constructor draws (`sectionSlots`), so firing origins, arcs, recoil arms, centre of mass, hit locations, shields and sensors all move with it. Validation, obstruction and load are recomputed.
- Pressing it again restores the section exactly.
- The button mirrors left/right only for the layouts that are lopsided that way: light Maximum (M + S), medium Maximum (L + S) and heavy Medium (L + M + M).
- **Front/back.** Every other layout is already its own left/right image, so the same button mirrors it front/back instead. It flips across the section's lateral axis, (x, y) → (−x, y), so forward mounts move to the rear and rear ones forward. This applies to light and medium Minimum, medium Medium, and heavy Maximum and Minimum. It is saved as `flip: true` (schema 6).
  - Facings are kept: guns still point where they pointed. A strict reflection would turn every forward gun to face the rear.
  - Slot ids and settings are unchanged, and a second press undoes it.
- Light Medium (two mounts on the centre line) is symmetrical both ways; its button is disabled and says so.
- After a layout change, a mirror left on the other axis stays and gets its own button, so it can be undone.
- Internal bays belong to the section class, not the layout, and do not move.

## Load ratings

Each section's rated equipment load is its class rating × the chassis load rating:

| Section | Walking ×1.6 | Tracked ×1.25 | Wheeled ×1.0 | Flying ×0.55 |
| --- | --- | --- | --- | --- |
| Light | 1120 kg | 875 kg | 700 kg | 385 kg |
| Medium | 2080 kg | 1625 kg | 1300 kg | 715 kg |
| Heavy | 4800 kg | 3750 kg | 3000 kg | 1650 kg |

These are **ratings, not limits**. Any design whose parts physically fit can be built and deployed. The drone's mass always includes frames, armor, running gear, integrated systems, mounts and equipment.

Above the rating, physics takes over, section by section. Each section's running gear or thrusters carry that section, and overload o = equipment / rating − 1:

- **Traction** falls to 1 / (1 + k·o): wheels k = 0.45, tracks 0.2, legs 0.12.
- **Rolling resistance** rises to (1 + s·o) as the gear sinks: wheels s = 0.5, tracks 0.35, legs 0.2.
- **Running gear fatigues** while it carries the overload: fatigue·o²·(0.3 + speed/100) of its integrity per second. Standing still wears it slowly; driving wears it faster.
- **Flyers.**
  - Each section's thrusters lift at most 1.15 × its rated mass, less when damaged or short of power.
  - Weight beyond that rests on the ground and drags, with a coefficient of 0.6.
  - The same thrusters drive the drone. A section drives with only √(1 − (mass / lift capacity)²) of its thrust, and with none when it cannot hold itself up.
- **Holding weight up costs power**: legs 1.5 PU/s and thrusters 3 PU/s per tonne carried, counted as propulsion demand.
- **Walkers brace**: with no drive command their feet are planted. Static friction, not rolling, resists recoil and impacts, and the legs resist being twisted.

Everything else follows from force and mass:
- acceleration, braking and turning slow as mass and rotational inertia grow;
- equipment far from the centre of mass shifts it and adds inertia;
- recoil turns and shoves the hull by impulse ÷ mass and by arm × impulse ÷ inertia.

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

### Ammunition compatibility

A weapon's hardpoint size and its ammunition family are different things: an Autocannon is a small hardpoint that feeds on Medium rounds. Every label below is generated from the equipment data: `WeaponStats.ammo`, the storage modules' payloads, and `AMMO_TYPES`.

| Weapon | Requires | Storage |
| --- | --- | --- |
| Machine Gun, Point Defense Gun, Quad Machine Gun | Small rounds | Small-Calibre Magazine |
| Autocannon, Rotary Cannon, Dual Autocannon | Autocannon rounds (Medium) | Medium-Calibre Magazine (default payload) |
| Scatter Cannon | Scatter shells | Medium-Calibre Magazine set to scatter shells |
| Rocket Pod | Offensive rockets / Interceptor rockets | Rocket Cassette (configurable split) |
| Heavy Cannon | Cannon shells | Shell Rack (default payload) |
| Coilgun | Coilgun penetrators | Shell Rack set to penetrators |
| Heavy Missile Launcher | Guided heavy missiles | Missile Reserve |

- A module holds one payload at a time. A Medium-Calibre Magazine set to scatter shells does not supply autocannons, and a Shell Rack set to penetrators does not supply the Heavy Cannon.
- Every weapon deploys with a full magazine, reserve or not. Reserves are shared across the drone: any working module supplies every weapon that accepts its family. A reload starts only if some accepted family has reserve left.
- Where it is shown:
  - **Tray cards**: REQUIRES and STORAGE on weapons, HOLDS and FEEDS on storage.
  - **Tray matching**: with a weapon or magazine selected, each card says whether it feeds it, would feed it with another payload, or never does, and which matching modules are installed. Each state differs by icon, outline and wording, not only colour.
  - **Properties**: an installed weapon shows its requirement and supply state under its name, then its starting load, reserve, matching modules, the weapons sharing them, endurance and what to fix. A module shows what it holds now and which installed weapons that feeds.
  - **Simulate**: the spectator lists each weapon's requirement and marks *no reserve* or *out of ammo*.

## Validation

**Errors** (block deployment) are only for things that cannot physically be built or read:
- a component in the wrong slot type or size, or in a slot the layout does not have;
- overlapping mounts;
- armor above the class maximum;
- unknown components or layouts.

**Engineering warnings** never block deployment:
- a section above its rated equipment load;
- thrust that cannot lift the drone;
- drive too weak to overcome rolling resistance, or very low acceleration;
- always-on or peak power demand above supply;
- coilgun charging the power supply cannot meet;
- firing arcs fully or partly obstructed;
- a weapon with no compatible reserve: it fires what it is loaded with, then cannot reload. The message names the storage and payload it needs, or the installed module that would feed it if set to another payload;
- a magazine set to a payload no installed weapon fires, when another weapon needs a different payload from it;
- a Reinforced Coupling in the middle section with no joint chosen;
- recoil above the section's mount rating.

**Information**:
- overload effects on traction, thrust and wear;
- weapon heat that cooling cannot offset;
- a weapon that would overheat within 12 s of continuous fire where it is mounted;
- ammunition for less than 20 s of continuous fire;
- a rocket pod with no interceptors;
- a rocket pod that starts with interceptors but has none stored (reloads use offensive rockets);
- ammunition storage that no installed weapon uses;
- fewer reserve missiles than one launcher reload;
- an idle or extra autoloader;
- no weapons yet.

**Diagnostics** in the Construct header show the figures behind these messages, computed with the same model the simulation uses:
- total, rated and per-section load;
- centre of mass and inertia;
- acceleration, top speed, pivot or turn rate, traction, rolling, lift and support power;
- power;
- heat per section and per weapon;
- ammunition endurance;
- recoil, mount rating, and Δv and Δω per shot.

Estimates say what they assume: flat ground, undamaged, fully powered, continuous fire.

Drive motors and control units used to be equipment. Designs saved before schema 2 are migrated by removing them, because every chassis now integrates both. In schema 3 the AA Autocannon became the **Autocannon** (`aa_gun` → `autocannon` on load). Schema 4 is the current layout table.

Unusual designs are allowed as long as they physically fit. The game has no fixed classes and assigns no labels to designs.
