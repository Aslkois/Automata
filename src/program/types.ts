// Program source formats (versioned). All three interfaces compile to AutoScript and run
// on the same interpreter against the same drone API.

export const PROGRAM_SCHEMA_VERSION = 1;

export type ProgramKind = 'code' | 'blocks' | 'nodes';

/** Blockly JSON serialization (workspace state). */
export interface BlocksState {
  blocks?: { languageVersion?: number; blocks: BlockJson[] };
  variables?: { name: string; id: string }[];
}

export interface BlockJson {
  type: string;
  id: string;
  x?: number;
  y?: number;
  fields?: Record<string, unknown>;
  inputs?: Record<string, { block?: BlockJson; shadow?: BlockJson }>;
  next?: { block?: BlockJson };
  extraState?: Record<string, unknown>;
  [k: string]: unknown;
}

export type PortType = 'exec' | 'number' | 'boolean' | 'contact' | 'string' | 'any';

export interface GraphNode {
  id: string;
  type: string;
  x: number;
  y: number;
  /** literal parameters edited inside the node (e.g. constant value, weapon id) */
  params: Record<string, string | number | boolean>;
}

export interface GraphEdge {
  id: string;
  source: string;
  sourcePort: string;
  target: string;
  targetPort: string;
}

export interface NodeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ProgramSource {
  schema: number;
  id: string;
  name: string;
  kind: ProgramKind;
  code?: string;
  blocks?: BlocksState;
  nodes?: NodeGraph;
}

export interface CompileResult {
  ok: boolean;
  js: string;
  errors: { message: string; line?: number; ref?: string }[];
  locMode: 'line' | 'marker';
  markerKind?: 'block' | 'node';
}
