// Component, section and joint damage; structural detachment; derived damage states.
import { SECTION_POSITIONS, type SectionPos } from './content/sections';
import type { SimContext } from './context';
import { boundingRadius, localToWorld, pointVelocity, recomputeMass } from './drone';
import type { Debris, Drone, DroneStatus, FailureEvent, RComponent, RSection } from './types';

function failure(sim: SimContext, d: Drone, f: Omit<FailureEvent, 'time'>): void {
  const ev = { time: sim.time, ...f };
  d.inbox.push(ev);
  d.failures.push(ev);
  if (d.failures.length > 200) d.failures.shift();
}

export function damageComponent(sim: SimContext, d: Drone, c: RComponent, amount: number): void {
  if (c.destroyed || amount <= 0) return;
  c.hp -= amount;
  const w = localToWorld(d.body, c);
  if (c.hp <= 0) {
    c.hp = 0;
    c.destroyed = true;
    sim.emit({ t: sim.time, type: 'component-destroyed', drone: d.id, component: c.id, kind: c.kind, x: w.x, y: w.y });
    failure(sim, d, { type: 'component-destroyed', component: c.id, kind: c.kind, section: c.section, detail: `${c.name} (${c.id}) destroyed` });
    if (c.shield) c.shield.charge = 0;
    if (c.weapon) c.weapon.trigger = false;
    if (c.battery) c.battery.charge = 0;
    if (c.ammo && c.def?.ammo) {
      const energy = c.ammo.rounds * c.def.ammo.cookOffPerRound;
      c.ammo.rounds = 0;
      if (energy > 1) {
        sim.emit({ t: sim.time, type: 'cookoff', drone: d.id, component: c.id, x: w.x, y: w.y, energy });
        const sec = d.sections[c.section];
        damageSection(sim, d, sec, energy * 0.6);
        for (const o of d.components) if (o !== c && o.section === c.section && !o.destroyed) damageComponent(sim, d, o, energy * 0.35);
      }
    }
  } else {
    sim.emit({ t: sim.time, type: 'component-damaged', drone: d.id, component: c.id, hp: c.hp / c.maxHp, x: w.x, y: w.y });
    if (!c.damagedReported && c.hp < c.maxHp * 0.5) {
      c.damagedReported = true;
      failure(sim, d, { type: 'component-damaged', component: c.id, kind: c.kind, section: c.section, detail: `${c.name} (${c.id}) below 50% integrity` });
    }
  }
}

export function damageSection(sim: SimContext, d: Drone, s: RSection, amount: number, localX?: number): void {
  if (s.destroyed || amount <= 0) return;
  s.hp -= amount;
  // Joint damage: hits close to a joint line stress the joint.
  if (localX !== undefined) {
    for (const j of d.joints) {
      if (!j.intact || (j.a !== s.pos && j.b !== s.pos)) continue;
      const dist = Math.abs(localX - j.x);
      if (dist < 7) damageJoint(sim, d, j, amount * 0.6 * (1 - dist / 7));
    }
  }
  if (s.hp <= 0) {
    s.hp = 0;
    s.destroyed = true;
    const w = localToWorld(d.body, { x: s.cx, y: 0 });
    sim.emit({ t: sim.time, type: 'section-destroyed', drone: d.id, section: s.pos, x: w.x, y: w.y });
    failure(sim, d, { type: 'section-destroyed', section: s.pos, detail: `${s.pos} section structurally destroyed` });
    for (const c of d.components) if (c.section === s.pos && !c.destroyed) damageComponent(sim, d, c, c.hp + 1);
    for (const j of d.joints) if (j.intact && (j.a === s.pos || j.b === s.pos)) j.hp = 0;
    processJoints(sim, d);
  }
}

export function damageJoint(sim: SimContext, d: Drone, j: Drone['joints'][number], amount: number): void {
  if (!j.intact) return;
  j.hp -= amount;
  if (j.hp <= 0) processJoints(sim, d);
}

/** Break failed joints and split disconnected section groups off as debris. */
export function processJoints(sim: SimContext, d: Drone): void {
  let changed = false;
  for (const j of d.joints) {
    if (j.intact && j.hp <= 0) {
      j.hp = 0;
      j.intact = false;
      changed = true;
    }
  }
  if (!changed) return;
  // Connected groups among attached sections.
  const attached = SECTION_POSITIONS.filter((p) => d.sections[p].attached);
  const groups: SectionPos[][] = [];
  const seen = new Set<SectionPos>();
  for (const p of attached) {
    if (seen.has(p)) continue;
    const g: SectionPos[] = [];
    const stack = [p];
    while (stack.length) {
      const q = stack.pop()!;
      if (seen.has(q)) continue;
      seen.add(q);
      g.push(q);
      for (const j of d.joints) {
        if (!j.intact) continue;
        if (j.a === q && d.sections[j.b].attached) stack.push(j.b);
        if (j.b === q && d.sections[j.a].attached) stack.push(j.a);
      }
    }
    groups.push(g);
  }
  if (groups.length <= 1) return;
  // The drone keeps the group with a working controller; otherwise the heaviest intact group.
  const hasController = (g: SectionPos[]) =>
    d.components.some((c) => c.kind === 'controller' && !c.destroyed && g.includes(c.section));
  const groupMass = (g: SectionPos[]) => g.reduce((m, p) => m + (d.sections[p].destroyed ? 0 : d.sections[p].maxHp), 0) + g.length * 1e-3;
  let keep = groups.find(hasController);
  if (!keep) keep = [...groups].sort((a, b) => groupMass(b) - groupMass(a))[0];
  for (const g of groups) {
    if (g === keep) continue;
    detachGroup(sim, d, g);
  }
  const secs = SECTION_POSITIONS.map((p) => d.sections[p]).filter((s) => s.attached);
  recomputeMass(d.body, secs, d.components, d.chassis.gearMassPerSide);
  d.radius = boundingRadius(secs);
}

function detachGroup(sim: SimContext, d: Drone, group: SectionPos[]): void {
  const secs = group.map((p) => d.sections[p]);
  const comps = d.components.filter((c) => group.includes(c.section));
  // Debris inherits the motion of its own centre of mass from the drone's velocity field.
  const body = {
    pos: { x: d.body.pos.x, y: d.body.pos.y },
    angle: d.body.angle,
    vel: { x: 0, y: 0 },
    angVel: d.body.angVel,
    mass: 1,
    invMass: 1,
    inertia: 1,
    invInertia: 1,
    com: { x: d.body.com.x, y: d.body.com.y },
  };
  body.vel = pointVelocity(d.body, localToWorld(d.body, body.com));
  const debrisSecs = secs.map((s) => ({ ...s }));
  const debrisComps = comps.map((c) => ({ ...c, weapon: undefined, shield: undefined }));
  recomputeMass(body, debrisSecs, debrisComps, d.chassis.gearMassPerSide);
  // Separation impulse: push the piece away from the remaining hull along the drone axis.
  const sign = secs[0].cx > 0 ? 1 : -1;
  const ax = { x: Math.cos(d.body.angle) * sign, y: Math.sin(d.body.angle) * sign };
  body.vel.x += ax.x * 12;
  body.vel.y += ax.y * 12;
  body.angVel += (sim.rng.next() - 0.5) * 1.2;
  const debris: Debris = {
    id: sim.nextId(),
    fromDrone: d.id,
    team: d.team,
    body,
    sections: debrisSecs,
    components: debrisComps,
    radius: boundingRadius(debrisSecs),
    chassis: d.chassis,
  };
  sim.debris.push(debris);
  for (const s of secs) s.attached = false;
  // Equipment on the detached part loses power, control and its weapon commands.
  for (const c of comps) {
    if (c.weapon) c.weapon.trigger = false;
    if (c.shield) c.shield.charge = 0;
  }
  const w = localToWorld(d.body, { x: secs[0].cx, y: 0 });
  sim.emit({ t: sim.time, type: 'detached', drone: d.id, sections: group, debris: debris.id, x: w.x, y: w.y });
  for (const p of group)
    d.inbox.push({ time: sim.time, type: 'section-detached', section: p, detail: `${p} section detached from the hull` }),
      d.failures.push({ time: sim.time, type: 'section-detached', section: p, detail: `${p} section detached from the hull` });
}

/** Derive damage states from component conditions (no global health bar). */
export function computeStatus(d: Drone): DroneStatus {
  const att = d.components.filter((c) => d.sections[c.section].attached);
  const ok = (c: RComponent) => !c.destroyed;
  const controller = att.some((c) => c.kind === 'controller' && ok(c));
  const powerSource = att.some((c) => (c.kind === 'generator' && ok(c)) || (c.kind === 'battery' && ok(c) && (c.battery?.charge ?? 0) > 1));
  const motors = att.some((c) => c.kind === 'motor' && ok(c));
  const gearL = att.some((c) => c.kind === 'gear' && c.gearSide === 'left' && ok(c));
  const gearR = att.some((c) => c.kind === 'gear' && c.gearSide === 'right' && ok(c));
  const hasWeapons = d.components.some((c) => c.kind === 'weapon');
  const armed = att.some((c) => {
    if (c.kind !== 'weapon' || !ok(c) || !c.weapon || !c.def?.weapon) return false;
    if (c.weapon.mag > 0) return true;
    const cal = c.def.weapon.caliber;
    return att.some((a) => a.kind === 'ammo' && ok(a) && a.def?.ammo?.caliber === cal && (a.ammo?.rounds ?? 0) > 0);
  });
  // Structurally destroyed: nothing of the remaining hull is intact.
  const destroyed = SECTION_POSITIONS.every((p) => d.sections[p].destroyed || !d.sections[p].attached);
  const disabled = destroyed || !controller || !powerSource;
  const immobilized = !motors || (!gearL && !gearR);
  const disarmed = hasWeapons ? !armed : true;
  const degraded =
    att.some((c) => c.destroyed || c.hp < c.maxHp * 0.5) ||
    SECTION_POSITIONS.some((p) => !d.sections[p].attached || d.sections[p].hp < d.sections[p].maxHp * 0.5);
  let label = 'Operational';
  if (destroyed) label = 'Destroyed';
  else if (disabled) label = 'Disabled';
  else if (immobilized && disarmed) label = 'Immobilized + Disarmed';
  else if (immobilized) label = 'Immobilized';
  else if (disarmed) label = 'Disarmed';
  else if (degraded) label = 'Degraded';
  return { operational: !disabled, degraded, immobilized, disarmed, disabled, destroyed, label };
}

/** A drone that can no longer fight: disabled, destroyed or disarmed. */
export const combatIneffective = (s: DroneStatus) => s.disabled || s.destroyed || s.disarmed;
