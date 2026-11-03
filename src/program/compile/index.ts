import { parseProgram } from '../interpreter';
import type { CompileResult, ProgramSource } from '../types';

export function compileProgram(p: ProgramSource): CompileResult {
  const js = p.code ?? '';
  const { diagnostics } = parseProgram(js);
  return {
    ok: diagnostics.length === 0,
    js,
    errors: diagnostics.map((d) => ({ message: d.message, line: d.line })),
    locMode: 'line',
    libraryFrom: p.libraryFrom,
  };
}
