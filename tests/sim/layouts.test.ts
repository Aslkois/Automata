import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGNS } from '../../src/data/defaults';
import { COMPONENT_MAP } from '../../src/sim/content/components';
import { LAYOUT_IDS, LAYOUTS, LEGACY_LAYOUT, SCHEMA3_LAYOUT, SECTION_CLASSES, SLOT_HALF, sectionSlots, type SectionClass } from '../../src/sim/content/sections';
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

  it('the layout table: Maximum mounts the largest equipment, Minimum more of smaller', () => {
    const shape = (cls: SectionClass, id: 'max' | 'medium' | 'min') =>
      LAYOUTS[cls][id].hardpoints
        .map((h) => h.size)
        .sort()
        .join('');
    expect(shape('light', 'max')).toBe('MS');
    expect(shape('light', 'medium')).toBe('SS');
    expect(shape('light', 'min')).toBe('SSS');
    expect(shape('medium', 'max')).toBe('LS');
    expect(shape('medium', 'medium')).toBe('MMM');
    expect(shape('medium', 'min')).toBe('SSSS');
    expect(shape('heavy', 'max')).toBe('LLM');
    expect(shape('heavy', 'medium')).toBe('LMM');
    expect(shape('heavy', 'min')).toBe('MMM');
  });

  it('each layout carries the equipment it lists, without construction errors', () => {
    const cases: [SectionClass, 'max' | 'medium' | 'min', string[]][] = [
      ['light', 'max', ['quad_mg', 'mg']],
      ['light', 'medium', ['mg', 'camera']],
      ['light', 'min', ['mg', 'autocannon', 'point_defense']],
      ['medium', 'max', ['heavy_cannon', 'camera']],
      ['medium', 'medium', ['rotary_cannon', 'radar', 'shield_dir']],
      ['medium', 'min', ['mg', 'mg', 'scatter', 'point_defense']],
      ['heavy', 'max', ['heavy_cannon', 'coilgun', 'dual_autocannon']],
      ['heavy', 'medium', ['missile_launcher', 'rocket_pod', 'radar']],
      ['heavy', 'min', ['dual_autocannon', 'dual_autocannon', 'dual_autocannon']],
    ];
    for (const [cls, lid, parts] of cases) {
      const slots: SectionDesign['slots'] = {};
      LAYOUTS[cls][lid].hardpoints.forEach((h, i) => (slots[h.id] = m(parts[i])));
      const d = design({
        chassis: 'walking',
        sections: {
          front: { class: cls, layout: lid, armor: 0, slots },
          middle: { class: 'medium', layout: 'medium', armor: 0, slots: {} },
          rear: { class: 'light', layout: 'medium', armor: 0, slots: {} },
        },
      });
      const errs = validateDesign(d).filter((i) => i.severity === 'error');
      expect(errs, `${cls}/${lid}`).toEqual([]);
    }
  });

  it('earlier arrangements map to layouts with the same mount ids, at least as large', () => {
    const rank = { S: 1, M: 2, L: 3 } as const;
    const covers = (from: { id: string; size: 'S' | 'M' | 'L' }[], to: { id: string; size: 'S' | 'M' | 'L' }[]) =>
      from.every((f) => to.some((t) => t.id === f.id && rank[t.size] >= rank[f.size]));
    // schema < 3: one arrangement per class
    for (const cls of CLASSES) {
      const legacy = SECTION_CLASSES[cls].slots.filter((x) => x.kind === 'hardpoint');
      expect(covers(legacy, LAYOUTS[cls][LEGACY_LAYOUT[cls]].hardpoints), cls).toBe(true);
    }
    expect(LEGACY_LAYOUT).toEqual({ light: 'medium', medium: 'medium', heavy: 'max' });
    // the schema-3 layout table
    const OLD: Record<SectionClass, Record<'max' | 'medium' | 'min', { id: string; size: 'S' | 'M' | 'L' }[]>> = {
      light: { max: [{ id: 'H1', size: 'M' }, { id: 'H2', size: 'S' }], medium: [{ id: 'H1', size: 'S' }, { id: 'H2', size: 'S' }], min: [{ id: 'H1', size: 'S' }] },
      medium: { max: [{ id: 'H1', size: 'L' }, { id: 'H2', size: 'S' }], medium: [{ id: 'H1', size: 'M' }, { id: 'H2', size: 'M' }, { id: 'H3', size: 'M' }], min: [{ id: 'H1', size: 'M' }, { id: 'H2', size: 'S' }] },
      heavy: { max: [{ id: 'H1', size: 'L' }, { id: 'H2', size: 'L' }, { id: 'H3', size: 'M' }], medium: [{ id: 'H1', size: 'L' }, { id: 'H2', size: 'L' }, { id: 'H3', size: 'S' }], min: [{ id: 'H1', size: 'L' }, { id: 'H2', size: 'M' }] },
    };
    for (const cls of CLASSES) for (const lid of LAYOUT_IDS) expect(covers(OLD[cls][lid], LAYOUTS[cls][SCHEMA3_LAYOUT[cls][lid]].hardpoints), `${cls}/${lid}`).toBe(true);
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
  const heavy = (): SectionDesign => ({ class: 'heavy', layout: 'max', armor: 40, slots: { H1: m('heavy_cannon'), H2: m('heavy_cannon'), H3: m('mg', 180), I1: m('ammo_small'), I4: m('shell_rack') } });

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

  it('heavy Maximum → Medium keeps one cannon, reports the second, keeps the gun and its rotation', () => {
    const r = relocateSection(heavy(), 'heavy', 'medium');
    expect(r.slots.H1?.component).toBe('heavy_cannon');
    expect(r.displaced.map((x) => x.mount.component)).toEqual(['heavy_cannon']);
    expect(r.slots.H3?.component).toBe('mg');
    // mount configuration (rotation) travels with the part
    expect(r.slots.H3?.rotation).toBe(180);
    // Minimum has no large mount: both cannons need a decision
    expect(relocateSection(heavy(), 'heavy', 'min').displaced.map((x) => x.mount.component)).toEqual(['heavy_cannon', 'heavy_cannon']);
  });

  it('a part that no longer fits its slot id moves to the nearest compatible one', () => {
    const sd: SectionDesign = { class: 'medium', layout: 'medium', armor: 0, slots: { H3: m('mg', 90) } };
    const r = relocateSection(sd, 'medium', 'max');
    // medium Maximum has no H3: the gun takes the smallest mount that fits, rotation kept
    expect(r.moved).toEqual([['H3', 'H2']]);
    expect(r.slots.H2).toEqual(m('mg', 90));
    expect(r.displaced).toEqual([]);
  });

  it('switching to the same layout changes nothing', () => {
    const sd = heavy();
    const r = relocateSection(sd, 'heavy', 'max');
    expect(r.moved).toEqual([]);
    expect(r.displaced).toEqual([]);
    expect(r.slots).toEqual(sd.slots);
  });
});

describe('design migration (schema 2 and 3 → current)', () => {
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
    expect(d.schema).toBe(6);
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

  it('maps old heavy sections to Maximum and schema-3 layouts to the new table without losing parts', () => {
    const old = {
      ...legacy,
      sections: { ...legacy.sections, front: { class: 'heavy', armor: 40, slots: { H1: { component: 'heavy_cannon', rotation: 0 }, H2: { component: 'heavy_cannon', rotation: 0 }, H3: { component: 'mg', rotation: 90 }, I4: { component: 'shell_rack', rotation: 0 } } } },
    };
    const d = parseDesign(JSON.stringify(old));
    expect(d.sections.front.layout).toBe('max');
    expect(Object.keys(d.sections.front.slots).sort()).toEqual(['H1', 'H2', 'H3', 'I4']);
    expect(d.sections.front.slots.H3).toEqual({ component: 'mg', rotation: 90 });
    expect(validateDesign(d).filter((i) => i.severity === 'error')).toEqual([]);
    // schema 3: heavy "medium" (2 L + 1 S) becomes Maximum; medium "min" (1 M + 1 S) becomes Medium
    const s3 = { ...old, schema: 3, sections: { ...old.sections, front: { ...old.sections.front, layout: 'medium' }, middle: { class: 'medium', layout: 'min', armor: 10, slots: { H1: { component: 'rotary_cannon', rotation: 0 }, H2: { component: 'camera', rotation: 0 } } } } };
    const d3 = parseDesign(JSON.stringify(s3));
    expect(d3.sections.front.layout).toBe('max');
    expect(d3.sections.middle.layout).toBe('medium');
    expect(d3.sections.middle.slots.H1?.component).toBe('rotary_cannon');
    expect(d3.sections.middle.slots.H2?.component).toBe('camera');
    expect(validateDesign(d3).filter((i) => i.severity === 'error')).toEqual([]);
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
