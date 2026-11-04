// Engineering diagnostics: what the design data says about the machine. Every figure is
// computed from the same model the simulation uses (src/sim/load.ts, design.ts); estimates
// state their assumptions.
import { AMMO_TYPES, COMPONENT_MAP, type AmmoType } from '../../sim/content/components';
import { CHASSIS } from '../../sim/content/chassis';
import { SECTION_POSITIONS } from '../../sim/content/sections';
import { listMounts, secondsToOverheat, type DesignStats, type DroneDesign } from '../../sim/design';
import { fmt, Meter } from '../common';

const pct = (x: number) => `${Math.round(x * 100)}%`;

function Row({ k, v, tone, hint }: { k: string; v: string; tone?: 'warn' | 'fault'; hint?: string }) {
  return (
    <div className="dg-row" title={hint}>
      <span>{k}</span>
      <span className={`num ${tone ?? ''}`}>{v}</span>
    </div>
  );
}

export function Diagnostics({ design, stats }: { design: DroneDesign; stats: DesignStats }) {
  const ch = CHASSIS[design.chassis];
  const L = stats.load;
  const mounts = listMounts(design);
  return (
    <div className="diagnostics pop" data-testid="diagnostics" aria-label="Engineering diagnostics">
      <section>
        <h3>Mass and load</h3>
        <Row k="Total mass" v={fmt.kg(stats.mass)} />
        <Row k="Rated mass on this chassis" v={fmt.kg(L.rated)} hint={`Every section carrying exactly its rated equipment load (${ch.name}: ×${ch.loadRating}).`} />
        <Row k="Load" v={pct(L.utilization)} tone={L.utilization > 1 ? 'warn' : undefined} hint="Mass / rated mass. Above 100% is allowed; see the effects below." />
        {SECTION_POSITIONS.map((p) => (
          <div key={p} className="dg-meter">
            <span>{p}</span>
            <Meter v={Math.min(1, stats.loadUtilization[p])} tone={stats.loadUtilization[p] > 1 ? 'warn' : 'signal'} label={`${p} load`} />
            <span className={`num ${stats.loadUtilization[p] > 1 ? 'warn' : ''}`}>
              {Math.round(stats.equipmentMass[p])}/{Math.round(stats.ratedEquipment[p])} kg
            </span>
          </div>
        ))}
        <Row k="Centre of mass" v={`${stats.comOffset.x >= 0 ? '+' : ''}${stats.comOffset.x.toFixed(1)} fwd, ${stats.comOffset.y >= 0 ? '+' : ''}${stats.comOffset.y.toFixed(1)} side`} hint="Offset from the middle of the hull, in u. Off-centre mass makes turning and recoil uneven." />
        <Row k="Rotational inertia" v={`${(stats.inertia / 1e6).toFixed(2)} M`} />
      </section>
      <section>
        <h3>Mobility</h3>
        <p className="dg-note">Estimates on flat ground, undamaged, fully powered.</p>
        <Row k="Acceleration" v={`${stats.maxAccel.toFixed(1)} u/s²`} tone={stats.maxAccel < 6 ? 'warn' : undefined} />
        <Row k="Top speed" v={`${stats.topSpeed.toFixed(0)} u/s`} />
        {ch.steering === 'skid' ? <Row k="Pivot from standstill" v={stats.pivotAccel > 0 ? `${stats.pivotAccel.toFixed(0)} °/s²` : 'cannot pivot'} tone={stats.pivotAccel <= 0 ? 'warn' : undefined} /> : <Row k="Turn rate at 50 u/s" v={`${stats.yawRateAt50.toFixed(0)} °/s`} hint="Wheels need forward speed to turn; grip limits it further." />}
        <Row k="Traction" v={`×${L.traction.toFixed(2)}`} tone={L.traction < 1 ? 'warn' : undefined} hint="Grip coefficient multiplier from the load." />
        <Row k="Rolling resistance" v={`×${L.rolling.toFixed(2)}`} tone={L.rolling > 1 ? 'warn' : undefined} />
        {ch.liftMargin && <Row k="Thrust can lift" v={`${fmt.kg(L.liftCapacity)} (${pct(Math.min(1, L.lift))} of the weight)`} tone={L.lift < 1 ? 'fault' : undefined} />}
        {L.supportPower > 0 && <Row k="Holding the weight up" v={`${L.supportPower.toFixed(1)} PU/s`} hint={ch.liftMargin ? 'Lift thrusters' : 'Legs bracing the load'} />}
        {L.overload > 0 && <p className="dg-note warn">Overloaded: the {ch.gearName.toLowerCase()} wear while carrying it, faster when moving.</p>}
      </section>
      <section>
        <h3>Power</h3>
        <Row k="Generation" v={`${stats.powerGeneration} PU/s`} />
        <Row k="Always-on demand" v={`${stats.baseDemand} PU/s`} tone={stats.baseDemand > stats.powerGeneration ? 'fault' : undefined} />
        <Row k="Peak demand" v={`${Math.round(stats.peakDemand + L.supportPower)} PU/s`} hint="Drive at full throttle, shields recharging, every weapon busy, plus holding the weight up." tone={stats.peakDemand + L.supportPower > stats.powerGeneration + stats.maxDischarge ? 'warn' : undefined} />
        {stats.chargeDemand > 0 && <Row k="Coilgun charging" v={`+${stats.chargeDemand} PU/s`} />}
        <Row k="Buffers" v={`${Math.round(stats.storage)} PU·s · ${Math.round(stats.maxDischarge)} PU/s`} />
      </section>
      <section>
        <h3>Heat</h3>
        <p className="dg-note">Continuous fire with no pauses; reloads make real fire last longer.</p>
        {SECTION_POSITIONS.filter((p) => stats.sectionWeaponHeat[p] > 0).map((p) => (
          <Row key={p} k={`${p}: weapon heat vs cooling`} v={`${stats.sectionWeaponHeat[p].toFixed(0)} vs ${(stats.sectionCooling[p] + 1.5).toFixed(1)} /s per part`} tone={stats.sectionWeaponHeat[p] > (stats.sectionCooling[p] + 1.5) * 2.5 ? 'warn' : undefined} />
        ))}
        {mounts
          .filter((m) => m.def.weapon)
          .map((m) => {
            const t = secondsToOverheat(m.def, stats.sectionCooling[m.section]);
            return <Row key={m.id} k={`${m.id} ${m.def.name}`} v={Number.isFinite(t) ? `overheats in ~${t.toFixed(0)} s` : 'never overheats'} tone={t < 8 ? 'warn' : undefined} />;
          })}
      </section>
      <section>
        <h3>Ammunition</h3>
        {(Object.entries(stats.ammoEndurance) as [AmmoType, number][]).map(([t, s]) => (
          <Row key={t} k={AMMO_TYPES[t].name} v={`${Math.round(s)} s of continuous fire · ${stats.ammo[t]} stored`} tone={s < 20 ? 'warn' : undefined} hint="Every weapon of this family firing at once, magazines and stores together." />
        ))}
        {Object.keys(stats.ammoEndurance).length === 0 && <p className="dg-note">No weapons.</p>}
      </section>
      <section>
        <h3>Recoil and mounts</h3>
        <p className="dg-note">Per firing event, at the mount’s rest facing.</p>
        {stats.recoil.map((r) => (
          <Row
            key={r.mount}
            k={`${r.mount} ${COMPONENT_MAP[mounts.find((m) => m.id === r.mount)!.def.id].name}`}
            v={`${(r.impulse / 1000).toFixed(1)}k / ${(r.rating / 1000).toFixed(0)}k · Δv ${r.dv.toFixed(1)} u/s · Δω ${r.dw.toFixed(1)} °/s`}
            tone={r.impulse > r.rating ? 'fault' : undefined}
            hint={r.impulse > r.rating ? 'Above the mount rating: each shot wears the mount and its section’s joints.' : 'Recoil, mount rating, hull velocity change and spin per shot.'}
          />
        ))}
        {stats.recoil.length === 0 && <p className="dg-note">No weapons.</p>}
      </section>
    </div>
  );
}
