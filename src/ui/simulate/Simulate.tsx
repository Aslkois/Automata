// SIMULATE — the battlefield is the screen. Instruments float over it and stay compact;
// selecting a drone opens its spectator card, deselecting returns to freecam.
import { useEffect, useMemo, useRef, useState } from 'react';
import { pickDrone, Renderer, screenToWorld, type Camera } from '../../render/renderer';
import type { Quality } from '../../render/vfx';
import { BUSES, type CombatAudio } from '../../render/audio';
import { TRAINING_MAP, TRAININGS, type TrainingId } from '../../data/training';
import { comWorld } from '../../sim/drone';
import type { Drone } from '../../sim/types';
import { useShell } from '../App';
import { Icon, Kbd, Segments, useDismiss, useStoredState } from '../common';
import { useLibrary } from '../store';
import { TEAMS } from '../theme';
import { describeEvent, eventDrone, severity } from './events';
import { SPEEDS } from './runner';
import { useSession, type Scenario } from './session';
import { Spectator } from './Spectator';

export const integrity = (d: Drone) => (['rear', 'middle', 'front'] as const).map((p) => (d.sections[p].attached ? d.sections[p].hp / d.sections[p].maxHp : 0)) as [number, number, number];

export function Simulate({ active }: { active: boolean }) {
  const lib = useLibrary();
  const { test } = useShell();
  const { runner, session } = useSession();
  const [selected, setSelected] = useState<number | null>(null);
  const [follow, setFollow] = useState(true);
  const [sensorView, setSensorView] = useState(false);
  const [showArcs, setShowArcs] = useStoredState('sim-arcs', true);
  const [showSensors, setShowSensors] = useStoredState('sim-cones', true);
  const [quality, setQuality] = useStoredState<Quality>('sim-quality', 'medium');
  const [sound, setSound] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [listOpen, setListOpen] = useStoredState('sim-list', true);
  const [events, setEvents] = useState(false);
  const [eventsMine, setEventsMine] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const [, setTick] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef<Camera>({ x: 900, y: 550, zoom: 0.6 });
  const fitRequest = useRef(true);
  const keys = useRef(new Set<string>());
  const view = useRef({ selected, follow, sensorView, showArcs, showSensors });
  view.current = { selected, follow, sensorView, showArcs, showSensors };
  const scenario = session.scenario(lib);

  // Deploy on first open so the field is never empty; and on "Test" from another workspace.
  useEffect(() => {
    if (!runner.sim) {
      session.deploy(lib, scenario);
      fitRequest.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const lastTest = useRef(0);
  useEffect(() => {
    if (!test || test.nonce === lastTest.current) return;
    lastTest.current = test.nonce;
    const opponent = lib.designs.find((d) => d.id !== test.designId && d.id === scenario.roster.find((r) => r.designId !== test.designId)?.designId) ?? lib.designs.find((d) => d.id !== test.designId);
    const s: Scenario = { ...scenario, mode: opponent ? 'duel' : 'sandbox', roster: [{ key: Date.now(), team: 0, designId: test.designId }, ...(opponent ? [{ key: Date.now() + 1, team: 1, designId: opponent.id }] : [])] };
    if (session.deploy(lib, s)) {
      fitRequest.current = true;
      setSelected(null);
      runner.play();
    } else {
      session.setScenario(s);
      setSheet(true);
    }
  }, [test, lib, scenario, session, runner]);

  // Panels refresh at 8 Hz, and only while Simulate is visible.
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), 125);
    return () => clearInterval(id);
  }, [active]);
  // Backgrounding the app pauses the battle (and rendering); returning resumes it.
  useEffect(() => {
    let resume = false;
    const onVis = () => {
      if (document.hidden) {
        resume = runner.playing;
        if (resume) runner.pause();
      } else if (resume) {
        resume = false;
        runner.play();
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [runner]);
  useEffect(() => {
    runner.vfx.quality = quality;
  }, [quality, runner]);
  useEffect(() => {
    runner.audio.setMuted(!sound);
  }, [sound, runner]);
  // Leaving Simulate pauses audio but not the battle state.
  useEffect(() => {
    if (!active) runner.audio.setMuted(true);
    else runner.audio.setMuted(!sound);
  }, [active, sound, runner]);

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
        c.zoom = Math.min(rect.width / (A.width + 100), (rect.height - 60) / (A.height + 100));
        c.x = A.width / 2;
        c.y = A.height / 2 + 14 / c.zoom;
      }
      const pan = 600 / c.zoom;
      const k = keys.current;
      let manual = false;
      if (k.has('w') || k.has('arrowup')) (c.y -= pan * dt), (manual = true);
      if (k.has('s') || k.has('arrowdown')) (c.y += pan * dt), (manual = true);
      if (k.has('a') || k.has('arrowleft')) (c.x -= pan * dt), (manual = true);
      if (k.has('d') || k.has('arrowright')) (c.x += pan * dt), (manual = true);
      if (manual && view.current.follow) setFollow(false);
      if (document.hidden) {
        raf = requestAnimationFrame(frame);
        return;
      }
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

  // Keyboard: pan, space = play/pause, . = tick, , = decision, Esc = freecam
  useEffect(() => {
    if (!active) return;
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.altKey || e.ctrlKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        keys.current.add(key);
        e.preventDefault();
      } else if (key === ' ') {
        if ((e.target as HTMLElement).tagName === 'BUTTON') return;
        runner.toggle();
        e.preventDefault();
      } else if (key === '.') runner.stepTick();
      else if (key === ',') runner.stepDecision();
      else if (key === 'escape') {
        if (sheet) setSheet(false);
        else setSelected(null);
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      keys.current.clear();
    };
  }, [active, runner, sheet]);

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; zoom: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.current.zoom };
      drag.current = null;
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      cam.current.zoom = Math.min(6, Math.max(0.2, (pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / Math.max(1, pinch.current.d)));
      return;
    }
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
    pointers.current.delete(e.pointerId);
    if (pinch.current) {
      if (pointers.current.size < 2) pinch.current = null;
      drag.current = null;
      return;
    }
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
    if (id !== null) setFollow(true);
  };

  const sim = runner.sim;
  const cfg = runner.config;
  const selDrone = sim && selected !== null ? sim.drones.find((d) => d.id === selected) : undefined;
  const nameOf = (id: number) => sim?.drones.find((d) => d.id === id)?.name ?? `#${id}`;

  return (
    <div className={`simulate ${selDrone ? 'spectating' : ''}`} data-testid="battle">
      <div className="field">
        <canvas ref={canvasRef} data-testid="battle-canvas" aria-label="Battlefield" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} />
      </div>

      <div className="float tl">
        <button className="chip strong" aria-expanded={sheet} onClick={() => setSheet((s) => !s)} data-testid="scenario-button">
          <Icon name="deploy" size={16} />
          {cfg ? (
            <span>
              {cfg.mode === 'duel' ? 'Duel' : 'Sandbox'}
              <em> · {cfg.drones.map((d) => d.design.name).join(' vs ')}</em>
            </span>
          ) : (
            'Deploy'
          )}
        </button>
        {sim && (
          <div className={`roster-mini ${listOpen ? '' : 'closed'}`} data-testid="drone-list" aria-label="Drones on the field">
            <button className="mini-head" aria-expanded={listOpen} onClick={() => setListOpen(!listOpen)}>
              <Icon name={listOpen ? 'chevronUp' : 'chevronDown'} size={14} /> {sim.drones.filter((d) => !d.status.disabled && !d.status.destroyed).length} of {sim.drones.length} active
            </button>
            {listOpen &&
              sim.drones.map((d) => {
                const dead = d.status.disabled || d.status.destroyed;
                return (
                  <button key={d.id} className={`dtag ${selected === d.id ? 'on' : ''} ${dead ? 'dead' : ''}`} style={{ ['--team' as string]: TEAMS[d.team % 4].light }} onClick={() => select(selected === d.id ? null : d.id)} aria-pressed={selected === d.id}>
                    <span className="swatch" />
                    <span className="name">{d.name}</span>
                    <Segments size="sm" values={integrity(d)} label={`${d.name} section integrity`} />
                  </button>
                );
              })}
          </div>
        )}
      </div>

      <div className="float tr" role="toolbar" aria-label="Camera">
        {selDrone ? (
          <span className="chip cam-chip">
            Following <b>{selDrone.name}</b>
            <button className="chip-btn" onClick={() => setSelected(null)} title="Return to freecam (Esc)">
              Freecam
            </button>
          </span>
        ) : (
          <span className="chip cam-chip">Freecam</span>
        )}
        {selDrone && (
          <>
            <button className="chip-btn tog" aria-pressed={follow} onClick={() => setFollow((f) => !f)}>
              Follow
            </button>
            <button className="chip-btn tog" aria-pressed={sensorView} onClick={() => setSensorView((v) => !v)} title="Show only what this drone perceives">
              Sensor view
            </button>
          </>
        )}
        <ViewMenu open={viewMenu} setOpen={setViewMenu} {...{ showArcs, setShowArcs, showSensors, setShowSensors, quality, setQuality, sound, setSound }} audio={runner.audio} onFit={() => (fitRequest.current = true)} />
      </div>

      {sim?.result && (
        <div className="result" data-testid="result-banner" role="status">
          <b>{sim.result.winner === null ? 'No victor' : `${TEAMS[sim.result.winner].name} wins`}</b>
          <span>
            {sim.result.reason} · {sim.result.time.toFixed(1)} s
          </span>
          <button className="chip-btn" onClick={() => runner.restart()}>
            Run again
          </button>
        </div>
      )}

      <div className="transport" data-testid="sim-controls" role="toolbar" aria-label="Simulation controls">
        <button className="tbtn" onClick={() => runner.restart()} disabled={!sim} aria-label="Restart" title="Restart from the deployed state">
          <Icon name="restart" />
        </button>
        <button className="tbtn" onClick={() => runner.stepDecision()} disabled={!sim} aria-label="Step decision" title="Advance to the next decision (,)">
          <Icon name="stepDecision" />
        </button>
        <button className="tbtn" onClick={() => runner.stepTick()} disabled={!sim} aria-label="Step tick" title="Advance one 1/60 s tick (.)">
          <Icon name="step" />
        </button>
        <button className="tbtn play" onClick={() => runner.toggle()} disabled={!sim} aria-label={runner.playing ? 'Pause' : 'Play'} title="Play / pause (Space)">
          <Icon name={runner.playing ? 'pause' : 'play'} size={22} />
        </button>
        <div className="speed" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button key={s} role="radio" aria-checked={runner.speed === s} className={runner.speed === s ? 'on' : ''} onClick={() => runner.setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
        <button className="speed-cycle" onClick={() => runner.setSpeed(SPEEDS[(SPEEDS.indexOf(runner.speed) + 1) % SPEEDS.length])} aria-label={`Speed ${runner.speed}×, change`}>
          {runner.speed}×
        </button>
        <span className="clock num" data-testid="sim-clock">
          t = {sim ? sim.time.toFixed(2) : '0.00'} s<small data-testid="sim-tick">tick {sim?.tick ?? 0}</small>
        </span>
      </div>

      <Timeline sim={sim} open={events} setOpen={setEvents} mine={eventsMine} setMine={setEventsMine} selected={selected} nameOf={nameOf} />

      {sheet && <DeploySheet onClose={() => setSheet(false)} onDeployed={() => ((fitRequest.current = true), setSelected(null), setSheet(false))} />}

      {sim && selDrone && <Spectator sim={sim} drone={selDrone} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ViewMenu(p: { open: boolean; setOpen: (o: boolean) => void; showArcs: boolean; setShowArcs: (v: boolean) => void; showSensors: boolean; setShowSensors: (v: boolean) => void; quality: Quality; setQuality: (q: Quality) => void; sound: boolean; setSound: (v: boolean) => void; audio: CombatAudio; onFit: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [, redraw] = useState(0);
  useDismiss(p.open, () => p.setOpen(false), ref);
  return (
    <div className="menu-anchor" ref={ref}>
      <button className="chip-btn" aria-expanded={p.open} onClick={() => p.setOpen(!p.open)} aria-label="View options">
        <Icon name="camera" size={16} /> View
      </button>
      {p.open && (
        <div className="menu pop" role="menu" aria-label="View options">
          <label className="switch-label">
            <input type="checkbox" className="switch" checked={p.showSensors} onChange={(e) => p.setShowSensors(e.target.checked)} /> Sensors &amp; ranging
          </label>
          <label className="switch-label">
            <input type="checkbox" className="switch" checked={p.showArcs} onChange={(e) => p.setShowArcs(e.target.checked)} /> Weapon arcs
          </label>
          <label className="switch-label">
            <input type="checkbox" className="switch" checked={p.sound} onChange={(e) => p.setSound(e.target.checked)} /> Sound
          </label>
          {p.sound && (
            <div className="volumes" role="group" aria-label="Volume">
              {BUSES.map((b) => (
                <label key={b.id} className="volume-row" title={b.hint}>
                  <span>{b.name}</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    aria-label={`${b.name} volume`}
                    value={Math.round(p.audio.settings.volumes[b.id] * 100)}
                    onChange={(e) => {
                      p.audio.setVolume(b.id, Number(e.target.value) / 100);
                      redraw((x) => x + 1);
                    }}
                  />
                  <span className="mono small">{Math.round(p.audio.settings.volumes[b.id] * 100)}</span>
                </label>
              ))}
            </div>
          )}
          <label className="select-row">
            Effects
            <select aria-label="Effects quality" value={p.quality} onChange={(e) => p.setQuality(e.target.value as Quality)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <button className="btn" onClick={() => (p.onFit(), p.setOpen(false))}>
            <Icon name="fit" /> Fit arena
          </button>
          <p className="muted small">
            Pan <Kbd>W</Kbd>
            <Kbd>A</Kbd>
            <Kbd>S</Kbd>
            <Kbd>D</Kbd> or drag · zoom with the wheel · <Kbd>Space</Kbd> play · <Kbd>Esc</Kbd> freecam
          </p>
        </div>
      )}
    </div>
  );
}

function Timeline({ sim, open, setOpen, mine, setMine, selected, nameOf }: { sim: ReturnType<typeof useSession>['runner']['sim']; open: boolean; setOpen: (o: boolean) => void; mine: boolean; setMine: (v: boolean) => void; selected: number | null; nameOf: (id: number) => string }) {
  const log = sim?.log ?? [];
  const listRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => log.filter((e) => !mine || selected === null || eventDrone(e) === selected || (e.type === 'impact' && e.shooter === selected)), [log, log.length, mine, selected]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = listRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 60) el.scrollTop = el.scrollHeight;
  });
  const span = Math.max(10, sim?.time ?? 0, sim?.config.timeLimit ?? 0);
  const marks = log.filter((e) => severity(e) !== 'minor').slice(-400);
  const latest = log[log.length - 1];
  return (
    <div className={`timeline ${open ? 'open' : ''}`} data-testid="event-log">
      <button className="tl-bar" aria-expanded={open} onClick={() => setOpen(!open)} aria-label={`Events (${log.length})`}>
        <span className="tl-label">
          <Icon name="timeline" size={16} /> Events <span className="num muted">{log.length}</span>
        </span>
        <span className="tl-track" aria-hidden="true">
          {marks.map((e, i) => (
            <i key={i} className={severity(e)} style={{ left: `${(e.t / span) * 100}%` }} />
          ))}
          {sim && <b className="tl-now" style={{ left: `${(sim.time / span) * 100}%` }} />}
        </span>
        <span className="tl-latest">{latest ? describeEvent(latest, nameOf) : 'No events yet'}</span>
        <Icon name={open ? 'chevronDown' : 'chevronUp'} size={16} />
      </button>
      {open && (
        <div className="tl-body">
          <div className="tl-tools">
            <label className="switch-label">
              <input type="checkbox" className="switch" checked={mine} onChange={(e) => setMine(e.target.checked)} disabled={selected === null} /> Only the followed drone
            </label>
          </div>
          <div className="tl-list" ref={listRef}>
            {shown.slice(-400).map((e, i) => (
              <div key={i} className={`ev ${severity(e)}`}>
                <span className="t num">{e.t.toFixed(2)}</span>
                <span className="mk" aria-hidden="true" />
                <span className="tx">{describeEvent(e, nameOf)}</span>
              </div>
            ))}
            {shown.length === 0 && <p className="muted pad">No events yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function DeploySheet({ onClose, onDeployed }: { onClose: () => void; onDeployed: () => void }) {
  const lib = useLibrary();
  const { session } = useSession();
  const s = session.scenario(lib);
  const set = (patch: Partial<Scenario>) => session.setScenario({ ...s, ...patch });
  const setEntry = (i: number, patch: Partial<Scenario['roster'][number]>) => set({ roster: s.roster.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const pr = session.problems(lib, s);
  const ok = !pr.global.length && pr.entries.every((e) => !e.length);
  const ref = useRef<HTMLDivElement>(null);
  const training = s.training ? TRAINING_MAP[s.training] : null;
  return (
    <aside className="deploy card" ref={ref} aria-label="Scenario" data-testid="scenario">
      <header>
        <h2>Scenario</h2>
        <button className="tool" onClick={onClose} aria-label="Close scenario">
          <Icon name="close" />
        </button>
      </header>
      <label className="course">
        <span className="label">Course</span>
        <select
          aria-label="Course"
          data-testid="course"
          value={s.training ?? ''}
          onChange={(e) => {
            const id = (e.target.value || null) as TrainingId | null;
            const t = id ? TRAINING_MAP[id] : null;
            set({ training: id, timeLimit: t ? t.timeLimit : 180, roster: t ? s.roster.map((x) => ({ ...x, team: 0 })) : s.roster });
          }}
        >
          <option value="">Battle — Foundry Yard</option>
          <optgroup label="Training">
            {TRAININGS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {training ? (
        <div className="course-brief" data-testid="course-brief">
          <p>{training.brief}</p>
          <p className="muted small">{training.teaches}</p>
          <p className="muted small">
            Objective: {training.objective === 'goal' ? 'reach the goal' : training.objective === 'survive' ? `survive ${training.timeLimit} s` : 'knock out every target'} · your drones are {TEAMS[0].name}; built-in targets run their own brains.
          </p>
        </div>
      ) : (
        <div className="seg" role="radiogroup" aria-label="Mode">
          {(['duel', 'sandbox'] as const).map((m) => (
            <button key={m} role="radio" aria-checked={s.mode === m} className={s.mode === m ? 'on' : ''} onClick={() => set({ mode: m })}>
              {m === 'duel' ? 'Duel' : 'Sandbox'}
            </button>
          ))}
        </div>
      )}
      <ol className="roster">
        {s.roster.map((en, i) => (
          <li key={en.key} data-testid={`roster-${i}`} style={{ ['--team' as string]: TEAMS[en.team % 4].color }}>
            <span className="swatch" />
            <select aria-label={`Drone ${i + 1}`} value={en.designId} onChange={(e) => setEntry(i, { designId: e.target.value })}>
              {lib.designs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            {!training && (
              <select aria-label={`Team ${i + 1}`} value={en.team} onChange={(e) => setEntry(i, { team: Number(e.target.value) })}>
                {TEAMS.map((t, k) => (
                  <option key={k} value={k}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <button className="tool" aria-label={`Remove drone ${i + 1}`} onClick={() => set({ roster: s.roster.filter((_, k) => k !== i) })}>
              <Icon name="close" size={16} />
            </button>
            {pr.entries[i]?.map((m) => (
              <p key={m} className="error-text">
                {m}
              </p>
            ))}
          </li>
        ))}
      </ol>
      <button className="btn ghost" onClick={() => set({ roster: [...s.roster, { key: Date.now(), team: training ? 0 : s.roster.length % 2, designId: lib.designs[0]?.id ?? '' }] })}>
        <Icon name="plus" /> Add drone
      </button>
      <p className="muted small">Each drone runs its own brain — edit it under Program.</p>
      <div className="grid2">
        <label>
          Seed
          <input type="number" value={s.seed} onChange={(e) => set({ seed: Number(e.target.value) || 0 })} />
        </label>
        <label>
          Time limit (s)
          <input type="number" min={0} value={s.timeLimit} onChange={(e) => set({ timeLimit: Math.max(0, Number(e.target.value) || 0) })} />
        </label>
        <label>
          Decisions per second
          <input type="number" min={1} max={30} value={s.decisionHz} onChange={(e) => set({ decisionHz: Math.min(30, Math.max(1, Number(e.target.value) || 10)) })} />
        </label>
      </div>
      {pr.global.map((m) => (
        <p key={m} className="error-text">
          {m}
        </p>
      ))}
      <button className="btn primary wide" disabled={!ok} onClick={() => session.deploy(lib, s) && onDeployed()}>
        <Icon name="deploy" /> Deploy
      </button>
    </aside>
  );
}
