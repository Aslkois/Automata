import { parseProgram } from '../interpreter';
import type { CompileResult, ProgramSource } from '../types';
import { compileBlocks } from './blocks';
import { compileNodes } from './nodes';

export function compileProgram(p: ProgramSource): CompileResult {
  if (p.kind === 'blocks') return compileBlocks(p.blocks ?? {});
  if (p.kind === 'nodes') return compileNodes(p.nodes ?? { nodes: [], edges: [] });
  const js = p.code ?? '';
  const { diagnostics } = parseProgram(js);
  return {
    ok: diagnostics.length === 0,
    js,
    errors: diagnostics.map((d) => ({ message: d.message, line: d.line })),
    locMode: 'line',
  };
}

export { compileBlocks, compileNodes };
