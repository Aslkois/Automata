import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as Blockly from 'blockly/core';
import { fragmentBlocks, type BJ, type BlocksDoc } from '../../program/brain/blocks';
import { blockTheme, moduleHooks, registerBlocks } from './blockTypes';
import { CodeEditor } from './CodeEditor';

export interface EditorHandle {
  insert(code: string, kind: 'stmt' | 'expr' | 'top'): boolean;
  reveal(id: string): void;
}

interface Props {
  doc: BlocksDoc;
  onChange: (doc: BlocksDoc) => void;
  highlight: string | null;
  errorRefs: Set<string>;
  visible: boolean;
}

export const BlockEditor = forwardRef<EditorHandle, Props>(function BlockEditor({ doc, onChange, highlight, errorRefs, visible }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const ws = useRef<Blockly.WorkspaceSvg | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const loading = useRef(false);
  const emitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [module, setModule] = useState<{ id: string; code: string; isStmt: boolean } | null>(null);

  const emitNow = () => {
    const w = ws.current;
    if (!w) return;
    if (emitTimer.current) clearTimeout(emitTimer.current);
    onChangeRef.current(Blockly.serialization.workspaces.save(w) as BlocksDoc);
  };
  const emitSoon = () => {
    if (emitTimer.current) clearTimeout(emitTimer.current);
    emitTimer.current = setTimeout(emitNow, 180);
  };

  useEffect(() => {
    registerBlocks();
    const w = Blockly.inject(host.current!, {
      theme: blockTheme(),
      renderer: 'thrasos',
      trashcan: false,
      sounds: false,
      grid: { spacing: 24, length: 2, colour: '#ddd5c5', snap: true },
      zoom: { controls: true, wheel: true, startScale: 0.95, maxScale: 2, minScale: 0.35, pinch: true },
      move: { scrollbars: true, drag: true, wheel: false },
    });
    ws.current = w;
    loading.current = true;
    try {
      Blockly.serialization.workspaces.load(doc as object, w);
    } catch (e) {
      console.error('Failed to load blocks', e);
    }
    loading.current = false;
    const listener = (e: Blockly.Events.Abstract) => {
      if (loading.current || e.isUiEvent) return;
      emitSoon();
    };
    w.addChangeListener(listener);
    moduleHooks.edit = (b) => {
      const bb = b as Blockly.Block & { code: string };
      setModule({ id: b.id, code: bb.code, isStmt: b.type === 'code_stmt' });
    };
    return () => {
      if (emitTimer.current) {
        clearTimeout(emitTimer.current);
        emitNow();
      }
      w.dispose();
      ws.current = null;
    };
    // The workspace is created once per document load; the parent keys this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (visible && ws.current) Blockly.svgResize(ws.current);
  }, [visible]);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => ws.current && Blockly.svgResize(ws.current));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const reveal = (id: string) => {
    const w = ws.current;
    if (!w) return;
    const b = w.getBlockById(id) as Blockly.BlockSvg | null;
    if (!b) return;
    w.highlightBlock(null);
    w.highlightBlock(id);
    w.centerOnBlock(id);
    b.select();
  };

  useEffect(() => {
    const w = ws.current;
    if (!w) return;
    if (highlight) reveal(highlight);
    else w.highlightBlock(null);
  }, [highlight]);

  // mark blocks that have errors
  useEffect(() => {
    const w = ws.current;
    if (!w) return;
    for (const b of w.getAllBlocks(false)) {
      const bad = errorRefs.has(b.id);
      const svg = (b as Blockly.BlockSvg).getSvgRoot?.();
      svg?.classList.toggle('blk-error', bad);
    }
  }, [errorRefs]);

  useImperativeHandle(ref, () => ({
    insert(code, kind) {
      const w = ws.current;
      if (!w) return false;
      const frag = fragmentBlocks(code, kind);
      if (!frag) return false;
      const sel = Blockly.common.getSelected() as Blockly.BlockSvg | null;
      const metrics = w.getMetricsManager().getViewMetrics(true);
      let placed: Blockly.BlockSvg | null = null;
      frag.forEach((json: BJ, i: number) => {
        const b = Blockly.serialization.blocks.append(json as Blockly.serialization.blocks.State, w) as Blockly.BlockSvg;
        // attach a statement after the selected statement when possible
        if (i === 0 && kind === 'stmt' && sel && sel.nextConnection && b.previousConnection) {
          const after = sel.nextConnection.targetBlock();
          sel.nextConnection.connect(b.previousConnection);
          let last = b;
          while (last.getNextBlock()) last = last.getNextBlock() as Blockly.BlockSvg;
          if (after && last.nextConnection && after.previousConnection && !after.previousConnection.isConnected()) last.nextConnection.connect(after.previousConnection);
        } else {
          b.moveTo(new Blockly.utils.Coordinate(metrics.left + 60 + i * 24, metrics.top + 60 + i * 24));
        }
        placed ??= b;
      });
      if (placed) (placed as Blockly.BlockSvg).select();
      emitNow();
      return true;
    },
    reveal,
  }));

  const applyModule = (code: string) => {
    const w = ws.current;
    if (!w || !module) return;
    const b = w.getBlockById(module.id) as (Blockly.BlockSvg & { setCode(c: string): void; ir?: unknown }) | null;
    if (b) {
      b.setCode(code);
      b.ir = undefined;
      b.render();
    }
    setModule(null);
    emitNow();
  };

  return (
    <div className="editor-surface">
      <div ref={host} className="blockly-host" data-testid="block-editor" />
      {module && <ModuleDialog code={module.code} isStmt={module.isStmt} onApply={applyModule} onCancel={() => setModule(null)} />}
    </div>
  );
});

export function ModuleDialog({ code, isStmt, onApply, onCancel }: { code: string; isStmt: boolean; onApply: (c: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(code);
  return (
    <div className="module-dialog card" role="dialog" aria-label="Edit code module">
      <header>
        <h3>{isStmt ? 'Code module' : 'Value module'}</h3>
        <p className="muted">AutoScript, kept exactly as written. If it can be shown as {isStmt ? 'blocks or nodes' : 'a value'}, it will be after you apply.</p>
      </header>
      <div className="module-code">
        <CodeEditor value={code} onChange={setText} highlightLine={null} compact />
      </div>
      <footer>
        <button className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" onClick={() => onApply(text)}>
          Apply
        </button>
      </footer>
    </div>
  );
}
