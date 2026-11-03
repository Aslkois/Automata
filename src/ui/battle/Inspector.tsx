import { useEffect, useState } from 'react';
import type { TraceEntry, TraceLoc } from '../../program/interpreter';
import { NODE_MAP } from '../../program/nodeDefs';
import type { BlockJson, ProgramSource } from '../../program/types';
import type { DroneController } from '../../program/runtime';
import { functional } from '../../sim/drone';
import { ammoReserve } from '../../sim/systems';
import type { Drone } from '../../sim/types';
import type { Simulation } from '../../sim/world';
import { useNav } from '../App';
import { library } from '../store';
import type { SimRunner } from './runner';
import { TEAM_COLORS } from '../../render/renderer';

type Tab = 'overview' | 'components' | 'sensors' | 'program';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const barClass = (x: number) => (x > 0.6 ? 'ok' : x > 0.3 ? 'warn' : 'bad');

function Bar({ v, cls }: { v: number; cls?: string }) {
  return (
    <div className={`bar ${cls ?? barClass(v)}`}>
      <span style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }} />
    </div>
  );
}

function findBlock(blocks: BlockJson[] | undefined, id: string): BlockJson | null {
  for (const b of blocks ?? []) {
    if (b.id === id) return b;
    for (const inp of Object.values(b.inputs ?? {})) {
      const r = findBlock([inp.block, inp.shadow].filter(Boolean) as BlockJson[], id);
      if (r) return r;
    }
    if (b.next?.block) {
      const r = findBlock([b.next.block], id);
      if (r) return r;
    }
  }
  return null;
}

export function describeLoc(loc: TraceLoc, program: ProgramSource | undefined): string {
  if (loc.kind === 'line') return `line ${loc.line}`;
  if (loc.kind === 'block') {
    const b = findBlock(program?.blocks?.blocks?.blocks, loc.id);
    return b ? `block ${b.type.replace(/^drone_/, '')}` : `block ${loc.id}`;
  }
  if (loc.kind === 'node') {
    const n = program?.nodes?.nodes.find((x) => x.id === loc.id);
    return n ? `node ${NODE_MAP[n.type]?.title ?? n.type}` : `node ${loc.id}`;
  }
  return 'runtime';
}

export function Inspector({ sim, runner, selected, onSelect }: { sim: Simulation | null; runner: SimRunner; selected: number | null; onSelect: (id: number | null) => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const d = sim && selected !== null ? sim.drones.find((x) => x.id === selected) : undefined;
  void runner;
  if (!sim) return <aside className="panel right"><div className="empty">Deploy a scenario to begin.</div></aside>;
  if (!d)
    return (
      <aside className="panel right" data-testid="inspector">
        <div className="panel-head">
          <h2>Freecam</h2>
        </div>
        <div className="panel-body">
          <p className="muted" style={{ marginTop: 0 }}>Click a drone (or pick one in the list) to spectate it. Selecting never takes control — drones act only on their own programs.</p>
          <div className="section-title">Combatants</div>
          <table className="grid">
            <thead>
              <tr>
                <th>Drone</th>
                <th>State</th>
                <th>Program</th>
              </tr>
            </thead>
            <tbody>
              {sim.drones.map((x) => {
                const c = sim.controllers.get(x.id)!;
                return (
                  <tr key={x.id} onClick={() => onSelect(x.id)} style={{ cursor: 'pointer' }}>
                    <td style={{ fontFamily: 'var(--sans)' }}>
                      <span className="team-dot" style={{ background: TEAM_COLORS[x.team % 4], marginRight: 6 }} />
                      {x.name}
                    </td>
                    <td>{x.status.label}</td>
                    <td className={c.state === 'ok' ? '' : 'bad'}>{c.state}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </aside>
    );
  const ctrl = sim.controllers.get(d.id)!;
  return (
    <aside className="panel right" data-testid="inspector">
      <div className="panel-head">
        <span className="team-dot" style={{ background: TEAM_COLORS[d.team % 4] }} />
        <h2 style={{ color: 'var(--text)', textTransform: 'none', letterSpacing: 0, fontSize: 13 }} data-testid="inspected-name">
          {d.name} <span className="faint">#{d.id}</span>
        </h2>
        <span className={d.status.disabled || d.status.destroyed ? 'bad' : d.status.label === 'Operational' ? 'ok' : 'warn'} data-testid="inspected-status">
          {d.status.label}
        </span>
      </div>
      <div className="inspector-tabs" role="tablist">
        {(['overview', 'components', 'sensors', 'program'] as Tab[]).map((t) => (
          <button key={t} role="tab" className={`btn small ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'overview' && <Overview d={d} />}
        {tab === 'components' && <Components d={d} />}
        {tab === 'sensors' && <Sensors d={d} sim={sim} />}
        {tab === 'program' && <ProgramTrace key={d.id} d={d} ctrl={ctrl} />}
      </div>
    </aside>
  );
}

function Overview({ d }: { d: Drone }) {
  const p = d.power;
  const speed = Math.hypot(d.body.vel.x, d.body.vel.y);
  const flags = (['degraded', 'immobilized', 'disarmed', 'disabled', 'destroyed'] as const).filter((f) => d.status[f]);
  return (
    <div data-testid="overview">
      <dl className="kv">
        <dt>Flags</dt>
        <dd>{flags.length ? flags.join(', ') : 'none'}</dd>
        <dt>Speed / heading</dt>
        <dd>
          {speed.toFixed(1)} u/s · {(((d.body.angle * 180) / Math.PI) % 360).toFixed(0)}°
        </dd>
        <dt>Command</dt>
        <dd>
          throttle {d.throttle.toFixed(2)} · steer {d.steer.toFixed(2)}
        </dd>
        <dt>Mass</dt>
        <dd>{Math.round(d.body.mass)} kg</dd>
      </dl>
      <div className="section-title">Power</div>
      <dl className="kv">
        <dt>Generation</dt>
        <dd>{p.generation.toFixed(0)} PU/s</dd>
        <dt>Stored</dt>
        <dd>
          {p.stored.toFixed(0)} / {p.capacity.toFixed(0)}
        </dd>
      </dl>
      {p.capacity > 0 && <Bar v={p.stored / p.capacity} />}
      <table className="grid" style={{ marginTop: 6 }}>
        <thead>
          <tr>
            <th>System</th>
            <th>Demand</th>
            <th>Supplied</th>
            <th>Priority</th>
          </tr>
        </thead>
        <tbody>
          {(['systems', 'propulsion', 'weapons', 'shields'] as const).map((c) => (
            <tr key={c}>
              <td>{c}</td>
              <td>{p.demand[c].toFixed(0)}</td>
              <td className={p.satisfaction[c] < 0.6 ? 'bad' : p.satisfaction[c] < 1 ? 'warn' : ''}>{pct(p.satisfaction[c])}</td>
              <td>{c === 'systems' ? 'first' : p.allocation[c].toFixed(1)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="section-title">Structure</div>
      <table className="grid">
        <thead>
          <tr>
            <th>Section</th>
            <th>Integrity</th>
            <th>Armor</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {(['front', 'middle', 'rear'] as const).map((pos) => {
            const s = d.sections[pos];
            return (
              <tr key={pos} className={!s.attached || s.destroyed ? 'dead' : ''}>
                <td>
                  {pos} ({s.def.id[0].toUpperCase()})
                </td>
                <td style={{ width: 90 }}>
                  <Bar v={s.hp / s.maxHp} />
                </td>
                <td>
                  {s.armor.toFixed(0)}/{s.armorMax} mm
                </td>
                <td>{s.destroyed ? 'destroyed' : s.attached ? 'attached' : 'detached'}</td>
              </tr>
            );
          })}
          {d.joints.map((j) => (
            <tr key={j.a + j.b} className={!j.intact ? 'dead' : ''}>
              <td>
                joint {j.a[0].toUpperCase()}–{j.b[0].toUpperCase()}
              </td>
              <td>
                <Bar v={j.hp / j.maxHp} />
              </td>
              <td colSpan={2}>{j.intact ? pct(j.hp / j.maxHp) : 'failed'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="section-title">Weapons</div>
      <table className="grid" data-testid="weapons-table">
        <thead>
          <tr>
            <th>Mount</th>
            <th>Type</th>
            <th>Ammo</th>
            <th>Heat</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {d.components
            .filter((c) => c.weapon)
            .map((c) => {
              const ws = c.weapon!;
              const ok = functional(d, c);
              const state = !ok ? (c.destroyed ? 'destroyed' : 'detached') : ws.reloading ? 'reloading' : ws.overheated ? 'overheated' : ws.blockReason && ws.trigger ? 'blocked' : ws.trigger ? 'firing' : 'holding';
              return (
                <tr key={c.id} className={!ok ? 'dead' : ''} title={ws.blockReason ?? ''}>
                  <td>{c.id}</td>
                  <td>{c.def!.id.replace('_', ' ')}</td>
                  <td>
                    {ws.mag}/{c.def!.weapon!.magazine} +{ammoReserve(d, c.def!.weapon!.caliber)}
                  </td>
                  <td className={c.heat > 100 ? 'bad' : c.heat > 70 ? 'warn' : ''}>{c.heat.toFixed(0)}</td>
                  <td className={state === 'blocked' || state === 'overheated' ? 'warn' : state === 'firing' ? 'ok' : ''}>{state}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
      {d.components.some((c) => c.shield) && (
        <>
          <div className="section-title">Shields</div>
          {d.components
            .filter((c) => c.shield)
            .map((c) => {
              const sh = c.shield!;
              const def = c.def!.shield!;
              const ok = functional(d, c);
              return (
                <div key={c.id} style={{ marginBottom: 6 }}>
                  <div className="mono" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                    <span>{c.id}</span>
                    <span>{!ok ? 'destroyed' : sh.overloadLeft > 0 ? `overloaded ${sh.overloadLeft.toFixed(1)}s` : !sh.powered ? 'unpowered' : sh.raised ? 'raised' : 'lowered'} · {sh.charge.toFixed(0)}/{def.capacity}</span>
                  </div>
                  <Bar v={sh.charge / def.capacity} cls="ok" />
                </div>
              );
            })}
        </>
      )}
      <div className="section-title">Hardware failures</div>
      {d.failures.length === 0 && <div className="faint">None.</div>}
      {d.failures
        .slice(-12)
        .reverse()
        .map((f, i) => (
          <div key={i} className="mono" style={{ fontSize: 11.5 }}>
            <span className="faint">{f.time.toFixed(2)}</span> {f.detail}
          </div>
        ))}
    </div>
  );
}

function Components({ d }: { d: Drone }) {
  return (
    <table className="grid" data-testid="components-table">
      <thead>
        <tr>
          <th>Id</th>
          <th>Component</th>
          <th>Health</th>
          <th>Heat</th>
        </tr>
      </thead>
      <tbody>
        {d.components.map((c) => {
          const ok = functional(d, c);
          return (
            <tr key={c.uid} className={!ok ? 'dead' : ''}>
              <td>{c.id}</td>
              <td style={{ fontFamily: 'var(--sans)' }}>{c.name}</td>
              <td style={{ width: 80 }}>
                <Bar v={c.hp / c.maxHp} />
              </td>
              <td className={c.heat > 100 ? 'bad' : ''}>{c.heat.toFixed(0)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Sensors({ d, sim }: { d: Drone; sim: Simulation }) {
  const name = (id: number) => sim.drones.find((x) => x.id === id)?.name ?? `#${id}`;
  return (
    <div data-testid="sensors">
      <p className="faint" style={{ marginTop: 0, fontSize: 12 }}>
        This is exactly what the drone's program can see (updated each decision tick at t = {d.perception.time.toFixed(2)} s).
      </p>
      <div className="section-title">Sensors</div>
      <table className="grid">
        <thead>
          <tr>
            <th>Id</th>
            <th>Type</th>
            <th>State</th>
            <th>Arc / range</th>
          </tr>
        </thead>
        <tbody>
          {d.components
            .filter((c) => c.kind === 'sensor')
            .map((c) => (
              <tr key={c.id} className={!functional(d, c) ? 'dead' : ''}>
                <td>{c.id}</td>
                <td>{c.def!.id}</td>
                <td>{!functional(d, c) ? 'lost' : d.power.satisfaction.systems < 0.5 ? 'unpowered' : 'active'}</td>
                <td>
                  {c.def!.sensor!.arcDeg}° / {c.def!.sensor!.range}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <div className="section-title">Contacts ({d.perception.contacts.length})</div>
      <table className="grid" data-testid="contacts-table">
        <thead>
          <tr>
            <th>Contact</th>
            <th>Dist</th>
            <th>Brg</th>
            <th>Size</th>
            <th>By</th>
          </tr>
        </thead>
        <tbody>
          {d.perception.contacts.map((c) => (
            <tr key={c.id}>
              <td className={c.team === 'enemy' ? 'bad' : 'ok'}>
                #{c.id} {name(c.id)}
              </td>
              <td>{c.distance.toFixed(0)}</td>
              <td>{c.bearing.toFixed(0)}°</td>
              <td>{c.size ?? '?'}</td>
              <td>{c.sensors.join(' ')}</td>
            </tr>
          ))}
          {d.perception.contacts.length === 0 && (
            <tr>
              <td colSpan={5} className="faint">No contacts.</td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="section-title">Incoming shells ({d.perception.threats.length})</div>
      {d.perception.threats.map((t, i) => (
        <div key={i} className="mono" style={{ fontSize: 11.5 }}>
          {t.distance.toFixed(0)} u · impact in {t.closingTime.toFixed(2)} s
        </div>
      ))}
    </div>
  );
}

function ProgramTrace({ d, ctrl }: { d: Drone; ctrl: DroneController }) {
  const { navigate } = useNav();
  const [pinned, setPinned] = useState<number | null>(null);
  const [selEntry, setSelEntry] = useState<number | null>(null);
  const program = library.get().programs.find((p) => p.id === ctrl.program.id) ?? ctrl.program;
  const hist = ctrl.history;
  const recIndex = pinned !== null ? hist.findIndex((h) => h.tick === pinned) : hist.length - 1;
  const rec = hist[recIndex];
  useEffect(() => setSelEntry(null), [pinned]);
  const entry: TraceEntry | null = rec && selEntry !== null ? rec.entries[selEntry] ?? null : null;
  const loc = entry?.loc ?? null;
  const source = ctrl.program.kind === 'code' ? ctrl.program.code ?? '' : ctrl.compiled.js;
  return (
    <div data-testid="program-trace">
      <dl className="kv">
        <dt>Program</dt>
        <dd>
          {ctrl.program.name} <span className="kind-tag">{ctrl.program.kind}</span>
        </dd>
        <dt>State</dt>
        <dd className={ctrl.state === 'ok' ? 'ok' : 'bad'}>{ctrl.state}</dd>
        {rec && (
          <>
            <dt>Operations</dt>
            <dd>
              {rec.ops} / {rec.budget}
            </dd>
            <dt>Perception</dt>
            <dd>
              {rec.contacts} contact(s), {rec.threats} shell(s)
            </dd>
          </>
        )}
        {ctrl.lastError && (
          <>
            <dt>Last error</dt>
            <dd className="bad" style={{ whiteSpace: 'normal' }}>{ctrl.lastError}</dd>
          </>
        )}
      </dl>
      <div className="section-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>Decision history</span>
        <button className={`btn small ${pinned === null ? 'active' : ''}`} onClick={() => setPinned(null)}>Latest</button>
      </div>
      <div className="tick-strip" aria-label="Decision ticks">
        {hist.slice(-120).map((h) => (
          <button key={h.tick} title={`t=${h.time.toFixed(1)}s${h.error ? ` error: ${h.error}` : ''}`} className={`${h.error ? 'err' : ''} ${rec && h.tick === rec.tick ? 'sel' : ''}`} onClick={() => setPinned(h.tick)} />
        ))}
      </div>
      {rec ? (
        <>
          <div className="muted mono" style={{ fontSize: 11.5, margin: '4px 0' }}>
            decision at t = {rec.time.toFixed(2)} s (tick {rec.tick}) · {rec.entries.length} trace entries{rec.dropped ? ` (+${rec.dropped} not recorded)` : ''}
          </div>
          <div data-testid="trace-entries">
            {rec.entries.map((e, i) => (
              <div key={i} className={`trace-entry k-${e.kind} ${selEntry === i ? 'sel' : ''}`} onClick={() => setSelEntry(i)}>
                <span className="loc">{describeLoc(e.loc, program)}</span>
                <span className="txt">{e.text}</span>
              </div>
            ))}
            {rec.error && <div className="trace-entry k-error"><span className="loc">error</span><span className="txt">{rec.error}</span></div>}
          </div>
        </>
      ) : (
        <div className="faint">No decisions yet — press Play or Step.</div>
      )}
      {loc && loc.kind !== 'none' && (
        <>
          <div className="section-title">Source</div>
          {loc.kind === 'line' && (
            <div className="source-view">
              {source
                .split('\n')
                .map((text, i) => ({ text, n: i + 1 }))
                .filter((l) => Math.abs(l.n - loc.line) <= 5)
                .map((l) => (
                  <div key={l.n} className={`ln ${l.n === loc.line ? 'hl' : ''}`}>
                    <span>{l.n}</span>
                    <span>{l.text}</span>
                  </div>
                ))}
            </div>
          )}
          {loc.kind !== 'line' && <div className="mono" style={{ fontSize: 12 }}>{describeLoc(loc, program)} <span className="faint">({loc.id})</span></div>}
          <button className="btn small" style={{ marginTop: 6 }} onClick={() => navigate({ tab: 'programs', programId: ctrl.program.id, highlight: loc })}>
            Show in editor
          </button>
          {program !== ctrl.program && JSON.stringify(program) !== JSON.stringify(ctrl.program) && (
            <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>The program has been edited since this battle was deployed; the running drone uses the deployed version.</div>
          )}
        </>
      )}
      <div className="section-title">Drone failures seen by the program</div>
      {d.failures.length === 0 ? <div className="faint">None.</div> : d.failures.slice(-6).map((f, i) => <div key={i} className="mono" style={{ fontSize: 11.5 }}>{f.time.toFixed(2)} {f.type}: {f.detail}</div>)}
    </div>
  );
}
