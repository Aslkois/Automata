// Legacy program (schema 1: separate code / block / node programs) -> AutoScript source.
// Used only by the library migration; the result is parsed into a brain.
import { compileBlocks } from './blocks';
import { compileNodes } from './nodes';
import { PRELUDE } from './prelude';
import type { LegacyProgram } from './types';

const RENAMES: [RegExp, string][] = [
  [/\b__aimAtContact\(/g, 'aimAtContact('],
  [/\b__turnTowardContact\(/g, 'turnTowardContact('],
  [/\b__engageAll\(/g, 'engageAll('],
  [/\b__shieldFaceContact\(/g, 'shieldFaceContact('],
  [/\b__canFire\(/g, 'canFireAt('],
  [/\b__listItem\(/g, 'itemAt('],
  [/\b__state\b/g, 'state'],
];

export function legacyToCode(p: LegacyProgram): { code: string; errors: string[] } {
  if (p.kind === 'code') return { code: p.code ?? '', errors: [] };
  const r = p.kind === 'blocks' ? compileBlocks(p.blocks ?? {}) : compileNodes(p.nodes ?? { nodes: [], edges: [] });
  let js = r.js.startsWith(PRELUDE) ? r.js.slice(PRELUDE.length) : r.js;
  js = js
    .split('\n')
    .filter((l) => !/^\s*__at\(".*"\);\s*$/.test(l))
    .join('\n');
  for (const [re, to] of RENAMES) js = js.replace(re, to);
  const header = `// Migrated from the ${p.kind === 'blocks' ? 'block' : 'node'} program "${p.name}".\n`;
  return { code: header + js, errors: r.errors.map((e) => e.message) };
}
