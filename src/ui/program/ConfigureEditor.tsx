// CONFIGURE — the fourth editor. The player chooses tactics; Configure writes an ordinary
// AutoScript brain for this drone's hardware (the same program Blocks, Nodes and Code show).
// While the brain is still exactly what its settings generate, changing a setting rewrites it
// at once. Once it has been edited elsewhere it is "customised": settings are saved, but the
// program is only regenerated when the player asks, and the edited version is kept first.
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Brain } from '../../program/brain/model';
import {
  configStatus,
  DEFENSE_RULES,
  defaultConfig,
  DOCTRINES,
  explain,
  generateCode,
  initialConfig,
  MOVEMENT_RULES,
  RANGE_CHOICES,
  TARGET_RULES,
  type AdvancedConfig,
  type BrainConfig,
  type ConfigStatus,
} from '../../program/configure';
import type { DroneDesign } from '../../sim/design';
import { Icon } from '../common';
import { library } from '../store';

const pct = (v: number) => `${Math.round(v * 100)} %`;

export function ConfigureEditor({ design, brain, onOpenCode, onTest, canTest }: { design: DroneDesign; brain: Brain; onOpenCode: () => void; onTest: () => void; canTest: boolean }) {
  const status: ConfigStatus = configStatus(brain, design);
  const stored = brain.config?.data;
  // a hand-written brain gets a starting point from its weapons; nothing is applied until asked
  const [draft, setDraft] = useState<BrainConfig>(() => stored ?? initialConfig(design));
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    setDraft(brain.config?.data ?? initialConfig(design));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brain.id]);
  useEffect(() => {
    // settings changed from elsewhere (undo, another tab of the same library)
    if (stored && JSON.stringify(stored) !== JSON.stringify(draft)) setDraft(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored]);

  const ex = useMemo(() => explain(design, draft), [design, draft]);
  const code = useMemo(() => generateCode(design, draft), [design, draft]);
  const hw = ex.plan.hw;
  const has = {
    coilgun: hw.weapons.some((w) => w.role === 'coilgun'),
    rockets: hw.weapons.some((w) => w.role === 'rockets'),
    missiles: hw.weapons.some((w) => w.role === 'missiles'),
    interceptors: hw.interceptors > 0,
    intercept: hw.hasRadar && (hw.pd.length > 0 || hw.interceptors > 0),
    shields: hw.shields.length > 0,
  };

  const commit = (next: BrainConfig) => {
    setDraft(next);
    if (status === 'synced' || status === 'hardware') library.configureBrain(design.id, next);
    else if (status === 'customized') library.storeConfigSettings(design.id, next);
  };
  const set = <K extends keyof BrainConfig>(k: K, v: BrainConfig[K]) => commit({ ...draft, [k]: v });
  const adv = <K extends keyof AdvancedConfig>(k: K, v: AdvancedConfig[K]) => commit({ ...draft, advanced: { ...draft.advanced, [k]: v } });
  const generate = () => {
    const r = library.configureBrain(design.id, draft);
    setNote(r.recovered ? 'Brain generated. The previous program is kept under Recovered programs.' : 'Brain generated.');
  };

  return (
    <div className="cfg" data-testid="configure">
      {status === 'none' && (
        <div className="banner" role="status" data-testid="cfg-status">
          <Icon name="program" size={16} />
          <span>This brain was written by hand. Choose tactics below, then generate a brain from them — the current program is kept under Recovered programs.</span>
          <button className="btn primary sm" onClick={generate} data-testid="cfg-generate">
            Generate brain
          </button>
        </div>
      )}
      {status === 'customized' && (
        <div className="banner warn" role="status" data-testid="cfg-status">
          <Icon name="warn" size={16} />
          <span>Customised: this brain was edited in Blocks, Nodes or Code since Configure generated it, so changes here are saved but not applied.</span>
          <button className="link" onClick={generate} data-testid="cfg-generate">
            Regenerate from settings
          </button>
          <span className="muted small">(your edited program is kept under Recovered programs)</span>
        </div>
      )}
      {status === 'hardware' && (
        <div className="banner warn" role="status" data-testid="cfg-status">
          <Icon name="construct" size={16} />
          <span>The hardware changed since this brain was generated.</span>
          <button className="link" onClick={generate} data-testid="cfg-generate">
            Regenerate for this hardware
          </button>
        </div>
      )}
      {status === 'synced' && (
        <div className="banner ok" role="status" data-testid="cfg-status">
          <Icon name="check" size={16} />
          <span>The brain is generated from these settings; every change applies at once.</span>
        </div>
      )}
      {note && (
        <p className="flash cfg-note" role="status">
          {note}
        </p>
      )}

      <div className="cfg-grid">
        <section className="cfg-main" aria-label="Tactics">
          <Group title="Doctrine" hint="The overall way this drone fights. Everything below left on “auto” follows it.">
            <div className="cfg-doctrines" role="radiogroup" aria-label="Doctrine">
              {DOCTRINES.map((d) => (
                <button key={d.id} role="radio" aria-checked={draft.doctrine === d.id} className={`cfg-card ${draft.doctrine === d.id ? 'on' : ''}`} onClick={() => set('doctrine', d.id)}>
                  <strong>{d.name}</strong>
                  <span>{d.summary}</span>
                </button>
              ))}
            </div>
          </Group>

          <Group title="Engagement distance" hint={`Now: ${ex.plan.band[0]}–${ex.plan.band[1]} u`}>
            <Chips label="Engagement distance" value={draft.range} options={RANGE_CHOICES.map((r) => ({ id: r.id, name: r.name }))} onPick={(v) => set('range', v)} />
            {draft.range === 'custom' && (
              <div className="cfg-pair">
                <NumberField label="From" unit="u" min={0} max={1900} step={10} value={draft.customRange[0]} onChange={(v) => set('customRange', [v, Math.max(v + 50, draft.customRange[1])])} />
                <NumberField label="To" unit="u" min={50} max={2000} step={10} value={draft.customRange[1]} onChange={(v) => set('customRange', [Math.min(draft.customRange[0], v - 50), v])} />
              </div>
            )}
          </Group>

          <Group title="Target selection">
            <Rules label="Target selection" value={draft.target} rules={TARGET_RULES} doctrine={ex.plan.c.targetRule} onPick={(v) => set('target', v)} />
          </Group>
          <Group title="Defensive behaviour">
            <Rules label="Defensive behaviour" value={draft.defense} rules={DEFENSE_RULES.map((r) => ({ ...r, disabled: r.needs === 'intercept' && !has.intercept ? 'needs radar and point defense or interceptors' : undefined }))} doctrine={ex.plan.c.defenseRule} onPick={(v) => set('defense', v)} />
          </Group>
          <Group title="Movement">
            <Rules label="Movement" value={draft.movement} rules={MOVEMENT_RULES} doctrine={ex.plan.c.movementRule} onPick={(v) => set('movement', v)} />
          </Group>

          <div className="cfg-advanced">
            <h3>Advanced</h3>
            <Section title="Engagement and movement">
              <Optional label="Closest distance" unit="u" auto="from range" value={draft.advanced.rangeMin} min={0} max={1500} step={10} fallback={ex.plan.band[0]} onChange={(v) => adv('rangeMin', v)} />
              <Optional label="Furthest distance" unit="u" auto="from range" value={draft.advanced.rangeMax} min={50} max={2000} step={10} fallback={ex.plan.band[1]} onChange={(v) => adv('rangeMax', v)} />
              <Doctrinal label="Pursuit" value={draft.advanced.pursuit} resolved={ex.plan.c.pursuit} min={0} max={1} step={0.05} show={pct} hint="0: never chase · 1: chase hard and long" onChange={(v) => adv('pursuit', v)} />
              <Doctrinal label="Retreat below" value={draft.advanced.retreatAt} resolved={ex.plan.c.retreatAt} min={0} max={0.9} step={0.05} show={(v) => (v === 0 ? 'never' : `${pct(v)} structure`)} onChange={(v) => adv('retreatAt', v)} />
              <Select label="Orbit direction" value={draft.advanced.orbit} options={[['alternate', 'Alternate'], ['cw', 'Clockwise'], ['ccw', 'Anticlockwise']]} onChange={(v) => adv('orbit', v)} />
              <Select label="Flank side" value={draft.advanced.flank} options={[['auto', 'Away from its guns'], ['left', 'Left'], ['right', 'Right']]} onChange={(v) => adv('flank', v)} />
              <Select label="When nothing is in sight" value={draft.advanced.search} options={[['lastKnown', 'Go where it was last seen'], ['sweep', 'Sweep the arena'], ['patrol', 'Patrol the start area'], ['hold', 'Hold and turn']]} onChange={(v) => adv('search', v)} />
              <Slider label="Remember lost contacts" value={draft.advanced.memory} min={1} max={30} step={1} show={(v) => `${v} s`} onChange={(v) => adv('memory', v)} />
              <Slider label="Top speed" value={draft.advanced.speed} min={0.3} max={1} step={0.05} show={pct} onChange={(v) => adv('speed', v)} />
              <Toggle label="Use cover while reloading or retreating" value={draft.advanced.cover} onChange={(v) => adv('cover', v)} />
              <Toggle label="Get unstuck (back out, then detour)" value={draft.advanced.stuckRecovery} onChange={(v) => adv('stuckRecovery', v)} />
            </Section>
            <Section title="Weapons">
              <Select label="Fire discipline" value={draft.advanced.discipline} options={[['auto', `Doctrine (${ex.plan.c.discipline})`], ['free', 'Free fire'], ['aimed', 'Aimed fire'], ['conserve', 'Conserve ammunition']]} onChange={(v) => adv('discipline', v)} />
              <Optional label="Aim tolerance" unit="°" auto="each weapon’s own" value={draft.advanced.aimTolerance} min={0.3} max={15} step={0.1} fallback={4} onChange={(v) => adv('aimTolerance', v)} />
              <Toggle label="Lead moving targets" value={draft.advanced.lead} onChange={(v) => adv('lead', v)} />
              <Toggle label="Fire in bursts (heat)" value={draft.advanced.burst} onChange={(v) => adv('burst', v)} />
              <Toggle label="Pull back while the main weapon reloads" value={draft.advanced.reloadDisengage} onChange={(v) => adv('reloadDisengage', v)} />
              <Toggle label="Coilgun: stop and settle for each shot" value={draft.advanced.coilgunBrace} disabled={!has.coilgun && 'no coilgun'} onChange={(v) => adv('coilgunBrace', v)} />
              <Select label="Rocket salvo" value={draft.advanced.rocketSalvo} disabled={!has.rockets && 'no rocket pod'} options={[['full', 'Hold until well inside range'], ['free', 'Fire as it bears']]} onChange={(v) => adv('rocketSalvo', v)} />
              <Toggle label="Missiles: only at tracked targets in reach" value={draft.advanced.missileConservation} disabled={!has.missiles && 'no missiles'} onChange={(v) => adv('missileConservation', v)} />
              <Slider label="Interceptors kept for threats" value={draft.advanced.interceptorReserve} min={0} max={12} step={1} show={(v) => `${v}`} disabled={!has.interceptors && 'no interceptor rockets'} onChange={(v) => adv('interceptorReserve', v)} />
            </Section>
            <Section title="Target evaluation">
              <p className="muted small">How much each factor counts when choosing a target (on top of the rule above).</p>
              {(
                [
                  ['distance', 'Distance (nearer is better)'],
                  ['threat', 'Threat to us'],
                  ['mobility', 'Speed (fast targets)'],
                  ['freshness', 'Fresh information'],
                  ['armor', 'What our weapons can penetrate'],
                ] as const
              ).map(([k, l]) => (
                <Slider key={k} label={l} value={draft.advanced.weights[k]} min={0} max={2} step={0.1} show={(v) => `×${v.toFixed(1)}`} onChange={(v) => adv('weights', { ...draft.advanced.weights, [k]: v })} />
              ))}
            </Section>
            <Section title="Resources">
              <Select label="Power priority" value={draft.advanced.power} options={[['balanced', 'Balanced'], ['weapons', 'Weapons'], ['propulsion', 'Propulsion'], ['shields', 'Shields']]} onChange={(v) => adv('power', v)} />
              <Slider label="Hold fire above heat" value={draft.advanced.heatLimit} min={50} max={98} step={1} show={(v) => `${v}`} onChange={(v) => adv('heatLimit', v)} />
              <Slider label="Conserve below ammunition" value={draft.advanced.ammoConserveBelow} min={0} max={0.8} step={0.05} show={(v) => (v === 0 ? 'never' : pct(v))} onChange={(v) => adv('ammoConserveBelow', v)} />
              <Toggle label="Emergency power: drop shields when stored power runs low" value={draft.advanced.emergencyPower} onChange={(v) => adv('emergencyPower', v)} />
            </Section>
            <Section title="Defensive reactions">
              <Select label="Incoming rounds" value={draft.advanced.incoming} options={[['auto', 'From defensive behaviour'], ['ignore', 'Ignore'], ['evade', 'Evade'], ['shield', 'Shield'], ['intercept', 'Intercept']]} onChange={(v) => adv('incoming', v)} />
              <Select label="Shield faces" value={draft.advanced.shieldFacing} disabled={!has.shields && 'no shield'} options={[['auto', 'The greater danger'], ['target', 'The target'], ['threat', 'Incoming rounds']]} onChange={(v) => adv('shieldFacing', v)} />
              <Select label="If sensors are lost" value={draft.advanced.sensorLoss} options={[['close', 'Close in to proximity range'], ['hold', 'Hold and turn'], ['retreat', 'Retreat']]} onChange={(v) => adv('sensorLoss', v)} />
              <Select label="If weapons are lost" value={draft.advanced.weaponLoss} options={[['adapt', 'Fight with what is left'], ['retreat', 'Retreat']]} onChange={(v) => adv('weaponLoss', v)} />
              <Toggle label="Keep fighting when immobilised" value={draft.advanced.fightImmobilized} onChange={(v) => adv('fightImmobilized', v)} />
            </Section>
            <Section title="Adaptive behaviour">
              <Toggle label="Switch ammunition to suit the target" value={draft.advanced.adaptAmmo} onChange={(v) => adv('adaptAmmo', v)} />
              <Toggle label="Shorten the range as weapons are lost" value={draft.advanced.adaptRange} onChange={(v) => adv('adaptRange', v)} />
              <Toggle label="Slow down and hold when running gear is damaged" value={draft.advanced.adaptPropulsion} onChange={(v) => adv('adaptPropulsion', v)} />
              <Toggle label="Avoid repeating a failed route" value={draft.advanced.avoidRepeats} onChange={(v) => adv('avoidRepeats', v)} />
              <Toggle label="Read the enemy (rushing or keeping away) and answer it" value={draft.advanced.readEnemy} onChange={(v) => adv('readEnemy', v)} />
            </Section>
            <button className="btn ghost sm" onClick={() => commit(defaultConfig(draft.doctrine))}>
              Reset to {DOCTRINES.find((d) => d.id === draft.doctrine)?.name} defaults
            </button>
          </div>
        </section>

        <aside className="cfg-side" aria-label="Hardware intelligence and program">
          <section className="cfg-panel" data-testid="cfg-hardware">
            <h3>Hardware intelligence</h3>
            <h4>Installed</h4>
            <ul>
              {ex.detected.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            <h4>What the brain will do</h4>
            <ul>
              {ex.behaviour.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
            {ex.cautions.length > 0 && (
              <>
                <h4>Cautions</h4>
                <ul className="warn">
                  {ex.cautions.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </>
            )}
            <details>
              <summary>Left out for this hardware</summary>
              <ul className="muted">
                {ex.omitted.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </details>
          </section>
          <section className="cfg-panel cfg-preview" data-testid="cfg-preview">
            <h3>Program</h3>
            <p className="muted small">
              {code.split('\n').length} lines of AutoScript · {ex.plan.modules.join(' · ')}
            </p>
            <details>
              <summary>{status === 'synced' ? 'Show the program' : 'Show what these settings generate'}</summary>
              <pre className="cfg-code">{code}</pre>
            </details>
            <div className="cfg-actions">
              <button className="btn" onClick={onOpenCode} title="Read or edit the brain in Code">
                <Icon name="program" size={16} /> Open in Code
              </button>
              <button className="btn primary" onClick={onTest} disabled={!canTest} title="Deploy this drone in Simulate">
                <Icon name="simulate" size={16} /> Test
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="cfg-group">
      <header>
        <h3>{title}</h3>
        {hint && <span className="muted small">{hint}</span>}
      </header>
      {children}
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="cfg-section">
      <summary>{title}</summary>
      <div className="cfg-fields">{children}</div>
    </details>
  );
}

function Chips<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { id: T; name: string; disabled?: string }[]; onPick: (v: T) => void }) {
  return (
    <div className="cfg-chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} disabled={!!o.disabled} title={o.disabled ?? undefined} onClick={() => onPick(o.id)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

function Rules<T extends string>({ label, value, rules, doctrine, onPick }: { label: string; value: T; rules: { id: T; name: string; summary: string; disabled?: string }[]; doctrine: string; onPick: (v: T) => void }) {
  const chosen = rules.find((r) => r.id === value);
  const resolved = rules.find((r) => r.id === doctrine);
  return (
    <>
      <Chips label={label} value={value} options={rules.map((r) => ({ id: r.id, name: r.id === ('auto' as T) ? 'Auto' : r.name, disabled: r.disabled }))} onPick={onPick} />
      <p className="cfg-summary small">{value === ('auto' as T) ? `Doctrine default: ${resolved?.name ?? doctrine}${resolved?.summary ? ` — ${resolved.summary}` : ''}` : chosen?.summary}</p>
    </>
  );
}

function Toggle({ label, value, onChange, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; disabled?: string | false }) {
  return (
    <label className={`cfg-field toggle ${disabled ? 'na' : ''}`} title={disabled || undefined}>
      <input type="checkbox" checked={value} disabled={!!disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
      {disabled && <em className="muted small">{disabled}</em>}
    </label>
  );
}

function Select<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; disabled?: string | false }) {
  return (
    <label className={`cfg-field ${disabled ? 'na' : ''}`} title={disabled || undefined}>
      <span>{label}</span>
      <select value={value} disabled={!!disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      {disabled && <em className="muted small">{disabled}</em>}
    </label>
  );
}

function Slider({ label, value, min, max, step, show, onChange, disabled }: { label: string; value: number; min: number; max: number; step: number; show: (v: number) => string; onChange: (v: number) => void; disabled?: string | false }) {
  return (
    <label className={`cfg-field slider ${disabled ? 'na' : ''}`} title={disabled || undefined}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={!!disabled} onChange={(e) => onChange(Number(e.target.value))} />
      <output className="num">{disabled ? disabled : show(value)}</output>
    </label>
  );
}

/** A number that is either chosen or left to the doctrine (stored as −1). */
function Doctrinal({ label, value, resolved, min, max, step, show, hint, onChange }: { label: string; value: number; resolved: number; min: number; max: number; step: number; show: (v: number) => string; hint?: string; onChange: (v: number) => void }) {
  const auto = value < 0;
  return (
    <div className="cfg-field optional">
      <span>{label}</span>
      <label className="auto">
        <input type="checkbox" checked={auto} onChange={(e) => onChange(e.target.checked ? -1 : resolved)} /> doctrine
      </label>
      <input type="range" min={min} max={max} step={step} value={auto ? resolved : value} disabled={auto} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <output className="num">{show(auto ? resolved : value)}</output>
      {hint && <em className="muted small">{hint}</em>}
    </div>
  );
}

/** A number that is either chosen or left automatic (stored as null). */
function Optional({ label, unit, auto, value, min, max, step, fallback, onChange }: { label: string; unit: string; auto: string; value: number | null; min: number; max: number; step: number; fallback: number; onChange: (v: number | null) => void }) {
  const isAuto = value === null;
  return (
    <div className="cfg-field optional">
      <span>{label}</span>
      <label className="auto">
        <input type="checkbox" checked={isAuto} onChange={(e) => onChange(e.target.checked ? null : fallback)} /> {auto}
      </label>
      <input type="range" min={min} max={max} step={step} value={isAuto ? fallback : value} disabled={isAuto} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
      <output className="num">
        {Math.round((isAuto ? fallback : value) * 10) / 10} {unit}
      </output>
    </div>
  );
}

function NumberField({ label, unit, min, max, step, value, onChange }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="cfg-field number">
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={min} max={max} step={step} value={value} onChange={(e) => Number.isFinite(Number(e.target.value)) && onChange(Math.min(max, Math.max(min, Number(e.target.value))))} />
      <span className="muted">{unit}</span>
    </label>
  );
}
