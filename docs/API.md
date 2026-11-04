# Programming API

Every program, whether written as blocks, nodes or code, compiles to **AutoScript** and runs in the same sandbox against the same `drone` object.

## Program structure

```js
let memory = [];            // top-level code runs once; globals persist between ticks

function update() {         // called every decision tick (default 10 Hz)
  const t = drone.nearestEnemy();
  if (t) drone.turnToward(t.x, t.y, 0.8);
}

function onFailure(event) { // called once per hardware failure, before update()
  drone.log(event.type, event.component, event.detail);
}
```

- Commands such as `drive`, `aim`, `fire` and `setPower` are **persistent**. They stay in effect until changed. The 60 Hz systems carry them out: turrets traverse at their rate, triggers fire whenever the weapon is able.
- Each decision tick has an operation budget of 20 000 operations from the integrated CPU, to stop runaway loops. Exceeding it ends that tick with an error. Standing commands remain.
- Angles are in degrees. 0° points to +x (east) and 90° to +y (south, down the screen). Distances are world units (1 u = 0.1 m).

## Language (AutoScript)

AutoScript is a JavaScript subset. It supports `let`, `const` and `var`, functions, arrow functions and closures, `if`, `switch`, `for`, `for…of`, `for…in`, `while` and `do…while`, `break` and `continue`, arrays and objects, template strings, optional chaining (`?.`), `??`, all arithmetic, comparison, logical and bitwise operators, and `typeof`.

Array methods: `push pop shift unshift slice splice concat indexOf lastIndexOf includes join reverse map filter forEach find findIndex some every reduce sort`. String methods: `indexOf includes startsWith endsWith slice substring toUpperCase toLowerCase trim charAt split concat repeat padStart`. Numbers: `toFixed`. Globals: `Math` (with seeded `random`), `String`, `Number`, `Boolean`, `parseInt`, `parseFloat`, `isNaN`, `isFinite`.

Not available, by design: `new`, classes, `this`, `try`/`throw`, destructuring, spread and rest, async and generators, regular expressions, labels, any host global (`window`, `globalThis`, `eval`, `Function`, timers, network, storage) and prototype access (`__proto__`, `constructor`, `prototype`).

Limits: call depth 64; arrays and strings up to 10 000 elements or characters.

## Data shapes

- **Contact**: `{ id, team: 'enemy'|'friend', x, y, distance, bearing, vx, vy, heading, size, disabled, sensors[] }`. `vx`/`vy` are `null` unless a velocity-capable sensor sees the target. `heading`, `size` and `disabled` are `null` unless a classifying sensor (camera) sees it.
- **Threat**: `{ id, x, y, vx, vy, speed, size, distance, bearing, closingTime, missDistance }`. Reported only by a radar, for interceptable rounds: shells and rockets on a collision course, and guided missiles closing within 900 u. Soonest first.
- **Range**: `{ side: 'front'|'left'|'right', distance, status }`. `distance` is `null` when nothing is within 500 u. `status` is `'ok'`, `'unpowered'`, `'destroyed'` or `'detached'`; anything but `'ok'` also gives `null`, so check the status to tell "nothing there" from "cannot see".
- **Ray** (LIDAR): `{ angle, distance, x, y }`. `angle` is relative to the hull heading (−90 left … +90 right); `distance`, `x` and `y` are `null` for no return.
- **Weapon** adds, for the new equipment:
  - `ammoTypes`, `selectedAmmo`, `loaded` (by type), `reserveByType`;
  - `reloadProgress` (0–1), `reloadTime`, `charging`, `charge` (coilgun 0–1), `spin` (rotary 0–1);
  - `barrels`, `activeBarrels`, `fireMode`, `fireModes`, `rpm` (per mount), `guided`, `designated`.
- **Missile**: `{ id, kind, x, y, target, tracking: 'seeker'|'uplink'|'lost', age }`.
- **Fire**: `{ section, intensity, burning }`.
- **Failure**: `{ time, type, component?, kind?, section?, detail }`. Types are `component-damaged`, `component-destroyed`, `section-destroyed`, `section-detached`, `shield-overload`, `power-shortage`, `overheat`, `ammo-depleted`, `charge-interrupted`, `fire` and `fire-out`.
- **Component ids** have the form `<section letter>.<slot>`, for example `F.H1` (front hardpoint 1) or `M.I3` (middle internal bay 3). Running gear is `F.gearL`, `F.gearR` and so on.

## Reference

### Self

| Call | Returns | Description |
| --- | --- | --- |
| `drone.time()` | `number` | Simulation time in seconds. |
| `drone.x()` | `number` | Own centre-of-mass x. |
| `drone.y()` | `number` | Own centre-of-mass y. |
| `drone.position()` | `{x, y}` | Own position. |
| `drone.heading()` | `degrees` | Hull heading. 0° = +x (east), 90° = +y (south). |
| `drone.speed()` | `number` | Signed forward speed (u/s). |
| `drone.velocity()` | `{x, y}` | Velocity vector. |
| `drone.angleTo(x, y)` | `degrees` | Bearing from self to a point. |
| `drone.distanceTo(x, y)` | `number` | Distance from self to a point. |
| `drone.arena()` | `{width, height}` | Arena dimensions (public map knowledge). |
| `drone.id()` | `number` | Own id. |
| `drone.team()` | `number` | Own team. |
| `drone.random()` | `0..1` | Seeded deterministic random number (Math.random is the same source). |
| `drone.log(...values)` |  | Write to the decision trace. |

### Sensors

| Call | Returns | Description |
| --- | --- | --- |
| `drone.contacts()` | `Contact[]` | All contacts detected this tick by powered, working sensors with line of sight. Sorted by distance. |
| `drone.enemies()` | `Contact[]` | Detected enemy contacts. |
| `drone.nearestEnemy()` | `Contact \| null` | Closest detected enemy not known to be disabled. |
| `drone.threats()` | `Threat[]` | Incoming interceptable rounds seen by a radar: shells and rockets on a collision course, guided missiles closing in. Each: id, x, y, vx, vy, speed, size, distance, bearing, closingTime, missDistance. Soonest first. |
| `drone.sensors()` | `Sensor[]` | Own sensors with status, arc, range and facing. |

### Environment

| Call | Returns | Description |
| --- | --- | --- |
| `drone.goal()` | `{x, y, radius} \| null` | The scenario’s goal point in training courses (public mission data). The walls between you and it are not known — find them with your sensors. |
| `drone.distance(side)` | `number \| null` | Distance (u) from the built-in "front", "left" or "right" distance sensor to the nearest wall, obstacle or hull, up to 500 u. null when nothing is in range — or when the sensor does not work; tell them apart with rangeStatus(). |
| `drone.obstacleDetected(side, within = 150)` | `boolean` | True when that distance sensor reads a surface closer than `within`. False when the sensor does not work. |
| `drone.rangeStatus(side)` | `"ok" \| "unpowered" \| "destroyed" \| "detached"` | Whether a distance sensor is working. "ok" with distance() null means nothing within 500 u. |
| `drone.ranges()` | `Range[]` | All three distance readings: side, distance (or null), status. Sampled at each decision. |
| `drone.bumper(side)` | `boolean` | True while the "front", "rear", "left" or "right" of the hull is pressing against something (contact within the last 0.15 s). |
| `drone.bumpers()` | `{front, rear, left, right, …Impulse}` | All four bumpers at once, with the contact impulse of each. |
| `drone.lidar(id?)` | `Ray[]` | Latest LIDAR scan: rays left to right, each {angle (relative to the hull heading), distance or null, x, y}. Geometry only — it does not identify drones. Empty without a working, powered LIDAR. |
| `drone.lidarAge()` | `seconds \| null` | Age of the latest LIDAR scan (it refreshes every 0.25 s). |

### Movement

| Call | Returns | Description |
| --- | --- | --- |
| `drone.drive(throttle, steer)` |  | Persistent propulsion command, both in [-1, 1]. Positive steer turns clockwise. |
| `drone.turnToward(x, y, throttle = 1)` |  | Proportional steering toward a point (slows down for sharp turns). |
| `drone.stop()` |  | Zero throttle and steering. |

### Weapons

| Call | Returns | Description |
| --- | --- | --- |
| `drone.weapons()` | `Weapon[]` | Own weapons: id, type, functional, ammo, magazine, reserve, ammoTypes, selectedAmmo, loaded, reserveByType, reloading, reloadProgress, charging, charge, spin, barrels, activeBarrels, fireMode, rpm, guided, ready, heat, aim, arcMin/arcMax, range, blocked. |
| `drone.weapon(id)` | `Weapon` | One weapon by id ("F.H1"), index or object. |
| `drone.aim(id, angle)` |  | Command a turret to a world angle (degrees). Turrets are stabilised and traverse at their rate within their arc. |
| `drone.aimAt(id, x, y)` |  | Command a turret toward a point. |
| `drone.fire(id, on = true)` |  | Hold (or release) the trigger. The weapon fires whenever loaded, cool and unobstructed. |
| `drone.ceaseFire(id?)` |  | Release one or all triggers. |
| `drone.reload(id)` |  | Start a reload from ammunition storage. |
| `drone.setFireMode(id, mode)` | `boolean` | Multi-barrel weapons that support it: "sequence" (barrels in turn) or "sync" (all together). Same combined rate; sync doubles the kick. False if unsupported. |
| `drone.selectAmmo(id, ammo)` | `boolean` | Which loaded ammunition fires next, e.g. "rocket" or "interceptor" for a rocket pod. False if the weapon does not take it. |
| `drone.designate(id, contact)` | `boolean` | Choose the target a missile launcher guides on (a current contact, or null for the one nearest its aim). |
| `drone.ammoStock()` | `{type: rounds}` | Rounds left in working ammunition storage, by family (not counting loaded magazines). |
| `drone.missiles()` | `Missile[]` | Own guided rounds in flight: id, kind, x, y, target, tracking ("uplink", "seeker" or "lost"), age. |
| `drone.canFire(id, x, y)` | `boolean` | Point within traverse arc, not obstructed by own sections, weapon loaded, cool and functional. |
| `drone.inArc(id, x, y)` | `boolean` | Point within traverse arc and not obstructed (ignores ammunition state). |
| `drone.aimError(id, x, y)` | `degrees` | Angle between the current turret direction and a point. |
| `drone.lead(id, contact)` | `{x, y, t} \| null` | Intercept point for a contact using its observed velocity and the weapon muzzle velocity. |

### Shields

| Call | Returns | Description |
| --- | --- | --- |
| `drone.shields()` | `Shield[]` | Own shields: charge, capacity, raised, powered, overloaded, facing, arc. |
| `drone.raiseShield(id, on = true)` |  | Raise or lower a shield (lowered shields still recharge). |
| `drone.shieldFace(id, angle)` |  | Rotate a directional shield to a world angle. |
| `drone.shieldFaceToward(id, x, y)` |  | Rotate a directional shield toward a point. |

### Power

| Call | Returns | Description |
| --- | --- | --- |
| `drone.power()` | `Power` | generation, stored, capacity, demand/satisfaction per category, allocation. |
| `drone.setPower(propulsion, weapons, shields)` |  | Priority weights for distributing power during shortages. |
| `drone.maxHeat()` | `number` | Hottest working component temperature (100 = overheated). |

### Hardware

| Call | Returns | Description |
| --- | --- | --- |
| `drone.components()` | `Component[]` | Every component: health, destroyed, attached, functional, heat. |
| `drone.component(id)` | `Component` | One component by id. |
| `drone.sections()` | `Section[]` | front/middle/rear: class, attached, destroyed, integrity, armor. |
| `drone.count(kind)` | `number` | Working components of a kind (weapon, sensor, motor, shield, generator, controller, gear…). |
| `drone.status()` | `Status` | Derived flags: degraded, immobilized, disarmed, disabled, label. |
| `drone.fires()` | `Fire[]` | Burning sections: section, intensity, burning (seconds). |
| `drone.suppressFire(section)` |  | Fire a suppression charge at the "front", "middle" or "rear" section (needs a Fire Suppression System in it or next to it). |
| `drone.setAutoSuppression(on = true)` |  | Let suppressors put fires out by themselves after 0.5 s (default), or only when the brain asks. |
| `drone.failures()` | `Failure[]` | Hardware failure events since the previous decision tick. |

### Timers

| Call | Returns | Description |
| --- | --- | --- |
| `drone.resetTimer(name)` |  | Reset a named timer to now. |
| `drone.elapsed(name)` | `seconds` | Seconds since the timer was reset (starts on first use). |

### Globals

| Call | Returns | Description |
| --- | --- | --- |
| `angleDiff(from, to)` | `degrees` | Signed smallest angle from one heading to another (-180..180]. |
| `clamp(x, lo, hi)` | `number` | Clamp a number. |
| `rad(deg)` | `number` | Degrees to radians. |
| `deg(rad)` | `number` | Radians to degrees. |

## Navigation without a map

A brain knows the arena's size and, in training courses, the goal point. It does not know where the walls are: it has to measure them.

```js
// follow the wall on the left (solves any maze without loops)
function update() {
  if (drone.bumper("front")) return drone.drive(-0.6, 0);
  if (drone.obstacleDetected("front", 140)) return drone.drive(0.25, 1);  // turn right
  const left = openDistance("left");
  if (left > 260) drone.drive(0.4, -1);                                  // wall ended: go round
  else drone.drive(0.7, clamp((90 - left) / 120, -0.5, 0.5));            // keep ~90 u from it
}
```

The Pathfinder example develops this into a complete state machine, with speed control for its wheels and a LIDAR check before it heads straight for a goal.

## Blocks, nodes and code

A drone's brain is one AutoScript program; Blocks and Nodes are other ways of showing and editing it.

- **Mapping.** *every decision tick* is `function update()`, *when hardware fails* is `function onFailure(event)`, and *when the brain starts* holds the top-level steps, which run once. Calls are shown with labelled arguments. Literal and variable arguments are typed directly on node ports.
- **Code modules.** Anything a visual editor can't draw stays as a code module with its exact text: `switch`, `for…in`, arrow functions, object and template literals, optional chaining, labels, nested function declarations, and assignment inside expressions. You can edit modules in place. If edited text becomes expressible, it is shown natively next time.
- **Comments** become notes (blocks and nodes) and survive round trips. Code keeps your formatting until the program is changed in another view.
- **Helpers** are ordinary AutoScript built only from the public API. They are appended when used, and your own function with the same name wins:
  - `engageAll(contact)`
  - `aimAtContact(weapon, contact, lead = true)`
  - `turnTowardContact(contact, throttle = 1)`
  - `shieldFaceContact(shield, contact)`
  - `canFireAt(weapon, contact)`
  - `itemAt(list, position)` (1-based)
  - `openDistance(side)`: a distance reading you can compare. Nothing in range counts as 500; a sensor that does not work counts as 0.
  - `steerClear(throttle = 1)`: drive on and turn toward the more open side; back out when the front bumper touches.
  - `widestGap()`: relative angle of the longest clear LIDAR ray, or `null`.
  - `interceptThreat(weapon)`: aim at the soonest radar threat with lead and fire inside 350 u.

  Helpers may call each other; everything a brain uses is included.
- **Pickers.** Arguments that name a weapon, shield or component, a side (`"front"`, `"left"`, `"right"`, and `"rear"` for bumpers), an ammunition type, a fire mode or a section are dropdowns in Blocks and suggestion lists in Nodes.
- **Node graphs.** Execution flows through diamond ports, and each step follows exactly one step. A data node used by several inputs is evaluated at each use.
