import { createContext, useCallback, useContext, useState } from 'react';
import type { TraceLoc } from '../program/interpreter';
import { Battle } from './battle/Battle';
import { Logo } from './common';
import { Hangar } from './hangar/Hangar';
import { Programs } from './program/Programs';

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

const TABS: { id: Tab; label: string; color: string; hint: string }[] = [
  { id: 'hangar', label: 'Hangar', color: 'var(--orange)', hint: 'Design the machine' },
  { id: 'programs', label: 'Programs', color: 'var(--teal)', hint: 'Program its intelligence' },
  { id: 'battle', label: 'Battle', color: 'var(--pink)', hint: 'Watch it fight on its own' },
];

export function App() {
  const [target, setTarget] = useState<NavTarget>({ tab: 'battle' });
  const navigate = useCallback((t: NavTarget) => setTarget(t), []);
  return (
    <NavContext.Provider value={{ target, navigate }}>
      <div className="app">
        <header className="topbar">
          <span className="wordmark">
            <Logo />
            AUTOMATA
          </span>
          <nav className="topnav" role="tablist" aria-label="Workspace">
            {TABS.map((t) => (
              <button key={t.id} role="tab" aria-selected={target.tab === t.id} title={t.hint} className={target.tab === t.id ? 'on' : ''} onClick={() => navigate({ tab: t.id })}>
                <span className="dot" style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
          </nav>
          <span className="spacer" />
          <span className="tagline">Design the machine · program its intelligence · it fights on its own</span>
        </header>
        {/* Views stay mounted so editors and the running battle keep their state across tabs. */}
        <div className="view" style={{ display: target.tab === 'hangar' ? 'block' : 'none' }}>
          <Hangar />
        </div>
        <div className="view" style={{ display: target.tab === 'programs' ? 'block' : 'none' }}>
          <Programs />
        </div>
        <div className="view" style={{ display: target.tab === 'battle' ? 'block' : 'none' }}>
          <Battle active={target.tab === 'battle'} />
        </div>
      </div>
    </NavContext.Provider>
  );
}
