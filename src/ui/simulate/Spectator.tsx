// The spectator card: everything about the followed drone, from real simulation state.
// It sits on the right edge over the field; sections expand on demand.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { irHash } from '../../program/brain/ir';
import type { TraceEntry } from '../../program/interpreter';
import { functional } from '../../sim/drone';
import { ammoReserve } from '../../sim/systems';
import { AMMO_TYPES } from '../../sim/content/components';
import { requirementOf } from '../../sim/ammoCompat';
import type { Drone, RComponent } from '../../sim/types';
import { PartAnimator } from '../../render/parts/animator';
import { MODELS } from '../../render/parts/models';
import type { Simulation } from '../../sim/world';
import { useShell } from '../App';
import { Icon, Meter, Segments, useStoredState } from '../common';
import { PartIcon, PartModelG } from '../parts';
import { library } from '../store';
import { TEAMS, T } from '../theme';
import { deployed } from './session';
import { integrity } from './Simulate';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const KIND_LABEL: Record<TraceEntry['kind'], string> = { branch: 'branch', call: 'read', command: 'command', log: 'log', error: 'error', sim: 'hardware', event: 'event' };

function recentFailures(d: Drone, now: number): Set<string> {
  const s = new Set<string>();
  for (const f of d.failures) if (f.component && now - f.time < 1.4) s.add(f.component);
  return s;
}

export type SheetState = 'peek' | 'half' | 'full';

export function Spectator({ sim, drone: d, onClose, onSelect, sheet = 'half', setSheet }: { sim: Simulation; drone: Drone; onClose: () => void; onSelect?: (id: number) => void; sheet?: SheetState; setSheet?: (s: SheetState) => void }) {
  const { openBrainAt, go, setDesignId } = useShell();
  const ctrl = sim.controllers.get(d.id)!;
  const [open, setOpen] = useStoredState<Record<string, boolean>>('spectator-sections', { weapons: true, power: true, sensors: false, components: false, trace: true });
  const toggle = (k: string) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  // A genuine hardware failure briefly disturbs the card's signal.
  const [glitch, setGlitch] = useState(false);
  const seen = useRef({ id: d.id, n: d.failures.length });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (seen.current.id !== d.id) {
      seen.current = { id: d.id, n: d.failures.length };
      return;
    }
    if (d.failures.length > seen.current.n) {
      const destructive = d.failures.slice(seen.current.n).some((f) => f.type === 'component-destroyed' || f.type === 'section-destroyed' || f.type === 'section-detached');
      seen.current.n = d.failures.length;
      if (destructive) {
        setGlitch(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setGlitch(false), 600);
      }
    }
  });
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const recent = recentFailures(d, sim.time);
  const rec = ctrl.history[ctrl.history.length - 1];
  const commands = rec?.entries.filter((e) => e.kind === 'command').map((e) => e.text) ?? [];
  const p = d.power;
  const maxHeat = d.components.reduce((m, c) => (functional(d, c) ? Math.max(m, c.heat) : m), 0);
  const team = TEAMS[d.team % 4];
  const designId = d.design.id;
  const tone = d.status.disabled || d.status.destroyed ? 'fault' : d.status.label === 'Operational' ? 'ok' : 'warn';

  return (
    <aside className={`spectator card ${glitch ? 'breakup' : ''}`} data-testid="inspector" aria-label="Drone diagnostics" data-sheet={sheet}>
      {setSheet && (
        <button className="sp-grab" aria-label={`Sheet size: ${sheet}. Tap to change`} data-testid="sheet-grab" onClick={() => setSheet(sheet === 'peek' ? 'half' : sheet === 'half' ? 'full' : 'peek')} />
      )}
      <header className="sp-head" style={{ ['--team' as string]: team.color }}>
        <span className="swatch" />
        <div className="grow">
          <h2 data-testid="inspected-name">{d.name}</h2>
          <p className="muted">
            {team.name} · unit #{d.id}
          </p>
        </div>
        <span className={`state-pill ${tone}`} data-testid="inspected-status">
          {d.status.label}
        </span>
        {onSelect && sim.drones.length > 1 && (
          <span className="sp-cycle">
            <button className="tool" aria-label="Previous drone" title="Previous drone ([)" onClick={() => onSelect(cycle(sim, d.id, -1))}>
              <Icon name="chevronLeft" />
            </button>
            <button className="tool" aria-label="Next drone" title="Next drone (])" onClick={() => onSelect(cycle(sim, d.id, 1))}>
              <Icon name="chevronRight" />
            </button>
          </span>
        )}
        <button className="tool" onClick={onClose} aria-label="Close diagnostics" title="Return to freecam (Esc)">
          <Icon name="close" />
        </button>
      </header>
      <div className="sp-body">
        <div className="sp-summary">
          <Silhouette d={d} recent={recent} />
          <div className="sp-figs">
            <Fig k="Integrity" v={<Segments values={integrity(d)} label="Section integrity" />} />
            <Fig k="Speed" v={`${Math.hypot(d.body.vel.x, d.body.vel.y).toFixed(0)} u/s`} />
            <Fig k="Hottest part" v={`${maxHeat.toFixed(0)}°`} tone={maxHeat > 90 ? 'fault' : maxHeat > 70 ? 'warn' : undefined} />
            <Fig k="Stored power" v={p.capacity ? pct(p.stored / p.capacity) : '—'} tone={p.capacity && p.stored / p.capacity < 0.2 ? 'warn' : undefined} />
          </div>
          <div className="sp-now">
            <span className="label">Now doing</span>
            <p className="num" data-testid="current-action">
              {d.status.disabled ? 'Nothing — controller offline' : commands.length ? commands.slice(0, 4).join(' · ') : `drive ${d.throttle.toFixed(2)} / steer ${d.steer.toFixed(2)}`}
            </p>
          </div>
          <div className="sp-brain">
            <span className={`state-dot ${ctrl.state === 'ok' ? 'ok' : 'fault'}`} />
            <span>
              Brain {ctrl.state === 'ok' ? 'running' : ctrl.state.replace('-', ' ')}
              {rec && (
                <span className="muted num">
                  {' '}
                  · {rec.ops}/{rec.budget} ops
                </span>
              )}
            </span>
            {rec && <Meter v={rec.budget ? rec.ops / rec.budget : 0} tone={rec.budget && rec.ops / rec.budget > 0.85 ? 'warn' : 'signal'} label="Operation budget used" />}
          </div>
          {ctrl.lastError && <p className="error-text">{ctrl.lastError}</p>}
          <div className="sp-links">
            <button
              className="btn"
              onClick={() => {
                const id = firstMapped(designId, rec?.entries ?? []);
                if (id) openBrainAt(designId, id);
                else {
                  setDesignId(designId);
                  go('program');
                }
              }}
            >
              <Icon name="program" /> Open brain
            </button>
            <button
              className="btn"
              onClick={() => {
                setDesignId(designId);
                go('construct');
              }}
            >
              <Icon name="construct" /> Hardware
            </button>
          </div>
        </div>

        <Section id="weapons" title="Weapons" note={`${d.components.filter((c) => c.weapon && functional(d, c)).length} working`} open={open.weapons} toggle={toggle}>
          <table className="table" data-testid="weapons-table">
            <tbody>
              {d.components
                .filter((c) => c.weapon)
                .map((c) => {
                  const ws = c.weapon!;
                  const ok = functional(d, c);
                  const w = c.def!.weapon!;
                  const prog = ws.reloading ? (w.charge ? ws.charge : Math.max(0, Math.min(1, 1 - ws.reloadLeft / Math.max(1e-6, ws.reloadTotal || w.reloadTime)))) : 1;
                  const state = !ok
                    ? c.destroyed
                      ? 'destroyed'
                      : 'detached'
                    : ws.reloading
                      ? `${w.charge ? (ws.reloadLeft === -1 ? 'charge held' : 'charging') : 'reloading'} ${pct(prog)}`
                      : ws.overheated
                        ? 'overheated'
                        : w.spinUp && ws.trigger && ws.spin < 0.9
                          ? `spinning ${pct(ws.spin)}`
                          : ws.blockReason && ws.trigger
                            ? 'blocked'
                            : ws.trigger
                              ? 'firing'
                              : ws.mag > 0
                                ? 'ready'
                                : ammoReserve(d, w.ammo) > 0
                                  ? 'empty'
                                  : 'out of ammo';
                  const reserve = ammoReserve(d, w.ammo);
                  const mixed = w.ammo.length > 1;
                  return (
                    <tr key={c.id} className={`${!ok ? 'dead' : ''} ${recent.has(c.id) ? 'static' : ''}`} title={ws.blockReason ?? ''}>
                      <td>
                        <code>{c.id}</code>
                      </td>
                      <td className="name">
                        {c.def!.name}
                        <span className="muted small ammo-line" data-testid={`spec-ammo-${c.id}`}>
                          {requirementOf(c.def!)?.label}
                        </span>
                      </td>
                      <td className="num r">
                        {ws.mag}/{w.magazine}
                        <span className="muted" title={reserve > 0 ? 'Compatible rounds left in storage' : 'No compatible reserve: it cannot reload'}>
                          {reserve > 0 ? ` +${reserve}` : ' · no reserve'}
                        </span>
                        {mixed && (
                          <span className="muted small" title="Loaded by type; the selected type fires next">
                            {' '}
                            · {w.ammo.map((t) => `${t === ws.selected ? '▸' : ''}${ws.loaded[t] ?? 0} ${AMMO_TYPES[t].plural}`).join(' ')}
                          </span>
                        )}
                        {w.fireModes && w.fireModes.length > 1 && <span className="muted small"> · {ws.fireMode}</span>}
                      </td>
                      <td className={`st ${state === 'firing' ? 'on' : state === 'ready' ? 'ok' : /^(reloading|charging|spinning)/.test(state) ? '' : 'fault'}`}>{state}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </Section>

        <Section id="power" title="Power and heat" note={`${p.generation.toFixed(0)} PU/s`} open={open.power} toggle={toggle}>
          {p.capacity > 0 && (
            <div className="meter-row">
              <span>Stored</span>
              <Meter v={p.stored / p.capacity} label="Stored power" />
              <span className="num">
                {p.stored.toFixed(0)}/{p.capacity.toFixed(0)}
              </span>
            </div>
          )}
          {(['systems', 'propulsion', 'weapons', 'shields'] as const).map((c) => (
            <div className="meter-row" key={c}>
              <span style={{ textTransform: 'capitalize' }}>{c}</span>
              <Meter v={p.satisfaction[c]} label={`${c} power supplied`} />
              <span className="num">{p.demand[c] ? pct(p.satisfaction[c]) : '—'}</span>
            </div>
          ))}
          <div className="meter-row">
            <span>Hottest</span>
            <Meter v={maxHeat / 100} tone={maxHeat > 90 ? 'fault' : maxHeat > 70 ? 'warn' : 'signal'} label="Hottest component temperature" />
            <span className="num">{maxHeat.toFixed(0)}°</span>
          </div>
          {d.components
            .filter((c) => c.shield)
            .map((c) => {
              const sh = c.shield!;
              const def = c.def!.shield!;
              const ok = functional(d, c);
              return (
                <div className="meter-row" key={c.id}>
                  <span>
                    Shield <code>{c.id}</code>
                  </span>
                  <Meter v={sh.charge / def.capacity} label={`${c.id} charge`} />
                  <span className={`num ${!ok || sh.overloadLeft > 0 || !sh.powered ? 'fault' : ''}`}>{!ok ? 'lost' : sh.overloadLeft > 0 ? 'overload' : !sh.powered ? 'no power' : sh.raised ? 'raised' : 'lowered'}</span>
                </div>
              );
            })}
        </Section>

        <Section id="sensors" title="Sensors" note={`${d.perception.contacts.length} contacts`} open={open.sensors} toggle={toggle}>
          <div data-testid="sensors">
            <table className="table">
              <tbody>
                {d.components
                  .filter((c) => c.kind === 'sensor')
                  .map((c) => (
                    <tr key={c.id} className={!functional(d, c) ? 'dead' : ''}>
                      <td>
                        <code>{c.id}</code>
                      </td>
                      <td className="name">
                        {c.def!.name}
                        <span className="muted small ammo-line" data-testid={`spec-ammo-${c.id}`}>
                          {requirementOf(c.def!)?.label}
                        </span>
                      </td>
                      <td className="num r">
                        {c.def!.sensor!.arcDeg}° · {c.def!.sensor!.range} u
                      </td>
                      <td className={`st ${!functional(d, c) || d.power.satisfaction.systems < 0.5 ? 'fault' : 'ok'}`}>{!functional(d, c) ? 'lost' : d.power.satisfaction.systems < 0.5 ? 'unpowered' : 'active'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <h4 className="sub-h">Contacts at last decision</h4>
            {d.perception.contacts.length === 0 && <p className="muted">None.</p>}
            {d.perception.contacts.map((c) => (
              <div key={c.id} className="contact num">
                <span className={c.team === 'enemy' ? 'fault' : ''}>{c.team}</span> #{c.id} · {c.distance.toFixed(0)} u · bearing {c.bearing.toFixed(0)}°
              </div>
            ))}
            {d.perception.threats.length > 0 && (
              <p className="num warn">
                {d.perception.threats.length} incoming · nearest {d.perception.threats[0].distance.toFixed(0)} u, {d.perception.threats[0].closingTime.toFixed(1)} s
              </p>
            )}
            <h4 className="sub-h">Surroundings</h4>
            <table className="table" data-testid="ranges">
              <tbody>
                {d.ranges.map((r) => (
                  <tr key={r.side} className={r.status !== 'ok' ? 'dead' : ''}>
                    <td className="name">Distance {r.side}</td>
                    <td className="num r">{r.status !== 'ok' ? '—' : r.distance === null ? 'clear (>500)' : `${r.distance.toFixed(0)} u`}</td>
                    <td className={`st ${r.status === 'ok' ? 'ok' : 'fault'}`}>{r.status}</td>
                  </tr>
                ))}
                <tr>
                  <td className="name">Bumpers</td>
                  <td className="num r" colSpan={2}>
                    {(['front', 'rear', 'left', 'right'] as const).filter((b) => sim.time - d.bumps[b].time <= 0.15).join(', ') || 'no contact'}
                  </td>
                </tr>
                {d.components
                  .filter((c) => c.def?.lidar)
                  .map((c) => {
                    const rays = c.scan?.rays ?? [];
                    const hits = rays.filter((r) => r.distance !== null);
                    return (
                      <tr key={c.id} className={!functional(d, c) ? 'dead' : ''}>
                        <td className="name">
                          LIDAR <code>{c.id}</code>
                        </td>
                        <td className="num r">{rays.length ? `${hits.length}/${rays.length} returns · nearest ${hits.length ? Math.min(...hits.map((r) => r.distance!)).toFixed(0) : '—'} u` : '—'}</td>
                        <td className={`st ${rays.length ? 'ok' : 'fault'}`}>{rays.length ? `${((sim.time - (c.scan?.time ?? 0)) * 1000).toFixed(0)} ms` : 'no scan'}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
            {(() => {
              const mine = sim.projectiles.filter((q) => q.alive && q.owner === d.id && q.guidance && q.guidance.targets === 'drones');
              if (!mine.length) return null;
              return (
                <p className="num muted">
                  {mine.length} missile{mine.length > 1 ? 's' : ''} in flight ·{' '}
                  {mine.map((q) => (q.track && sim.time - q.track.time <= q.guidance!.memory + 0.12 ? q.track.source : 'lost')).join(', ')}
                </p>
              );
            })()}
          </div>
        </Section>

        <Section id="components" title="Components" note={`${d.components.filter((c) => functional(d, c)).length}/${d.components.length} working`} open={open.components} toggle={toggle}>
          <table className="table" data-testid="components-table">
            <tbody>
              {d.components.map((c) => (
                <tr key={c.uid} className={`${!functional(d, c) ? 'dead' : ''} ${recent.has(c.id) ? 'static' : ''}`}>
                  <td>
                    <PartIcon id={c.def?.id} kind={c.kind} size={14} />
                  </td>
                  <td>
                    <code>{c.id}</code>
                  </td>
                  <td className="name">{c.name}</td>
                  <td style={{ width: 90 }}>
                    <Meter v={c.hp / c.maxHp} label={`${c.id} integrity`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {(['front', 'middle', 'rear'] as const).some((pos) => d.sections[pos].fire > 0) && (
            <p className="num fault" data-testid="fires">
              Burning:{' '}
              {(['front', 'middle', 'rear'] as const)
                .filter((pos) => d.sections[pos].fire > 0)
                .map((pos) => `${pos} ${(sim.time - d.sections[pos].fireSince).toFixed(1)} s`)
                .join(', ')}
            </p>
          )}
          {d.components
            .filter((c) => c.suppression)
            .map((c) => (
              <p key={c.id} className="num muted">
                Suppression <code>{c.id}</code>: {c.suppression!.charges} charge{c.suppression!.charges === 1 ? '' : 's'} · {c.suppression!.auto ? 'automatic' : 'on command'}
              </p>
            ))}
          {d.failures.length > 0 && (
            <>
              <h4 className="sub-h">Failures</h4>
              {d.failures
                .slice(-8)
                .reverse()
                .map((f, i) => (
                  <div key={i} className="failure num">
                    <span className="muted">{f.time.toFixed(1)}</span> {f.detail}
                  </div>
                ))}
            </>
          )}
        </Section>

        <Section id="trace" title="Decision trace" note={rec ? `t ${rec.time.toFixed(2)} s` : ''} open={open.trace} toggle={toggle}>
          <Trace designId={designId} d={d} sim={sim} />
        </Section>
      </div>
    </aside>
  );
}

/** The next drone to follow in either direction (wraps around). */
export function cycle(sim: Simulation, id: number, dir: 1 | -1): number {
  const ids = sim.drones.map((x) => x.id);
  const i = ids.indexOf(id);
  return ids[(i + dir + ids.length) % ids.length] ?? id;
}

function firstMapped(designId: string, entries: TraceEntry[]): string | null {
  const dep = deployed.get(designId);
  if (!dep) return null;
  for (const e of entries) if (e.loc.kind === 'line') {
    const id = dep.lineIds[e.loc.line];
    if (id) return id;
  }
  return null;
}

function Fig({ k, v, tone }: { k: string; v: ReactNode; tone?: 'warn' | 'fault' }) {
  return (
    <div className="fig">
      <span className="label">{k}</span>
      <span className={`num ${tone ?? ''}`}>{v}</span>
    </div>
  );
}

function Section({ id, title, note, open, toggle, children }: { id: string; title: string; note?: string; open: boolean; toggle: (k: string) => void; children: ReactNode }) {
  return (
    <section className={`sp-sec ${open ? 'open' : ''}`}>
      <button className="sp-sec-head" aria-expanded={open} onClick={() => toggle(id)}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={16} />
        <span className="grow">{title}</span>
        {note && <span className="muted num">{note}</span>}
      </button>
      {open && <div className="sp-sec-body">{children}</div>}
    </section>
  );
}

function Trace({ designId, d, sim }: { designId: string; d: Drone; sim: Simulation }) {
  const { openBrainAt } = useShell();
  const ctrl = sim.controllers.get(d.id)!;
  const [pinned, setPinned] = useState<number | null>(null);
  const hist = ctrl.history;
  const rec = pinned !== null ? hist.find((h) => h.tick === pinned) ?? hist[hist.length - 1] : hist[hist.length - 1];
  const dep = deployed.get(designId);
  const brain = library.brainFor(designId);
  const edited = dep && brain ? irHash(brain.ir) !== dep.hash : false;
  const lineText = (line: number) => dep?.text.split('\n')[line - 1]?.trim() ?? '';
  return (
    <div data-testid="program-trace">
      <div className="tick-strip" aria-label="Decision history">
        {hist.slice(-80).map((h) => (
          <button key={h.tick} title={`t = ${h.time.toFixed(1)} s${h.error ? ` — ${h.error}` : ''}`} aria-label={`Decision at ${h.time.toFixed(1)} s`} className={`${h.error ? 'err' : ''} ${rec && h.tick === rec.tick ? 'sel' : ''}`} onClick={() => setPinned(h.tick)} />
        ))}
        <button className="chip-btn small" aria-pressed={pinned === null} onClick={() => setPinned(null)}>
          Latest
        </button>
      </div>
      {!rec && <p className="muted">No decisions yet — press Play or Step decision.</p>}
      {rec && (
        <>
          <p className="muted small num">
            t = {rec.time.toFixed(2)} s · {rec.entries.length} entries{rec.dropped ? ` (+${rec.dropped} not recorded)` : ''} · {rec.contacts} contacts
          </p>
          <ol className="trace" data-testid="trace-entries">
            {rec.entries.map((e, i) => {
              const id = e.loc.kind === 'line' ? dep?.lineIds[e.loc.line] ?? null : null;
              return (
                <li key={i} className={`k-${e.kind}`}>
                  <span className="tk">{KIND_LABEL[e.kind]}</span>
                  <span className="tx">{e.text}</span>
                  {e.loc.kind === 'line' && (
                    <button className="src" title={lineText(e.loc.line)} disabled={!id} onClick={() => id && openBrainAt(designId, id)} aria-label={`Show line ${e.loc.line} in the brain`}>
                      line {e.loc.line}
                    </button>
                  )}
                </li>
              );
            })}
            {rec.error && (
              <li className="k-error">
                <span className="tk">error</span>
                <span className="tx">{rec.error}</span>
              </li>
            )}
          </ol>
          {rec.vars && rec.vars.length > 0 && (
            <>
              <h4 className="sub-h">Variables after this decision</h4>
              <dl className="vars">
                {rec.vars.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd className="num">{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {edited && <p className="muted small">The brain was edited after this drone was deployed; it keeps running the deployed version until you deploy again.</p>}
        </>
      )}
    </div>
  );
}

/** The machine as it is now: sections shaded by remaining integrity, failed parts marked. */
const uiParts = new PartAnimator();

/** Live state of an internal component worth showing as a fill (stock, charge, saturation, charges). */
function internalLevel(c: RComponent): { v: number; label: string; tone: string } | null {
  const def = c.def;
  if (!def) return null;
  if (c.ammo && def.ammo) {
    const cap = def.ammo.payloads.reduce((n, p) => Math.max(n, p.rounds), 0);
    const left = Object.values(c.ammo.stock).reduce((n: number, x) => n + (x ?? 0), 0);
    return { v: Math.max(0, Math.min(1, left / Math.max(1, cap))), label: `${left} rounds left`, tone: '#b9b2a3' };
  }
  if (c.battery && def.power?.storage) return { v: c.battery.charge / def.power.storage, label: `${Math.round(c.battery.charge)} / ${def.power.storage} PU·s`, tone: '#8cc4b1' };
  if (c.heatStore !== undefined && def.support?.heatBuffer) return { v: c.heatStore / def.support.heatBuffer.capacity, label: `${Math.round(c.heatStore)} / ${def.support.heatBuffer.capacity} heat stored`, tone: '#e3a46a' };
  if (c.suppression && def.support?.suppression) return { v: c.suppression.charges / def.support.suppression.charges, label: `${c.suppression.charges} charges`, tone: '#d9d4c8' };
  if (def.power?.generation) return { v: Math.min(1, 1 - Math.max(0, c.heat - 50) / 100), label: c.heat > 100 ? 'overheated: half output' : 'generating', tone: c.heat > 100 ? '#c9735e' : '#e2b46e' };
  return null;
}

function Silhouette({ d, recent }: { d: Drone; recent: Set<string> }) {
  const secs = (['rear', 'middle', 'front'] as const).map((p) => d.sections[p]);
  const minX = Math.min(...secs.map((s) => s.cx - s.length / 2)) - 5;
  const maxX = Math.max(...secs.map((s) => s.cx + s.length / 2)) + 5;
  const H = Math.max(...secs.map((s) => s.width)) / 2 + 5;
  return (
    <svg className="silhouette" viewBox={`${minX} ${-H} ${maxX - minX} ${2 * H}`} aria-label="Live structure">
      <defs>
        <pattern id="sp-hatch" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="1.6" stroke={T.fault} strokeWidth="0.35" />
        </pattern>
      </defs>
      {secs.map((s) => {
        const integ = s.hp / s.maxHp;
        const x = s.cx - s.length / 2;
        const lost = s.destroyed || !s.attached;
        return (
          <g key={s.pos} opacity={s.attached ? 1 : 0.5}>
            <rect x={x} y={-s.width / 2} width={s.length} height={s.width} fill="#3a3a37" />
            {!lost && <rect x={x} y={-s.width / 2 + s.width * (1 - integ)} width={s.length} height={s.width * integ} fill={integ < 0.34 ? '#6b3428' : '#4a4a46'} />}
            {s.destroyed && <rect x={x} y={-s.width / 2} width={s.length} height={s.width} fill="url(#sp-hatch)" />}
            <rect x={x} y={-s.width / 2} width={s.length} height={s.width} fill="none" stroke={s.destroyed ? T.faultLight : '#8f8c84'} strokeWidth={0.35} strokeDasharray={s.attached ? undefined : '1.2 0.8'} />
          </g>
        );
      })}
      {d.joints.map((j) => (
        <line key={j.a + j.b} x1={j.x} y1={-5} x2={j.x} y2={5} stroke={j.intact ? '#cfcac0' : T.faultLight} strokeWidth={j.intact ? 0.5 : 0.3} strokeDasharray={j.intact ? undefined : '0.8 0.6'} />
      ))}
      {/* internals first: their real state, as a fill */}
      {d.components.map((c) => {
        if (c.kind === 'gear' || c.external || c.def?.integrated) return null;
        const r = c.half * 0.7;
        const dead = c.destroyed;
        const level = internalLevel(c);
        return (
          <g key={c.uid} className={recent.has(c.id) ? 'static' : undefined}>
            <title>{`${c.name} (${c.id})${level ? ` · ${level.label}` : ''}`}</title>
            <rect x={c.x - r} y={c.y - r} width={r * 2} height={r * 2} fill="#2a2926" stroke={dead ? T.faultLight : '#8f8c84'} strokeWidth={0.3} />
            {!dead && level && <rect x={c.x - r} y={c.y + r - r * 2 * level.v} width={r * 2} height={r * 2 * level.v} fill={level.tone} opacity={0.85} />}
            {dead && <path d={`M${c.x - r * 0.7} ${c.y - r * 0.7}L${c.x + r * 0.7} ${c.y + r * 0.7}M${c.x + r * 0.7} ${c.y - r * 0.7}L${c.x - r * 0.7} ${c.y + r * 0.7}`} stroke={T.faultLight} strokeWidth={0.45} />}
          </g>
        );
      })}
      {/* hardpoints: the same models as the battlefield, in their live state */}
      {d.components.map((c) => {
        if (c.kind === 'gear' || !c.external || !c.def) return null;
        if (!MODELS[c.def.id]) return null;
        return (
          <g key={c.uid} transform={`translate(${c.x} ${c.y})`} className={recent.has(c.id) ? 'static' : undefined}>
            <PartModelG id={c.def.id} v={uiParts.visual(d, c)} context="field" strokeWidth={0.18} />
          </g>
        );
      })}
    </svg>
  );
}
