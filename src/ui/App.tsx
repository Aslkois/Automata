import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ViewKind } from '../program/brain/model';
import { Construct } from './construct/Construct';
import { Program } from './program/Program';
import { Rail } from './shell/Rail';
import { Simulate } from './simulate/Simulate';
import { useStoredState } from './common';
import { useLibrary } from './store';

export type Workspace = 'construct' | 'program' | 'simulate';

export interface FocusRequest {
  designId: string;
  /** IR id to reveal */
  id: string;
  view?: ViewKind;
  nonce: number;
}
export interface TestRequest {
  designId: string;
  nonce: number;
}

interface ShellState {
  ws: Workspace;
  go(ws: Workspace): void;
  /** the active drone, shared by every workspace */
  designId: string;
  setDesignId(id: string): void;
  focus: FocusRequest | null;
  openBrainAt(designId: string, id: string, view?: ViewKind): void;
  test: TestRequest | null;
  testDrone(designId: string): void;
}

const ShellContext = createContext<ShellState | null>(null);
export function useShell(): ShellState {
  const s = useContext(ShellContext);
  if (!s) throw new Error('useShell outside App');
  return s;
}

export function App() {
  const lib = useLibrary();
  const [ws, setWs] = useStoredState<Workspace>('workspace', 'construct');
  const [storedDesign, setStoredDesign] = useStoredState<string>('design', lib.designs[0]?.id ?? '');
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [test, setTest] = useState<TestRequest | null>(null);
  const designId = lib.designs.some((d) => d.id === storedDesign) ? storedDesign : (lib.designs[0]?.id ?? '');
  useEffect(() => {
    if (designId !== storedDesign) setStoredDesign(designId);
  }, [designId, storedDesign, setStoredDesign]);

  const go = useCallback((w: Workspace) => setWs(w), [setWs]);
  const openBrainAt = useCallback(
    (d: string, id: string, view?: ViewKind) => {
      setStoredDesign(d);
      setFocus({ designId: d, id, view, nonce: Date.now() });
      setWs('program');
    },
    [setStoredDesign, setWs],
  );
  const testDrone = useCallback(
    (d: string) => {
      setStoredDesign(d);
      setTest({ designId: d, nonce: Date.now() });
      setWs('simulate');
    },
    [setStoredDesign, setWs],
  );
  const value = useMemo<ShellState>(() => ({ ws, go, designId, setDesignId: setStoredDesign, focus, openBrainAt, test, testDrone }), [ws, go, designId, setStoredDesign, focus, openBrainAt, test, testDrone]);

  // On-screen keyboards cover the layout viewport on phones: track the visual viewport so the
  // app (editor, symbol bar, sheets) shrinks to the space above the keyboard instead.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--kb', `${kb > 80 ? Math.round(kb) : 0}px`);
      root.classList.toggle('kb-open', kb > 80);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);

  // Keyboard: Alt+1/2/3 switch activities.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const w = ({ '1': 'construct', '2': 'program', '3': 'simulate' } as const)[e.key as '1' | '2' | '3'];
      if (w) {
        e.preventDefault();
        setWs(w);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setWs]);

  return (
    <ShellContext.Provider value={value}>
      <div className="app">
        <Rail />
        {/* Workspaces stay mounted so editors, camera and the running simulation keep their state. */}
        <main className="workspaces">
          <section className={`ws ${ws === 'construct' ? 'shown' : ''}`} hidden={ws !== 'construct'} aria-label="Construct">
            <Construct active={ws === 'construct'} />
          </section>
          <section className={`ws ${ws === 'program' ? 'shown' : ''}`} hidden={ws !== 'program'} aria-label="Program">
            <Program active={ws === 'program'} />
          </section>
          <section className={`ws ${ws === 'simulate' ? 'shown' : ''}`} hidden={ws !== 'simulate'} aria-label="Simulate">
            <Simulate active={ws === 'simulate'} />
          </section>
        </main>
      </div>
    </ShellContext.Provider>
  );
}
