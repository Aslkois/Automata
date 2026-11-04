// A runnable program: AutoScript source executed by the sandboxed interpreter against the
// drone API. Brains (src/program/brain) are compiled to this form for deployment.
export const PROGRAM_SCHEMA_VERSION = 2;

export interface ProgramSource {
  schema: number;
  id: string;
  name: string;
  code: string;
  /** first line of appended library helpers (traces inside them report the caller's line) */
  libraryFrom?: number;
}

export interface CompileResult {
  ok: boolean;
  js: string;
  errors: { message: string; line?: number; ref?: string }[];
  locMode: 'line' | 'marker';
  markerKind?: 'block' | 'node';
  libraryFrom?: number;
}
