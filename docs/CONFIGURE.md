# Configure

Configure is the fourth way to program a drone: **CONFIGURE | BLOCKS | NODES | CODE**. You choose tactics; Configure writes the brain for this drone’s hardware.

It is not a separate AI. The settings generate ordinary, readable AutoScript. That program is parsed into the same brain the other three editors show, compiled by the same compiler, and run in the same sandbox and budget as any hand-written brain. A generated brain sees only what its sensors report and gets no bonus of any kind. Open it in Code at any time to read what it does.

```
settings (BrainConfig) + hardware (analyzeHardware)
        │  generateCode
        ▼
readable AutoScript ──parseBrain──▶ brain IR ──▶ Blocks · Nodes · Code
                                        │
                                 compileBrain ─▶ sandboxed runtime (same as every brain)
```

Code: `src/program/configure/` — `config.ts` (settings and validation), `hardware.ts` (what is installed), `generate.ts` (the generator), `explain.ts` (the hardware panel), `index.ts` (sync with the brain). UI: `src/ui/program/ConfigureEditor.tsx`.

## Primary tactics

| Setting | Choices |
|---|---|
| **Doctrine** | Aggressive · Balanced · Defensive · Precision · Harassment · Interception · Area Control · Adaptive |
| **Engagement distance** | Automatic (from the weapons’ reach and what the sensors can see) · Close · Medium · Long · Custom (from–to) |
| **Target selection** | Auto · Nearest · Highest threat · Most vulnerable · Fastest · Heaviest · Best weapon match · Adaptive |
| **Defensive behaviour** | Auto · Prioritise survival · Balanced · Favour offense · Intercept projectiles · Evasive manoeuvring · Armour facing |
| **Movement** | Auto · Hold · Advance · Pursue · Orbit · Kite · Flank · Patrol · Adaptive |

Anything left on **Auto** follows the doctrine:

| Doctrine | Range | Target | Defence | Movement | Retreat below | Pursuit | Fire discipline |
|---|---|---|---|---|---|---|---|
| Aggressive | close | nearest | offense | pursue | 12 % | 1.0 | free |
| Balanced | weapon | best match | balanced | orbit | 25 % | 0.6 | aimed |
| Defensive | weapon | threat | survival | kite | 45 % | 0.2 | aimed |
| Precision | long | best match | balanced | hold | 30 % | 0.3 | conserve |
| Harassment | weapon | vulnerable | evasive | flank | 30 % | 0.7 | aimed |
| Interception | weapon | fastest | intercept | kite | 25 % | 0.5 | aimed |
| Area Control | weapon | threat | armour | patrol | never | 0.1 | aimed |
| Adaptive | weapon | adaptive | balanced | adaptive | 30 % | 0.6 | aimed |

Automatic movement is then adjusted to the chassis and the main weapon, because the same order does not suit every machine: a walker holds (a standing walker braces, which steadies its aim); a precise weapon on a ground drone kites rather than orbits (orbiting ruins a coilgun’s settle); a tracked drone holds rather than orbits. A slow, well-armoured drone that holds its ground angles its best plate toward the enemy. The hardware panel says when this happened.

“Most vulnerable” cannot use health — no drone can observe another’s health — so it uses what sensors do report: size class and whether the target is turned away.

## Advanced settings

Every setting changes the generated program on hardware it applies to; a unit test (`tests/program/configure.test.ts`) fails if one does not. Settings that need hardware the drone does not have are greyed out with the reason (for example *no coilgun*), and the generator leaves the matching code out entirely.

- **Engagement and movement:** closest and furthest distance (override the range), pursuit (0 never chase … 1 chase hard), retreat threshold, orbit direction (only when it orbits), flank side (only when it flanks), what to do with nothing in sight (go where it was last seen, sweep, patrol, hold), how long a lost contact is remembered, top speed, use cover while reloading or retreating, get unstuck.
- **Weapons:** fire discipline, aim tolerance, lead moving targets, fire in bursts, pull back while the main weapon reloads, coilgun settle, rocket salvo style, missile conservation, interceptors kept back for incoming rounds.
- **Target evaluation:** weights for distance, threat, speed, fresh information and what the weapons can penetrate.
- **Resources:** power priority, heat limit, conserve ammunition below a share, emergency power (drop shields when stored power runs low).
- **Defensive reactions:** incoming rounds (ignore, evade, shield, intercept), shield facing, what to do when sensors or weapons are lost, keep fighting when immobilised.
- **Adaptive behaviour:** shorten the range as weapons are lost, slow down when running gear is damaged, avoid repeating a failed route, read whether the enemy is rushing or keeping away.

Stored settings are validated on load: an unknown value falls back to its default and numbers are clamped, so a damaged save never breaks a brain.

## Hardware intelligence

The panel beside the settings is built from the same plan the generator uses, so it cannot disagree with the program:

- **Installed:** chassis and what it implies, mass and speed, armour by section and the best-armoured end, sensors and their reach, shields, power.
- **What the brain will do:** the weapon it is built around, the range band it will fight in, movement and targeting as resolved, interception and shield use, the retreat rule, and a line per weapon (for example *“F.H1 Coilgun: charges for 5 s with weapons on power priority; stops and settles for each shot”*).
- **Cautions:** no weapons, overload, power shortfall, weapons that overheat quickly.
- **Left out for this hardware:** the behaviours that were not generated and why.

Below it, **Program** shows the generated AutoScript with its modules (Settings · Hardware · State · Movement · Perception · Targeting · Situation · Decisions · Manoeuvres · Weapons · Defence · Resources · Main loop) and **Open in Code** / **Test**.

## Switching editors safely

A brain made with Configure stores its settings and a hash of the program they generated (node ids and literal spelling ignored). From that the editor knows which of four states the brain is in:

| State | Meaning | What Configure does |
|---|---|---|
| **Hand-written** | never generated | Shows a starting configuration chosen from the weapons. Nothing changes until you press **Generate brain**; the current program is then kept under **Recovered programs**. |
| **Synced** | the brain is exactly what its settings generate | Every change applies at once. A green dot on the tab. |
| **Customised** | edited in Blocks, Nodes or Code since | Changes are saved but **not applied**. **Regenerate from settings** rewrites it — after keeping your edited program under Recovered programs. An amber dot on the tab. |
| **Hardware changed** | untouched, but the drone’s hardware changed | Saving the design regenerates a synced brain automatically (it refers to mounts by id); a customised or hand-written brain is never touched. |

Switching tabs never changes the program: Configure only writes it when a setting changes on a synced brain, or when you ask.

Settings travel with the brain through save and load, **Duplicate** (fresh node ids keep it synced), **Export** and **Import**. Brains from before Configure simply have no settings and keep working unchanged.

## Debugging a generated brain

Generated brains log each change of mode (`mode: searching`, `pursuing`, `closing`, `engaging`, `kiting`, `reloading`, `retreating`, `evading`, `guarding`, `recovering`, `immobilized`) and notable events (`cooling F.H1`, `intercepting round #12`, `dodging round #9`, `target: #4 (large)`). The **Debug** drawer and the battlefield spectator card show the current state and recent activity; **Show** jumps to the line that set it, switching from Configure to Code. The hand-written starters log their states the same way (`state: …`, `tactic: …`), so the same display works for them.

## How good is it?

Measured, not claimed: see [EVALUATION.md](EVALUATION.md) §6. Each starter’s hardware was given a default and a specialised generated brain, and both were played against the roster’s hand-written brains and against that starter’s own hand-written brain on identical hardware.

## Limitations

- The generator writes one general-purpose structure; a hand-written brain built around one trick (Viper’s rear arc, Rapier’s nose-on duel) can still beat it at that trick.
- “Adaptive” choices switch between fixed behaviours on observed facts; there is no learning between battles.
- Generated programs are long (around 440–480 lines) because they cover every installed system; they are commented and split into named functions, but Blocks and Nodes show large programs as large graphs.
