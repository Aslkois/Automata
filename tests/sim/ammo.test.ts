// Ammunition compatibility shown in the interface must be derived from the equipment data and
// agree with what the simulation actually loads and reloads.
import { describe, expect, it } from 'vitest';
import { COMPONENTS, getComponent } from '../../src/sim/content/components';
import { carried, payloadOptions, requirementOf, storageMatch, weaponAmmo, moduleSupplies, ammoLabel } from '../../src/sim/ammoCompat';
import { ammoReserve } from '../../src/sim/systems';
import { hasErrors, parseDesign, validateDesign, type MountDesign } from '../../src/sim/design';
import { DEFAULT_DESIGNS } from '../../src/data/defaults';
import { code, comp, design, m, makeSim } from './helpers';

const WEAPONS = COMPONENTS.filter((c) => c.weapon);
const MODULES = COMPONENTS.filter((c) => c.ammo);

/** Your table, checked against what the data produces (the UI shows the derived values). */
const EXPECTED: Record<string, { requires: string; storage: string }> = {
  mg: { requires: 'Small rounds', storage: 'Small-Calibre Magazine' },
  autocannon: { requires: 'Autocannon rounds (Medium)', storage: 'Medium-Calibre Magazine' },
  point_defense: { requires: 'Small rounds', storage: 'Small-Calibre Magazine' },
  scatter: { requires: 'Scatter shells', storage: 'Medium-Calibre Magazine, scatter shells payload' },
  quad_mg: { requires: 'Small rounds', storage: 'Small-Calibre Magazine' },
  rotary_cannon: { requires: 'Autocannon rounds (Medium)', storage: 'Medium-Calibre Magazine' },
  dual_autocannon: { requires: 'Autocannon rounds (Medium)', storage: 'Medium-Calibre Magazine' },
  rocket_pod: { requires: 'Offensive rockets / Interceptor rockets', storage: 'Rocket Cassette' },
  heavy_cannon: { requires: 'Cannon shells', storage: 'Shell Rack' },
  coilgun: { requires: 'Coilgun penetrators', storage: 'Shell Rack, penetrators payload' },
  missile_launcher: { requires: 'Guided heavy missiles', storage: 'Missile Reserve' },
};

const front = (slots: Record<string, MountDesign>) =>
  design({ chassis: 'tracked', sections: { front: { class: 'heavy', armor: 20, slots }, middle: { class: 'medium', armor: 10, slots: {} }, rear: { class: 'light', armor: 5, slots: {} } } });

describe('labels come from the equipment data', () => {
  it('1. every weapon shows its ammunition family and storage', () => {
    expect(Object.keys(EXPECTED).sort()).toEqual(WEAPONS.map((w) => w.id).sort());
    for (const w of WEAPONS) {
      const r = requirementOf(w)!;
      expect(r.types, w.id).toEqual(w.weapon!.ammo);
      expect(r.label, w.id).toBe(EXPECTED[w.id].requires);
      expect(r.storageShort, w.id).toBe(EXPECTED[w.id].storage);
    }
  });

  it('2. every ammunition module lists the weapons each payload feeds', () => {
    for (const mod of MODULES) {
      const opts = payloadOptions(mod);
      expect(opts.length, mod.id).toBeGreaterThan(0);
      for (const o of opts) {
        expect(o.weapons.length, `${mod.id} ${o.type}`).toBeGreaterThan(0);
        for (const w of o.weapons) expect(w.weapon!.ammo).toContain(o.type);
      }
    }
    expect(payloadOptions(getComponent('ammo_medium')).map((o) => [o.type, o.rounds, o.weapons.map((w) => w.id)])).toEqual([
      ['medium', 400, ['autocannon', 'rotary_cannon', 'dual_autocannon']],
      ['scatter', 60, ['scatter']],
    ]);
  });

  it('4. the Autocannon is a small hardpoint that is explicitly fed Medium ammunition', () => {
    const ac = getComponent('autocannon');
    expect(ac.size).toBe('S');
    expect(requirementOf(ac)!.label).toBe('Autocannon rounds (Medium)');
    expect(requirementOf(ac)!.storage.map((o) => o.def.id)).toEqual(['ammo_medium']);
  });
});

describe('configured payloads', () => {
  const mag = getComponent('ammo_medium');
  const rack = getComponent('shell_rack');

  it('3. a module carries only its selected payload, in its own quantity', () => {
    expect(carried(mag)).toEqual([{ type: 'medium', rounds: 400 }]);
    expect(carried(mag, { payload: 'scatter' })).toEqual([{ type: 'scatter', rounds: 60 }]);
    expect(carried(rack, { payload: 'penetrator' })).toEqual([{ type: 'penetrator', rounds: 24 }]);
  });

  it('5. scatter shells are not autocannon rounds', () => {
    expect(storageMatch(mag, getComponent('autocannon'))).toBe('supplies');
    expect(storageMatch(mag, getComponent('scatter'))).toBe('reconfigure');
    expect(storageMatch(mag, getComponent('autocannon'), { payload: 'scatter' })).toBe('reconfigure');
    expect(storageMatch(mag, getComponent('scatter'), { payload: 'scatter' })).toBe('supplies');
    const d = front({ H1: m('autocannon'), H2: m('scatter'), I1: { component: 'ammo_medium', rotation: 0, payload: 'scatter' } });
    const st = weaponAmmo(d);
    expect(st.find((x) => x.mount === 'F.H1')!.status).toBe('loaded-only');
    expect(st.find((x) => x.mount === 'F.H2')!.status).toBe('supplied');
    expect(moduleSupplies(d, 'F.I1')).toEqual({ feeds: ['F.H2'], couldFeed: [{ mount: 'F.H1', needs: 'medium' }] });
  });

  it('6. cannon shells are not coilgun penetrators', () => {
    expect(storageMatch(rack, getComponent('heavy_cannon'))).toBe('supplies');
    expect(storageMatch(rack, getComponent('coilgun'))).toBe('reconfigure');
    expect(storageMatch(rack, getComponent('coilgun'), { payload: 'penetrator' })).toBe('supplies');
    expect(storageMatch(rack, getComponent('heavy_cannon'), { payload: 'penetrator' })).toBe('reconfigure');
    expect(storageMatch(getComponent('ammo_medium'), getComponent('coilgun'))).toBe('none');
  });

  it('7. rocket pods report offensive and interceptor rockets from a split cassette', () => {
    const pod = getComponent('rocket_pod');
    expect(requirementOf(pod)!.types).toEqual(['rocket', 'interceptor']);
    expect(carried(getComponent('rocket_cassette'), { interceptors: 4 })).toEqual([
      { type: 'rocket', rounds: 8 },
      { type: 'interceptor', rounds: 4 },
    ]);
    // interceptors in the tubes, none stored: reloads refill with offensive rockets (as the simulation does)
    const d = front({ H1: { component: 'rocket_pod', rotation: 0, interceptors: 2 }, I1: m('rocket_cassette') });
    const st = weaponAmmo(d)[0];
    expect(st.loaded).toEqual({ interceptor: 2, rocket: 4 });
    expect(st.status).toBe('supplied');
    expect(st.unreplenished).toEqual(['interceptor']);
  });
});

describe('warnings, not restrictions', () => {
  it('8. a weapon with no reserve gets an actionable warning; the drone still deploys and fires its load', () => {
    const d = front({ H1: m('autocannon') });
    const issues = validateDesign(d);
    const w = issues.find((i) => i.code === 'no-ammo-storage')!;
    expect(w.severity).toBe('warning');
    expect(w.message).toContain('Autocannon F.H1 has 35 rounds loaded but no compatible reserve ammunition');
    expect(w.message).toContain('Install a Medium-Calibre Magazine set to Autocannon rounds (Medium)');
    expect(hasErrors(issues)).toBe(false);
    // the simulation agrees: exactly the loaded magazine, then no reload
    const sim = makeSim([{ design: d, program: code(`function update(){ drone.aim('F.H1', 0); drone.fire('F.H1'); }`), team: 0, x: 300, y: 550, angle: 0 }]);
    let shots = 0;
    for (let i = 0; i < 60 * 15; i++) {
      sim.step();
      shots += sim.takeEvents().filter((e) => e.type === 'shot').length;
    }
    expect(shots).toBe(35);
  });

  it('a magazine on the wrong payload is named, with the payload that would fix it', () => {
    const d = front({ H1: m('autocannon'), I1: { component: 'ammo_medium', rotation: 0, payload: 'scatter' } });
    const issues = validateDesign(d);
    expect(issues.find((i) => i.code === 'no-ammo-storage')!.message).toContain('F.I1 Medium-Calibre Magazine is set to Scatter shells: set it to Autocannon rounds (Medium)');
    const mis = issues.find((i) => i.code === 'ammo-misconfigured')!;
    expect(mis.severity).toBe('warning');
    expect(mis.message).toContain('F.H1 needs Autocannon rounds (Medium)');
    expect(hasErrors(issues)).toBe(false);
  });
});

describe('agrees with the simulation', () => {
  it('reserve and starting load shown for every starter weapon are what the simulation deploys with', () => {
    for (const d of DEFAULT_DESIGNS) {
      const sim = makeSim([{ design: d, program: code('function update(){}'), team: 0, x: 300, y: 550, angle: 0 }]);
      const dr = sim.drones[0];
      for (const st of weaponAmmo(d)) {
        const c = comp(dr, st.mount);
        expect(st.reserveTotal, `${d.name} ${st.mount}`).toBe(ammoReserve(dr, c.def!.weapon!.ammo));
        expect(st.loaded, `${d.name} ${st.mount}`).toEqual(c.weapon!.loaded);
      }
    }
  });

  it('every starter is supplied, and no starter has a mis-set magazine', () => {
    for (const d of DEFAULT_DESIGNS) {
      for (const st of weaponAmmo(d)) expect(st.status, `${d.name} ${st.mount}`).toBe('supplied');
      expect(validateDesign(d).filter((i) => i.code === 'ammo-misconfigured' || i.code === 'no-ammo-storage')).toEqual([]);
    }
  });

  it('10. saved ammunition configurations load unchanged', () => {
    const d = front({ H1: { component: 'rocket_pod', rotation: 0, interceptors: 2 }, I1: { component: 'rocket_cassette', rotation: 0, interceptors: 5 }, I2: { component: 'shell_rack', rotation: 0, payload: 'penetrator' } });
    const back = parseDesign(JSON.parse(JSON.stringify(d)));
    expect(back.sections.front.slots).toEqual(d.sections.front.slots);
    for (const d0 of DEFAULT_DESIGNS) expect(parseDesign(JSON.parse(JSON.stringify(d0))).sections).toEqual(d0.sections);
    expect(ammoLabel('medium')).toBe('Autocannon rounds (Medium)');
  });
});
