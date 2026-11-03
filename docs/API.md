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
- **Threat**: `{ x, y, vx, vy, distance, bearing, closingTime }`. Reported only for interceptable shells on a collision course, and only by a radar.
- **Failure**: `{ time, type, component?, kind?, section?, detail }`. Types are `component-damaged`, `component-destroyed`, `section-destroyed`, `section-detached`, `shield-overload`, `power-shortage`, `overheat` and `ammo-depleted`.
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
| `drone.nearestEnemy()` | `Contact | null` | Closest detected enemy not known to be disabled. |
| `drone.threats()` | `Threat[]` | Interceptable shells on a collision course (needs a radar). |
| `drone.sensors()` | `Sensor[]` | Own sensors with status, arc, range and facing. |

### Movement

| Call | Returns | Description |
| --- | --- | --- |
| `drone.drive(throttle, steer)` |  | Persistent propulsion command, both in [-1, 1]. Positive steer turns clockwise. |
| `drone.turnToward(x, y, throttle = 1)` |  | Proportional steering toward a point (slows down for sharp turns). |
| `drone.stop()` |  | Zero throttle and steering. |

### Weapons

| Call | Returns | Description |
| --- | --- | --- |
| `drone.weapons()` | `Weapon[]` | Own weapons: id, type, functional, ammo, reserve, reloading, ready, heat, aim, arcMin/arcMax, range, blocked. |
| `drone.weapon(id)` | `Weapon` | One weapon by id ("F.H1"), index or object. |
| `drone.aim(id, angle)` |  | Command a turret to a world angle (degrees). Turrets are stabilised and traverse at their rate within their arc. |
| `drone.aimAt(id, x, y)` |  | Command a turret toward a point. |
| `drone.fire(id, on = true)` |  | Hold (or release) the trigger. The weapon fires whenever loaded, cool and unobstructed. |
| `drone.ceaseFire(id?)` |  | Release one or all triggers. |
| `drone.reload(id)` |  | Start a reload from ammunition storage. |
| `drone.canFire(id, x, y)` | `boolean` | Point within traverse arc, not obstructed by own sections, weapon loaded, cool and functional. |
| `drone.inArc(id, x, y)` | `boolean` | Point within traverse arc and not obstructed (ignores ammunition state). |
| `drone.aimError(id, x, y)` | `degrees` | Angle between the current turret direction and a point. |
| `drone.lead(id, contact)` | `{x, y, t} | null` | Intercept point for a contact using its observed velocity and the weapon muzzle velocity. |

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
| `drone.count(kind)` | `number` | Working components of a kind (weapon, sensor, motor, shield, generator, controller, gear…). The integrated drive, CPU, power core, coolant loop and proximity array count as motor, controller, generator, cooler and sensor. |
| `drone.status()` | `Status` | Derived flags: degraded, immobilized, disarmed, disabled, label. |
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
- **Node graphs.** Execution flows through diamond ports, and each step follows exactly one step. A data node used by several inputs is evaluated at each use.
