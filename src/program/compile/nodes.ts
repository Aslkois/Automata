// Headless compiler: node graph -> AutoScript. Validates port types, required inputs,
// data cycles and exec cycles. Each exec node is prefixed with __at("<nodeId>").
import { identFor, NODE_MAP, portCompatible, type NodeGenCtx } from '../nodeDefs';
import type { CompileResult, GraphEdge, GraphNode, NodeGraph } from '../types';
import { PRELUDE } from './prelude';

export function validateGraph(g: NodeGraph): CompileResult['errors'] {
  const errors: CompileResult['errors'] = [];
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const n of g.nodes) if (!NODE_MAP[n.type]) errors.push({ message: `unknown node type '${n.type}'`, ref: n.id });
  const seenIn = new Set<string>();
  const seenExecOut = new Set<string>();
  for (const e of g.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      errors.push({ message: `connection ${e.id} references a missing node` });
      continue;
    }
    const sp = NODE_MAP[s.type]?.outputs.find((p) => p.id === e.sourcePort);
    const tp = NODE_MAP[t.type]?.inputs.find((p) => p.id === e.targetPort);
    if (!sp || !tp) {
      errors.push({ message: `connection ${e.id} uses an unknown port`, ref: t.id });
      continue;
    }
    if (!portCompatible(sp.type, tp.type)) errors.push({ message: `${NODE_MAP[s.type].title}.${sp.label || sp.id} (${sp.type}) cannot connect to ${NODE_MAP[t.type].title}.${tp.label || tp.id} (${tp.type})`, ref: t.id });
    if (tp.type !== 'exec') {
      const k = `${e.target}:${e.targetPort}`;
      if (seenIn.has(k)) errors.push({ message: `${NODE_MAP[t.type].title}: input '${tp.label}' has more than one connection`, ref: t.id });
      seenIn.add(k);
    } else {
      const k = `${e.source}:${e.sourcePort}`;
      if (seenExecOut.has(k)) errors.push({ message: `${NODE_MAP[s.type].title}: an exec output can only connect once (use a Sequence node)`, ref: s.id });
      seenExecOut.add(k);
    }
  }
  return errors;
}

export function compileNodes(g: NodeGraph): CompileResult {
  const errors = validateGraph(g ?? { nodes: [], edges: [] });
  const fail = (): CompileResult => ({ ok: false, js: '', errors, locMode: 'marker', markerKind: 'node' });
  if (errors.length) return fail();
  const byId = new Map<string, GraphNode>(g.nodes.map((n) => [n.id, n]));
  const inEdge = new Map<string, GraphEdge>();
  const outExec = new Map<string, GraphEdge>();
  for (const e of g.edges) {
    const t = byId.get(e.target)!;
    const tp = NODE_MAP[t.type].inputs.find((p) => p.id === e.targetPort)!;
    if (tp.type === 'exec') outExec.set(`${e.source}:${e.sourcePort}`, e);
    else inEdge.set(`${e.target}:${e.targetPort}`, e);
  }
  const vars = new Set<string>();
  for (const n of g.nodes) if (n.type === 'GetVar' || n.type === 'SetVar') vars.add('mem_' + identFor(n.params.name ?? 'memory'));

  const exprStack: string[] = [];
  const expr = (nodeId: string, port: string): string => {
    const n = byId.get(nodeId)!;
    const def = NODE_MAP[n.type];
    if (exprStack.includes(nodeId)) {
      errors.push({ message: `data cycle through ${def.title}`, ref: nodeId });
      return 'null';
    }
    if (!def.expr) {
      errors.push({ message: `${def.title} has no data outputs`, ref: nodeId });
      return 'null';
    }
    exprStack.push(nodeId);
    const r = def.expr(ctxFor(n, ''), port);
    exprStack.pop();
    return r;
  };

  const execStack: string[] = [];
  const execFrom = (nodeId: string, port: string, ind: string): string => {
    const e = outExec.get(`${nodeId}:${port}`);
    if (!e) return '';
    return stmtOf(e.target, ind);
  };
  const stmtOf = (nodeId: string, ind: string): string => {
    const n = byId.get(nodeId)!;
    const def = NODE_MAP[n.type];
    if (execStack.includes(nodeId)) {
      errors.push({ message: `execution loop through ${def.title} (use a variable and the next decision tick instead)`, ref: nodeId });
      return '';
    }
    if (!def.stmt) {
      errors.push({ message: `${def.title} cannot be executed`, ref: nodeId });
      return '';
    }
    execStack.push(nodeId);
    const body = def.stmt(ctxFor(n, ind));
    execStack.pop();
    return `${ind}__at(${JSON.stringify(n.id)});\n${body}`;
  };

  function ctxFor(n: GraphNode, ind: string): NodeGenCtx {
    const def = NODE_MAP[n.type];
    return {
      ind,
      q: (s) => JSON.stringify(String(s)),
      param: (id) => n.params[id] ?? def.params.find((p) => p.id === id)?.dflt ?? '',
      in: (port) => {
        const e = inEdge.get(`${n.id}:${port}`);
        if (e) return expr(e.source, e.sourcePort);
        const pd = def.inputs.find((p) => p.id === port);
        if (pd?.dflt !== undefined) return pd.dflt;
        errors.push({ message: `${def.title}: required input '${pd?.label ?? port}' is not connected`, ref: n.id });
        return 'null';
      },
      exec: (port) => execFrom(n.id, port, ind + (def.type === 'Branch' ? '  ' : '')),
    };
  }

  let start = '';
  let update = '';
  let failure = '';
  const events = [...g.nodes].filter((n) => NODE_MAP[n.type]?.event).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const n of events) {
    const ev = NODE_MAP[n.type].event;
    const indent = ev === 'start' ? '' : '  ';
    const code = `${indent}__at(${JSON.stringify(n.id)});\n` + execFrom(n.id, 'out', indent);
    if (ev === 'start') start += code;
    else if (ev === 'update') update += code;
    else failure += code;
  }
  if (!events.length) errors.push({ message: 'graph has no event node (Every Decision Tick, On Start or On Hardware Failure)' });
  if (errors.length) return fail();
  let js = PRELUDE + "var __state = 'patrol';\n";
  if (vars.size) js += `var ${[...vars].join(', ')};\n`;
  js += start;
  if (update) js += `function update() {\n${update}}\n`;
  if (failure) js += `function onFailure(event) {\n${failure}}\n`;
  return { ok: true, js, errors: [], locMode: 'marker', markerKind: 'node' };
}
