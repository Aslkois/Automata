// Mirroring a section's hardpoint arrangement across that section's vertical centreline:
// local (x, y) → (−x, y). Mounts swap left and right within the section (on the construction
// stage, where sections run rear → middle → front left to right); nothing moves vertically,
// no facing changes, no other section changes, and the simulation uses the same geometry.
import { describe, expect, it } from 'vitest';
import { LAYOUT_IDS, SECTION_CLASSES, SLOT_HALF, layoutSymmetric, sectionSlots, type SectionClass } from '../../src/sim/content/sections';
import { cloneDesign, computeStats, layoutSections, listMounts, mirrorEffect, mirrorSection, parseDesign, relocateSection, serializeDesign, slotsOf, validateDesign, type DroneDesign, type SectionDesign } from '../../src/sim/design';
import type { SimEvent } from '../../src/sim/types';
import { DEFAULT_DESIGNS } from '../../src/data/defaults';
import { code, comp, design, m, makeSim } from './helpers';

const CLASSES = Object.keys(SECTION_CLASSES) as SectionClass[];
const POS = ['front', 'middle', 'rear'] as const;
const mirrored = (d: DroneDesign, ...pos: (typeof POS)[number][]) => {
  const out = cloneDesign(d);
  for (const p of pos) out.sections[p] = mirrorSection(out.sections[p]);
  return out;
};

/** Heavy Medium front (L forward-left, M forward-right, M aft), with turned parts and settings. */
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
  it('every layout mirrors to (−x, y) about its own centre, same ids and sizes, inside the hull, distances kept', () => {
    for (const cls of CLASSES)
      for (const l of LAYOUT_IDS) {
        const a = sectionSlots(cls, l);
        const b = sectionSlots(cls, l, true);
        expect(b.map((s) => [s.id, s.kind, s.size, s.y]), `${cls}/${l}`).toEqual(a.map((s) => [s.id, s.kind, s.size, s.y]));
        for (let i = 0; i < a.length; i++) expect(b[i].x, `${cls} ${l} ${a[i].id}`).toBe(a[i].kind === 'hardpoint' && a[i].x !== 0 ? -a[i].x : a[i].x);
        const c = SECTION_CLASSES[cls];
        const hp = b.filter((s) => s.kind === 'hardpoint');
        const hp0 = a.filter((s) => s.kind === 'hardpoint');
        for (const h of hp) expect(Math.abs(h.x) + SLOT_HALF[h.size]).toBeLessThanOrEqual(c.length / 2 + 1e-9);
        for (let i = 0; i < hp.length; i++)
          for (let j = i + 1; j < hp.length; j++) expect(Math.hypot(hp[i].x - hp[j].x, hp[i].y - hp[j].y)).toBeCloseTo(Math.hypot(hp0[i].x - hp0[j].x, hp0[i].y - hp0[j].y), 9);
      }
  });

  it('every asymmetric layout reverses; only light Medium (mounts on the centreline) is its own mirror image', () => {
    const sym = CLASSES.flatMap((c) => LAYOUT_IDS.filter((l) => layoutSymmetric(c, l)).map((l) => `${c}/${l}`));
    expect(sym).toEqual(['light/medium']);
    for (const cls of CLASSES)
      for (const l of LAYOUT_IDS) {
        const shape = (mir: boolean) => sectionSlots(cls, l, mir).filter((s) => s.kind === 'hardpoint').map((s) => `${s.size}${s.x},${s.y}`).sort().join();
        expect(shape(true) === shape(false), `${cls}/${l}`).toBe(layoutSymmetric(cls, l));
      }
    // heavy Maximum: [ L L ] forward, [ M ] aft — mirrored, [ M ] forward, [ L L ] aft
    const max = (mir: boolean) => sectionSlots('heavy', 'max', mir).filter((s) => s.kind === 'hardpoint');
    expect(max(false).filter((s) => s.size === 'L').every((s) => s.x > 0)).toBe(true);
    expect(max(true).filter((s) => s.size === 'L').every((s) => s.x < 0)).toBe(true);
  });

  it('mirrors about the section centre, not the drone centre: x′ = 2 × sectionCentreX − x', () => {
    const d = subject();
    const f = mirrored(d, 'front');
    const lay = layoutSections(d);
    for (const a of listMounts(d).filter((x) => x.section === 'front' && x.slot.kind === 'hardpoint')) {
      const b = listMounts(f).find((x) => x.id === a.id)!;
      expect(b.x).toBeCloseTo(2 * lay.front.cx - a.x, 9);
      expect(b.y).toBe(a.y);
    }
  });
});

describe('the design', () => {
  it('mirroring twice restores the section exactly', () => {
    for (const d of [subject(), ...DEFAULT_DESIGNS]) for (const pos of POS) expect(mirrorSection(mirrorSection(d.sections[pos]))).toEqual(d.sections[pos]);
  });

  it('sections mirror independently', () => {
    for (const only of POS) {
      const d = subject();
      const f = mirrored(d, only);
      for (const a of listMounts(d)) {
        const b = listMounts(f).find((x) => x.id === a.id)!;
        if (a.section === only && a.slot.kind === 'hardpoint' && a.slot.x !== 0) expect(b.x, a.id).not.toBe(a.x);
        else expect([b.x, b.y], a.id).toEqual([a.x, a.y]);
        expect(b.facing).toBe(a.facing);
      }
      for (const p of POS) if (p !== only) expect(f.sections[p]).toEqual(d.sections[p]);
      expect(f.sections[only].mirror).toBe(true);
    }
  });

  it('keeps components, slot ids, facings, settings, mass and layout tier; no weapon is turned', () => {
    const d = subject();
    const f = mirrored(d, 'front', 'middle', 'rear');
    for (const pos of POS) {
      expect(f.sections[pos].slots).toEqual(d.sections[pos].slots);
      expect([f.sections[pos].class, f.sections[pos].layout, f.sections[pos].armor]).toEqual([d.sections[pos].class, d.sections[pos].layout, d.sections[pos].armor]);
    }
    expect(computeStats(f).mass).toBeCloseTo(computeStats(d).mass, 9);
    for (const a of listMounts(d)) expect(listMounts(f).find((x) => x.id === a.id)!.facing).toBe(a.facing);
  });

  it('validation and firing clearance are recomputed; valid mirrored starters stay valid', () => {
    for (const d of DEFAULT_DESIGNS) {
      const f = mirrored(d, 'front', 'middle', 'rear');
      expect(validateDesign(f).filter((i) => i.severity === 'error'), d.name).toEqual([]);
      expect(computeStats(f).weapons.map((w) => w.mount)).toEqual(computeStats(d).weapons.map((w) => w.mount));
    }
  });

  it('class and layout changes keep a section mirrored and re-seat parts on the mirrored mounts', () => {
    const sd: SectionDesign = mirrorSection(subject().sections.front);
    const ch = relocateSection(sd, 'heavy', 'max');
    expect(ch.displaced).toEqual([]);
    const placed: SectionDesign = { ...sd, layout: 'max', slots: ch.slots };
    expect(slotsOf(placed).find((s) => s.id === 'H1')!.x).toBe(-sectionSlots('heavy', 'max')[0].x);
  });
});

describe('the simulation uses the mirrored geometry', () => {
  const fire = code(`function update(){ drone.aim('F.H1', 0); drone.fire('F.H1'); }`);
  const firstShot = (d: DroneDesign) => {
    const sim = makeSim([{ design: d, program: fire, team: 0, x: 500, y: 550, angle: 0 }]);
    for (let i = 0; i < 120; i++) {
      sim.step();
      const s = sim.takeEvents().find((e): e is Extract<SimEvent, { type: 'shot' }> => e.type === 'shot' && e.mount === 'F.H1');
      if (s) return s;
    }
    throw new Error('no shot');
  };

  it('weapons fire from their mirrored positions', () => {
    const d = subject();
    const a = firstShot(d);
    const b = firstShot(mirrored(d, 'front'));
    // F.H1 moves from x to −x within the front section: the shot leaves 2·x further aft
    const x = sectionSlots('heavy', 'medium').find((s) => s.id === 'H1')!.x;
    expect(a.x - b.x).toBeCloseTo(2 * x, 0);
    expect(b.y).toBeCloseTo(a.y, 0);
    expect(b.dir).toBeCloseTo(a.dir, 2);
  });

  it('components, shields and sensors sit where the constructor draws them, facing unchanged', () => {
    const f = mirrored(subject(), 'front', 'middle', 'rear');
    const sim = makeSim([{ design: f, program: code('function update(){}'), team: 0, x: 500, y: 550, angle: 0 }]);
    const dr = sim.drones[0];
    for (const mt of listMounts(f)) {
      const c = comp(dr, mt.id);
      expect([c.x, c.y], mt.id).toEqual([mt.x, mt.y]);
      expect(c.facing, mt.id).toBeCloseTo(mt.facing, 9);
    }
    expect(comp(dr, 'M.H1').shield!.facing).toBeCloseTo(60 * (Math.PI / 180), 9);
    expect(comp(dr, 'F.H3').facing).toBeCloseTo(135 * (Math.PI / 180), 9);
  });

  it('a mirrored drone runs deterministically', () => {
    const run = (x: DroneDesign) => {
      const sim = makeSim([{ design: x, program: fire, team: 0, x: 500, y: 550, angle: 0 }], { seed: 3 });
      sim.run(3);
      return JSON.stringify([sim.drones[0].body.pos, sim.drones[0].body.angle]);
    };
    expect(run(mirrored(subject(), 'front'))).toBe(run(mirrored(subject(), 'front')));
  });
});

describe('saving and loading', () => {
  it('existing designs load unchanged and unmirrored', () => {
    for (const d of DEFAULT_DESIGNS) {
      const back = parseDesign(serializeDesign(d));
      expect(back.sections).toEqual(d.sections);
      for (const p of POS) expect('mirror' in back.sections[p]).toBe(false);
    }
  });

  it('export, import and duplication keep each section’s mirror state', () => {
    const f = mirrored(subject(), 'front', 'rear');
    const back = parseDesign(serializeDesign(f));
    expect([back.sections.front.mirror, back.sections.middle.mirror, back.sections.rear.mirror]).toEqual([true, undefined, true]);
    expect(back.sections).toEqual(f.sections);
    expect(cloneDesign(f).sections.front.mirror).toBe(true);
  });

  it('superseded mirrors migrate: the schema-6 flip becomes the mirror; the old long-axis mirror is undone with its facings', () => {
    const d = subject();
    const old = JSON.parse(serializeDesign(d));
    old.schema = 6;
    old.sections.middle.flip = true;
    // a section saved with the old long-axis mirror had its hardpoint facings reflected
    old.sections.front.mirror = true;
    old.sections.front.slots.H1.rotation = -30;
    old.sections.front.slots.H2.rotation = 20;
    old.sections.front.slots.H3.rotation = -135;
    const back = parseDesign(old);
    expect(back.sections.middle.mirror).toBe(true);
    expect('flip' in back.sections.middle).toBe(false);
    expect(back.sections.front.mirror).toBeUndefined();
    expect(back.sections.front.slots).toEqual(d.sections.front.slots);
  });
});

describe('the mirror control', () => {
  it('knows when mirroring changes nothing', () => {
    const empty = (cls: SectionClass, layout: SectionDesign['layout']): SectionDesign => ({ class: cls, layout, armor: 0, slots: {} });
    expect(mirrorEffect(empty('light', 'medium'))).toBe('none');
    for (const c of CLASSES) for (const l of LAYOUT_IDS) if (!(c === 'light' && l === 'medium')) expect(mirrorEffect(empty(c, l)), `${c}/${l}`).toBe('reshape');
  });
});
