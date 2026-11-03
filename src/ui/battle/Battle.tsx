import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { compileProgram } from '../../program/compile';
import { pickDrone, Renderer, screenToWorld, type Camera } from '../../render/renderer';
import type { Quality } from '../../render/vfx';
import { hasErrors, validateDesign } from '../../sim/design';
import { comWorld } from '../../sim/drone';
import type { SimEvent } from '../../sim/types';
import { defaultArena, type ScenarioConfig } from '../../sim/world';
import { useResizableWidth } from '../common';
import { useLibrary, type Library } from '../store';
import { C, TEAM_COLOR, TEAM_NAME } from '../theme';
import { Inspector } from './Inspector';
import { SimRunner, SPEEDS } from './runner';

interface Entry {
  key: number;
  team: number;
  designId: string;
  programId: string;
}

function defaultEntries(lib: Library): Entry[] {
  const d = (id: string) => lib.designs.find((x) => x.id === id)?.id ?? lib.designs[0]?.id ?? '';
  const p = (id: string) => lib.programs.find((x) => x.id === id)?.id ?? lib.programs[0]?.id ?? '';
  return [
    { key: 1, team: 0, designId: d('example-assault'), programId: p('example-assault-code') },
    { key: 2, team: 1, designId: d('example-aa-destroyer'), programId: p('example-aa-blocks') },
  ];
}

export function describeEvent(e: SimEvent, name: (id: number) => string): string {
  switch (e.type) {
    case 'impact':
      return `${e.shooter !== undefined ? name(e.shooter) : '?'} ${e.weapon ?? ''} → ${e.drone !== null ? name(e.drone) : 'terrain'}${e.section ? ` ${e.section}` : ''}${e.component ? ` [${e.component}]` : ''}: ${e.result}${e.penetration !== undefined ? ` (pen ${e.penetration.toFixed(0)} vs ${e.effectiveArmor?.toFixed(0)} mm${e.angleDeg !== undefined ? ` @ ${e.angleDeg.toFixed(0)}°` : ''})` : ''}`;
    case 'component-destroyed':
      return `${name(e.drone)}: ${e.component} (${e.kind}) destroyed`;
    case 'section-destroyed':
      return `${name(e.drone)}: ${e.section} section structurally destroyed`;
    case 'detached':
      return `${name(e.drone)}: ${e.sections.join(' + ')} detached`;
    case 'shield-overload':
      return `${name(e.drone)}: shield ${e.component} overloaded`;
    case 'intercept':
      return `${name(e.by)} point defense intercepted a shell`;
    case 'cookoff':
      return `${name(e.drone)}: ammunition cook-off in ${e.component}`;
    case 'status':
      return `${name(e.drone)} is now ${e.label}`;
    case 'program-error':
      return `${name(e.drone)} program error: ${e.message}`;
    case 'battle-end':
      return `Battle ended: ${e.winner === null ? 'no winner' : `${TEAM_NAME[e.winner]} team wins`} — ${e.reason}`;
    default:
      return e.type;
  }
}

/** Timeline marker colour by what happened. */
function eventColor(e: SimEvent): string {
  switch (e.type) {
    case 'impact':
      return e.result === 'penetration' || e.result === 'component-hit' ? C.pink : e.result === 'shield' ? C.violet : C.slate;
    case 'component-destroyed':
    case 'section-destroyed':
    case 'cookoff':
    case 'detached':
      return C.red;
    case 'shield-overload':
      return C.violet;
    case 'intercept':
      return C.teal;
    case 'status':
      return C.yellow;
    case 'program-error':
      return C.orange;
    case 'battle-end':
      return C.paper;
    default:
      return C.slate;
  }
}

const eventDrone = (e: SimEvent): number | null => ('drone' in e && typeof e.drone === 'number' ? e.drone : e.type === 'intercept' ? e.by : null);

const stateTone = (label: string, disabled: boolean) => (disabled ? 'err' : label === 'Operational' ? 'ok' : 'warn');

export function Battle({ active }: { active: boolean }) {
  const lib = useLibrary();
  const runnerRef = useRef<SimRunner>();
  if (!runnerRef.current) runnerRef.current = new SimRunner();
  const runner = runnerRef.current;
  useSyncExternalStore(runner.subscribe.bind(runner), runner.getVersion);

  const [mode, setMode] = useState<'duel' | 'sandbox'>('duel');
  const [seed, setSeed] = useState(1);
  const [timeLimit, setTimeLimit] = useState(180);
  const [decisionHz, setDecisionHz] = useState(10);
  const [entries, setEntries] = useState<Entry[]>(() => defaultEntries(lib));
  const [selected, setSelected] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [sensorView, setSensorView] = useState(false);
  const [showArcs, setShowArcs] = useState(true);
  const [showSensors, setShowSensors] = useState(true);
  const [quality, setQuality] = useState<Quality>('medium');
  const [sound, setSound] = useState(false);
  const [logFilter, setLogFilter] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(true);
  const [rosterTab, setRosterTab] = useState<'drones' | 'scenario'>('drones');
  const [debugOpen, setDebugOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const insp = useResizableWidth('battle', 380, 320, 640);
  const [, setTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ x: 900, y: 550, zoom: 0.6 });
  const fitRequest = useRef(true);
  const keys = useRef(new Set<string>());
  const view = useRef({ selected, follow, sensorView, showArcs, showSensors });
  view.current = { selected, follow, sensorView, showArcs, showSensors };

  const problems = useMemo(
    () =>
      entries.map((en) => {
        const d = lib.designs.find((x) => x.id === en.designId);
        const p = lib.programs.find((x) => x.id === en.programId);
        const out: string[] = [];
        if (!d) out.push('No design selected');
        else if (hasErrors(validateDesign(d))) out.push(`Design "${d.name}" has construction errors (see Hangar)`);
        if (!p) out.push('No program selected');
        else {
          const c = compileProgram(p);
          if (!c.ok) out.push(`Program "${p.name}" does not compile: ${c.errors[0]?.message}`);
        }
        return out;
      }),
    [entries, lib],
  );
  const duelTeamsOk = mode !== 'duel' || (entries.length === 2 && entries[0].team !== entries[1].team);
  const canDeploy = entries.length >= 1 && problems.every((p) => p.length === 0) && duelTeamsOk;

  const deploy = () => {
    if (!canDeploy) return;
    const cfg: ScenarioConfig = {
      seed,
      arena: defaultArena(),
      mode,
      timeLimit,
      decisionHz,
      drones: entries.map((en) => ({ design: lib.designs.find((x) => x.id === en.designId)!, program: lib.programs.find((x) => x.id === en.programId)!, team: en.team })),
    };
    runner.pause();
    runner.load(JSON.parse(JSON.stringify(cfg)) as ScenarioConfig);
    setSelected(null);
    setRosterTab('drones');
    fitRequest.current = true;
  };

  // Deploy the example duel on first load so the battlefield is never empty.
  useEffect(() => {
    if (!runner.sim && canDeploy) deploy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Panels refresh at ~8 Hz; the canvas renders every frame.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 125);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    runner.vfx.quality = quality;
  }, [quality, runner]);
  useEffect(() => {
    runner.audio.setMuted(!sound);
  }, [sound, runner]);

  // Render loop
  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const renderer = new Renderer(ctx);
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(rect.width * dpr) || canvas.height !== Math.round(rect.height * dpr)) {
        canvas.width = Math.round(rect.width * dpr);
        canvas.height = Math.round(rect.height * dpr);
      }
      const c = cam.current;
      if (fitRequest.current && rect.width > 0 && runner.sim) {
        fitRequest.current = false;
        const A = runner.sim.arena;
        c.zoom = Math.min(rect.width / A.width, rect.height / A.height) * 0.95;
        c.x = A.width / 2;
        c.y = A.height / 2;
      }
      const pan = 600 / c.zoom;
      const k = keys.current;
      let manual = false;
      if (k.has('w') || k.has('arrowup')) (c.y -= pan * dt), (manual = true);
      if (k.has('s') || k.has('arrowdown')) (c.y += pan * dt), (manual = true);
      if (k.has('a') || k.has('arrowleft')) (c.x -= pan * dt), (manual = true);
      if (k.has('d') || k.has('arrowright')) (c.x += pan * dt), (manual = true);
      if (manual && view.current.follow) setFollow(false);
      const stepped = runner.advance(dt);
      const sim = runner.sim;
      if (sim) {
        const v = view.current;
        const sel = v.selected !== null ? sim.drones.find((d) => d.id === v.selected) : undefined;
        if (sel && v.follow) {
          const p = comWorld(sel.body);
          c.x += (p.x - c.x) * Math.min(1, dt * 6);
          c.y += (p.y - c.y) * Math.min(1, dt * 6);
        }
        runner.listener = { x: c.x, y: c.y, range: 700 / Math.max(0.3, c.zoom) };
        runner.vfx.update(sim, runner.playing ? dt * runner.speed : stepped ? dt : 0);
        renderer.draw(sim, c, runner.vfx, { selected: v.selected, sensorView: v.sensorView, showArcs: v.showArcs, showSensors: v.showSensors, labels: true }, rect.width, rect.height, dpr);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, runner]);

  // Keyboard: camera pan, space = play/pause, period = step, escape = freecam
  useEffect(() => {
    if (!active) return;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        keys.current.add(key);
        e.preventDefault();
      } else if (key === ' ') {
        runner.toggle();
        e.preventDefault();
      } else if (key === '.') runner.stepTick();
      else if (key === ',') runner.stepDecision();
      else if (key === 'escape') setSelected(null);
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keys.current.clear();
    };
  }, [active, runner]);

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const dr = drag.current;
    if (!dr) return;
    const dx = e.clientX - dr.x;
    const dy = e.clientY - dr.y;
    if (!dr.moved && Math.hypot(dx, dy) < 4) return;
    dr.moved = true;
    cam.current.x -= dx / cam.current.zoom;
    cam.current.y -= dy / cam.current.zoom;
    dr.x = e.clientX;
    dr.y = e.clientY;
    if (follow) setFollow(false);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const dr = drag.current;
    drag.current = null;
    if (!dr || dr.moved || !runner.sim) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const w = screenToWorld(cam.current, rect.width, rect.height, e.clientX - rect.left, e.clientY - rect.top);
    const d = pickDrone(runner.sim, w.x, w.y);
    select(d ? d.id : null);
  };
  const onWheel = (e: React.WheelEvent) => {
    const c = cam.current;
    const rect = canvasRef.current!.getBoundingClientRect();
    const before = screenToWorld(c, rect.width, rect.height, e.clientX - rect.left, e.clientY - rect.top);
    c.zoom = Math.min(6, Math.max(0.2, c.zoom * Math.exp(-e.deltaY * 0.0015)));
    const after = screenToWorld(c, rect.width, rect.height, e.clientX - rect.left, e.clientY - rect.top);
    c.x += before.x - after.x;
    c.y += before.y - after.y;
  };
  const select = (id: number | null) => {
    setSelected(id);
    if (id !== null) {
      setFollow(true);
      setDebugOpen(true);
    }
  };

  const sim = runner.sim;
  const nameOf = (id: number) => sim?.drones.find((d) => d.id === id)?.name ?? `#${id}`;
  const fullLog = sim ? sim.log : [];
  const log = fullLog.filter((e) => !logFilter || selected === null || eventDrone(e) === selected || (e.type === 'impact' && e.shooter === selected)).slice(-300);
  const latest = fullLog[fullLog.length - 1];
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 40) el.scrollTop = el.scrollHeight;
  });
  const selDrone = sim && selected !== null ? sim.drones.find((d) => d.id === selected) : undefined;

  const setEntry = (i: number, patch: Partial<Entry>) => setEntries((es) => es.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  return (
    <div className="battle" data-testid="battle" style={insp.style}>
      <div className="sim-bar" data-testid="sim-controls" role="toolbar" aria-label="Simulation controls">
        <button className="btn small quiet" aria-pressed={rosterOpen} onClick={() => setRosterOpen((o) => !o)} title="Show or hide the roster and scenario panel">
          Roster
        </button>
        <span className="divider" />
        <button className="btn go" style={{ minWidth: 82 }} onClick={() => runner.toggle()} disabled={!sim} aria-label={runner.playing ? 'Pause' : 'Play'}>
          {runner.playing ? 'Pause' : 'Play'}
        </button>
        <button className="btn small quiet" onClick={() => runner.stepTick()} disabled={!sim} title="Advance one 1/60 s physics tick (.)">
          Step tick
        </button>
        <button className="btn small quiet" onClick={() => runner.stepDecision()} disabled={!sim} title="Advance to the next decision update (,)">
          Step decision
        </button>
        <button className="btn small quiet" onClick={() => runner.restart()} disabled={!sim} title="Restart from the deployed configuration">
          Restart
        </button>
        <div className="seg dense" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={runner.speed === s} className={runner.speed === s ? 'on' : ''} onClick={() => runner.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <span className="clock" data-testid="sim-clock">
          t = {sim ? sim.time.toFixed(2) : '0.00'} s
          <small data-testid="sim-tick">tick {sim?.tick ?? 0}</small>
        </span>
        <span className="grow" />
        <label className="toggle hide-sm" title="Particle effects quality">
          Effects
          <select aria-label="Effects quality" value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </label>
        <label className="toggle">
          <input type="checkbox" className="switch" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Sound
        </label>
        <span className="divider" />
        <button className="btn small quiet" aria-pressed={timelineOpen} onClick={() => setTimelineOpen((o) => !o)}>
          Timeline
        </button>
        <button className="btn small quiet" aria-pressed={debugOpen} onClick={() => setDebugOpen((o) => !o)} title="Show or hide the drone inspector and debugger">
          Debugger
        </button>
      </div>

      <div className="battle-body">
        <aside className="dock left" hidden={!rosterOpen} aria-label="Roster">
          <div className="insp-tabs" role="tablist">
            <button role="tab" aria-selected={rosterTab === 'drones'} className={rosterTab === 'drones' ? 'on' : ''} onClick={() => setRosterTab('drones')}>
              Drones {sim && <span className="muted">({sim.drones.length})</span>}
            </button>
            <button role="tab" aria-selected={rosterTab === 'scenario'} className={rosterTab === 'scenario' ? 'on' : ''} onClick={() => setRosterTab('scenario')}>
              Scenario
            </button>
          </div>
          <div className="insp-body">
            {rosterTab === 'drones' && (
              <>
                {sim ? (
                  <div className="items" data-testid="drone-list" style={{ gap: 6 }}>
                    {sim.drones.map((d) => {
                      const ctrl = sim.controllers.get(d.id)!;
                      return (
                        <button key={d.id} className={`drone-item ${selected === d.id ? 'sel' : ''}`} style={{ ['--c' as string]: TEAM_COLOR[d.team % 4] }} onClick={() => select(d.id)} aria-pressed={selected === d.id}>
                          <span className="tdot" />
                          <b>{d.name}</b>
                          <span className="mini">
                            <span className={`state-tag ${stateTone(d.status.label, d.status.disabled || d.status.destroyed)}`}>{d.status.label}</span>
                            <span className="muted">{TEAM_NAME[d.team]}</span>
                            {ctrl.state !== 'ok' && <span className="state-tag err">{ctrl.state}</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="insp-note">Nothing deployed yet.</p>
                )}
                <button className="btn small quiet wide" onClick={() => setRosterTab('scenario')}>
                  Change scenario…
                </button>
                <p className="insp-note">Selecting a drone spectates it. It never takes control — drones act only on their own programs.</p>
              </>
            )}
            {rosterTab === 'scenario' && (
              <>
                <div className="seg" role="group" aria-label="Mode">
                  <button
                    className={mode === 'duel' ? 'on' : ''}
                    onClick={() => {
                      setMode('duel');
                      setEntries((es) => (es.length >= 2 ? [es[0], { ...es[1], team: es[0].team === 1 ? 0 : 1 }] : defaultEntries(lib)));
                    }}
                  >
                    Duel
                  </button>
                  <button className={mode === 'sandbox' ? 'on' : ''} onClick={() => setMode('sandbox')}>
                    Sandbox
                  </button>
                </div>
                <div className="field-row">
                  <label className="field">
                    Seed
                    <input type="number" aria-label="Seed" value={seed} onChange={(e) => setSeed(Math.floor(Number(e.target.value) || 0))} />
                  </label>
                  <label className="field">
                    Limit (s)
                    <input type="number" aria-label="Time limit" value={timeLimit} min={0} onChange={(e) => setTimeLimit(Math.max(0, Number(e.target.value) || 0))} />
                  </label>
                  <label className="field">
                    Decisions
                    <select aria-label="Decision rate" value={decisionHz} onChange={(e) => setDecisionHz(Number(e.target.value))}>
                      {[5, 10, 20, 30].map((h) => (
                        <option key={h} value={h}>
                          {h} Hz
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {entries.map((en, i) => (
                    <div key={en.key} className="roster-card" data-testid={`roster-${i}`} style={{ ['--c' as string]: TEAM_COLOR[en.team % 4] }}>
                      <div className="row">
                        Team
                        <select aria-label={`Team ${i + 1}`} value={en.team} onChange={(e) => setEntry(i, { team: Number(e.target.value) })}>
                          {(mode === 'duel' ? [0, 1] : [0, 1, 2, 3]).map((t) => (
                            <option key={t} value={t}>
                              {TEAM_NAME[t]}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="row">
                        Design
                        <select aria-label={`Design ${i + 1}`} value={en.designId} onChange={(e) => setEntry(i, { designId: e.target.value })}>
                          {lib.designs.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="row">
                        Program
                        <select aria-label={`Program ${i + 1}`} value={en.programId} onChange={(e) => setEntry(i, { programId: e.target.value })}>
                          {lib.programs.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name} · {p.kind}
                            </option>
                          ))}
                        </select>
                      </div>
                      {problems[i]?.map((p) => (
                        <div key={p} className="issue error">
                          {p}
                        </div>
                      ))}
                      {mode === 'sandbox' && (
                        <button className="btn small danger" onClick={() => setEntries((es) => es.filter((_, k) => k !== i))}>
                          Remove
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                {mode === 'sandbox' && entries.length < 6 && (
                  <button className="btn small quiet" onClick={() => setEntries((es) => [...es, { key: Date.now(), team: es.length % 2, designId: lib.designs[0]?.id ?? '', programId: lib.programs[0]?.id ?? '' }])}>
                    + Add drone
                  </button>
                )}
                {!duelTeamsOk && <div className="issue error">A duel needs two different teams.</div>}
                <button className="btn go wide" disabled={!canDeploy} onClick={deploy}>
                  Deploy
                </button>
                <div className="unavailable">Team Battle, Fleet Battle, Challenges, Tournament and Replay Laboratory are not available yet (later phases).</div>
              </>
            )}
          </div>
        </aside>

        <section className="field-wrap">
          <div className="canvas-wrap">
            <canvas ref={canvasRef} data-testid="battle-canvas" aria-label="Battlefield" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel} />
            <div className="hud tl">
              {selDrone ? (
                <>
                  <span className="spectate-chip" style={{ ['--c' as string]: TEAM_COLOR[selDrone.team % 4] }}>
                    <span className="tdot" />
                    Spectating {selDrone.name}
                    <button className="btn small quiet" onClick={() => setSelected(null)} title="Return to freecam (Esc)">
                      Freecam
                    </button>
                  </span>
                  <button className="btn small" aria-pressed={follow} onClick={() => setFollow((f) => !f)}>
                    Follow
                  </button>
                  <button className="btn small" aria-pressed={sensorView} onClick={() => setSensorView((s) => !s)} title="Show only what the selected drone's sensors perceive">
                    Sensor view
                  </button>
                  <button className="btn small" aria-pressed={showSensors} onClick={() => setShowSensors((s) => !s)}>
                    Sensor cones
                  </button>
                  <button className="btn small" aria-pressed={showArcs} onClick={() => setShowArcs((s) => !s)}>
                    Weapon arcs
                  </button>
                </>
              ) : (
                <>
                  <button className="btn small on" aria-pressed="true">
                    Freecam
                  </button>
                  <span className="hud-chip">Click a drone to spectate it</span>
                </>
              )}
              <span style={{ flex: 1 }} />
              <button className="btn small quiet" onClick={() => ((fitRequest.current = true), setFollow(false))} title="Fit the whole arena in view">
                Fit arena
              </button>
            </div>
            {sim?.result && (
              <div className="result-banner" data-testid="result-banner" role="status">
                <b>{sim.result.winner === null ? 'No winner' : `${TEAM_NAME[sim.result.winner]} team wins`}</b> at {sim.result.time.toFixed(1)} s<div>{sim.result.reason}</div>
              </div>
            )}
            <div className="hud bl">
              <button className="btn small quiet" aria-expanded={keysOpen} onClick={() => setKeysOpen((o) => !o)}>
                Controls ?
              </button>
              {keysOpen && (
                <span className="hud-chip">
                  <b>Drag</b>/<b>WASD</b> pan · <b>wheel</b> zoom · <span className="kbd">Space</span> play · <span className="kbd">.</span> tick · <span className="kbd">,</span> decision · <span className="kbd">Esc</span> freecam
                </span>
              )}
            </div>
            {sim && (
              <div className="hud br">
                {[...new Set(sim.drones.map((d) => d.team))].map((t) => {
                  const alive = sim.drones.filter((d) => d.team === t && !d.status.disabled && !d.status.destroyed).length;
                  const all = sim.drones.filter((d) => d.team === t).length;
                  return (
                    <span key={t} className="hud-chip" style={{ borderLeft: `6px solid ${TEAM_COLOR[t % 4]}` }}>
                      <b>{TEAM_NAME[t]}</b> {alive}/{all} active
                    </span>
                  );
                })}
              </div>
            )}
          </div>
          <div className="timeline" data-testid="event-log">
            <div className="timeline-head">
              <button className="btn small quiet" aria-expanded={timelineOpen} onClick={() => setTimelineOpen((o) => !o)}>
                {timelineOpen ? '▾' : '▸'} Events <span className="muted">({fullLog.length})</span>
              </button>
              <span className="latest" aria-live="polite">
                {latest ? (
                  <>
                    <span style={{ color: C.slate }}>{latest.t.toFixed(2)}s</span> {describeEvent(latest, nameOf)}
                  </>
                ) : (
                  'Combat events appear here.'
                )}
              </span>
              {timelineOpen && (
                <label className="toggle">
                  <input type="checkbox" className="switch" checked={logFilter} onChange={(e) => setLogFilter(e.target.checked)} /> selected drone only
                </label>
              )}
            </div>
            {timelineOpen && (
              <div className="timeline-body" ref={logRef}>
                {log.length === 0 && <div className="muted">No events yet.</div>}
                {log.map((e, i) => {
                  const id = eventDrone(e);
                  return (
                    <div key={i} className="ev" style={{ ['--c' as string]: eventColor(e) }} onClick={() => id !== null && select(id)}>
                      <span className="t">{e.t.toFixed(2)}</span>
                      <span className="k" />
                      <span className="txt">{describeEvent(e, nameOf)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {debugOpen && <Inspector sim={sim} runner={runner} selected={selected} onSelect={select} width={insp.width} onResize={insp.setWidth} />}
      </div>
    </div>
  );
}
