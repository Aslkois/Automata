import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGNS } from '../../src/data/defaults';
import { COMPONENT_MAP } from '../../src/sim/content/components';
import { LAYOUT_IDS, LAYOUTS, SECTION_CLASSES, SLOT_HALF, sectionSlots, type SectionClass } from '../../src/sim/content/sections';
import { computeStats, footprintsOverlap, parseDesign, relocateSection, validateDesign, type SectionDesign } from '../../src/sim/design';
import { buildDrone } from '../../src/sim/drone';
import { design, m } from './helpers';

const CLASSES: SectionClass[] = ['light', 'medium', 'heavy'];

describe('hardpoint layouts', () => {
  it('every layout keeps its mounts inside the hull without overlapping', () => {
    for (const cls of CLASSES) {
      const c = SECTION_CLASSES[cls];
      for (const lid of LAYOUT_IDS) {
        const slots = sectionSlots(cls, lid);
        const hps = slots.filter((s) => s.kind === 'hardpoint');
        expect(hps.length, `${cls}/${lid}`).toBeGreaterThan(0);
        for (const s of slots) {
          const h = SLOT_HALF[s.size];
          expect(Math.abs(s.x) + h, `${cls}/${lid} ${s.id} x`).toBeLessThanOrEqual(c.length / 2);
          expect(Math.abs(s.y) + h, `${cls}/${lid} ${s.id} y`).toBeLessThanOrEqual(c.width / 2);
        }
        // hardpoints stand on the deck, bays sit below it: each level must be free of overlaps
        for (const level of ['hardpoint', 'internal'] as const) {
          const ls = slots.filter((s) => s.kind === level);
          for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) expect(footprintsOverlap(ls[i], ls[j]), `${cls}/${lid} ${ls[i].id}/${ls[j].id}`).toBe(false);
        }
      }
    }
  });

  it('Maximum carries larger equipment than Medium, Minimum fewer mounts', () => {
    const rank = { S: 1, M: 2, L: 3 } as const;
    for (const cls of CLASSES) {
      const L = LAYOUTS[cls];
      const biggest = (id: 'max' | 'medium' | 'min') => Math.max(...L[id].hardpoints.map((h) => rank[h.size]));
      expect(biggest('max')).toBeGreaterThanOrEqual(biggest('medium'));
      expect(L.min.hardpoints.length).toBeLessThanOrEqual(L.medium.hardpoints.length);
      expect(L.max.frameMass).toBeGreaterThan(0);
      expect(L.min.frameMass).toBeLessThan(0);
    }
    // light max takes a medium weapon that the medium layout cannot
    expect(LAYOUTS.light.max.hardpoints.some((h) => h.size === 'M')).toBe(true);
    expect(LAYOUTS.light.medium.hardpoints.every((h) => h.size === 'S')).toBe(true);
  });

  it('the Medium layout is the arrangement every earlier design used', () => {
    for (const cls of CLASSES) {
      const legacy = SECTION_CLASSES[cls].slots.filter((s) => s.kind === 'hardpoint');
      expect(LAYOUTS[cls].medium.hardpoints).toEqual(legacy);
    }
  });

  it('layout frame mass and exposure have real effects', () => {
    const base = design({
      sections: {
        front: { class: 'medium', layout: 'medium', armor: 20, slots: { H1: m('quad_mg'), I1: m('ammo_small') } },
        middle: { class: 'medium', layout: 'medium', armor: 10, slots: {} },
        rear: { class: 'light', layout: 'medium', armor: 5, slots: {} },
      },
    });
    const max = structuredClone(base);
    max.sections.front.layout = 'max';
    const sa = computeStats(base);
    const sb = computeStats(max);
    expect(sb.mass - sa.mass).toBeCloseTo(LAYOUTS.medium.max.frameMass, 5);
    const da = buildDrone(base, 1, 0, 300, 300, 0, 1);
    const db = buildDrone(max, 1, 0, 300, 300, 0, 1);
    // runtime mass agrees with the design statistics
    expect(da.body.mass).toBeCloseTo(sa.mass, 0);
    expect(db.body.mass).toBeCloseTo(sb.mass, 0);
    const pa = da.components.find((c) => c.id === 'F.H1')!.profile;
    const pb = db.components.find((c) => c.id === 'F.H1')!.profile;
    expect(pb / pa).toBeCloseTo(LAYOUTS.medium.max.exposure, 5);
    // stronger mounts on the Maximum layout
    expect(db.sections.front.mountRating).toBeGreaterThan(da.sections.front.mountRating);
  });
});

describe('layout changes relocate equipment', () => {
  const heavy = (): SectionDesign => ({ class: 'heavy', layout: 'medium', armor: 40, slots: { H1: m('heavy_cannon'), H2: m('heavy_cannon'), H3: m('mg', 180), I1: m('ammo_small'), I4: m('shell_rack') } });

  it('keeps every part or reports it — nothing is dropped silently', () => {
    const sd = heavy();
    for (const lid of LAYOUT_IDS) {
      for (const cls of CLASSES) {
        const r = relocateSection(sd, cls, lid);
        const placed = Object.values(r.slots).filter(Boolean).length;
        expect(placed + r.displaced.length, `${cls}/${lid}`).toBe(Object.values(sd.slots).filter(Boolean).length);
        // every placed part fits its new slot
        const slots = sectionSlots(cls, lid);
        for (const [sid, mt] of Object.entries(r.slots)) {
          const s = slots.find((x) => x.id === sid)!;
          expect(s, `${cls}/${lid} ${sid}`).toBeDefined();
          const def = COMPONENT_MAP[mt!.component];
          expect(def.slot).toBe(s.kind);
        }
      }
    }
  });

  it('heavy Medium → Minimum keeps one cannon, moves the gun and reports the second cannon', () => {
    const r = relocateSection(heavy(), 'heavy', 'min');
    expect(r.slots.H1?.component).toBe('heavy_cannon');
    expect(r.displaced.map((x) => x.mount.component)).toEqual(['heavy_cannon']);
    expect(r.slots.H2?.component).toBe('mg');
    expect(r.moved).toContainEqual(['H3', 'H2']);
    // mount configuration (rotation) travels with the part
    expect(r.slots.H2?.rotation).toBe(180);
  });

  it('switching back to Medium restores the same slots', () => {
    const sd = heavy();
    const r = relocateSection(sd, 'heavy', 'medium');
    expect(r.moved).toEqual([]);
    expect(r.displaced).toEqual([]);
    expect(r.slots).toEqual(sd.slots);
  });
});

describe('design migration (schema 2 → 3)', () => {
  const legacy = {
    schema: 2,
    id: 'old',
    name: 'Old AA',
    chassis: 'tracked',
    sections: {
      front: { class: 'medium', armor: 25, slots: { H1: { component: 'aa_gun', rotation: 0 }, H2: { component: 'aa_gun', rotation: 0 }, I1: { component: 'ammo_medium', rotation: 0 } } },
      middle: { class: 'medium', armor: 15, slots: { H3: { component: 'radar', rotation: 0 }, I1: { component: 'motor_m', rotation: 0 } } },
      rear: { class: 'light', armor: 8, slots: { H1: { component: 'mg', rotation: 180 } } },
    },
  };

  it('renames the AA autocannon, assigns the Medium layout and keeps positions', () => {
    const d = parseDesign(JSON.stringify(legacy));
    expect(d.schema).toBe(3);
    expect(d.sections.front.layout).toBe('medium');
    expect(d.sections.middle.layout).toBe('medium');
    expect(d.sections.front.slots.H1?.component).toBe('autocannon');
    expect(d.sections.front.slots.H2?.component).toBe('autocannon');
    // retired motor dropped (it is integrated), everything else intact
    expect(d.sections.middle.slots.I1).toBeUndefined();
    expect(d.sections.middle.slots.H3?.component).toBe('radar');
    expect(d.sections.rear.slots.H1).toEqual({ component: 'mg', rotation: 180 });
    expect(validateDesign(d).filter((i) => i.severity === 'error')).toEqual([]);
    // migrated hardpoints sit exactly where they did
    const dr = buildDrone(d, 1, 0, 0, 0, 0, 1);
    const old = SECTION_CLASSES.medium.slots.find((s) => s.id === 'H1')!;
    const c = dr.components.find((x) => x.id === 'F.H1')!;
    expect(c.y).toBeCloseTo(old.y, 5);
  });

  it('migration is idempotent', () => {
    const a = parseDesign(JSON.stringify(legacy));
    const b = parseDesign(JSON.stringify(a));
    expect(b).toEqual(a);
  });

  it('keeps mount configuration through a round trip', () => {
    const d = design({
      sections: {
        front: { class: 'medium', layout: 'medium', armor: 20, slots: { H1: { component: 'dual_autocannon', rotation: 0, fireMode: 'sync' }, H2: { component: 'rocket_pod', rotation: 0 }, I1: { component: 'ammo_medium', rotation: 0, payload: 'medium' }, I2: { component: 'rocket_cassette', rotation: 0, interceptors: 4 } } },
        middle: { class: 'medium', layout: 'max', armor: 10, slots: { I3: { component: 'coupling', rotation: 0, joint: 'rear' } } },
        rear: { class: 'light', layout: 'min', armor: 5, slots: {} },
      },
    });
    const r = parseDesign(JSON.stringify(d));
    expect(r.sections.front.slots.H1?.fireMode).toBe('sync');
    expect(r.sections.front.slots.I2?.interceptors).toBe(4);
    expect(r.sections.middle.layout).toBe('max');
    expect(r.sections.middle.slots.I3?.joint).toBe('rear');
    expect(r.sections.rear.layout).toBe('min');
  });

  it('rejects a design from a newer schema', () => {
    expect(() => parseDesign({ ...legacy, schema: 99 })).toThrow(/newer/);
  });

  it('every starter design validates without errors', () => {
    for (const d of DEFAULT_DESIGNS) {
      const errs = validateDesign(d).filter((i) => i.severity === 'error');
      expect(errs, d.name).toEqual([]);
    }
  });
});
