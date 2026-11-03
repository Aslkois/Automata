import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Handle,
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
import { NODE_DEFS, NODE_MAP, portCompatible } from '../../program/nodeDefs';
import type { GraphNode, NodeGraph } from '../../program/types';

type GData = { gnode: GraphNode; onParam: (id: string, key: string, v: string | number | boolean) => void; traced: boolean; errored: boolean };
type FlowNode = Node<GData, 'graph'>;

function GraphNodeView({ data, selected }: NodeProps<FlowNode>) {
  const def = NODE_MAP[data.gnode.type];
  if (!def) return <div className="gnode errored">Unknown node {data.gnode.type}</div>;
  const rows = Math.max(def.inputs.length, def.outputs.length);
  return (
    <div className={`gnode ${selected ? 'selected' : ''} ${data.traced ? 'traced' : ''} ${data.errored ? 'errored' : ''}`} data-testid={`gnode-${data.gnode.id}`}>
      <div className="gnode-head">
        {def.title}
        <span className="cat">{def.category}</span>
      </div>
      <div className="gnode-body">
        {Array.from({ length: rows }).map((_, i) => {
          const inp = def.inputs[i];
          const out = def.outputs[i];
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              <div className="gport">
                {inp && (
                  <>
                    <Handle type="target" position={Position.Left} id={inp.id} className={`t-${inp.type}`} />
                    {inp.label || (inp.type === 'exec' ? '▶' : inp.id)}
                  </>
                )}
              </div>
              <div className="gport out">
                {out && (
                  <>
                    {out.label || (out.type === 'exec' ? '▶' : out.id)}
                    <Handle type="source" position={Position.Right} id={out.id} className={`t-${out.type}`} />
                  </>
                )}
              </div>
            </div>
          );
        })}
        {def.params.map((p) => {
          const v = data.gnode.params[p.id] ?? p.dflt;
          return (
            <label key={p.id} className="gparam nodrag">
              <span className="faint">{p.label}</span>
              {p.kind === 'select' ? (
                <select value={String(v)} onChange={(e) => data.onParam(data.gnode.id, p.id, e.target.value)}>
                  {p.options!.map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              ) : p.kind === 'bool' ? (
                <input type="checkbox" checked={!!v} onChange={(e) => data.onParam(data.gnode.id, p.id, e.target.checked)} />
              ) : (
                <input type={p.kind === 'number' ? 'number' : 'text'} step="any" value={String(v)} onChange={(e) => data.onParam(data.gnode.id, p.id, p.kind === 'number' ? Number(e.target.value) : e.target.value)} />
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

const nodeTypes = { graph: GraphNodeView };

function portType(nodes: GraphNode[], nodeId: string, port: string, dir: 'in' | 'out') {
  const n = nodes.find((x) => x.id === nodeId);
  const def = n && NODE_MAP[n.type];
  return (dir === 'in' ? def?.inputs : def?.outputs)?.find((p) => p.id === port)?.type;
}

function Inner({ graph, onChange, highlight, errorRefs }: { graph: NodeGraph; onChange: (g: NodeGraph) => void; highlight: string | null; errorRefs: Set<string> }) {
  const flow = useReactFlow();
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const [selected, setSelected] = useState<string[]>([]);

  const onParam = useCallback(
    (id: string, key: string, v: string | number | boolean) => {
      const g = graphRef.current;
      onChange({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, params: { ...n.params, [key]: v } } : n)) });
    },
    [onChange],
  );

  const nodes: FlowNode[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: 'graph' as const,
        position: { x: n.x, y: n.y },
        selected: selected.includes(n.id),
        data: { gnode: n, onParam, traced: highlight === n.id, errored: errorRefs.has(n.id) },
      })),
    [graph.nodes, onParam, highlight, errorRefs, selected],
  );
  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => {
        const t = portType(graph.nodes, e.source, e.sourcePort, 'out');
        return { id: e.id, source: e.source, sourceHandle: e.sourcePort, target: e.target, targetHandle: e.targetPort, animated: t === 'exec', style: { stroke: t === 'exec' ? '#e6e7ea' : '#55585f', strokeWidth: t === 'exec' ? 1.6 : 1.2 } };
      }),
    [graph],
  );

  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const sel = changes.filter((c) => c.type === 'select');
    if (sel.length) {
      setSelected((s) => {
        let next = s.slice();
        for (const c of sel) if (c.type === 'select') next = c.selected ? [...new Set([...next, c.id])] : next.filter((x) => x !== c.id);
        return next;
      });
    }
    const relevant = changes.filter((c) => c.type === 'position' || c.type === 'remove');
    if (!relevant.length) return;
    const applied = applyNodeChanges(relevant, nodes);
    const g = graphRef.current;
    const ids = new Set(applied.map((n) => n.id));
    onChange({
      nodes: g.nodes.filter((n) => ids.has(n.id)).map((n) => {
        const a = applied.find((x) => x.id === n.id)!;
        return { ...n, x: Math.round(a.position.x), y: Math.round(a.position.y) };
      }),
      edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    });
  };
  const onEdgesChange = (changes: EdgeChange[]) => {
    const rem = changes.filter((c) => c.type === 'remove');
    if (!rem.length) return;
    const kept = applyEdgeChanges(rem, edges);
    const g = graphRef.current;
    onChange({ ...g, edges: g.edges.filter((e) => kept.some((k) => k.id === e.id)) });
  };
  const isValidConnection = (c: Connection | Edge) => {
    const from = portType(graphRef.current.nodes, c.source!, c.sourceHandle!, 'out');
    const to = portType(graphRef.current.nodes, c.target!, c.targetHandle!, 'in');
    return !!from && !!to && portCompatible(from, to) && c.source !== c.target;
  };
  const onConnect = (c: Connection) => {
    const g = graphRef.current;
    const from = portType(g.nodes, c.source, c.sourceHandle!, 'out');
    // Data inputs take one connection; exec outputs drive one successor.
    const edgesKept = g.edges.filter((e) => (from === 'exec' ? !(e.source === c.source && e.sourcePort === c.sourceHandle) : !(e.target === c.target && e.targetPort === c.targetHandle)));
    const id = `e${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    onChange({ ...g, edges: [...edgesKept, { id, source: c.source, sourcePort: c.sourceHandle!, target: c.target, targetPort: c.targetHandle! }] });
  };

  const add = (type: string) => {
    const g = graphRef.current;
    const vp = flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const id = `${type.toLowerCase()}_${Date.now().toString(36)}`;
    const def = NODE_MAP[type];
    const params = Object.fromEntries(def.params.map((p) => [p.id, p.dflt]));
    onChange({ ...g, nodes: [...g.nodes, { id, type, x: Math.round(vp.x - 80), y: Math.round(vp.y - 40), params }] });
  };

  useEffect(() => {
    if (!highlight) return;
    const n = graphRef.current.nodes.find((x) => x.id === highlight);
    if (n) flow.setCenter(n.x + 80, n.y + 40, { zoom: 1, duration: 300 });
  }, [highlight, flow]);

  const cats = ['Events', 'Flow', 'Sensors', 'Actions', 'Data', 'Memory'] as const;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="node-palette" data-testid="node-palette">
        {cats.map((cat) => (
          <span key={cat} style={{ display: 'contents' }}>
            <span className="cat">{cat}</span>
            {NODE_DEFS.filter((d) => d.category === cat).map((d) => (
              <button key={d.type} className="btn small" title={d.description} onClick={() => add(d.type)}>
                {d.title}
              </button>
            ))}
          </span>
        ))}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          isValidConnection={isValidConnection}
          fitView
          colorMode="dark"
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={{ hideAttribution: true }}
          style={{ background: '#000' }}
        >
          <Background color="#1a1b1e" gap={24} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

export function NodeEditor(props: { graph: NodeGraph; onChange: (g: NodeGraph) => void; highlight: string | null; errorRefs: Set<string> }) {
  return (
    <ReactFlowProvider>
      <div data-testid="node-editor" style={{ position: 'absolute', inset: 0 }}>
        <Inner {...props} />
      </div>
    </ReactFlowProvider>
  );
}
