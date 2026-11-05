// Horizontal mirroring of hardpoint layouts: a physical reflection across the drone's long
// axis, (x, y) → (x, −y), with the same slot ids, the mirrored facing, and the simulation
// using the same geometry the constructor draws.
import { describe, expect, it } from 'vitest';
import { LAYOUT_IDS, LAYOUTS, SECTION_CLASSES, SLOT_HALF, layoutSymmetric, sectionSlots, type SectionClass } from '../../src/sim/content/sections';
import { cloneDesign, computeStats, listMounts, mirrorEffect, mirrorSection, parseDesign, relocateSection, serializeDesign, slotsOf, validateDesign, type DroneDesign, type SectionDesign } from '../../src/sim/design';
import { localToWorld } from '../../src/sim/drone';
import type { SimEvent } from '../../src/sim/types';
import { DEFAULT_DESIGNS } from '../../src/data/defaults';
import { code, comp, design, m, makeSim } from './helpers';

const CLASSES = Object.keys(SECTION_CLASSES) as SectionClass[];
const mirrored = (d: DroneDesign, ...pos: ('front' | 'middle' | 'rear')[]) => {
  const out = cloneDesign(d);
  for (const p of pos) out.sections[p] = mirrorSection(out.sections[p]);
  return out;
};

/** Heavy Maximum front (L, L, M) with a turret turned to one side, a shield and a camera. */
const subject = () =>
  design({
    chassis: 'tracked',
    sections: {
      front: { class: 'heavy', layout: 'medium', armor: 40, slots: { H1: m('heavy_cannon', 30), H2: { component: 'dual_autocannon', rotation: -20, fireMode: 'sync' }, H3: m('camera', 135), I1: m('shell_rack'), I2: { component: 'ammo_medium', rotation: 0, payload: 'medium' } } },
      middle: { class: 'medium', layout: 'max', armor: 20, slots: { H1: m('shield_dir', 60), H2: m('radar') } },
      rear: { class: 'light', layout: 'max', armor: 8, slots: { H1: { component: 'rocket_pod', rotation: 180, interceptors: 2 }, I1: { component: 'rocket_cassette', rotation: 0, interceptors: 4 } } },
    },
  });

describe('layout geometry', () => {
  it('1. every layout mirrors to (x, −y) with the same ids and sizes, still inside the hull and not overlapping', () => {
    for (const cls of CLASSES)
      for (const l of LAYOUT_IDS) {
        const a = sectionSlots(cls, l);
        const b = sectionSlots(cls, l, true);
        expect(b.map((s) => [s.id, s.kind, s.size, s.x])).toEqual(a.map((s) => [s.id, s.kind, s.size, s.x]));
        for (let i = 0; i < a.length; i++) expect(b[i].y, `${cls} ${l} ${a[i].id}`).toBe(a[i].kind === 'hardpoint' ? (a[i].y === 0 ? 0 : -a[i].y) : a[i].y);
        const c = SECTION_CLASSES[cls];
        const hp = b.filter((s) => s.kind === 'hardpoint');
        const hp0 = a.filter((s) => s.kind === 'hardpoint');
        for (const h of hp) {
          expect(Math.abs(h.x) + SLOT_HALF[h.size]).toBeLessThanOrEqual(c.length / 2 + 1e-9);
          expect(Math.abs(h.y) + SLOT_HALF[h.size]).toBeLessThanOrEqual(c.width / 2 + 1e-9);
        }
        // a reflection keeps every distance, so no mirrored mounts overlap that did not before
        for (let i = 0; i < hp.length; i++)
          for (let j = i + 1; j < hp.length; j++) expect(Math.hypot(hp[i].x - hp[j].x, hp[i].y - hp[j].y)).toBeCloseTo(Math.hypot(hp0[i].x - hp0[j].x, hp0[i].y - hp0[j].y), 9);
      }
  });

  it('asymmetric layouts reverse; symmetrical ones keep their shape', () => {
    const asym = CLASSES.flatMap((c) => LAYOUT_IDS.filter((l) => !layoutSymmetric(c, l)).map((l) => `${c}/${l}`));
    // a different size on each side: light and medium Maximum, heavy Medium
    expect(asym.sort()).toEqual(['heavy/medium', 'light/max', 'medium/max']);
    for (const cls of CLASSES)
      for (const l of LAYOUT_IDS) {
        const shape = (mir: boolean) => sectionSlots(cls, l, mir).filter((s) => s.kind === 'hardpoint').map((s) => `${s.size}${s.x},${s.y}`).sort();
        expect(shape(true).join() === shape(false).join(), `${cls}/${l}`).toBe(layoutSymmetric(cls, l));
      }
    // heavy Maximum is symmetrical: the medium mount on the centreline, a large one on each side
    expect(layoutSymmetric('heavy', 'max')).toBe(true);
    expect(LAYOUTS.heavy.max.hardpoints.filter((h) => h.y === 0).map((h) => h.size)).toEqual(['M']);
  });
});

describe('the design', () => {
  it('2. mirroring twice restores the section exactly', () => {
    for (const d of [subject(), ...DEFAULT_DESIGNS])
      for (const pos of ['front', 'middle', 'rear'] as const) expect(mirrorSection(mirrorSection(d.sections[pos]))).toEqual(d.sections[pos]);
  });

  it('3. sections mirror independently', () => {
    const d = subject();
    const f = mirrored(d, 'front');
    const before = listMounts(d);
    const after = listMounts(f);
    for (const a of before) {
      const b = after.find((x) => x.id === a.id)!;
      if (a.section === 'front' && a.slot.kind === 'hardpoint') expect(b.y).toBeCloseTo(-a.y, 9);
      else expect([b.x, b.y, b.facing]).toEqual([a.x, a.y, a.facing]);
    }
    expect(f.sections.middle).toEqual(d.sections.middle);
    expect(f.sections.rear).toEqual(d.sections.rear);
    expect(f.sections.front.mirror).toBe(true);
    expect(f.sections.middle.mirror).toBeUndefined();
  });

  it('4. mount ids, components and settings are unchanged; only facings reflect', () => {
    const d = subject();
    const f = mirrored(d, 'front', 'middle', 'rear');
    for (const pos of ['front', 'middle', 'rear'] as const) {
      expect(Object.keys(f.sections[pos].slots)).toEqual(Object.keys(d.sections[pos].slots));
      for (const [id, mt] of Object.entries(d.sections[pos].slots)) {
        const g = f.sections[pos].slots[id]!;
        const { rotation: r0, ...rest0 } = mt!;
        const { rotation: r1, ...rest1 } = g;
        expect(rest1).toEqual(rest0);
        const hard = slotsOf(d.sections[pos]).find((s) => s.id === id)!.kind === 'hardpoint';
        expect(r1, `${pos}.${id}`).toBe(hard && r0 !== 0 && Math.abs(r0) !== 180 ? -r0 : r0);
      }
    }
    // the rear pod at 180° (astern) still points astern
    expect(f.sections.rear.slots.H1!.rotation).toBe(180);
  });

  it('6. turret facings and firing arcs are the mirror image; coverage is unchanged', () => {
    const d = subject();
    const f = mirrored(d, 'front', 'middle', 'rear');
    const a = listMounts(d);
    const b = listMounts(f);
    for (const x of a.filter((x) => x.slot.kind === 'hardpoint')) {
      const y = b.find((z) => z.id === x.id)!;
      expect(Math.sin(y.facing)).toBeCloseTo(-Math.sin(x.facing), 9);
      expect(Math.cos(y.facing)).toBeCloseTo(Math.cos(x.facing), 9);
    }
    const ca = computeStats(d).weapons;
    const cb = computeStats(f).weapons;
    for (const w of ca) expect(cb.find((v) => v.mount === w.mount)!.usableFraction).toBeCloseTo(w.usableFraction, 6);
    expect(computeStats(f).mass).toBeCloseTo(computeStats(d).mass, 6);
  });

  it('with hardpoint equipment only, the centre of mass reflects and the inertia is unchanged', () => {
    // internal bays belong to the section class, not the hardpoint layout, and do not move
    const d = subject();
    for (const p of ['front', 'middle', 'rear'] as const) for (const id of Object.keys(d.sections[p].slots)) if (id.startsWith('I')) delete d.sections[p].slots[id];
    const f = mirrored(d, 'front', 'middle', 'rear');
    const sa = computeStats(d);
    const sb = computeStats(f);
    expect(sb.mass).toBeCloseTo(sa.mass, 6);
    expect(sb.inertia).toBeCloseTo(sa.inertia, 3);
    expect(sb.com.y).toBeCloseTo(-sa.com.y, 6);
    expect(sb.com.x).toBeCloseTo(sa.com.x, 6);
  });

  it('validation is recomputed and an otherwise valid mirrored design stays valid', () => {
    for (const d of DEFAULT_DESIGNS) {
      const f = mirrored(d, 'front', 'middle', 'rear');
      expect(validateDesign(f).filter((i) => i.severity === 'error')).toEqual([]);
    }
  });

  it('layout and class changes keep a section mirrored and use the mirrored positions', () => {
    const sd: SectionDesign = mirrorSection(subject().sections.front);
    const ch = relocateSection(sd, 'heavy', 'max');
    const placed: SectionDesign = { ...sd, layout: 'max', slots: ch.slots };
    expect(slotsOf(placed).find((s) => s.id === 'H1')!.y).toBe(-sectionSlots('heavy', 'max')[0].y);
    expect(ch.displaced).toEqual([]);
  });
});

describe('the simulation uses the mirrored geometry', () => {
  const fire = code(`function update(){ drone.aim('F.H1', 0); drone.fire('F.H1'); }`);
  const firstShot = (d: DroneDesign) => {
    const sim = makeSim([{ design: d, program: fire, team: 0, x: 500, y: 550, angle: 0 }]);
    for (let i = 0; i < 120; i++) {
      sim.step();
      const s = sim.takeEvents().find((e): e is Extract<SimEvent, { type: 'shot' }> => e.type === 'shot' && e.mount === 'F.H1');
      if (s) return { s, sim };
    }
    throw new Error('no shot');
  };

  it('5. a mirrored weapon fires from its mirrored position', () => {
    const d = subject();
    const a = firstShot(d).s;
    const b = firstShot(mirrored(d, 'front')).s;
    expect(Math.abs(a.y - 550)).toBeGreaterThan(1);
    expect(b.x).toBeCloseTo(a.x, 0);
    expect(b.y - 550).toBeCloseTo(-(a.y - 550), 0);
  });

  it('7–8. components, shields and sensors sit and face where the constructor puts them', () => {
    const f = mirrored(subject(), 'front', 'middle', 'rear');
    const sim = makeSim([{ design: f, program: code('function update(){}'), team: 0, x: 500, y: 550, angle: 0 }]);
    const dr = sim.drones[0];
    for (const mt of listMounts(f)) {
      const c = comp(dr, mt.id);
      // the same geometry the stage draws (listMounts / slotsOf), in the simulation's body frame
      const w = localToWorld(dr.body, c);
      const expected = localToWorld(dr.body, { x: mt.x, y: mt.y } as typeof c);
      expect([w.x, w.y], mt.id).toEqual([expected.x, expected.y]);
      expect(c.facing, mt.id).toBeCloseTo(mt.facing, 9);
    }
    expect(comp(dr, 'M.H1').shield!.facing).toBeCloseTo(-60 * (Math.PI / 180), 9);
    expect(comp(dr, 'F.H3').facing).toBeCloseTo(-135 * (Math.PI / 180), 9);
  });

  it('a mirrored drone is deterministic and behaves as the reflection of the original', () => {
    const d = subject();
    const run = (x: DroneDesign) => {
      const sim = makeSim([{ design: x, program: fire, team: 0, x: 500, y: 550, angle: 0 }], { seed: 3 });
      sim.run(3);
      return sim.drones[0].body;
    };
    const a = run(d);
    const b = run(mirrored(d, 'front', 'middle', 'rear'));
    // recoil from a turret on the other side turns the hull the other way
    expect(b.angle).toBeCloseTo(-a.angle, 2);
    expect(b.pos.y - 550).toBeCloseTo(-(a.pos.y - 550), 1);
    expect(run(mirrored(d, 'front'))).toEqual(run(mirrored(d, 'front')));
  });
});

describe('saving and loading', () => {
  it('9. existing designs load unchanged and unmirrored', () => {
    for (const d of DEFAULT_DESIGNS) {
      const back = parseDesign(serializeDesign(d));
      expect(back.sections).toEqual(d.sections);
      for (const p of ['front', 'middle', 'rear'] as const) expect('mirror' in back.sections[p]).toBe(false);
    }
    // a schema-4 file never had mirroring: a stray flag is not read
    const old = JSON.parse(serializeDesign(subject()));
    old.schema = 4;
    old.sections.front.mirror = true;
    expect(parseDesign(old).sections.front.mirror).toBeUndefined();
  });

  it('10. export, import and duplication keep each section’s mirror state', () => {
    const f = mirrored(subject(), 'front', 'rear');
    const back = parseDesign(serializeDesign(f));
    expect([back.sections.front.mirror, back.sections.middle.mirror, back.sections.rear.mirror]).toEqual([true, undefined, true]);
    expect(back.sections).toEqual(f.sections);
    expect(cloneDesign(f).sections.front.mirror).toBe(true);
  });
});

describe('the mirror control', () => {
  it('12. knows when mirroring changes nothing, only swaps sides, or reverses the arrangement', () => {
    const empty = (cls: SectionClass, layout: SectionDesign['layout']): SectionDesign => ({ class: cls, layout, armor: 0, slots: {} });
    // an empty symmetrical layout: the same drone either way
    expect(mirrorEffect(empty('medium', 'medium'))).toBe('none');
    // parts on a symmetrical layout change sides
    expect(mirrorEffect({ ...empty('light', 'medium'), slots: { H1: m('mg'), H2: m('camera') } })).toBe('swap');
    // asymmetrical layouts reverse, even empty
    expect(mirrorEffect(empty('heavy', 'medium'))).toBe('reshape');
    expect(mirrorEffect(empty('heavy', 'max'))).toBe('none');
    // a centreline mount turned sideways still changes (its facing mirrors)
    expect(mirrorEffect({ ...empty('medium', 'medium'), slots: { H3: m('camera', 90) } })).toBe('swap');
    expect(mirrorEffect({ ...empty('medium', 'medium'), slots: { H3: m('camera', 0) } })).toBe('none');
  });
});
