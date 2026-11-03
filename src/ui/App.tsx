import { createContext, useCallback, useContext, useState } from 'react';
import type { TraceLoc } from '../program/interpreter';
import { Battle } from './battle/Battle';
import { Logo } from './common';
import { Hangar } from './hangar/Hangar';
import { Programs } from './program/Programs';
import { useLibrary } from './store';

export type Tab = 'hangar' | 'programs' | 'battle';

export interface NavTarget {
  tab: Tab;
  designId?: string;
  programId?: string;
  highlight?: TraceLoc;
}

interface Nav {
  target: NavTarget;
  navigate(t: NavTarget): void;
}

const NavContext = createContext<Nav>({ target: { tab: 'hangar' }, navigate: () => {} });
export const useNav = () => useContext(NavContext);

// The three volumes of the archive.
const VOLUMES: { id: Tab; roman: string; label: string; hint: string }[] = [
  { id: 'hangar', roman: 'I', label: 'Hangar', hint: 'Specimen archive — construct and catalogue machines' },
  { id: 'programs', roman: 'II', label: 'Programs', hint: 'Intelligence laboratory — write machine behaviour' },
  { id: 'battle', roman: 'III', label: 'Battle', hint: 'Observation — deploy machines and watch them act' },
];

export function App() {
  const [target, setTarget] = useState<NavTarget>({ tab: 'battle' });
  const navigate = useCallback((t: NavTarget) => setTarget(t), []);
  const lib = useLibrary();
  return (
    <NavContext.Provider value={{ target, navigate }}>
      <div className="app">
        <header className="mast">
          <Logo />
          <nav className="vols" role="tablist" aria-label="Archive volumes">
            {VOLUMES.map((v) => (
              <button key={v.id} role="tab" aria-selected={target.tab === v.id} aria-label={v.label} title={v.hint} className={target.tab === v.id ? 'on' : ''} onClick={() => navigate({ tab: v.id })}>
                <span className="roman">{v.roman}</span>
                {v.label}
              </button>
            ))}
          </nav>
          <span className="spacer" />
          <span className="census" aria-label="Archive contents">
            <span>
              <b>{lib.designs.length}</b> specimens
            </span>
            <span>
              <b>{lib.programs.length}</b> intelligence records
            </span>
          </span>
        </header>
        {/* Volumes stay mounted so editors and the running battle keep their state. */}
        <div className={`view ${target.tab === 'hangar' ? 'shown' : ''}`} style={{ display: target.tab === 'hangar' ? 'block' : 'none' }}>
          <Hangar />
        </div>
        <div className={`view ${target.tab === 'programs' ? 'shown' : ''}`} style={{ display: target.tab === 'programs' ? 'block' : 'none' }}>
          <Programs />
        </div>
        <div className={`view ${target.tab === 'battle' ? 'shown' : ''}`} style={{ display: target.tab === 'battle' ? 'block' : 'none' }}>
          <Battle active={target.tab === 'battle'} />
        </div>
      </div>
    </NavContext.Provider>
  );
}
