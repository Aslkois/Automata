// A specimen sheet of every component's icon and model, in each state that changes its look.
// Opened with ?parts-sheet (used for visual inspection and screenshot tests).
import { COMPONENTS } from '../sim/content/components';
import { MODELS, restVisual, type PartVisual } from '../render/parts/models';
import { PartIcon, PartModelG } from './parts';

const STATES: { label: string; v: Partial<PartVisual> }[] = [
  { label: 'ready', v: {} },
  { label: 'firing', v: { recoil: [1, 0.5, 1, 0.5, 1, 0.5], spin: 0.6, discharge: 0.8, heat: 0.9, raised: true } },
  { label: 'reloading', v: { loaded: [false, false, true, false, false, false], reload: 0.45, charge: 0.45, chargeState: 'charging', sweep: 0.7 } },
  { label: 'damaged', v: { damage: 1, jammed: [false, true, false, true], charge: 0.4, chargeState: 'interrupted' } },
  { label: 'critical', v: { damage: 2, jammed: [false, true, false, true], flicker: 1 } },
  { label: 'destroyed', v: { damage: 3, active: false } },
];

function Cell({ id, v, k }: { id: string; v: PartVisual; k: number }) {
  return (
    <svg width={27 * k} height={16 * k} viewBox="-8 -8 27 16" className="sheet-model">
      <PartModelG id={id} v={v} strokeWidth={0.9 / k} context="field" />
    </svg>
  );
}

export function PartsSheet() {
  const hard = COMPONENTS.filter((c) => MODELS[c.id]);
  return (
    <main className="parts-sheet" data-testid="parts-sheet">
      <h1>Component specimens</h1>
      <section>
        <h2>Icons — 20, 24 and 40 px</h2>
        <div className="sheet-icons">
          {COMPONENTS.map((c) => (
            <figure key={c.id} data-testid={`icon-${c.id}`}>
              <PartIcon id={c.id} kind={c.kind} size={20} />
              <PartIcon id={c.id} kind={c.kind} size={24} />
              <PartIcon id={c.id} kind={c.kind} size={40} />
              <figcaption>{c.name}</figcaption>
            </figure>
          ))}
        </div>
      </section>
      <section>
        <h2>Hardpoint models</h2>
        <table className="sheet-models">
          <thead>
            <tr>
              <th />
              {STATES.map((s) => (
                <th key={s.label}>{s.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {hard.map((c) => (
              <tr key={c.id} data-testid={`model-${c.id}`}>
                <th>{c.name}</th>
                {STATES.map((s) => (
                  <td key={s.label} className="sheet-field">
                    <Cell id={c.id} v={restVisual({ seed: 7, ...s.v })} k={5} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
