import { createContext, useCallback, useContext, useState } from 'react';
import type { TraceLoc } from '../program/interpreter';
import { Battle } from './battle/Battle';
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

export function App() {
  const [target, setTarget] = useState<NavTarget>({ tab: 'battle' });
  const navigate = useCallback((t: NavTarget) => setTarget(t), []);
  const tabs: [Tab, string][] = [
    ['hangar', 'Hangar'],
    ['programs', 'Programs'],
    ['battle', 'Battle'],
  ];
  return (
    <NavContext.Provider value={{ target, navigate }}>
      <div className="app">
        <header className="topbar">
          <span className="wordmark">AUTOMATA</span>
          <nav className="tabs" role="tablist">
            {tabs.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={target.tab === id} className={`tab ${target.tab === id ? 'active' : ''}`} onClick={() => navigate({ tab: id })}>
                {label}
              </button>
            ))}
          </nav>
          <span className="spacer" />
          <span className="hint">Design the machine · program its intelligence · it fights on its own</span>
        </header>
        {/* Views stay mounted so editors and the running battle keep their state across tabs. */}
        <div style={{ display: target.tab === 'hangar' ? 'contents' : 'none' }}>
          <Hangar />
        </div>
        <div style={{ display: target.tab === 'programs' ? 'contents' : 'none' }}>
          <Programs />
        </div>
        <div style={{ display: target.tab === 'battle' ? 'contents' : 'none' }}>
          <Battle active={target.tab === 'battle'} />
        </div>
      </div>
    </NavContext.Provider>
  );
}
