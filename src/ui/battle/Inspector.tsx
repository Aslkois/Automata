import { useEffect, useState, type ReactNode } from 'react';
import type { TraceEntry, TraceLoc } from '../../program/interpreter';
import { NODE_MAP } from '../../program/nodeDefs';
import type { DroneController } from '../../program/runtime';
import type { BlockJson, ProgramSource } from '../../program/types';
import { functional } from '../../sim/drone';
import { ammoReserve } from '../../sim/systems';
import type { Drone } from '../../sim/types';
import type { Simulation } from '../../sim/world';
import { useNav } from '../App';
import { Bar, ResizeGrip } from '../common';
import { library } from '../store';
import { C, KIND_COLOR, TEAM_COLOR, TEAM_NAME } from '../theme';
import type { SimRunner } from './runner';

type Tab = 'overview' | 'components' | 'sensors' | 'program';

const pct = (x: number) => `${Math.round(x * 100)}%`;

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

const tone = (label: string, bad: boolean) => (bad ? 'err' : label === 'Operational' ? 'ok' : 'warn');

function Card({ title, color, children, testid }: { title: string; color: string; children: ReactNode; testid?: string }) {
  return (
    <div className="card accent" style={{ ['--c' as string]: color }} data-testid={testid}>
      <h4>{title}</h4>
      {children}
    </div>
  );
}

export function Inspector({ sim, runner, selected, onSelect, width, onResize }: { sim: Simulation | null; runner: SimRunner; selected: number | null; onSelect: (id: number | null) => void; width: number; onResize: (w: number) => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const d = sim && selected !== null ? sim.drones.find((x) => x.id === selected) : undefined;
  void runner;
  const shell = (children: ReactNode) => (
    <aside className="dock right" data-testid="inspector" aria-label="Drone inspector">
      <ResizeGrip width={width} onResize={onResize} label="Resize drone inspector" />
      {children}
    </aside>
  );
  if (!sim) return shell(<div className="empty">Deploy a scenario to begin.</div>);
  if (!d)
    return shell(
      <>
        <div className="insp-head" style={{ paddingBottom: 10, borderBottom: '2px solid #000' }}>
          <h3>Freecam</h3>
        </div>
        <div className="insp-body">
          <p className="insp-note">Click a drone on the battlefield or in the roster to spectate it and inspect its decisions. Selecting never takes control.</p>
          {sim.drones.map((x) => {
            const c = sim.controllers.get(x.id)!;
            const ws = x.components.filter((k) => k.weapon);
            const live = ws.filter((k) => functional(x, k)).length;
            return (
              <button key={x.id} className="drone-item" style={{ ['--c' as string]: TEAM_COLOR[x.team % 4] }} onClick={() => onSelect(x.id)}>
                <span className="tdot" />
                <b>{x.name}</b>
                <span className="mini">
                  <span className={`state-tag ${tone(x.status.label, x.status.disabled || x.status.destroyed)}`}>{x.status.label}</span>
                  <span className="muted">
                    weapons {live}/{ws.length}
                  </span>
                  <span className={c.state === 'ok' ? 'muted' : 'bad'}>program {c.state}</span>
                </span>
              </button>
            );
          })}
        </div>
      </>,
    );
  const ctrl = sim.controllers.get(d.id)!;
  const tc = TEAM_COLOR[d.team % 4];
  return shell(
    <>
      <div className="insp-head" style={{ paddingBottom: 8 }}>
        <span className="tdot" style={{ width: 16, height: 16, borderRadius: '50%', border: '3px solid #000', background: tc, flex: 'none' }} />
        <h3 style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} data-testid="inspected-name">
          {d.name} <span className="muted" style={{ fontWeight: 500 }}>#{d.id} · {TEAM_NAME[d.team]}</span>
        </h3>
        <span className={`state-tag ${tone(d.status.label, d.status.disabled || d.status.destroyed)}`} data-testid="inspected-status">
          {d.status.label}
        </span>
      </div>
      <div className="insp-tabs" role="tablist">
        {(['overview', 'components', 'sensors', 'program'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'program' ? 'Program' : t[0].toUpperCase() + t.slice(1)}
            {t === 'program' && ctrl.state !== 'ok' && <span className="count">!</span>}
          </button>
        ))}
      </div>
      <div className="insp-body">
        {tab === 'overview' && <Overview d={d} />}
        {tab === 'components' && <Components d={d} />}
        {tab === 'sensors' && <Sensors d={d} sim={sim} />}
        {tab === 'program' && <ProgramTrace key={d.id} d={d} ctrl={ctrl} />}
      </div>
    </>,
  );
}

function Overview({ d }: { d: Drone }) {
  const p = d.power;
  const speed = Math.hypot(d.body.vel.x, d.body.vel.y);
  const flags = (['degraded', 'immobilized', 'disarmed', 'disabled', 'destroyed'] as const).filter((f) => d.status[f]);
  return (
    <div data-testid="overview" style={{ display: 'grid', gap: 12 }}>
      <div className="stat-big">
        <div>
          <b>{speed.toFixed(0)}</b>
          <span>speed u/s</span>
        </div>
        <div>
          <b>{((((d.body.angle * 180) / Math.PI) % 360) + 360) % 360 | 0}°</b>
          <span>heading</span>
        </div>
        <div>
          <b>{Math.round(d.body.mass)}</b>
          <span>mass kg</span>
        </div>
      </div>
      <dl className="kv">
        <dt>Damage flags</dt>
        <dd className={flags.length ? 'warn' : 'ok'}>{flags.length ? flags.join(', ') : 'none'}</dd>
        <dt>Drive command</dt>
        <dd>
          throttle {d.throttle.toFixed(2)} · steer {d.steer.toFixed(2)}
        </dd>
      </dl>
      <Card title="Weapons" color={KIND_COLOR.weapon} testid="weapons-card">
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
      </Card>
      <Card title="Structure" color={C.paper}>
        <table className="grid">
          <tbody>
            {(['front', 'middle', 'rear'] as const).map((pos) => {
              const s = d.sections[pos];
              return (
                <tr key={pos} className={!s.attached || s.destroyed ? 'dead' : ''}>
                  <td style={{ fontFamily: 'var(--font)', textTransform: 'capitalize' }}>
                    {pos} <span className="muted">{s.def.name}</span>
                  </td>
                  <td style={{ width: 90 }}>
                    <Bar v={s.hp / s.maxHp} tone="auto" />
                  </td>
                  <td>
                    {s.armor.toFixed(0)}/{s.armorMax}mm
                  </td>
                  <td>{s.destroyed ? 'destroyed' : s.attached ? '' : 'detached'}</td>
                </tr>
              );
            })}
            {d.joints.map((j) => (
              <tr key={j.a + j.b} className={!j.intact ? 'dead' : ''}>
                <td style={{ fontFamily: 'var(--font)' }}>
                  joint {j.a[0].toUpperCase()}–{j.b[0].toUpperCase()}
                </td>
                <td>
                  <Bar v={j.hp / j.maxHp} tone="auto" />
                </td>
                <td colSpan={2}>{j.intact ? pct(j.hp / j.maxHp) : 'failed'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Power" color={KIND_COLOR.generator}>
        <dl className="kv">
          <dt>Generation</dt>
          <dd>{p.generation.toFixed(0)} PU/s</dd>
          <dt>Stored</dt>
          <dd>
            {p.stored.toFixed(0)} / {p.capacity.toFixed(0)}
          </dd>
        </dl>
        {p.capacity > 0 && (
          <div style={{ margin: '6px 0' }}>
            <Bar v={p.stored / p.capacity} tone="auto" />
          </div>
        )}
        <table className="grid">
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
      </Card>
      {d.components.some((c) => c.shield) && (
        <Card title="Shields" color={KIND_COLOR.shield}>
          {d.components
            .filter((c) => c.shield)
            .map((c) => {
              const sh = c.shield!;
              const def = c.def!.shield!;
              const ok = functional(d, c);
              return (
                <div key={c.id} style={{ marginBottom: 6 }}>
                  <div className="mono" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span>{c.id}</span>
                    <span>
                      {!ok ? 'destroyed' : sh.overloadLeft > 0 ? `overloaded ${sh.overloadLeft.toFixed(1)}s` : !sh.powered ? 'unpowered' : sh.raised ? 'raised' : 'lowered'} · {sh.charge.toFixed(0)}/{def.capacity}
                    </span>
                  </div>
                  <Bar v={sh.charge / def.capacity} tone="violet" />
                </div>
              );
            })}
        </Card>
      )}
      <Card title="Hardware failures" color={C.red}>
        {d.failures.length === 0 && <p className="insp-note">None.</p>}
        {d.failures
          .slice(-12)
          .reverse()
          .map((f, i) => (
            <div key={i} className="mono" style={{ fontSize: 12 }}>
              <span className="muted">{f.time.toFixed(2)}</span> {f.detail}
            </div>
          ))}
      </Card>
    </div>
  );
}

function Components({ d }: { d: Drone }) {
  return (
    <table className="grid" data-testid="components-table">
      <thead>
        <tr>
          <th />
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
              <td>
                <i className="sw" style={{ background: KIND_COLOR[c.kind] ?? C.slate, width: 10, marginRight: 0 }} />
              </td>
              <td>{c.id}</td>
              <td style={{ fontFamily: 'var(--font)' }}>{c.name}</td>
              <td style={{ width: 80 }}>
                <Bar v={c.hp / c.maxHp} tone="auto" />
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
    <div data-testid="sensors" style={{ display: 'grid', gap: 12 }}>
      <p className="insp-note">Exactly what this drone's program can see, updated each decision tick (t = {d.perception.time.toFixed(2)} s).</p>
      <Card title="Sensors" color={KIND_COLOR.sensor}>
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
      </Card>
      <Card title={`Contacts (${d.perception.contacts.length})`} color={C.sky}>
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
                <td colSpan={5} className="muted">
                  No contacts.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      <Card title={`Incoming shells (${d.perception.threats.length})`} color={C.yellow}>
        {d.perception.threats.length === 0 && <p className="insp-note">None tracked.</p>}
        {d.perception.threats.map((t, i) => (
          <div key={i} className="mono" style={{ fontSize: 12 }}>
            {t.distance.toFixed(0)} u · impact in {t.closingTime.toFixed(2)} s
          </div>
        ))}
      </Card>
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
    <div data-testid="program-trace" style={{ display: 'grid', gap: 12 }}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <b style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ctrl.program.name}</b>
          <span className={`kind-badge k-${ctrl.program.kind}`}>{ctrl.program.kind}</span>
          <span className={`state-tag ${ctrl.state === 'ok' ? 'ok' : 'err'}`}>{ctrl.state}</span>
        </div>
        {rec && (
          <dl className="kv">
            <dt>Operations</dt>
            <dd>
              {rec.ops} / {rec.budget}
            </dd>
            <dt>Perception</dt>
            <dd>
              {rec.contacts} contact(s), {rec.threats} shell(s)
            </dd>
          </dl>
        )}
        {rec && <div style={{ marginTop: 6 }}><Bar v={rec.budget ? rec.ops / rec.budget : 0} tone={rec.budget && rec.ops / rec.budget > 0.85 ? 'bad' : rec.budget && rec.ops / rec.budget > 0.6 ? 'warn' : undefined} /></div>}
        {ctrl.lastError && <div className="issue error" style={{ marginTop: 8 }}>{ctrl.lastError}</div>}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h3 style={{ flex: 1 }}>Decision history</h3>
          <button className="btn small" aria-pressed={pinned === null} onClick={() => setPinned(null)}>
            Latest
          </button>
        </div>
        <div className="tick-strip" aria-label="Decision ticks">
          {hist.slice(-120).map((h) => (
            <button key={h.tick} title={`t=${h.time.toFixed(1)}s${h.error ? ` error: ${h.error}` : ''}`} aria-label={`Decision at ${h.time.toFixed(1)} s`} className={`${h.error ? 'err' : ''} ${rec && h.tick === rec.tick ? 'sel' : ''}`} onClick={() => setPinned(h.tick)} />
          ))}
        </div>
      </div>
      {rec ? (
        <div>
          <div className="muted mono" style={{ fontSize: 12, marginBottom: 4 }}>
            t = {rec.time.toFixed(2)} s · tick {rec.tick} · {rec.entries.length} entries{rec.dropped ? ` (+${rec.dropped} not recorded)` : ''}
          </div>
          <div data-testid="trace-entries" style={{ display: 'grid', gap: 1 }}>
            {rec.entries.map((e, i) => (
              <div key={i} className={`trace-entry k-${e.kind} ${selEntry === i ? 'sel' : ''}`} onClick={() => setSelEntry(i)} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && setSelEntry(i)}>
                <span className="loc">{describeLoc(e.loc, program)}</span>
                <span className="txt">{e.text}</span>
              </div>
            ))}
            {rec.error && (
              <div className="trace-entry k-error">
                <span className="loc">error</span>
                <span className="txt">{rec.error}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="insp-note">No decisions yet — press Play or Step.</p>
      )}
      {loc && loc.kind !== 'none' && (
        <Card title="Source" color={C.yellow}>
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
          {loc.kind !== 'line' && (
            <div className="mono" style={{ fontSize: 12 }}>
              {describeLoc(loc, program)} <span className="muted">({loc.id})</span>
            </div>
          )}
          <button className="btn small" style={{ marginTop: 8 }} onClick={() => navigate({ tab: 'programs', programId: ctrl.program.id, highlight: loc })}>
            Show in editor
          </button>
          {JSON.stringify(program) !== JSON.stringify(ctrl.program) && <p className="insp-note" style={{ marginTop: 6 }}>The program has been edited since this battle was deployed; the running drone uses the deployed version.</p>}
        </Card>
      )}
      <Card title="Failures seen by the program" color={C.red}>
        {d.failures.length === 0 ? (
          <p className="insp-note">None.</p>
        ) : (
          d.failures.slice(-6).map((f, i) => (
            <div key={i} className="mono" style={{ fontSize: 12 }}>
              {f.time.toFixed(2)} {f.type}: {f.detail}
            </div>
          ))
        )}
      </Card>
    </div>
  );
}
