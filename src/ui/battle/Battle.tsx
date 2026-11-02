import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { compileProgram } from '../../program/compile';
import { pickDrone, Renderer, screenToWorld, TEAM_COLORS, type Camera } from '../../render/renderer';
import type { Quality } from '../../render/vfx';
import { hasErrors, validateDesign } from '../../sim/design';
import { comWorld } from '../../sim/drone';
import type { SimEvent } from '../../sim/types';
import { defaultArena, type ScenarioConfig } from '../../sim/world';
import { useLibrary, type Library } from '../store';
import { Inspector } from './Inspector';
import { SimRunner, SPEEDS } from './runner';

interface Entry {
  key: number;
  team: number;
  designId: string;
  programId: string;
}

const TEAM_NAMES = ['Blue', 'Orange', 'Green', 'Purple'];

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
      return `Battle ended: ${e.winner === null ? 'no winner' : `${TEAM_NAMES[e.winner]} team wins`} — ${e.reason}`;
    default:
      return e.type;
  }
}

const eventDrone = (e: SimEvent): number | null =>
  'drone' in e && typeof e.drone === 'number' ? e.drone : e.type === 'intercept' ? e.by : null;

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
  const [, setTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ x: 900, y: 550, zoom: 0.6 });
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
  const canDeploy = entries.length >= 1 && problems.every((p) => p.length === 0) && (mode !== 'duel' || (entries.length === 2 && entries[0].team !== entries[1].team));

  const deploy = () => {
    if (!canDeploy) return;
    const cfg: ScenarioConfig = {
      seed,
      arena: defaultArena(),
      mode,
      timeLimit,
      decisionHz,
      drones: entries.map((en) => ({ design: lib.designs.find((x) => x.id === en.designId)!, program: lib.programs.find((x) => x.id === en.programId)! , team: en.team })),
    };
    runner.pause();
    runner.load(JSON.parse(JSON.stringify(cfg)) as ScenarioConfig);
    setSelected(null);
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
    let fitted = false;
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
      if (!fitted && rect.width > 0 && runner.sim) {
        fitted = true;
        const A = runner.sim.arena;
        c.zoom = Math.min(rect.width / A.width, rect.height / A.height) * 0.94;
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
    setSelected(d ? d.id : null);
    if (d) setFollow(true);
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

  const sim = runner.sim;
  const nameOf = (id: number) => sim?.drones.find((d) => d.id === id)?.name ?? `#${id}`;
  const log = sim ? sim.log.filter((e) => !logFilter || selected === null || eventDrone(e) === selected || (e.type === 'impact' && e.shooter === selected)).slice(-250) : [];
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 40) el.scrollTop = el.scrollHeight;
  });

  const setEntry = (i: number, patch: Partial<Entry>) => setEntries((es) => es.map((x, k) => (k === i ? { ...x, ...patch } : x)));

  return (
    <div className="view battle" data-testid="battle">
      <aside className="panel">
        <div className="panel-head">
          <h2>Scenario</h2>
        </div>
        <div className="panel-body">
          <div className="seg" role="group" aria-label="Mode" style={{ marginBottom: 10 }}>
            <button className={mode === 'duel' ? 'on' : ''} onClick={() => { setMode('duel'); setEntries((es) => (es.length >= 2 ? [es[0], { ...es[1], team: es[0].team === 1 ? 0 : 1 }] : defaultEntries(lib))); }}>
              Duel
            </button>
            <button className={mode === 'sandbox' ? 'on' : ''} onClick={() => setMode('sandbox')}>Sandbox</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
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
                  <option key={h} value={h}>{h} Hz</option>
                ))}
              </select>
            </label>
          </div>
          <div className="section-title">Combatants</div>
          {entries.map((en, i) => (
            <div key={en.key} className="roster-entry" data-testid={`roster-${i}`}>
              <div className="row">
                <span className="muted">Team</span>
                <select aria-label={`Team ${i + 1}`} value={en.team} onChange={(e) => setEntry(i, { team: Number(e.target.value) })}>
                  {(mode === 'duel' ? [0, 1] : [0, 1, 2, 3]).map((t) => (
                    <option key={t} value={t}>{TEAM_NAMES[t]}</option>
                  ))}
                </select>
              </div>
              <div className="row">
                <span className="muted">Design</span>
                <select aria-label={`Design ${i + 1}`} value={en.designId} onChange={(e) => setEntry(i, { designId: e.target.value })}>
                  {lib.designs.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
              <div className="row">
                <span className="muted">Program</span>
                <select aria-label={`Program ${i + 1}`} value={en.programId} onChange={(e) => setEntry(i, { programId: e.target.value })}>
                  {lib.programs.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} · {p.kind}</option>
                  ))}
                </select>
              </div>
              {problems[i]?.map((p) => (
                <div key={p} className="issue error">{p}</div>
              ))}
              {mode === 'sandbox' && (
                <button className="btn small danger" onClick={() => setEntries((es) => es.filter((_, k) => k !== i))}>Remove</button>
              )}
            </div>
          ))}
          {mode === 'sandbox' && entries.length < 6 && (
            <button className="btn small" style={{ marginBottom: 10 }} onClick={() => setEntries((es) => [...es, { key: Date.now(), team: es.length % 2, designId: lib.designs[0]?.id ?? '', programId: lib.programs[0]?.id ?? '' }])}>
              Add drone
            </button>
          )}
          {mode === 'duel' && entries.length === 2 && entries[0].team === entries[1].team && <div className="issue error">A duel needs two different teams.</div>}
          <button className="btn primary" style={{ width: '100%', marginTop: 4 }} disabled={!canDeploy} onClick={deploy}>
            Deploy
          </button>
          <div className="section-title">Other modes</div>
          <div className="unavailable">Team Battle, Fleet Battle, Challenges, Tournament and Replay Laboratory are not available yet (later phases).</div>
          {sim && (
            <>
              <div className="section-title">Drones</div>
              <div className="list" data-testid="drone-list">
                {sim.drones.map((d) => (
                  <div key={d.id} className={`list-item ${selected === d.id ? 'selected' : ''}`} onClick={() => { setSelected(d.id); setFollow(true); }}>
                    <span className="team-dot" style={{ background: TEAM_COLORS[d.team % 4] }} />
                    <span>{d.name}</span>
                    <span className={`sub ${d.status.disabled || d.status.destroyed ? 'bad' : d.status.label === 'Operational' ? 'ok' : 'warn'}`}>{d.status.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </aside>

      <section className="battle-center">
        <div className="sim-controls" data-testid="sim-controls">
          <button className="btn primary" style={{ minWidth: 70 }} onClick={() => runner.toggle()} disabled={!sim} aria-label={runner.playing ? 'Pause' : 'Play'}>
            {runner.playing ? 'Pause' : 'Play'}
          </button>
          <button className="btn" onClick={() => runner.stepTick()} disabled={!sim} title="Advance one 1/60 s physics tick (.)">Step tick</button>
          <button className="btn" onClick={() => runner.stepDecision()} disabled={!sim} title="Advance to the next decision update (,)">Step decision</button>
          <button className="btn" onClick={() => { runner.restart(); }} disabled={!sim} title="Restart from the deployed configuration">Restart</button>
          <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            Speed
            <select aria-label="Speed" value={runner.speed} onChange={(e) => runner.setSpeed(Number(e.target.value))}>
              {SPEEDS.map((s) => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>
          </label>
          <span className="clock" data-testid="sim-clock">
            t = {sim ? sim.time.toFixed(2) : '0.00'} s
          </span>
          <span className="faint mono" style={{ fontSize: 11 }} data-testid="sim-tick">tick {sim?.tick ?? 0}</span>
          <span style={{ flex: 1 }} />
          <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            Effects
            <select aria-label="Effects quality" value={quality} onChange={(e) => setQuality(e.target.value as Quality)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Sound
          </label>
        </div>
        <div className="canvas-wrap">
          <canvas ref={canvasRef} data-testid="battle-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel} />
          <div className="cam-mode">
            <button className={`btn small ${selected === null ? 'active' : ''}`} onClick={() => setSelected(null)}>Freecam</button>
            {selected !== null && (
              <>
                <button className={`btn small ${follow ? 'active' : ''}`} onClick={() => setFollow((f) => !f)}>Follow</button>
                <button className={`btn small ${sensorView ? 'active' : ''}`} onClick={() => setSensorView((s) => !s)} title="Show only what the selected drone's sensors perceive">Sensor view</button>
                <button className={`btn small ${showSensors ? 'active' : ''}`} onClick={() => setShowSensors((s) => !s)}>Sensor cones</button>
                <button className={`btn small ${showArcs ? 'active' : ''}`} onClick={() => setShowArcs((s) => !s)}>Weapon arcs</button>
              </>
            )}
          </div>
          {sim?.result && (
            <div className="overlay-banner" data-testid="result-banner">
              <b>{sim.result.winner === null ? 'No winner' : `${TEAM_NAMES[sim.result.winner]} team wins`}</b> at {sim.result.time.toFixed(1)} s
              <div className="muted" style={{ fontSize: 12 }}>{sim.result.reason}</div>
            </div>
          )}
          <div className="cam-hint">Drag / WASD pan · wheel zoom · click a drone to spectate · Esc freecam · Space play/pause · “.” tick · “,” decision</div>
        </div>
        <div className="event-log" ref={logRef} data-testid="event-log">
          <label className="muted" style={{ position: 'sticky', top: 0, float: 'right', background: '#000', fontFamily: 'var(--sans)', fontSize: 11 }}>
            <input type="checkbox" checked={logFilter} onChange={(e) => setLogFilter(e.target.checked)} /> selected drone only
          </label>
          {log.length === 0 && <div className="faint">Combat events appear here.</div>}
          {log.map((e, i) => {
            const id = eventDrone(e);
            return (
              <div key={i} className="row" onClick={() => id !== null && setSelected(id)}>
                <span className="t">{e.t.toFixed(2)}</span>
                <span className={e.type === 'program-error' || e.type === 'component-destroyed' || e.type === 'section-destroyed' ? 'warn' : e.type === 'battle-end' ? 'ok' : ''}>{describeEvent(e, nameOf)}</span>
              </div>
            );
          })}
        </div>
      </section>

      <Inspector sim={sim} runner={runner} selected={selected} onSelect={setSelected} />
    </div>
  );
}
