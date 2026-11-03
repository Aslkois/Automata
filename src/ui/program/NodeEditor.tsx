import { createContext, forwardRef, memo, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CALL_MAP, calleeCategory } from '../../program/brain/catalog';
import { inlineText, isValueNode, nodeSize, parseInline, portsOf, snippetToGraph, type GEdge, type GNode, type GraphDoc } from '../../program/brain/graph';
import { ARITH_OPS, ASSIGN_OPS, COMPARE_OPS, LOGIC_OPS, newId, type Expr } from '../../program/brain/ir';
import { CAT } from '../theme';
import type { EditorHandle } from './BlockEditor';

interface Props {
  doc: GraphDoc;
  onChange: (g: GraphDoc) => void;
  highlight: string | null;
  errors: Map<string, string>;
  ids: { weapon: string[]; shield: string[]; component: string[] };
}

type FlowNode = Node<{ g: GNode }, 'brain'>;

interface Ctx {
  connected: Set<string>;
  onData: (id: string, patch: Record<string, unknown>) => void;
  onInline: (id: string, port: string, text: string) => void;
  highlight: string | null;
  errors: Map<string, string>;
  ids: Props['ids'];
}
const NodeCtx = createContext<Ctx | null>(null);

const OP_LABEL: Record<string, string> = { '*': '×', '/': '÷', '&&': 'and', '||': 'or', '??': 'otherwise', '!': 'not', '==': '=', '!=': '≠', '<=': '≤', '>=': '≥' };

function categoryOf(n: GNode): string {
  switch (n.t) {
    case 'entry':
      return n.d.role === 'func' ? 'function' : 'event';
    case 'call':
      return calleeCategory(String(n.d.callee ?? ''));
    case 'if':
    case 'cond':
    case 'unary':
      return 'logic';
    case 'binary':
      return ARITH_OPS.includes(n.d.op as never) ? 'math' : 'logic';
    case 'while':
    case 'dowhile':
    case 'for':
    case 'forof':
    case 'break':
    case 'continue':
      return 'loop';
    case 'return':
      return 'function';
    case 'code':
    case 'codev':
      return 'code';
    case 'note':
      return 'note';
    default:
      return 'value';
  }
}

function TextField({ value, onCommit, label, mono = true, wide = false }: { value: string; onCommit: (v: string) => void; label: string; mono?: boolean; wide?: boolean }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      className={`nf nodrag ${mono ? 'mono' : ''} ${wide ? 'wide' : ''}`}
      aria-label={label}
      value={v}
      size={Math.max(3, Math.min(24, v.length + 1))}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setV(value);
        e.stopPropagation();
      }}
    />
  );
}

function Select({ value, options, onChange, label }: { value: string; options: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <select className="nf nodrag" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o} value={o}>
          {OP_LABEL[o] ?? o}
        </option>
      ))}
    </select>
  );
}

function CodeArea({ value, onCommit, label, rows }: { value: string; onCommit: (v: string) => void; label: string; rows: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <textarea className="ncode nodrag nowheel" aria-label={label} value={v} rows={rows} spellCheck={false} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} onKeyDown={(e) => e.stopPropagation()} />;
}

function Title({ n }: { n: GNode }) {
  const c = useContext(NodeCtx)!;
  const set = (patch: Record<string, unknown>) => c.onData(n.id, patch);
  const d = n.d;
  switch (n.t) {
    case 'entry':
      if (d.role === 'tick') return <span className="nt">Every decision tick</span>;
      if (d.role === 'start') return <span className="nt">When the brain starts</span>;
      if (d.role === 'failure')
        return (
          <span className="nt">
            When hardware fails, as <TextField label="Failure parameter" value={String((d.params as string[])?.[0] ?? 'event')} onCommit={(v) => set({ params: [v] })} />
          </span>
        );
      return (
        <span className="nt">
          function <TextField label="Function name" value={String(d.name ?? '')} onCommit={(v) => set({ name: v })} /> (
          <TextField label="Parameters" value={((d.params as string[]) ?? []).join(', ')} onCommit={(v) => set({ params: v.split(',').map((x) => x.trim()).filter(Boolean) })} />)
        </span>
      );
    case 'decl':
      return (
        <span className="nt">
          <Select label="Declaration kind" value={String(d.kind)} options={['let', 'const', 'var']} onChange={(v) => set({ kind: v })} /> <TextField label="Variable name" value={String(d.name)} onCommit={(v) => set({ name: v })} />
        </span>
      );
    case 'assign':
      return (
        <span className="nt">
          set {typeof d.name === 'string' && <TextField label="Variable name" value={String(d.name)} onCommit={(v) => set({ name: v })} />} <Select label="Operator" value={String(d.op)} options={ASSIGN_OPS} onChange={(v) => set({ op: v })} />
        </span>
      );
    case 'update':
      return (
        <span className="nt">
          <TextField label="Variable name" value={String(d.name)} onCommit={(v) => set({ name: v })} /> <Select label="Operator" value={String(d.op)} options={['++', '--']} onChange={(v) => set({ op: v })} />
        </span>
      );
    case 'call': {
      const info = CALL_MAP[String(d.callee)];
      return (
        <span className="nt call">
          <TextField label="Function" value={String(d.callee)} onCommit={(v) => set({ callee: v, n: CALL_MAP[v] ? CALL_MAP[v].params.filter((p) => !p.optional).length : d.n })} />
          {info && <small>{info.label}</small>}
        </span>
      );
    }
    case 'eval':
      return <span className="nt">evaluate</span>;
    case 'if':
      return <span className="nt">if</span>;
    case 'while':
      return <span className="nt">while</span>;
    case 'dowhile':
      return <span className="nt">repeat … while</span>;
    case 'for':
      return <span className="nt">loop</span>;
    case 'forof':
      return (
        <span className="nt">
          for each <Select label="Declaration kind" value={String(d.kind || 'none')} options={['const', 'let', 'var', 'none']} onChange={(v) => set({ kind: v === 'none' ? '' : v })} /> <TextField label="Loop variable" value={String(d.name)} onCommit={(v) => set({ name: v })} />
        </span>
      );
    case 'break':
      return <span className="nt">leave the loop</span>;
    case 'continue':
      return <span className="nt">next iteration</span>;
    case 'return':
      return <span className="nt">return</span>;
    case 'note':
      return <span className="nt">Note</span>;
    case 'code':
      return <span className="nt">Code module</span>;
    case 'codev':
      return <span className="nt">Value module</span>;
    case 'get':
      return (
        <span className="nt">
          <TextField label="Variable name" value={String(d.name)} onCommit={(v) => set({ name: v })} />
        </span>
      );
    case 'member':
      return (
        <span className="nt">
          .<TextField label="Property" value={String(d.prop)} onCommit={(v) => set({ prop: v })} />
        </span>
      );
    case 'index':
      return <span className="nt">item at</span>;
    case 'unary':
      return (
        <span className="nt">
          <Select label="Operator" value={String(d.op)} options={['!', '-', '+', '~', 'typeof']} onChange={(v) => set({ op: v })} />
        </span>
      );
    case 'binary':
      return (
        <span className="nt">
          <Select label="Operator" value={String(d.op)} options={[...ARITH_OPS, ...COMPARE_OPS, ...LOGIC_OPS]} onChange={(v) => set({ op: v })} />
        </span>
      );
    case 'cond':
      return <span className="nt">choose</span>;
    case 'array':
      return <span className="nt">list</span>;
  }
}

function InlineField({ n, port, hint }: { n: GNode; port: string; hint?: string }) {
  const c = useContext(NodeCtx)!;
  const cur = n.d.inl?.[port];
  const text = cur ? inlineText(cur) : '';
  const [v, setV] = useState(text);
  useEffect(() => setV(text), [text]);
  const list = hint === 'weapon' || hint === 'shield' || hint === 'component' ? `ids-${hint}` : undefined;
  return (
    <input
      className={`inl nodrag mono ${cur ? '' : 'empty'}`}
      aria-label={`${port} value`}
      list={list}
      placeholder="—"
      value={v}
      size={Math.max(2, Math.min(18, v.length + 1))}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== text && c.onInline(n.id, port, v)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setV(text);
        e.stopPropagation();
      }}
    />
  );
}

const BrainNode = memo(function BrainNode({ data, selected }: NodeProps<FlowNode>) {
  const c = useContext(NodeCtx)!;
  const n = data.g;
  const p = portsOf(n);
  const execIn = p.inputs.find((x) => x.exec);
  const dataIns = p.inputs.filter((x) => !x.exec);
  const next = p.outputs.find((x) => x.id === 'next');
  const value = p.outputs.find((x) => x.id === 'value');
  const sideOuts = p.outputs.filter((x) => x.id !== 'next' && x.id !== 'value');
  const cat = categoryOf(n);
  const err = c.errors.get(n.id);
  const sz = nodeSize(n);
  const rows = Math.max(dataIns.length, sideOuts.length);
  const variadic = n.t === 'call' && (!CALL_MAP[String(n.d.callee)] || CALL_MAP[String(n.d.callee)].variadic || Number(n.d.n) < CALL_MAP[String(n.d.callee)].params.length);
  return (
    <div className={`bn c-${cat} ${isValueNode(n) ? 'val' : 'step'} ${selected ? 'sel' : ''} ${c.highlight === n.id ? 'traced' : ''} ${err ? 'err' : ''}`} style={{ width: sz.w, ['--cat' as string]: cat === 'note' ? '#cfc6b4' : CAT[cat]?.color }} title={err}>
      <div className="bn-head">
        {execIn && <Handle type="target" position={Position.Left} id="in" className="h exec" />}
        <Title n={n} />
        {next && <Handle type="source" position={Position.Right} id="next" className="h exec" />}
        {value && <Handle type="source" position={Position.Right} id="value" className="h data" />}
      </div>
      {n.t === 'note' && <CodeArea label="Note" rows={Math.max(1, String(n.d.text ?? '').split('\n').length)} value={String(n.d.text ?? '')} onCommit={(v) => c.onData(n.id, { text: v })} />}
      {(n.t === 'code' || n.t === 'codev') && <CodeArea label="Code" rows={Math.min(16, Math.max(1, String(n.d.code ?? '').split('\n').length))} value={String(n.d.code ?? '')} onCommit={(v) => c.onData(n.id, { code: v, ir: undefined })} />}
      {rows > 0 && (
        <div className="bn-rows">
          {Array.from({ length: rows }, (_, i) => {
            const ip = dataIns[i];
            const op = sideOuts[i];
            return (
              <div className="bn-row" key={i}>
                <span className="bn-in">
                  {ip && (
                    <>
                      <Handle type="target" position={Position.Left} id={ip.id} className="h data" />
                      {ip.label && <span className="pl">{ip.label}</span>}
                      {!c.connected.has(`${n.id}:${ip.id}`) && <InlineField n={n} port={ip.id} hint={ip.hint} />}
                    </>
                  )}
                </span>
                <span className="bn-out">
                  {op && (
                    <>
                      <span className="pl">{op.label}</span>
                      <Handle type="source" position={Position.Right} id={op.id} className="h exec" />
                    </>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {(variadic || n.t === 'array') && (
        <div className="bn-foot nodrag">
          <button onClick={() => c.onData(n.id, { n: Number(n.d.n ?? 0) + 1 })} aria-label="Add input">
            + input
          </button>
          {Number(n.d.n ?? 0) > 0 && (
            <button onClick={() => c.onData(n.id, { n: Number(n.d.n) - 1 })} aria-label="Remove input">
              − input
            </button>
          )}
        </div>
      )}
      {n.d.doc !== undefined && <p className="bn-doc">{String(n.d.doc)}</p>}
    </div>
  );
});

const nodeTypes = { brain: BrainNode };

const Inner = forwardRef<EditorHandle, Props>(function Inner({ doc, onChange, highlight, errors, ids }, ref) {
  const flow = useReactFlow();
  const host = useRef<HTMLDivElement>(null);
  const [graph, setGraph] = useState(doc);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const [selected, setSelected] = useState<string[]>([]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const commit = useCallback((g: GraphDoc) => {
    graphRef.current = g;
    setGraph(g);
    onChangeRef.current(g);
  }, []);

  const connected = useMemo(() => new Set(graph.edges.filter((e) => e.tp !== 'in').map((e) => `${e.t}:${e.tp}`)), [graph.edges]);

  const onData = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      const g = graphRef.current;
      const nodes = g.nodes.map((n) => {
        if (n.id !== id) return n;
        const d = { ...n.d, ...patch };
        for (const k of Object.keys(patch)) if (patch[k] === undefined) delete d[k];
        return { ...n, d };
      });
      // ports that no longer exist lose their connections
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const edges = g.edges.filter((e) => {
        const s = byId.get(e.s);
        const t = byId.get(e.t);
        if (!s || !t) return false;
        return portsOf(s).outputs.some((p) => p.id === e.sp) && portsOf(t).inputs.some((p) => p.id === e.tp);
      });
      commit({ nodes, edges });
    },
    [commit],
  );

  const onInline = useCallback(
    (id: string, port: string, text: string) => {
      const g = graphRef.current;
      const node = g.nodes.find((n) => n.id === id);
      if (!node) return;
      const r = parseInline(text);
      const inl = { ...(node.d.inl ?? {}) };
      if (!text.trim()) {
        delete inl[port];
        commit({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, d: { ...n.d, inl } } : n)) });
        return;
      }
      if (!r.expr) return; // invalid: the field keeps showing what was typed until fixed or escaped
      const e = r.expr;
      if (e.k === 'num' || e.k === 'str' || e.k === 'bool' || e.k === 'null' || e.k === 'ident') {
        const prev = inl[port];
        inl[port] = { ...e, id: prev?.id ?? e.id } as Expr;
        commit({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, d: { ...n.d, inl } } : n)) });
        return;
      }
      // a compound expression typed inline becomes value nodes wired into the port
      const frag = snippetToGraph(text, 'expr');
      if (!frag) return;
      delete inl[port];
      const root = frag.nodes.find((n) => !frag.edges.some((x) => x.s === n.id));
      const maxX = Math.max(...frag.nodes.map((n) => n.x + nodeSize(n).w));
      const dx = node.x - 40 - maxX;
      const dy = node.y + 40;
      const nodes = [...g.nodes.map((n) => (n.id === id ? { ...n, d: { ...n.d, inl } } : n)), ...frag.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy }))];
      const edges = [...g.edges, ...frag.edges, ...(root ? [{ id: `${root.id}:value>${id}:${port}`, s: root.id, sp: 'value', t: id, tp: port }] : [])];
      commit({ nodes, edges });
    },
    [commit],
  );

  const flowNodes: FlowNode[] = useMemo(() => graph.nodes.map((n) => ({ id: n.id, type: 'brain' as const, position: { x: n.x, y: n.y }, selected: selected.includes(n.id), data: { g: n } })), [graph.nodes, selected]);
  const flowEdges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.s,
        sourceHandle: e.sp,
        target: e.t,
        targetHandle: e.tp,
        className: e.tp === 'in' ? 'ex' : 'da',
        type: e.tp === 'in' ? 'smoothstep' : 'default',
      })),
    [graph.edges],
  );

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const sel = changes.filter((c) => c.type === 'select');
    if (sel.length)
      setSelected((s) => {
        let next = s.slice();
        for (const c of sel) if (c.type === 'select') next = c.selected ? [...new Set([...next, c.id])] : next.filter((x) => x !== c.id);
        return next;
      });
    const moving = changes.filter((c) => c.type === 'position');
    const removing = changes.filter((c) => c.type === 'remove');
    if (!moving.length && !removing.length) return;
    const applied = applyNodeChanges([...moving, ...removing], flowNodes);
    const g = graphRef.current;
    const pos = new Map(applied.map((n) => [n.id, n.position]));
    const nodes = g.nodes.filter((n) => pos.has(n.id)).map((n) => ({ ...n, x: Math.round(pos.get(n.id)!.x), y: Math.round(pos.get(n.id)!.y) }));
    const next = { nodes, edges: g.edges.filter((e) => pos.has(e.s) && pos.has(e.t)) };
    const done = removing.length > 0 || moving.some((c) => c.type === 'position' && c.dragging === false);
    if (done) commit(next);
    else {
      graphRef.current = next;
      setGraph(next);
    }
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    const rem = new Set(changes.filter((c) => c.type === 'remove').map((c) => (c as { id: string }).id));
    if (!rem.size) return;
    const g = graphRef.current;
    commit({ ...g, edges: g.edges.filter((e) => !rem.has(e.id)) });
  };
  const isExecPort = (nodeId: string, port: string, dir: 'in' | 'out') => {
    const n = graphRef.current.nodes.find((x) => x.id === nodeId);
    if (!n) return null;
    const p = (dir === 'in' ? portsOf(n).inputs : portsOf(n).outputs).find((x) => x.id === port);
    return p ? p.exec : null;
  };
  const isValidConnection = (c: Connection | Edge) => {
    if (c.source === c.target) return false;
    const a = isExecPort(c.source!, c.sourceHandle!, 'out');
    const b = isExecPort(c.target!, c.targetHandle!, 'in');
    return a !== null && b !== null && a === b;
  };
  const onConnect = (c: Connection) => {
    const g = graphRef.current;
    const exec = isExecPort(c.source, c.sourceHandle!, 'out');
    // an input takes one connection; an execution output leads to one step
    const kept = g.edges.filter((e) => (exec ? !(e.s === c.source && e.sp === c.sourceHandle) && !(e.t === c.target && e.tp === 'in') : !(e.t === c.target && e.tp === c.targetHandle)));
    const nodes = exec ? g.nodes : g.nodes.map((n) => (n.id === c.target && n.d.inl?.[c.targetHandle!] ? { ...n, d: { ...n.d, inl: Object.fromEntries(Object.entries(n.d.inl).filter(([k]) => k !== c.targetHandle)) } } : n));
    const e: GEdge = { id: `${c.source}:${c.sourceHandle}>${c.target}:${c.targetHandle}`, s: c.source, sp: c.sourceHandle!, t: c.target, tp: c.targetHandle! };
    commit({ nodes, edges: [...kept, e] });
  };

  useEffect(() => {
    if (!highlight) return;
    const n = graphRef.current.nodes.find((x) => x.id === highlight);
    if (n) {
      const s = nodeSize(n);
      flow.setCenter(n.x + s.w / 2, n.y + s.h / 2, { zoom: Math.max(flow.getZoom(), 0.9), duration: 250 });
      setSelected([n.id]);
    }
  }, [highlight, flow]);

  useImperativeHandle(ref, () => ({
    insert(code, kind) {
      const frag = snippetToGraph(code, kind);
      if (!frag || !frag.nodes.length) return false;
      const g = graphRef.current;
      // fresh ids so repeated inserts never collide
      const map = new Map(frag.nodes.map((n) => [n.id, newId()]));
      const r = host.current?.getBoundingClientRect();
      const c = flow.screenToFlowPosition({ x: r ? r.left + r.width * 0.45 : 400, y: r ? r.top + r.height * 0.4 : 300 });
      const minX = Math.min(...frag.nodes.map((n) => n.x));
      const minY = Math.min(...frag.nodes.map((n) => n.y));
      const nodes = frag.nodes.map((n) => ({ ...n, id: map.get(n.id)!, x: Math.round(n.x - minX + c.x), y: Math.round(n.y - minY + c.y) }));
      const edges = frag.edges.map((e) => ({ ...e, s: map.get(e.s)!, t: map.get(e.t)!, id: `${map.get(e.s)}:${e.sp}>${map.get(e.t)}:${e.tp}` }));
      let allEdges = [...g.edges, ...edges];
      // a step inserted while a step is selected is wired in after it
      const selNode = g.nodes.find((n) => selected.length === 1 && n.id === selected[0] && portsOf(n).outputs.some((p) => p.id === 'next'));
      if (kind === 'stmt' && selNode) {
        const head = nodes.find((n) => !edges.some((e) => e.t === n.id && e.tp === 'in') && portsOf(n).inputs.some((p) => p.exec));
        let tail = head;
        for (let guard = 0; tail && guard < 100; guard++) {
          const nx = edges.find((e) => e.s === tail!.id && e.sp === 'next');
          if (!nx) break;
          tail = nodes.find((n) => n.id === nx.t);
        }
        if (head && tail) {
          const old = allEdges.find((e) => e.s === selNode.id && e.sp === 'next');
          allEdges = allEdges.filter((e) => e !== old);
          allEdges.push({ id: `${selNode.id}:next>${head.id}:in`, s: selNode.id, sp: 'next', t: head.id, tp: 'in' });
          if (old) allEdges.push({ id: `${tail.id}:next>${old.t}:in`, s: tail.id, sp: 'next', t: old.t, tp: 'in' });
          const dx = selNode.x + nodeSize(selNode).w + 60 - nodes[0].x;
          const dy = selNode.y - nodes[0].y;
          for (const n of nodes) {
            n.x += dx;
            n.y += dy + 120;
          }
        }
      }
      commit({ nodes: [...g.nodes, ...nodes], edges: allEdges });
      setSelected(nodes.slice(0, 1).map((n) => n.id));
      return true;
    },
    reveal(id) {
      const n = graphRef.current.nodes.find((x) => x.id === id);
      if (n) flow.setCenter(n.x + 100, n.y + 40, { zoom: 1, duration: 250 });
    },
  }));

  const ctx = useMemo<Ctx>(() => ({ connected, onData, onInline, highlight, errors, ids }), [connected, onData, onInline, highlight, errors, ids]);

  return (
    <NodeCtx.Provider value={ctx}>
      <div ref={host} className="flow-host">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          fitView
          fitViewOptions={{ padding: 0.12, minZoom: 0.6, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.6}
          colorMode="light"
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={{ hideAttribution: true }}
          snapToGrid
          snapGrid={[4, 4]}
        >
          <Background variant={BackgroundVariant.Dots} color="#cfc6b4" gap={24} size={1.3} />
          <Controls showInteractive={false} position="bottom-right" />
          <MiniMap pannable zoomable position="bottom-left" nodeColor={(n) => CAT[categoryOf((n.data as { g: GNode }).g)]?.color ?? '#9a978f'} maskColor="rgba(233,227,214,0.7)" style={{ width: 160, height: 100 }} />
        </ReactFlow>
        {(['weapon', 'shield', 'component'] as const).map((k) => (
          <datalist key={k} id={`ids-${k}`}>
            {ids[k].map((x) => (
              <option key={x} value={JSON.stringify(x)} />
            ))}
          </datalist>
        ))}
      </div>
    </NodeCtx.Provider>
  );
});

export const NodeEditor = forwardRef<EditorHandle, Props>(function NodeEditor(props, ref) {
  return (
    <ReactFlowProvider>
      <div data-testid="node-editor" className="editor-surface">
        <Inner ref={ref} {...props} />
      </div>
    </ReactFlowProvider>
  );
});
