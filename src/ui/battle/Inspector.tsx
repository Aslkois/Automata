import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { TraceEntry, TraceLoc } from '../../program/interpreter';
import { NODE_MAP } from '../../program/nodeDefs';
import type { DroneController } from '../../program/runtime';
import type { BlockJson, ProgramSource } from '../../program/types';
import { functional } from '../../sim/drone';
import { ammoReserve } from '../../sim/systems';
import type { Drone } from '../../sim/types';
import type { Simulation } from '../../sim/world';
import { useNav } from '../App';
import { Glyph, Meter, ResizeGrip, SectionTitle, Stamp } from '../common';
import { library } from '../store';
import { A, KIND_CODE, TEAM_COLOR, TEAM_NAME } from '../theme';

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

const statusTone = (d: Drone): 'ok' | 'warn' | 'bad' => (d.status.disabled || d.status.destroyed ? 'bad' : d.status.label === 'Operational' ? 'ok' : 'warn');

/** Components that failed within the last moments, for transient signal disturbance. */
function recentFailures(d: Drone, now: number): Set<string> {
  const s = new Set<string>();
  for (const f of d.failures) if (f.component && now - f.time < 1.4) s.add(f.component);
  return s;
}

export function Inspector({ sim, drone: d, onClose, width, onResize }: { sim: Simulation; drone: Drone; onClose: () => void; width: number; onResize: (w: number) => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const ctrl = sim.controllers.get(d.id)!;
  // A genuine hardware failure briefly disturbs the report's signal.
  const [glitch, setGlitch] = useState(false);
  const seen = useRef({ id: d.id, n: d.failures.length });
  const glitchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        if (glitchTimer.current) clearTimeout(glitchTimer.current);
        glitchTimer.current = setTimeout(() => setGlitch(false), 700);
      }
    }
  });
  useEffect(() => () => void (glitchTimer.current && clearTimeout(glitchTimer.current)), []);
  const recent = recentFailures(d, sim.time);
  const index = sim.drones.findIndex((x) => x.id === d.id);
  return (
    <aside className={`diag ${glitch ? 'breakup' : ''}`} data-testid="inspector" aria-label="Diagnostic report">
      <ResizeGrip width={width} onResize={onResize} label="Resize diagnostic report" />
      <div className="diag-head">
        <div className="eyebrow">
          Diagnostic report · unit {String(index + 1).padStart(2, '0')} · {TEAM_NAME[d.team]}
        </div>
        <div className="row1">
          <span style={{ width: 4, alignSelf: 'stretch', background: TEAM_COLOR[d.team % 4], flex: 'none' }} />
          <div className="grow">
            <h2 data-testid="inspected-name">
              {d.name} <span className="faint" style={{ fontSize: 15 }}>#{d.id}</span>
            </h2>
          </div>
          <Stamp tone={statusTone(d)} testid="inspected-status">
            {d.status.label}
          </Stamp>
        </div>
      </div>
      <div className="tabs" role="tablist">
        {(['overview', 'components', 'sensors', 'program'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
            {t === 'overview' ? 'Diagnostics' : t === 'program' ? 'Program' : t[0].toUpperCase() + t.slice(1)}
            {t === 'program' && ctrl.state !== 'ok' && <span className="count bad">!</span>}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn ghost sm" onClick={onClose} title="Close and return to freecam (Esc)" aria-label="Close diagnostic report">
          ✕
        </button>
      </div>
      <div className="diag-body">
        <div className="scan reveal" key={`${d.id}-${tab}`}>
          {tab === 'overview' && <Overview d={d} recent={recent} />}
          {tab === 'components' && <Components d={d} recent={recent} />}
          {tab === 'sensors' && <Sensors d={d} sim={sim} />}
          {tab === 'program' && <ProgramTrace key={d.id} d={d} ctrl={ctrl} />}
        </div>
      </div>
    </aside>
  );
}

/** The machine as it is now: sections shaded by remaining integrity, failed parts marked. */
function Silhouette({ d, recent }: { d: Drone; recent: Set<string> }) {
  const secs = (['rear', 'middle', 'front'] as const).map((p) => d.sections[p]);
  const minX = Math.min(...secs.map((s) => s.cx - s.length / 2)) - 8;
  const maxX = Math.max(...secs.map((s) => s.cx + s.length / 2)) + 8;
  const H = Math.max(...secs.map((s) => s.width)) / 2 + 11;
  const ink = A.ink;
  return (
    <svg className="silhouette" viewBox={`${minX} ${-H} ${maxX - minX} ${2 * H}`} aria-label="Structural silhouette">
      <defs>
        <pattern id="sil-hatch" width="1.6" height="1.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="1.6" stroke={A.rust} strokeWidth="0.35" />
        </pattern>
      </defs>
      <line x1={minX + 2} y1={0} x2={maxX - 2} y2={0} stroke={ink} strokeWidth={0.12} strokeDasharray="3 1 0.5 1" opacity={0.5} />
      {secs.map((s) => {
        const integ = s.hp / s.maxHp;
        const x = s.cx - s.length / 2;
        const lost = s.destroyed || !s.attached;
        return (
          <g key={s.pos} opacity={s.attached ? 1 : 0.55}>
            <rect x={x} y={-s.width / 2} width={s.length} height={s.width} fill={A.ivory} />
            {!lost && <rect x={x} y={-s.width / 2 + s.width * (1 - integ)} width={s.length} height={s.width * integ} fill={integ < 0.3 ? A.rustWash : A.vellum} />}
            {s.destroyed && <rect x={x} y={-s.width / 2} width={s.length} height={s.width} fill="url(#sil-hatch)" />}
            <rect x={x} y={-s.width / 2} width={s.length} height={s.width} fill="none" stroke={s.destroyed ? A.rust : ink} strokeWidth={0.35} strokeDasharray={s.attached ? undefined : '1.2 0.8'} />
            <text x={s.cx} y={-s.width / 2 - 4.4} fontSize={2.6} textAnchor="middle" fontFamily="IBM Plex Mono, monospace" fill={lost ? A.rust : A.stone}>
              {s.destroyed ? 'LOST' : !s.attached ? 'DETACHED' : pct(integ)}
            </text>
          </g>
        );
      })}
      {d.joints.map((j) => (
        <line key={j.a + j.b} x1={j.x} y1={-5} x2={j.x} y2={5} stroke={j.intact ? ink : A.rust} strokeWidth={j.intact ? 0.5 : 0.3} strokeDasharray={j.intact ? undefined : '0.8 0.6'} />
      ))}
      {d.components.map((c) => {
        const r = c.kind === 'gear' ? 0 : c.half * 0.7;
        const dead = c.destroyed;
        const hurt = !dead && c.hp < c.maxHp * 0.5;
        const flick = recent.has(c.id);
        if (c.kind === 'gear') {
          const s = d.sections[c.section];
          const y = c.gearSide === 'left' ? -s.width / 2 - 2.6 : s.width / 2 + 0.6;
          return <rect key={c.uid} x={s.cx - s.length / 2 + 1} y={y} width={s.length - 2} height={2} fill={dead ? A.rustWash : A.vellum} stroke={dead ? A.rust : ink} strokeWidth={0.2} className={flick ? 'static' : undefined} />;
        }
        return (
          <g key={c.uid} className={flick ? 'static' : undefined}>
            {c.external ? (
              <circle cx={c.x} cy={c.y} r={r} fill={dead ? A.rustWash : hurt ? A.vellum : A.ivory} stroke={dead ? A.rust : ink} strokeWidth={0.3} />
            ) : (
              <rect x={c.x - r} y={c.y - r} width={r * 2} height={r * 2} fill={dead ? A.rustWash : hurt ? A.vellum : A.ivory} stroke={dead ? A.rust : ink} strokeWidth={0.25} />
            )}
            {dead && <path d={`M${c.x - r * 0.7} ${c.y - r * 0.7}L${c.x + r * 0.7} ${c.y + r * 0.7}M${c.x + r * 0.7} ${c.y - r * 0.7}L${c.x - r * 0.7} ${c.y + r * 0.7}`} stroke={A.rust} strokeWidth={0.4} />}
            {c.weapon && !dead && <line x1={c.x} y1={c.y} x2={c.x + Math.cos(c.weapon.aim) * (r + 3)} y2={c.y + Math.sin(c.weapon.aim) * (r + 3)} stroke={ink} strokeWidth={0.5} />}
          </g>
        );
      })}
    </svg>
  );
}

function Block({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <SectionTitle note={note}>{title}</SectionTitle>
      {children}
    </div>
  );
}

function Overview({ d, recent }: { d: Drone; recent: Set<string> }) {
  const p = d.power;
  const speed = Math.hypot(d.body.vel.x, d.body.vel.y);
  const flags = (['degraded', 'immobilized', 'disarmed', 'disabled', 'destroyed'] as const).filter((f) => d.status[f]);
  const heading = ((((d.body.angle * 180) / Math.PI) % 360) + 360) % 360;
  return (
    <div data-testid="overview" style={{ display: 'grid', gap: 18 }}>
      <Silhouette d={d} recent={recent} />
      <div className="figures">
        <div>
          <b>
            {speed.toFixed(0)}
            <small>u/s</small>
          </b>
          <span>Speed</span>
        </div>
        <div>
          <b>
            {heading.toFixed(0)}
            <small>°</small>
          </b>
          <span>Heading</span>
        </div>
        <div>
          <b>
            {Math.round(d.body.mass)}
            <small>kg</small>
          </b>
          <span>Mass</span>
        </div>
      </div>
      <dl className="kv">
        <dt>Condition</dt>
        <dd className={`text ${flags.length ? 'bad' : ''}`}>{flags.length ? flags.join(', ') : 'nominal'}</dd>
        <dt>Drive command</dt>
        <dd>
          throttle {d.throttle.toFixed(2)} · steer {d.steer.toFixed(2)}
        </dd>
      </dl>
      <Block title="Armament" note={`${d.components.filter((c) => c.weapon && functional(d, c)).length} working`}>
        <table className="ledger" data-testid="weapons-table">
          <thead>
            <tr>
              <th>Mount</th>
              <th>Type</th>
              <th style={{ textAlign: 'right' }}>Ammo</th>
              <th style={{ textAlign: 'right' }}>Heat</th>
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
                  <tr key={c.id} className={`${!ok ? 'dead' : ''} ${recent.has(c.id) ? 'static' : ''}`} title={ws.blockReason ?? ''}>
                    <td className="code">{c.id}</td>
                    <td className="name">{c.def!.name}</td>
                    <td className="n">
                      {ws.mag}/{c.def!.weapon!.magazine} <span className="faint">+{ammoReserve(d, c.def!.weapon!.caliber)}</span>
                    </td>
                    <td className={`n ${c.heat > 100 ? 'bad' : ''}`}>{c.heat.toFixed(0)}</td>
                    <td className={state === 'blocked' || state === 'overheated' || state === 'destroyed' ? 'bad' : ''} style={state === 'firing' ? { fontWeight: 600 } : undefined}>
                      {state}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </Block>
      <Block title="Structure" note="integrity">
        <table className="ledger">
          <tbody>
            {(['front', 'middle', 'rear'] as const).map((pos) => {
              const s = d.sections[pos];
              return (
                <tr key={pos} className={!s.attached || s.destroyed ? 'dead' : ''}>
                  <td className="name" style={{ textTransform: 'capitalize' }}>
                    {pos} <span className="faint">{s.def.name}</span>
                  </td>
                  <td style={{ width: 110 }}>
                    <Meter v={s.hp / s.maxHp} label={`${pos} integrity`} />
                  </td>
                  <td className="n">
                    {s.armor.toFixed(0)}/{s.armorMax} mm
                  </td>
                  <td className="bad">{s.destroyed ? 'lost' : s.attached ? '' : 'detached'}</td>
                </tr>
              );
            })}
            {d.joints.map((j) => (
              <tr key={j.a + j.b} className={!j.intact ? 'dead' : ''}>
                <td className="name">
                  Joint {j.a[0].toUpperCase()}–{j.b[0].toUpperCase()}
                </td>
                <td>
                  <Meter v={j.hp / j.maxHp} label="joint integrity" />
                </td>
                <td className="n" colSpan={2}>
                  {j.intact ? pct(j.hp / j.maxHp) : 'failed'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
      <Block title="Power" note={`${p.generation.toFixed(0)} PU/s generated`}>
        <dl className="kv">
          <dt>Stored</dt>
          <dd>
            {p.stored.toFixed(0)} / {p.capacity.toFixed(0)} PU·s
          </dd>
        </dl>
        {p.capacity > 0 && (
          <div style={{ margin: '6px 0 8px' }}>
            <Meter v={p.stored / p.capacity} label="stored power" />
          </div>
        )}
        <table className="ledger">
          <thead>
            <tr>
              <th>System</th>
              <th style={{ textAlign: 'right' }}>Demand</th>
              <th style={{ textAlign: 'right' }}>Supplied</th>
              <th style={{ textAlign: 'right' }}>Priority</th>
            </tr>
          </thead>
          <tbody>
            {(['systems', 'propulsion', 'weapons', 'shields'] as const).map((c) => (
              <tr key={c}>
                <td>{c}</td>
                <td className="n">{p.demand[c].toFixed(0)}</td>
                <td className={`n ${p.satisfaction[c] < 0.6 ? 'bad' : ''}`}>{pct(p.satisfaction[c])}</td>
                <td className="n">{c === 'systems' ? 'first' : p.allocation[c].toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
      {d.components.some((c) => c.shield) && (
        <Block title="Barriers">
          {d.components
            .filter((c) => c.shield)
            .map((c) => {
              const sh = c.shield!;
              const def = c.def!.shield!;
              const ok = functional(d, c);
              return (
                <div key={c.id} style={{ marginBottom: 8 }}>
                  <div className="num" style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                    <span>{c.id}</span>
                    <span className={!ok || sh.overloadLeft > 0 || !sh.powered ? 'bad' : ''}>
                      {!ok ? 'destroyed' : sh.overloadLeft > 0 ? `overloaded ${sh.overloadLeft.toFixed(1)} s` : !sh.powered ? 'unpowered' : sh.raised ? 'raised' : 'lowered'} · {sh.charge.toFixed(0)}/{def.capacity}
                    </span>
                  </div>
                  <Meter v={sh.charge / def.capacity} label={`${c.id} charge`} />
                </div>
              );
            })}
        </Block>
      )}
      <Block title="Failure record" note={`${d.failures.length} entries`}>
        {d.failures.length === 0 && <p className="note">No failures recorded.</p>}
        {d.failures
          .slice(-12)
          .reverse()
          .map((f, i) => (
            <div key={i} className="num" style={{ fontSize: 12, display: 'grid', gridTemplateColumns: '54px 1fr', gap: 8 }}>
              <span className="faint">{f.time.toFixed(2)}</span>
              <span className={f.type.includes('destroyed') || f.type === 'section-detached' ? 'bad' : ''}>{f.detail}</span>
            </div>
          ))}
      </Block>
    </div>
  );
}

function Components({ d, recent }: { d: Drone; recent: Set<string> }) {
  return (
    <Block title="Component inventory" note={`${d.components.filter((c) => functional(d, c)).length}/${d.components.length} functional`}>
      <table className="ledger" data-testid="components-table">
        <thead>
          <tr>
            <th />
            <th>Id</th>
            <th>Component</th>
            <th style={{ width: 80 }}>Integrity</th>
            <th style={{ textAlign: 'right' }}>Heat</th>
          </tr>
        </thead>
        <tbody>
          {d.components.map((c) => {
            const ok = functional(d, c);
            return (
              <tr key={c.uid} className={`${!ok ? 'dead' : ''} ${recent.has(c.id) ? 'static' : ''}`}>
                <td title={KIND_CODE[c.kind]}>
                  <Glyph kind={c.kind} size={14} />
                </td>
                <td className="code">{c.id}</td>
                <td className="name">{c.name}</td>
                <td>
                  <Meter v={c.hp / c.maxHp} label={`${c.id} integrity`} />
                </td>
                <td className={`n ${c.heat > 100 ? 'bad' : ''}`}>{c.heat.toFixed(0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Block>
  );
}

function Sensors({ d, sim }: { d: Drone; sim: Simulation }) {
  const name = (id: number) => sim.drones.find((x) => x.id === id)?.name ?? `#${id}`;
  return (
    <div data-testid="sensors" style={{ display: 'grid', gap: 18 }}>
      <p className="note">Exactly what this machine's program can perceive, sampled at its last decision (t = {d.perception.time.toFixed(2)} s).</p>
      <Block title="Sensors">
        <table className="ledger">
          <thead>
            <tr>
              <th>Id</th>
              <th>Type</th>
              <th>State</th>
              <th style={{ textAlign: 'right' }}>Arc / range</th>
            </tr>
          </thead>
          <tbody>
            {d.components
              .filter((c) => c.kind === 'sensor')
              .map((c) => (
                <tr key={c.id} className={!functional(d, c) ? 'dead' : ''}>
                  <td className="code">{c.id}</td>
                  <td className="name">{c.def!.name}</td>
                  <td className={!functional(d, c) || d.power.satisfaction.systems < 0.5 ? 'bad' : ''}>{!functional(d, c) ? 'lost' : d.power.satisfaction.systems < 0.5 ? 'unpowered' : 'active'}</td>
                  <td className="n">
                    {c.def!.sensor!.arcDeg}° / {c.def!.sensor!.range}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </Block>
      <Block title="Contacts" note={`${d.perception.contacts.length} held`}>
        <table className="ledger" data-testid="contacts-table">
          <thead>
            <tr>
              <th>Contact</th>
              <th style={{ textAlign: 'right' }}>Dist</th>
              <th style={{ textAlign: 'right' }}>Brg</th>
              <th>Size</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {d.perception.contacts.map((c) => (
              <tr key={c.id}>
                <td className="name" style={c.team === 'enemy' ? { fontWeight: 600 } : undefined}>
                  #{c.id} {name(c.id)} <span className="faint">{c.team}</span>
                </td>
                <td className="n">{c.distance.toFixed(0)}</td>
                <td className="n">{c.bearing.toFixed(0)}°</td>
                <td>{c.size ?? '—'}</td>
                <td className="code">{c.sensors.join(' ')}</td>
              </tr>
            ))}
            {d.perception.contacts.length === 0 && (
              <tr>
                <td colSpan={5} className="faint">
                  No contacts.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Block>
      <Block title="Incoming shells" note={`${d.perception.threats.length} tracked`}>
        {d.perception.threats.length === 0 && <p className="note">None tracked.</p>}
        {d.perception.threats.map((t, i) => (
          <div key={i} className="num" style={{ fontSize: 12 }}>
            {t.distance.toFixed(0)} u · impact in {t.closingTime.toFixed(2)} s
          </div>
        ))}
      </Block>
    </div>
  );
}

const KIND_MARK: Record<TraceEntry['kind'], string> = { branch: '?', call: '◦', command: '▸', log: '“', error: '✕', sim: '!', event: '!' };

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
    <div data-testid="program-trace" style={{ display: 'grid', gap: 18 }}>
      <div>
        <SectionTitle note={ctrl.program.kind.toUpperCase()}>{ctrl.program.name}</SectionTitle>
        <dl className="kv">
          <dt>Execution state</dt>
          <dd className={`text ${ctrl.state === 'ok' ? '' : 'bad'}`}>{ctrl.state}</dd>
          {rec && (
            <>
              <dt>Operations this tick</dt>
              <dd>
                {rec.ops} / {rec.budget}
              </dd>
              <dt>Perception</dt>
              <dd>
                {rec.contacts} contact(s), {rec.threats} shell(s)
              </dd>
            </>
          )}
        </dl>
        {rec && (
          <div style={{ marginTop: 8 }}>
            <Meter v={rec.budget ? rec.ops / rec.budget : 0} inverse critical={0.15} label="operation budget used" />
          </div>
        )}
        {ctrl.lastError && (
          <div className="notice error" style={{ marginTop: 10 }}>
            {ctrl.lastError}
          </div>
        )}
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <SectionTitle note={`${hist.length} recorded`}>Decision history</SectionTitle>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div className="tick-strip" aria-label="Decision ticks" style={{ flex: 1 }}>
            {hist.slice(-120).map((h) => (
              <button key={h.tick} title={`t=${h.time.toFixed(1)}s${h.error ? ` error: ${h.error}` : ''}`} aria-label={`Decision at ${h.time.toFixed(1)} s`} className={`${h.error ? 'err' : ''} ${rec && h.tick === rec.tick ? 'sel' : ''}`} onClick={() => setPinned(h.tick)} />
            ))}
          </div>
          <button className="btn sm" aria-pressed={pinned === null} onClick={() => setPinned(null)}>
            Latest
          </button>
        </div>
      </div>
      {rec ? (
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>
            t = {rec.time.toFixed(2)} s · tick {rec.tick} · {rec.entries.length} entries{rec.dropped ? ` (+${rec.dropped} not recorded)` : ''}
          </div>
          <div data-testid="trace-entries">
            {rec.entries.map((e, i) => (
              <div key={i} className={`trace-entry k-${e.kind} ${selEntry === i ? 'sel' : ''}`} onClick={() => setSelEntry(i)} role="button" tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && setSelEntry(i)}>
                <span className="loc">{describeLoc(e.loc, program)}</span>
                <span className="txt">
                  <span className="k">{KIND_MARK[e.kind]}</span>
                  {e.text}
                </span>
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
        <p className="note">No decisions yet — press Play or Step.</p>
      )}
      {loc && loc.kind !== 'none' && (
        <div>
          <SectionTitle note={describeLoc(loc, program)}>Source</SectionTitle>
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
            <div className="num" style={{ fontSize: 12 }}>
              {describeLoc(loc, program)} <span className="faint">({loc.id})</span>
            </div>
          )}
          <button className="btn sm" style={{ marginTop: 8 }} onClick={() => navigate({ tab: 'programs', programId: ctrl.program.id, highlight: loc })}>
            Show in editor
          </button>
          {JSON.stringify(program) !== JSON.stringify(ctrl.program) && (
            <p className="note" style={{ marginTop: 6 }}>
              The record has been edited since deployment; this machine runs the deployed version.
            </p>
          )}
        </div>
      )}
      <Block title="Failures seen by the program">
        {d.failures.length === 0 ? (
          <p className="note">None.</p>
        ) : (
          d.failures.slice(-6).map((f, i) => (
            <div key={i} className="num" style={{ fontSize: 12 }}>
              {f.time.toFixed(2)} {f.type}: {f.detail}
            </div>
          ))
        )}
      </Block>
    </div>
  );
}
