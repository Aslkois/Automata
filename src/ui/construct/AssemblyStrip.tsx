// The assembly strip: the three structural sections as one compact bar, proportioned like
// the hull. Each segment shows class, armour, equipment load and installed parts; the
// joints between them show what each connection carries.
import { COMPONENT_MAP } from '../../sim/content/components';
import { SECTION_CLASSES, SECTION_LETTER, type SectionPos } from '../../sim/content/sections';
import type { DesignStats, DroneDesign } from '../../sim/design';
import type { Selection } from './Stage';
import { PartIcon } from '../parts';
import { Icon } from '../common';

const ORDER: SectionPos[] = ['rear', 'middle', 'front'];

export function AssemblyStrip({ design, stats, sel, onSelect }: { design: DroneDesign; stats: DesignStats; sel: Selection; onSelect: (s: Selection) => void }) {
  return (
    <div className="assembly" role="group" aria-label="Sections">
      {ORDER.map((pos, i) => {
        const sd = design.sections[pos];
        const cls = SECTION_CLASSES[sd.class];
        const load = stats.loadUtilization[pos];
        const parts = Object.values(sd.slots).filter(Boolean).map((m) => COMPONENT_MAP[m!.component]);
        const on = sel?.pos === pos;
        return (
          <div key={pos} className="asm-cell" style={{ flexGrow: cls.length }}>
            {i > 0 && (
              <span className="joint-mark" title={`${ORDER[i - 1]}–${pos} joint · carries ${Math.round(stats.sectionMass[ORDER[i - 1]] + stats.equipmentMass[ORDER[i - 1]])} kg on the ${ORDER[i - 1]} side`} aria-hidden="true">
                <i />
                <i />
              </span>
            )}
            <button className={`asm-seg ${on ? 'on' : ''}`} onClick={() => onSelect({ type: 'section', pos })} aria-pressed={on} data-testid={`section-${pos}`} aria-label={`${pos} section: ${cls.name}, ${sd.armor} mm armour, ${parts.length} parts${sd.mirror ? ', layout mirrored' : ''}`}>
              <span className="asm-top">
                <b className="letter">{SECTION_LETTER[pos]}</b>
                <span className="cls">{cls.name}</span>
                {sd.mirror && (
                  <span className="asm-mirror" title="Hardpoint layout mirrored left/right" data-testid={`mirrored-${pos}`}>
                    <Icon name="mirror" size={13} />
                  </span>
                )}
                <span className="num armor">{sd.armor} mm</span>
              </span>
              <span className="asm-load" title={`Equipment ${Math.round(stats.equipmentMass[pos])} kg of ${Math.round(stats.ratedEquipment[pos])} kg rated on this chassis (${Math.round(load * 100)}%) — a rating, not a limit`}>
                <b style={{ width: `${Math.min(100, load * 100)}%` }} className={load > 1 ? 'over' : load > 0.85 ? 'high' : ''} />
              </span>
              <span className="asm-parts">
                {parts.length ? parts.slice(0, 7).map((p, k) => <PartIcon key={k} id={p.id} kind={p.kind} size={14} />) : <span className="muted">empty</span>}
                {parts.length > 7 && <span className="muted">+{parts.length - 7}</span>}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
