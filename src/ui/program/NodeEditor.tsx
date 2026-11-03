import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type ConnectionLineComponentProps,
  type Edge,
  type EdgeChange,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { NODE_MAP, portCompatible } from '../../program/nodeDefs';
import type { GraphNode, NodeGraph, PortType } from '../../program/types';
import { A, PORT_COLOR, PROG } from '../theme';

/** Node families: colour = what the node does (matches blocks and the hangar). */
export const NODE_FAMILIES: { key: string; label: string; color: string; types: string[] }[] = [
  { key: 'event', label: 'Events', color: PROG.event.fill, types: ['OnTick', 'OnStart', 'OnFailure'] },
  { key: 'flow', label: 'Flow & logic', color: PROG.logic.fill, types: ['Branch', 'Sequence', 'Compare', 'Logic'] },
  { key: 'sensor', label: 'Sensors', color: PROG.sensor.fill, types: ['NearestEnemy', 'ContactInfo', 'Self', 'WeaponStatus', 'CanFire', 'ThreatCount', 'ComponentOK', 'Status', 'Power', 'ShieldCharge'] },
  { key: 'move', label: 'Movement', color: PROG.move.fill, types: ['Drive', 'TurnToward', 'Stop'] },
  { key: 'weapon', label: 'Weapons', color: PROG.weapon.fill, types: ['EngageAll', 'AimAt', 'Fire', 'Reload'] },
  { key: 'system', label: 'Systems', color: PROG.system.fill, types: ['ShieldFace', 'RaiseShield', 'SetPower', 'Log'] },
  { key: 'data', label: 'Data', color: PROG.math.fill, types: ['Number', 'Bool', 'Math', 'AngleDiff', 'Random'] },
  { key: 'memory', label: 'Memory & state', color: PROG.memory.fill, types: ['GetVar', 'SetVar', 'StateIs', 'SetState', 'Timer', 'ResetTimer'] },
];
const FAMILY_OF: Record<string, (typeof NODE_FAMILIES)[number]> = Object.fromEntries(NODE_FAMILIES.flatMap((f) => f.types.map((t) => [t, f])));
export const familyOf = (type: string) => FAMILY_OF[type] ?? NODE_FAMILIES[6];

type GData = { gnode: GraphNode; onParam: (id: string, key: string, v: string | number | boolean) => void; traced: boolean; errored: boolean };
type FlowNode = Node<GData, 'graph'>;
type CableEdgeType = Edge<{ portType: PortType }, 'cable'>;

/** A wire leaving the jack horizontally and sagging slightly under its own weight. */
function cablePath(sx: number, sy: number, tx: number, ty: number) {
  const dx = tx - sx;
  const dist = Math.hypot(dx, ty - sy);
  const reach = Math.max(40, Math.abs(dx) * 0.45, Math.min(160, dist * 0.35));
  const sag = Math.min(70, dist * 0.18);
  return `M ${sx} ${sy} C ${sx + reach} ${sy + sag}, ${tx - reach} ${ty + sag}, ${tx} ${ty}`;
}

function CableEdge({ id, sourceX, sourceY, targetX, targetY, data, selected }: EdgeProps<CableEdgeType>) {
  const type = data?.portType ?? 'exec';
  const exec = type === 'exec';
  const d = cablePath(sourceX, sourceY, targetX, targetY);
  return (
    <g>
      <path d={d} fill="none" stroke={A.ivory} strokeWidth={exec ? 6 : 5} strokeLinecap="square" />
      <BaseEdge id={id} path={d} className="cable-core" style={{ stroke: PORT_COLOR[type], strokeWidth: exec ? 2.2 : 1.6 }} interactionWidth={16} />
      {exec && <path d={d} fill="none" stroke={A.ivory} strokeWidth={1} strokeDasharray="1 9" />}
      {selected && <path d={d} fill="none" stroke={A.ink} strokeWidth={4} strokeOpacity={0.25} />}
    </g>
  );
}

function CableConnectionLine({ fromX, fromY, toX, toY, fromHandle, connectionStatus }: ConnectionLineComponentProps) {
  const color = connectionStatus === 'invalid' ? A.rust : A.ink;
  const d = fromHandle?.type === 'target' ? cablePath(toX, toY, fromX, fromY) : cablePath(fromX, fromY, toX, toY);
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeDasharray="4 3" />
      <rect x={toX - 4} y={toY - 4} width={8} height={8} fill={A.ivory} stroke={color} strokeWidth={1.5} />
    </g>
  );
}

function GraphNodeView({ data, selected }: NodeProps<FlowNode>) {
  const def = NODE_MAP[data.gnode.type];
  if (!def) return <div className="card-node errored">Unknown node {data.gnode.type}</div>;
  const fam = familyOf(def.type);
  const rows = Math.max(def.inputs.length, def.outputs.length);
  return (
    <div className={`card-node gnode ${selected ? 'sel' : ''} ${data.traced ? 'traced' : ''} ${data.errored ? 'errored' : ''}`} style={{ ['--c' as string]: fam.color }} data-testid={`gnode-${data.gnode.id}`} title={def.description}>
      <div className="card-head">
        <span className="notch" />
        <b>{def.title}</b>
        <span>{fam.label}</span>
      </div>
      {(rows > 0 || def.params.length > 0) && (
        <div className="card-body">
          {Array.from({ length: rows }).map((_, i) => {
            const inp = def.inputs[i];
            const out = def.outputs[i];
            return (
              <div key={i} className="port-row">
                <span className="pin">
                  {inp && (
                    <>
                      <Handle type="target" position={Position.Left} id={inp.id} className={`port t-${inp.type}`} />
                      {inp.label || (inp.type === 'exec' ? 'run' : inp.id)}
                    </>
                  )}
                </span>
                <span className="pin out">
                  {out && (
                    <>
                      {out.label || (out.type === 'exec' ? 'then' : out.id)}
                      <Handle type="source" position={Position.Right} id={out.id} className={`port t-${out.type}`} />
                    </>
                  )}
                </span>
              </div>
            );
          })}
          {def.params.map((p) => {
            const v = data.gnode.params[p.id] ?? p.dflt;
            return (
              <label key={p.id} className="mparam nodrag">
                <span>{p.label}</span>
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
      )}
    </div>
  );
}

const nodeTypes = { graph: GraphNodeView };
const edgeTypes = { cable: CableEdge };

function portType(nodes: GraphNode[], nodeId: string, port: string, dir: 'in' | 'out') {
  const n = nodes.find((x) => x.id === nodeId);
  const def = n && NODE_MAP[n.type];
  return (dir === 'in' ? def?.inputs : def?.outputs)?.find((p) => p.id === port)?.type;
}

export interface NodeEditorHandle {
  addNode(type: string): void;
}

interface Props {
  graph: NodeGraph;
  onChange: (g: NodeGraph) => void;
  highlight: string | null;
  errorRefs: Set<string>;
}

const Inner = forwardRef<NodeEditorHandle, Props>(function Inner({ graph, onChange, highlight, errorRefs }, ref) {
  const flow = useReactFlow();
  const host = useRef<HTMLDivElement>(null);
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

  useImperativeHandle(ref, () => ({
    addNode(type: string) {
      const g = graphRef.current;
      const r = host.current?.getBoundingClientRect();
      const vp = flow.screenToFlowPosition({ x: r ? r.left + r.width / 2 : window.innerWidth / 2, y: r ? r.top + r.height / 2 : window.innerHeight / 2 });
      const id = `${type.toLowerCase()}_${Date.now().toString(36)}`;
      const def = NODE_MAP[type];
      const params = Object.fromEntries(def.params.map((p) => [p.id, p.dflt]));
      // nudge so repeated adds don't stack exactly
      const k = g.nodes.length % 5;
      onChange({ ...g, nodes: [...g.nodes, { id, type, x: Math.round(vp.x - 100 + k * 18), y: Math.round(vp.y - 50 + k * 18), params }] });
      setSelected([id]);
    },
  }));

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
  const edges: CableEdgeType[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        type: 'cable' as const,
        source: e.source,
        sourceHandle: e.sourcePort,
        target: e.target,
        targetHandle: e.targetPort,
        data: { portType: (portType(graph.nodes, e.source, e.sourcePort, 'out') ?? 'any') as PortType },
      })),
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
      nodes: g.nodes
        .filter((n) => ids.has(n.id))
        .map((n) => {
          const a = applied.find((x) => x.id === n.id)!;
          return { ...n, x: Math.round(a.position.x), y: Math.round(a.position.y) };
        }),
      edges: g.edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
    });
  };
  const onEdgesChange = (changes: EdgeChange<CableEdgeType>[]) => {
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

  useEffect(() => {
    if (!highlight) return;
    const n = graphRef.current.nodes.find((x) => x.id === highlight);
    if (n) flow.setCenter(n.x + 100, n.y + 50, { zoom: 1, duration: 300 });
  }, [highlight, flow]);

  return (
    <div ref={host} style={{ position: 'absolute', inset: 0 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        connectionLineComponent={CableConnectionLine}
        fitView
        fitViewOptions={{ padding: 0.08, minZoom: 0.85, maxZoom: 1.1 }}
        colorMode="light"
        deleteKeyCode={['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
        style={{ background: 'transparent' }}
      >
        <Background variant={BackgroundVariant.Dots} color={A.rule} gap={20} size={1.2} />
        <Background id="major" variant={BackgroundVariant.Lines} color="rgba(43,41,37,0.06)" gap={100} lineWidth={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
});

export const NodeEditor = forwardRef<NodeEditorHandle, Props>(function NodeEditor(props, ref) {
  return (
    <ReactFlowProvider>
      <div data-testid="node-editor" style={{ position: 'absolute', inset: 0 }}>
        <Inner ref={ref} {...props} />
      </div>
    </ReactFlowProvider>
  );
});
