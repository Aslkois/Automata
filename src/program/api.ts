// The drone API exposed to player programs. Every function reads only information the
// drone legitimately has: its own hardware state and its sensor perception. Commands are
// recorded on the drone and executed by the simulation's fixed-step systems.
import type { SimContext } from '../sim/context';
import { comWorld, functional, localToWorld } from '../sim/drone';
import { DEG, wrapAngle, type Rng } from '../sim/math';
import { ammoReserve, weaponObstruction } from '../sim/systems';
import type { Contact, Drone, FailureEvent, RComponent } from '../sim/types';
import { HostFn, inspect, Interpreter, isObj, makeObj, ProgramError, toStr, toValue, type ObjVal, type Value } from './interpreter';

export interface ApiHost {
  sim: SimContext;
  drone: Drone;
  rng: Rng;
  timers: Map<string, number>;
  failuresThisTick: FailureEvent[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const fmtContact = (c: Value) => (isObj(c) ? `#${c.id} ${c.team} @ ${r1(c.distance as number)}u brg ${r1(c.bearing as number)}°` : 'none');

function num(v: Value, name: string, it: Interpreter): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) throw new ProgramError(`${name}: expected a number, got ${inspect(v)}`, it.loc);
  return n;
}

/** Resolve a weapon/shield/component reference: id string, object with id, or index into the list. */
function resolve(d: Drone, ref: Value, kind: string, it: Interpreter): RComponent {
  let id: string | null = null;
  if (typeof ref === 'string') id = ref;
  else if (isObj(ref) && typeof ref.id === 'string') id = ref.id;
  else if (typeof ref === 'number') {
    const list = d.components.filter((c) => c.kind === kind);
    const c = list[Math.floor(ref)];
    if (!c) throw new ProgramError(`no ${kind} at index ${ref}`, it.loc);
    return c;
  }
  const c = id !== null ? d.components.find((x) => x.id === id && (kind === 'any' || x.kind === kind)) : undefined;
  if (!c) throw new ProgramError(`unknown ${kind} ${inspect(ref)}`, it.loc);
  return c;
}

function contactValue(c: Contact): ObjVal {
  return makeObj({
    id: c.id,
    team: c.team,
    x: c.x,
    y: c.y,
    distance: c.distance,
    bearing: c.bearing,
    vx: c.vx,
    vy: c.vy,
    heading: c.heading,
    size: c.size,
    disabled: c.disabled,
    sensors: c.sensors.slice(),
  });
}

export function weaponInfo(d: Drone, c: RComponent): Record<string, unknown> {
  const w = c.def!.weapon!;
  const ws = c.weapon!;
  const ok = functional(d, c);
  const facingW = d.body.angle + c.facing;
  return {
    id: c.id,
    type: c.def!.id,
    name: c.name,
    section: c.section,
    caliber: w.caliber,
    functional: ok,
    health: c.hp / c.maxHp,
    ammo: ws.mag,
    magazine: w.magazine,
    reserve: ammoReserve(d, w.caliber),
    reloading: ws.reloading,
    ready: ok && !ws.reloading && ws.mag > 0 && !ws.overheated && ws.cooldown <= 0,
    overheated: ws.overheated,
    heat: c.heat,
    aim: wrapAngle(d.body.angle + ws.aim) / DEG,
    arcMin: wrapAngle(facingW - (w.arcDeg / 2) * DEG) / DEG,
    arcMax: wrapAngle(facingW + (w.arcDeg / 2) * DEG) / DEG,
    muzzleVelocity: w.muzzleVelocity,
    range: w.muzzleVelocity * w.projectileLife * 0.85,
    penetration: w.penetration,
    blocked: ws.blockReason,
  };
}

function aimCheck(d: Drone, c: RComponent, x: number, y: number) {
  const w = c.def!.weapon!;
  const m = localToWorld(d.body, c);
  const ang = Math.atan2(y - m.y, x - m.x);
  const local = wrapAngle(ang - d.body.angle);
  const inArc = Math.abs(wrapAngle(local - c.facing)) <= (w.arcDeg / 2) * DEG + 1e-9;
  const obstructed = weaponObstruction(d, c, local);
  return { m, ang, inArc, obstructed };
}

export function createDroneApi(host: ApiHost): ObjVal {
  const { drone: d } = host;
  const fn = (name: string, f: (a: Value[], it: Interpreter) => Value) => new HostFn(`drone.${name}`, f);
  const cmd = (it: Interpreter, text: string) => it.pushTrace('command', text);
  const read = (it: Interpreter, text: string) => it.pushTrace('call', text);

  const api: Record<string, Value> = {
    // ---------------------------------------------------------------- self
    id: fn('id', () => d.id),
    team: fn('team', () => d.team),
    time: fn('time', () => host.sim.time),
    x: fn('x', () => comWorld(d.body).x),
    y: fn('y', () => comWorld(d.body).y),
    position: fn('position', () => {
      const p = comWorld(d.body);
      return makeObj({ x: p.x, y: p.y });
    }),
    heading: fn('heading', () => wrapAngle(d.body.angle) / DEG),
    speed: fn('speed', () => d.body.vel.x * Math.cos(d.body.angle) + d.body.vel.y * Math.sin(d.body.angle)),
    velocity: fn('velocity', () => makeObj({ x: d.body.vel.x, y: d.body.vel.y })),
    angleTo: fn('angleTo', (a, it) => {
      const p = comWorld(d.body);
      return Math.atan2(num(a[1], 'angleTo y', it) - p.y, num(a[0], 'angleTo x', it) - p.x) / DEG;
    }),
    distanceTo: fn('distanceTo', (a, it) => {
      const p = comWorld(d.body);
      return Math.hypot(num(a[0], 'distanceTo x', it) - p.x, num(a[1], 'distanceTo y', it) - p.y);
    }),
    arena: fn('arena', () => makeObj({ width: host.sim.arena.width, height: host.sim.arena.height })),
    random: fn('random', () => host.rng.next()),
    log: fn('log', (a, it) => {
      it.pushTrace('log', a.map((x) => (typeof x === 'string' ? x : inspect(x))).join(' '));
      return undefined;
    }),

    // ---------------------------------------------------------------- sensors
    contacts: fn('contacts', (_a, it) => {
      const v = d.perception.contacts.map(contactValue);
      read(it, `contacts() → ${v.length} contact(s)`);
      return v;
    }),
    enemies: fn('enemies', (_a, it) => {
      const v = d.perception.contacts.filter((c) => c.team === 'enemy').map(contactValue);
      read(it, `enemies() → ${v.length} contact(s)`);
      return v;
    }),
    nearestEnemy: fn('nearestEnemy', (_a, it) => {
      const c = d.perception.contacts.find((x) => x.team === 'enemy' && x.disabled !== true);
      const v = c ? contactValue(c) : null;
      read(it, `nearestEnemy() → ${fmtContact(v)}`);
      return v;
    }),
    threats: fn('threats', (_a, it) => {
      const v = d.perception.threats.map((t) => toValue(t));
      read(it, `threats() → ${v.length} incoming shell(s)`);
      return v;
    }),
    sensors: fn('sensors', () =>
      d.components
        .filter((c) => c.kind === 'sensor')
        .map((c) =>
          toValue({
            id: c.id,
            type: c.def!.id,
            functional: functional(d, c),
            powered: d.power.satisfaction.systems >= 0.5,
            health: c.hp / c.maxHp,
            arc: c.def!.sensor!.arcDeg,
            range: c.def!.sensor!.range,
            facing: wrapAngle(d.body.angle + c.facing) / DEG,
          }),
        ),
    ),

    // ---------------------------------------------------------------- movement
    drive: fn('drive', (a, it) => {
      d.throttle = Math.max(-1, Math.min(1, num(a[0] ?? 0, 'drive throttle', it)));
      d.steer = Math.max(-1, Math.min(1, num(a[1] ?? 0, 'drive steer', it)));
      cmd(it, `drive(throttle ${r1(d.throttle)}, steer ${r1(d.steer)})`);
      return undefined;
    }),
    stop: fn('stop', (_a, it) => {
      d.throttle = 0;
      d.steer = 0;
      cmd(it, 'stop()');
      return undefined;
    }),
    turnToward: fn('turnToward', (a, it) => {
      const x = num(a[0], 'turnToward x', it);
      const y = num(a[1], 'turnToward y', it);
      const throttle = a[2] === undefined ? 1 : num(a[2], 'turnToward throttle', it);
      const p = comWorld(d.body);
      const err = wrapAngle(Math.atan2(y - p.y, x - p.x) - d.body.angle) / DEG;
      d.steer = Math.max(-1, Math.min(1, err / 35));
      d.throttle = Math.max(-1, Math.min(1, throttle * (Math.abs(err) > 70 ? 0.35 : 1)));
      cmd(it, `turnToward(${r1(x)}, ${r1(y)}) heading error ${r1(err)}° → throttle ${r1(d.throttle)}, steer ${r1(d.steer)}`);
      return undefined;
    }),

    // ---------------------------------------------------------------- weapons
    weapons: fn('weapons', () => d.components.filter((c) => c.kind === 'weapon').map((c) => toValue(weaponInfo(d, c)))),
    weapon: fn('weapon', (a, it) => toValue(weaponInfo(d, resolve(d, a[0], 'weapon', it)))),
    aim: fn('aim', (a, it) => {
      const c = resolve(d, a[0], 'weapon', it);
      const ang = num(a[1], 'aim angle', it);
      c.weapon!.targetWorld = ang * DEG;
      cmd(it, `aim(${c.id}, ${r1(ang)}°)${functional(d, c) ? '' : ' — weapon not functional'}`);
      return undefined;
    }),
    aimAt: fn('aimAt', (a, it) => {
      const c = resolve(d, a[0], 'weapon', it);
      const x = num(a[1], 'aimAt x', it);
      const y = num(a[2], 'aimAt y', it);
      const chk = aimCheck(d, c, x, y);
      c.weapon!.targetWorld = chk.ang;
      cmd(it, `aimAt(${c.id}, ${r1(x)}, ${r1(y)})${chk.inArc ? '' : ' — outside traverse arc'}${chk.obstructed ? ` — blocked by own ${chk.obstructed} section` : ''}${functional(d, c) ? '' : ' — weapon not functional'}`);
      return undefined;
    }),
    fire: fn('fire', (a, it) => {
      const c = resolve(d, a[0], 'weapon', it);
      const on = a.length < 2 ? true : !!a[1];
      c.weapon!.trigger = on && functional(d, c);
      cmd(it, `fire(${c.id}, ${on})${functional(d, c) ? '' : ' — weapon not functional'}`);
      return undefined;
    }),
    ceaseFire: fn('ceaseFire', (a, it) => {
      if (a.length === 0) {
        for (const c of d.components) if (c.weapon) c.weapon.trigger = false;
        cmd(it, 'ceaseFire(all)');
      } else {
        const c = resolve(d, a[0], 'weapon', it);
        c.weapon!.trigger = false;
        cmd(it, `ceaseFire(${c.id})`);
      }
      return undefined;
    }),
    reload: fn('reload', (a, it) => {
      const c = resolve(d, a[0], 'weapon', it);
      const ws = c.weapon!;
      const w = c.def!.weapon!;
      if (functional(d, c) && !ws.reloading && ws.mag < w.magazine && ammoReserve(d, w.caliber) > 0) {
        ws.reloading = true;
        ws.reloadLeft = w.reloadTime;
        cmd(it, `reload(${c.id}) started`);
      } else cmd(it, `reload(${c.id}) ignored`);
      return undefined;
    }),
    canFire: fn('canFire', (a, it) => {
      const c = resolve(d, a[0], 'weapon', it);
      const x = num(a[1], 'canFire x', it);
      const y = num(a[2], 'canFire y', it);
      const chk = aimCheck(d, c, x, y);
      const ws = c.weapon!;
      const ok = functional(d, c) && chk.inArc && !chk.obstructed && ws.mag > 0 && !ws.reloading && !ws.overheated;
      read(it, `canFire(${c.id}) → ${ok}${!chk.inArc ? ' (out of arc)' : ''}${chk.obstructed ? ` (blocked by ${chk.obstructed})` : ''}`);
      return ok;
    }),
    inArc: fn('inArc', (a, it) => {
      const c = resolve(d, a[0], 'weapon', it);
      const chk = aimCheck(d, c, num(a[1], 'inArc x', it), num(a[2], 'inArc y', it));
      return functional(d, c) && chk.inArc && !chk.obstructed;
    }),
    aimError: fn('aimError', (a, it) => {
      const c = resolve(d, a[0], 'weapon', it);
      const chk = aimCheck(d, c, num(a[1], 'aimError x', it), num(a[2], 'aimError y', it));
      return Math.abs(wrapAngle(chk.ang - (d.body.angle + c.weapon!.aim))) / DEG;
    }),
    lead: fn('lead', (a, it) => {
      const c = resolve(d, a[0], 'weapon', it);
      const t = a[1];
      if (!isObj(t)) throw new ProgramError('lead: expected a contact', it.loc);
      const tx = num(t.x, 'contact.x', it);
      const ty = num(t.y, 'contact.y', it);
      const tvx = typeof t.vx === 'number' ? t.vx : 0;
      const tvy = typeof t.vy === 'number' ? t.vy : 0;
      const m = localToWorld(d.body, c);
      const s = c.def!.weapon!.muzzleVelocity;
      const rx = tx - m.x;
      const ry = ty - m.y;
      // Solve |r + v t| = s t
      const A = tvx * tvx + tvy * tvy - s * s;
      const B = 2 * (rx * tvx + ry * tvy);
      const C = rx * rx + ry * ry;
      let time: number;
      if (Math.abs(A) < 1e-9) time = -C / B;
      else {
        const disc = B * B - 4 * A * C;
        if (disc < 0) return null;
        const t1 = (-B - Math.sqrt(disc)) / (2 * A);
        const t2 = (-B + Math.sqrt(disc)) / (2 * A);
        time = Math.min(...[t1, t2].filter((x) => x > 0));
      }
      if (!Number.isFinite(time) || time <= 0) return null;
      return makeObj({ x: tx + tvx * time, y: ty + tvy * time, t: time });
    }),

    // ---------------------------------------------------------------- shields
    shields: fn('shields', () =>
      d.components
        .filter((c) => c.kind === 'shield')
        .map((c) =>
          toValue({
            id: c.id,
            functional: functional(d, c),
            charge: c.shield!.charge,
            capacity: c.def!.shield!.capacity,
            raised: c.shield!.raised,
            powered: c.shield!.powered,
            overloaded: c.shield!.overloadLeft > 0,
            facing: wrapAngle(d.body.angle + c.shield!.facing) / DEG,
            arc: c.def!.shield!.arcDeg,
          }),
        ),
    ),
    raiseShield: fn('raiseShield', (a, it) => {
      const c = resolve(d, a[0], 'shield', it);
      c.shield!.raised = a.length < 2 ? true : !!a[1];
      cmd(it, `raiseShield(${c.id}, ${c.shield!.raised})`);
      return undefined;
    }),
    shieldFace: fn('shieldFace', (a, it) => {
      const c = resolve(d, a[0], 'shield', it);
      const ang = num(a[1], 'shieldFace angle', it);
      c.shield!.targetWorld = ang * DEG;
      cmd(it, `shieldFace(${c.id}, ${r1(ang)}°)`);
      return undefined;
    }),
    shieldFaceToward: fn('shieldFaceToward', (a, it) => {
      const c = resolve(d, a[0], 'shield', it);
      const m = localToWorld(d.body, c);
      const ang = Math.atan2(num(a[2], 'y', it) - m.y, num(a[1], 'x', it) - m.x);
      c.shield!.targetWorld = ang;
      cmd(it, `shieldFaceToward(${c.id}) → ${r1(ang / DEG)}°`);
      return undefined;
    }),

    // ---------------------------------------------------------------- power & heat
    power: fn('power', () =>
      toValue({
        generation: d.power.generation,
        stored: d.power.stored,
        capacity: d.power.capacity,
        demand: { ...d.power.demand },
        satisfaction: { ...d.power.satisfaction },
        allocation: { ...d.power.allocation },
      }),
    ),
    setPower: fn('setPower', (a, it) => {
      const p = Math.max(0, num(a[0] ?? 1, 'setPower propulsion', it));
      const w = Math.max(0, num(a[1] ?? 1, 'setPower weapons', it));
      const s = Math.max(0, num(a[2] ?? 1, 'setPower shields', it));
      d.power.allocation = { propulsion: p, weapons: w, shields: s };
      cmd(it, `setPower(propulsion ${r1(p)}, weapons ${r1(w)}, shields ${r1(s)})`);
      return undefined;
    }),
    maxHeat: fn('maxHeat', () => d.components.reduce((m, c) => (functional(d, c) ? Math.max(m, c.heat) : m), 0)),

    // ---------------------------------------------------------------- hardware state
    components: fn('components', () =>
      d.components.map((c) =>
        toValue({
          id: c.id,
          name: c.name,
          kind: c.kind,
          section: c.section,
          health: c.hp / c.maxHp,
          destroyed: c.destroyed,
          attached: d.sections[c.section].attached,
          functional: functional(d, c),
          heat: c.heat,
        }),
      ),
    ),
    component: fn('component', (a, it) => {
      const c = resolve(d, a[0], 'any', it);
      return toValue({ id: c.id, name: c.name, kind: c.kind, section: c.section, health: c.hp / c.maxHp, destroyed: c.destroyed, attached: d.sections[c.section].attached, functional: functional(d, c), heat: c.heat });
    }),
    sections: fn('sections', () =>
      (['front', 'middle', 'rear'] as const).map((p) => {
        const s = d.sections[p];
        return toValue({ id: p, class: s.def.id, attached: s.attached, destroyed: s.destroyed, integrity: s.hp / s.maxHp, armor: s.armor });
      }),
    ),
    count: fn('count', (a) => {
      const kind = toStr(a[0]);
      return d.components.filter((c) => c.kind === kind && functional(d, c)).length;
    }),
    status: fn('status', () => toValue({ ...d.status })),
    failures: fn('failures', (_a, it) => {
      const v = host.failuresThisTick.map((f) => toValue(f));
      if (v.length) read(it, `failures() → ${v.length} new event(s)`);
      return v;
    }),

    // ---------------------------------------------------------------- timers
    resetTimer: fn('resetTimer', (a) => {
      host.timers.set(toStr(a[0] ?? 'default'), host.sim.time);
      return undefined;
    }),
    elapsed: fn('elapsed', (a) => {
      const k = toStr(a[0] ?? 'default');
      if (!host.timers.has(k)) host.timers.set(k, host.sim.time);
      return host.sim.time - host.timers.get(k)!;
    }),
  };
  const o = makeObj(api);
  Object.freeze(o);
  return o;
}

/** Names exposed on the `drone` object (for autocomplete and documentation). */
export const API_NAMES = [
  'id', 'team', 'time', 'x', 'y', 'position', 'heading', 'speed', 'velocity', 'angleTo', 'distanceTo', 'arena', 'random', 'log',
  'contacts', 'enemies', 'nearestEnemy', 'threats', 'sensors',
  'drive', 'stop', 'turnToward',
  'weapons', 'weapon', 'aim', 'aimAt', 'fire', 'ceaseFire', 'reload', 'canFire', 'inArc', 'aimError', 'lead',
  'shields', 'raiseShield', 'shieldFace', 'shieldFaceToward',
  'power', 'setPower', 'maxHeat',
  'components', 'component', 'sections', 'count', 'status', 'failures',
  'resetTimer', 'elapsed',
];
