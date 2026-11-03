// Brain -> runnable program. The runtime executes exactly the printed IR (plus helpers
// appended after it, so line numbers in traces are lines of the printed text).
import { parseProgram } from '../interpreter';
import type { ProgramSource } from '../types';
import { indexIR, irHash, type BrainIR } from './ir';
import { printIR, type Printed } from './print';
import { helpersFor } from './stdlib';

export interface CompiledBrain {
  program: ProgramSource;
  printed: Printed;
  hash: string;
  errors: { message: string; line?: number; ref?: string }[];
}

const cache = new Map<string, CompiledBrain>();

export function compileBrain(ir: BrainIR, id = 'brain', name = 'brain'): CompiledBrain {
  const hash = irHash(ir);
  const key = `${id}\u0000${name}\u0000${hash}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const printed = printIR(ir);
  const helpers = helpersFor(ir, printed.text);
  const code = helpers ? `${printed.text}\n${helpers}\n` : printed.text;
  const { diagnostics } = parseProgram(code);
  const errors: CompiledBrain['errors'] = diagnostics.map((d) => ({ message: d.message, line: d.line, ref: printed.lineIds[d.line] ?? undefined }));
  if (!ir.body.some((s) => s.k === 'func' && (s.name === 'update' || s.name === 'onFailure')) && !ir.body.some((s) => s.k !== 'func' && s.k !== 'note'))
    errors.push({ message: 'the brain does nothing yet: add "every decision tick" (function update)' });
  const libraryFrom = helpers ? printed.text.split('\n').length + 1 : undefined;
  const out: CompiledBrain = { program: { schema: 2, id, name, code, ...(libraryFrom ? { libraryFrom } : {}) }, printed, hash, errors };
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}

/** Map a runtime trace line back to the IR id that produced it. */
export function idForLine(printed: Printed, line: number): string | null {
  return printed.lineIds[line] ?? null;
}

export function idExists(ir: BrainIR, id: string): boolean {
  return indexIR(ir).has(id);
}
