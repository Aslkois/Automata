// Turns a DroneDesign into runtime simulation state, and maintains mass properties.
import { CHASSIS } from './content/chassis';
import { INTEGRATED_MASS, integratedParts } from './content/integrated';
import { FOOTPRINT } from './content/components';
import { LAYOUTS, SECTION_CLASSES, SECTION_LETTER, SECTION_POSITIONS, type SectionPos } from './content/sections';
import { layoutSections, listMounts, moduleStock, mountRating, type DroneDesign } from './design';
import { cross, rotate, sub, type Vec2 } from './math';
import type { Drone, RComponent, RigidBody, RSection, WeaponState } from './types';

export function localToWorld(b: RigidBody, p: Vec2): Vec2 {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  return { x: b.pos.x + p.x * c - p.y * s, y: b.pos.y + p.x * s + p.y * c };
}

export function worldToLocal(b: RigidBody, p: Vec2): Vec2 {
  const dx = p.x - b.pos.x;
  const dy = p.y - b.pos.y;
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  return { x: dx * c + dy * s, y: -dx * s + dy * c };
}

export const dirToLocal = (b: RigidBody, d: Vec2): Vec2 => rotate(d, -b.angle);
export const dirToWorld = (b: RigidBody, d: Vec2): Vec2 => rotate(d, b.angle);

export const comWorld = (b: RigidBody): Vec2 => localToWorld(b, b.com);

/** Velocity of a world point attached to the body. */
export function pointVelocity(b: RigidBody, p: Vec2): Vec2 {
  const r = sub(p, comWorld(b));
  return { x: b.vel.x - b.angVel * r.y, y: b.vel.y + b.angVel * r.x };
}

export function applyImpulse(b: RigidBody, j: Vec2, worldPoint: Vec2): void {
  if (b.invMass === 0) return;
  b.vel.x += j.x * b.invMass;
  b.vel.y += j.y * b.invMass;
  const r = sub(worldPoint, comWorld(b));
  b.angVel += cross(r, j) * b.invInertia;
}

interface MassPart {
  m: number;
  x: number;
  y: number;
  l: number;
  w: number;
}

/**
 * Recompute mass, centre of mass and inertia from the given sections and components,
 * keeping world-space motion continuous (the new COM keeps the rigid-body velocity field).
 */
export function recomputeMass(body: RigidBody, sections: RSection[], components: RComponent[], gearMass: number): void {
  const parts: MassPart[] = [];
  for (const s of sections) {
    parts.push({ m: s.def.structureMass + (s.extraMass ?? 0) + s.armor * s.def.armorMassPerMm + 2 * gearMass, x: s.cx, y: 0, l: s.length, w: s.width });
  }
  const secSet = new Set(sections.map((s) => s.pos));
  for (const c of components) {
    if (!secSet.has(c.section) || !c.def) continue;
    parts.push({ m: c.def.mass, x: c.x, y: c.y, l: 0, w: 0 });
  }
  let m = 0,
    mx = 0,
    my = 0;
  for (const p of parts) {
    m += p.m;
    mx += p.m * p.x;
    my += p.m * p.y;
  }
  if (m <= 0) return;
  const newCom = { x: mx / m, y: my / m };
  let inertia = 0;
  for (const p of parts) inertia += p.m * ((p.x - newCom.x) ** 2 + (p.y - newCom.y) ** 2) + (p.m * (p.l * p.l + p.w * p.w)) / 12;
  // Keep the velocity field continuous: v_new = v(newComWorld)
  const newComWorld = localToWorld(body, newCom);
  const vNew = pointVelocity(body, newComWorld);
  body.com = newCom;
  body.vel = vNew;
  body.mass = m;
  body.invMass = 1 / m;
  body.inertia = inertia;
  body.invInertia = 1 / inertia;
}

export function boundingRadius(sections: RSection[]): number {
  let r = 0;
  for (const s of sections) {
    const fx = Math.abs(s.cx) + s.length / 2;
    r = Math.max(r, Math.hypot(fx, s.width / 2));
  }
  return r;
}

export function buildDrone(design: DroneDesign, id: number, team: number, x: number, y: number, angle: number, seed: number): Drone {
  let uidCounter = 1;
  const chassis = CHASSIS[design.chassis];
  const lay = layoutSections(design);
  const sections = {} as Record<SectionPos, RSection>;
  for (const pos of SECTION_POSITIONS) {
    const sd = design.sections[pos];
    const def = SECTION_CLASSES[sd.class];
    sections[pos] = {
      pos,
      def,
      cx: lay[pos].cx,
      length: def.length,
      width: def.width,
      height: def.height,
      armor: Math.min(sd.armor, def.maxArmor),
      armorMax: Math.min(sd.armor, def.maxArmor),
      hp: def.structureHp,
      maxHp: def.structureHp,
      attached: true,
      destroyed: false,
      fire: 0,
      fireFuel: 0,
      fireSince: 0,
      mountRating: mountRating(sd),
      extraMass: (LAYOUTS[sd.class][sd.layout ?? 'medium'] ?? LAYOUTS[sd.class].medium).frameMass + (pos === 'middle' ? INTEGRATED_MASS : 0),
      exposure: (LAYOUTS[sd.class][sd.layout ?? 'medium'] ?? LAYOUTS[sd.class].medium).exposure,
    };
  }
  const components: RComponent[] = [];
  for (const mt of listMounts(design)) {
    const def = mt.def;
    const c: RComponent = {
      uid: uidCounter++,
      id: mt.id,
      name: def.name,
      kind: def.kind,
      def,
      section: mt.section,
      x: mt.x,
      y: mt.y,
      half: FOOTPRINT[def.size],
      facing: mt.facing,
      external: def.slot === 'hardpoint',
      profile: Math.min(0.95, def.profile * (def.slot === 'hardpoint' ? sections[mt.section].exposure : 1)),
      armor: def.armor,
      hp: def.hp,
      maxHp: def.hp,
      destroyed: false,
      heat: 0,
      damagedReported: false,
    };
    if (def.weapon) {
      const w = def.weapon;
      const interceptors = w.ammo.includes('interceptor') ? Math.max(0, Math.min(w.magazine, Math.round(mt.mount.interceptors ?? 0))) : 0;
      const loaded: WeaponState['loaded'] = {};
      if (interceptors) {
        loaded.interceptor = interceptors;
        if (w.magazine - interceptors > 0) loaded[w.ammo[0]] = w.magazine - interceptors;
      } else loaded[w.ammo[0]] = w.magazine;
      c.weapon = {
        aim: mt.facing,
        targetWorld: null,
        trigger: false,
        mag: w.magazine,
        loaded,
        selected: w.ammo[0],
        loadInterceptors: interceptors,
        reloading: false,
        reloadLeft: 0,
        reloadTotal: w.reloadTime,
        cooldown: 0,
        overheated: false,
        shots: 0,
        barrel: 0,
        fireMode: mt.mount.fireMode === 'sync' && w.fireModes?.includes('sync') ? 'sync' : 'sequence',
        spin: 0,
        // the first round of a coilgun is charged before deployment; later ones must be charged in battle
        charge: w.charge ? 1 : 0,
        jitter: 0,
        designated: null,
        blockReason: null,
        clamped: false,
      };
    }
    if (def.shield) c.shield = { charge: def.shield.capacity, raised: true, facing: mt.facing, targetWorld: null, overloadLeft: 0, powered: true };
    if (def.power?.storage) c.battery = { charge: def.power.storage };
    if (def.ammo) c.ammo = { stock: moduleStock(def, mt.mount) };
    if (def.support?.heatBuffer) c.heatStore = 0;
    if (def.support?.suppression) c.suppression = { charges: def.support.suppression.charges, auto: true };
    if (def.support?.jointReinforcement) c.braces = mt.section === 'front' ? 'front' : mt.section === 'rear' ? 'rear' : (mt.mount.joint ?? 'front');
    if (def.lidar) c.scan = { time: -1, rays: [] };
    components.push(c);
  }
  // Integrated systems: propulsion, CPU, power core, coolant loop, proximity sensors.
  for (const ip of integratedParts(design)) {
    const def = ip.def;
    const c: RComponent = {
      uid: uidCounter++,
      id: ip.id,
      name: def.name,
      kind: def.kind,
      def,
      section: ip.section,
      x: sections[ip.section].cx + ip.x,
      y: ip.y,
      half: def.rangefinder ? 1.2 : 2.2,
      facing: ip.facing ?? 0,
      external: !!ip.external,
      profile: def.profile,
      armor: def.armor,
      hp: def.hp,
      maxHp: def.hp,
      destroyed: false,
      heat: 0,
      damagedReported: false,
      integrated: true,
    };
    if (def.power?.storage) c.battery = { charge: def.power.storage };
    components.push(c);
  }
  // Running gear: one left + one right per section.
  for (const pos of SECTION_POSITIONS) {
    const s = sections[pos];
    for (const side of ['left', 'right'] as const) {
      components.push({
        uid: uidCounter++,
        id: `${SECTION_LETTER[pos]}.gear${side === 'left' ? 'L' : 'R'}`,
        name: `${chassis.gearName} (${pos} ${side})`,
        kind: 'gear',
        def: null,
        section: pos,
        x: s.cx,
        y: (side === 'left' ? -1 : 1) * (s.width / 2 - 2.5),
        half: 2.5,
        facing: 0,
        external: true,
        profile: 0.45,
        armor: chassis.gearArmor,
        hp: chassis.gearHp,
        maxHp: chassis.gearHp,
        destroyed: false,
        heat: 0,
        damagedReported: false,
        gearSide: side,
      });
    }
  }
  const joints = [
    { a: 'front' as SectionPos, b: 'middle' as SectionPos, x: sections.middle.cx + sections.middle.length / 2 },
    { a: 'middle' as SectionPos, b: 'rear' as SectionPos, x: sections.middle.cx - sections.middle.length / 2 },
  ].map((j) => {
    const hp = Math.round(Math.min(sections[j.a].maxHp, sections[j.b].maxHp) * 0.7);
    return { ...j, hp, maxHp: hp, intact: true };
  });

  const body: RigidBody = { pos: { x, y }, angle, vel: { x: 0, y: 0 }, angVel: 0, mass: 1, invMass: 1, inertia: 1, invInertia: 1, com: { x: 0, y: 0 } };
  const secList = SECTION_POSITIONS.map((p) => sections[p]);
  recomputeMass(body, secList, components, chassis.gearMassPerSide);
  // Place COM-consistent: body.pos is the local origin; we want the origin at (x,y).
  body.vel = { x: 0, y: 0 };
  body.angVel = 0;

  const drone: Drone = {
    id,
    team,
    name: design.name,
    design,
    chassis,
    body,
    sections,
    joints,
    components,
    throttle: 0,
    steer: 0,
    power: {
      generation: 0,
      demand: { systems: 0, propulsion: 0, weapons: 0, shields: 0 },
      granted: { systems: 0, propulsion: 0, weapons: 0, shields: 0 },
      satisfaction: { systems: 1, propulsion: 1, weapons: 1, shields: 1 },
      stored: 0,
      capacity: 0,
      allocation: { propulsion: 1, weapons: 1, shields: 1 },
    },
    status: { operational: true, degraded: false, immobilized: false, disarmed: false, disabled: false, destroyed: false, label: 'Operational' },
    inbox: [],
    failures: [],
    perception: { time: 0, contacts: [], threats: [] },
    radius: boundingRadius(secList),
    seed,
    treadPhase: { left: 0, right: 0 },
    ranges: [],
    bumps: { front: { time: -1, impulse: 0 }, rear: { time: -1, impulse: 0 }, left: { time: -1, impulse: 0 }, right: { time: -1, impulse: 0 } },
    shake: 0,
  };
  return drone;
}

export const attachedSections = (d: Drone): RSection[] => SECTION_POSITIONS.map((p) => d.sections[p]).filter((s) => s.attached);

/** Components that are physically attached (their section is still part of the drone). */
export const attachedComponents = (d: Drone): RComponent[] => d.components.filter((c) => d.sections[c.section].attached);

export const functional = (d: Drone, c: RComponent): boolean => !c.destroyed && d.sections[c.section].attached;

export const sectionWorldCenter = (d: Drone, pos: SectionPos): Vec2 => localToWorld(d.body, { x: d.sections[pos].cx, y: 0 });

