// Blockly definitions for the brain's block view. Every block maps one-to-one onto an IR
// construct (see src/program/brain/blocks.ts); code modules hold exact AutoScript.
import * as Blockly from 'blockly/core';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { argKind, argLabel, CALL_MAP, calleeCategory, ENUM_OPTIONS } from '../../program/brain/catalog';
import { ARITH_OPS, ASSIGN_OPS, COMPARE_OPS, LOGIC_OPS } from '../../program/brain/ir';
import { CAT } from '../theme';

/** Ids of the current drone's parts, for the id pickers. Set by the editor. */
export const designIds = { weapon: [] as string[], shield: [] as string[], component: [] as string[] };
/** Opens the code module editor for a block. Set by the editor. */
export const moduleHooks = { edit: (_b: Blockly.Block) => {} };

const OP_LABEL: Record<string, string> = { '*': '×', '/': '÷', '**': '^', '&&': 'and', '||': 'or', '??': 'else if missing', '==': '=', '!=': '≠', '===': '≡', '!==': '≢', '<=': '≤', '>=': '≥' };
const opOptions = (ops: string[]) => ops.map((o) => [OP_LABEL[o] ?? o, o] as [string, string]);

const PENCIL = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><path d="M4 20h4L19 9l-4-4L4 16z M14 6l4 4" fill="none" stroke="#f3efe6" stroke-width="2" stroke-linejoin="round"/></svg>')}`;

let registered = false;
export function registerBlocks() {
  if (registered) return;
  registered = true;
  Blockly.setLocale(En as unknown as Record<string, string>);
  Blockly.ContextMenuRegistry.registry.unregister('blockDisable');

  const S = (cat: string) => `cat_${cat}`;
  const stmt = { previousStatement: null, nextStatement: null };
  Blockly.common.defineBlocksWithJsonArray([
    { type: 'ev_start', message0: 'when the brain starts %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], style: S('event'), tooltip: 'Top-level steps: run once, before the first decision. Variables declared here persist.' },
    { type: 'ev_tick', message0: 'every decision tick %1 %2', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], style: S('event'), tooltip: 'function update() — runs on every decision (10 Hz by default).' },
    { type: 'ev_failure', message0: 'when hardware fails, as %1 %2 %3', args0: [{ type: 'field_input', name: 'PARAM', text: 'event' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], style: S('event'), tooltip: 'function onFailure(event) — once per hardware failure, before the decision tick.' },
    { type: 'fn_def', message0: 'function %1 ( %2 ) %3 %4', args0: [{ type: 'field_input', name: 'NAME', text: 'doSomething' }, { type: 'field_input', name: 'PARAMS', text: '' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], style: S('function'), tooltip: 'A function. Parameters are comma-separated names.' },
    { type: 'decl', message0: '%1 %2 = %3', args0: [{ type: 'field_dropdown', name: 'KIND', options: [['let', 'let'], ['const', 'const'], ['var', 'var']] }, { type: 'field_input', name: 'NAME', text: 'memory' }, { type: 'input_value', name: 'VALUE' }], ...stmt, style: S('value'), tooltip: 'Declare a variable (leave the value empty for none).' },
    { type: 'assign', message0: 'set %1 %2 %3', args0: [{ type: 'field_input', name: 'NAME', text: 'memory' }, { type: 'field_dropdown', name: 'OP', options: opOptions(ASSIGN_OPS).map(([l, v]) => [v === '=' ? 'to' : l, v]) }, { type: 'input_value', name: 'VALUE' }], ...stmt, inputsInline: true, style: S('value'), tooltip: 'Change a variable.' },
    { type: 'assign_to', message0: 'set %1 %2 %3', args0: [{ type: 'input_value', name: 'TARGET' }, { type: 'field_dropdown', name: 'OP', options: opOptions(ASSIGN_OPS).map(([l, v]) => [v === '=' ? 'to' : l, v]) }, { type: 'input_value', name: 'VALUE' }], ...stmt, inputsInline: true, style: S('value'), tooltip: 'Change a property or list item.' },
    { type: 'update', message0: '%1 %2', args0: [{ type: 'field_input', name: 'NAME', text: 'count' }, { type: 'field_dropdown', name: 'OP', options: [['+1', '++'], ['−1', '--']] }], ...stmt, style: S('value'), tooltip: 'Add or subtract one.' },
    { type: 'eval_stmt', message0: 'evaluate %1', args0: [{ type: 'input_value', name: 'VALUE' }], ...stmt, style: S('value'), tooltip: 'Evaluate a value for its effect.' },
    { type: 'ctl_while', message0: 'while %1 %2 %3', args0: [{ type: 'input_value', name: 'COND' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], ...stmt, style: S('loop'), tooltip: 'Repeat while the condition holds (each step costs operations).' },
    { type: 'ctl_dowhile', message0: 'repeat %1 %2 while %3', args0: [{ type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }, { type: 'input_value', name: 'COND' }], ...stmt, style: S('loop'), tooltip: 'Run once, then repeat while the condition holds.' },
    { type: 'ctl_for', message0: 'loop: first %1 while %2 after each %3 %4', args0: [{ type: 'input_statement', name: 'INIT' }, { type: 'input_value', name: 'TEST', align: 'RIGHT' }, { type: 'input_statement', name: 'STEP' }, { type: 'input_statement', name: 'DO' }], ...stmt, style: S('loop'), tooltip: 'for (setup; condition; step) — the counting loop.' },
    { type: 'ctl_forof', message0: 'for each %1 %2 in %3 %4 %5', args0: [{ type: 'field_dropdown', name: 'KIND', options: [['const', 'const'], ['let', 'let'], ['var', 'var'], ['(existing)', 'none']] }, { type: 'field_input', name: 'NAME', text: 'item' }, { type: 'input_value', name: 'LIST' }, { type: 'input_dummy' }, { type: 'input_statement', name: 'DO' }], ...stmt, style: S('loop'), tooltip: 'Repeat for every item of a list.' },
    { type: 'ctl_flow', message0: '%1', args0: [{ type: 'field_dropdown', name: 'FLOW', options: [['leave the loop', 'break'], ['next iteration', 'continue']] }], ...stmt, style: S('loop') },
    { type: 'fn_return', message0: 'return %1', args0: [{ type: 'input_value', name: 'VALUE' }], ...stmt, style: S('function'), tooltip: 'Leave the function (with a value, optionally).' },
    { type: 'var_get', message0: '%1', args0: [{ type: 'field_input', name: 'NAME', text: 'memory' }], output: null, style: S('value'), tooltip: 'A variable, parameter or global.' },
    { type: 'prop_get', message0: '%1 . %2', args0: [{ type: 'input_value', name: 'OBJ' }, { type: 'field_input', name: 'PROP', text: 'distance' }], output: null, inputsInline: true, style: S('value'), tooltip: 'A property of an object (distance, bearing, x, y, ready…).' },
    { type: 'index_get', message0: '%1 [ %2 ]', args0: [{ type: 'input_value', name: 'OBJ' }, { type: 'input_value', name: 'INDEX' }], output: null, inputsInline: true, style: S('value'), tooltip: 'An item of a list (counting from 0).' },
    { type: 'op_arith', message0: '%1 %2 %3', args0: [{ type: 'input_value', name: 'A' }, { type: 'field_dropdown', name: 'OP', options: opOptions(ARITH_OPS) }, { type: 'input_value', name: 'B' }], output: null, inputsInline: true, style: S('math') },
    { type: 'op_compare', message0: '%1 %2 %3', args0: [{ type: 'input_value', name: 'A' }, { type: 'field_dropdown', name: 'OP', options: opOptions(COMPARE_OPS) }, { type: 'input_value', name: 'B' }], output: null, inputsInline: true, style: S('logic') },
    { type: 'op_logic', message0: '%1 %2 %3', args0: [{ type: 'input_value', name: 'A' }, { type: 'field_dropdown', name: 'OP', options: opOptions(LOGIC_OPS) }, { type: 'input_value', name: 'B' }], output: null, inputsInline: true, style: S('logic') },
    { type: 'op_unary', message0: '%1 %2', args0: [{ type: 'field_dropdown', name: 'OP', options: [['not', '!'], ['−', '-'], ['+', '+'], ['bitwise not', '~'], ['type of', 'typeof']] }, { type: 'input_value', name: 'X' }], output: null, inputsInline: true, style: S('logic') },
    { type: 'op_cond', message0: 'if %1 then %2 else %3', args0: [{ type: 'input_value', name: 'IF' }, { type: 'input_value', name: 'THEN' }, { type: 'input_value', name: 'ELSE' }], output: null, inputsInline: true, style: S('logic'), tooltip: 'Choose a value by condition.' },
  ]);

  // ---- calls (statement and value), with labelled arguments from the catalogue
  const callMixin = (isStmt: boolean) => ({
    init(this: Blockly.Block & { argCount: number }) {
      this.argCount = 0;
      const callee = new Blockly.FieldTextInput('drone.stop', (v: string) => {
        setTimeout(() => (this as unknown as { refresh(): void }).refresh(), 0);
        return v;
      });
      this.appendDummyInput('HEAD').appendField(callee, 'CALLEE');
      if (isStmt) {
        this.setPreviousStatement(true);
        this.setNextStatement(true);
      } else this.setOutput(true);
      this.setInputsInline(true);
      this.setStyle('cat_function');
    },
    refresh(this: Blockly.Block & { argCount: number }) {
      const callee = String(this.getFieldValue('CALLEE') ?? '');
      this.setStyle(`cat_${calleeCategory(callee)}`);
      const info = CALL_MAP[callee];
      this.setTooltip(info ? `${info.label}: ${info.doc}` : `Call ${callee}`);
      for (let i = 0; i < this.argCount; i++) {
        const inp = this.getInput('ARG' + i);
        const f = inp?.fieldRow[0];
        const want = argLabel(callee, i);
        if (f && f.getValue() !== want) f.setValue(want);
      }
    },
    setArgs(this: Blockly.Block & { argCount: number }, n: number) {
      while (this.argCount < n) {
        const i = this.argCount++;
        this.appendValueInput('ARG' + i).appendField(new Blockly.FieldLabel(argLabel(String(this.getFieldValue('CALLEE') ?? ''), i), 'arg-label'));
      }
      while (this.argCount > n) this.removeInput('ARG' + --this.argCount);
      (this as unknown as { refresh(): void }).refresh();
    },
    saveExtraState(this: Blockly.Block & { argCount: number }) {
      return { args: this.argCount };
    },
    loadExtraState(this: Blockly.Block & { argCount: number; setArgs(n: number): void }, s: { args?: number }) {
      this.setArgs(Number(s?.args ?? 0));
    },
    customContextMenu(this: Blockly.BlockSvg & { argCount: number; setArgs(n: number): void }, options: Array<Blockly.ContextMenuRegistry.ContextMenuOption | Blockly.ContextMenuRegistry.LegacyContextMenuOption>) {
      options.push({ text: 'Add argument', enabled: true, callback: () => this.setArgs(this.argCount + 1) } as Blockly.ContextMenuRegistry.LegacyContextMenuOption);
      if (this.argCount > 0) options.push({ text: 'Remove last argument', enabled: true, callback: () => this.setArgs(this.argCount - 1) } as Blockly.ContextMenuRegistry.LegacyContextMenuOption);
      const info = CALL_MAP[String(this.getFieldValue('CALLEE'))];
      if (info) options.push({ text: `About ${info.callee}: ${info.doc.slice(0, 60)}${info.doc.length > 60 ? '…' : ''}`, enabled: false, callback: () => {} } as Blockly.ContextMenuRegistry.LegacyContextMenuOption);
    },
  });
  Blockly.Blocks['call_stmt'] = callMixin(true);
  Blockly.Blocks['call_expr'] = callMixin(false);

  // ---- id picker: a string literal naming one of this drone's parts
  Blockly.Blocks['id_pick'] = {
    init(this: Blockly.Block & { kind: string }) {
      this.kind = 'weapon';
      const opts = (): [string, string][] => {
        const cur = String(this.getFieldValue?.('ID') ?? '');
        const list = (designIds as Record<string, string[]>)[this.kind] ?? ENUM_OPTIONS[this.kind as keyof typeof ENUM_OPTIONS] ?? [];
        const all = [...new Set([...(cur ? [cur] : []), ...list])];
        return all.length ? all.map((x) => [x, x]) : [['F.H1', 'F.H1']];
      };
      this.appendDummyInput().appendField(new Blockly.FieldDropdown(opts as Blockly.MenuGenerator), 'ID');
      this.setOutput(true, null);
      this.setStyle('cat_value');
      this.setTooltip('A choice: one of this drone’s parts by mount id, or a fixed option such as a side or ammunition type (text).');
    },
    saveExtraState(this: Blockly.Block & { kind: string }) {
      return { kind: this.kind };
    },
    loadExtraState(this: Blockly.Block & { kind: string }, s: { kind?: string }) {
      this.kind = s?.kind ?? 'weapon';
    },
  };

  // ---- notes and code modules: multi-line, rebuilt from extra state
  Blockly.Blocks['note'] = {
    init(this: Blockly.Block & { lines: number; trail?: boolean }) {
      this.lines = 0;
      this.setPreviousStatement(true);
      this.setNextStatement(true);
      this.setStyle('cat_note');
      this.setTooltip('A note for people. It does not run.');
      (this as unknown as { setLines(n: number): void }).setLines(1);
    },
    setLines(this: Blockly.Block & { lines: number }, n: number) {
      while (this.lines < n) {
        const i = this.lines++;
        this.appendDummyInput('L' + i).appendField(i === 0 ? '//' : '  ').appendField(new Blockly.FieldTextInput(''), 'L' + i);
      }
      while (this.lines > n) this.removeInput('L' + --this.lines);
    },
    saveExtraState(this: Blockly.Block & { lines: number; trail?: boolean }) {
      return { lines: this.lines, ...(this.trail ? { trail: true } : {}) };
    },
    loadExtraState(this: Blockly.Block & { lines: number; trail?: boolean; setLines(n: number): void }, s: { lines?: number; trail?: boolean }) {
      this.setLines(Math.max(1, Number(s?.lines ?? 1)));
      this.trail = !!s?.trail;
    },
    customContextMenu(this: Blockly.Block & { lines: number; setLines(n: number): void }, options: unknown[]) {
      options.push({ text: 'Add a line', enabled: true, callback: () => this.setLines(this.lines + 1) });
      if (this.lines > 1) options.push({ text: 'Remove last line', enabled: true, callback: () => this.setLines(this.lines - 1) });
    },
  };

  const MAX_LINES = 14;
  const moduleMixin = (isStmt: boolean) => ({
    init(this: Blockly.Block & { code: string; ir?: unknown }) {
      this.code = '';
      if (isStmt) {
        this.setPreviousStatement(true);
        this.setNextStatement(true);
      } else this.setOutput(true);
      this.setStyle('cat_code');
      this.setTooltip('Code module: AutoScript kept exactly as written and run unchanged. Click the pencil to edit.');
      (this as unknown as { render_(): void }).render_();
    },
    render_(this: Blockly.Block & { code: string }) {
      for (const inp of [...this.inputList]) this.removeInput(inp.name);
      const lines = this.code.split('\n');
      const head = this.appendDummyInput('HEAD');
      head.appendField(new Blockly.FieldImage(PENCIL, 14, 14, 'Edit code', () => moduleHooks.edit(this)));
      head.appendField(new Blockly.FieldLabel(isStmt ? 'code' : 'value', 'blk-code-tag'));
      if (!isStmt && lines.length === 1) {
        head.appendField(new Blockly.FieldLabel(lines[0], 'blk-code'));
        return;
      }
      lines.slice(0, MAX_LINES).forEach((l, i) => this.appendDummyInput('C' + i).appendField(new Blockly.FieldLabel(l.replace(/\t/g, '  ') || ' ', 'blk-code')));
      if (lines.length > MAX_LINES) this.appendDummyInput('MORE').appendField(new Blockly.FieldLabel(`… ${lines.length - MAX_LINES} more lines`, 'blk-code-tag'));
    },
    setCode(this: Blockly.Block & { code: string; ir?: unknown; render_(): void }, code: string) {
      this.code = code;
      this.render_();
    },
    saveExtraState(this: Blockly.Block & { code: string; ir?: unknown }) {
      return this.ir !== undefined ? { code: this.code, ir: this.ir } : { code: this.code };
    },
    loadExtraState(this: Blockly.Block & { code: string; ir?: unknown; render_(): void }, s: { code?: string; ir?: unknown }) {
      this.code = String(s?.code ?? '');
      this.ir = s?.ir;
      this.render_();
    },
    customContextMenu(this: Blockly.Block, options: unknown[]) {
      options.push({ text: 'Edit code…', enabled: true, callback: () => moduleHooks.edit(this) });
    },
  });
  Blockly.Blocks['code_stmt'] = moduleMixin(true);
  Blockly.Blocks['code_expr'] = moduleMixin(false);
}

const style = (c: string) => ({ colourPrimary: c, colourSecondary: c, colourTertiary: '#1d1d1c' });
export function blockTheme() {
  const blockStyles: Record<string, ReturnType<typeof style>> = {};
  for (const [k, v] of Object.entries(CAT)) blockStyles[`cat_${k}`] = style(v.color);
  blockStyles.cat_note = { colourPrimary: '#e3ddcf', colourSecondary: '#e3ddcf', colourTertiary: '#9a978f' };
  // built-ins
  blockStyles.logic_blocks = style(CAT.logic.color);
  blockStyles.math_blocks = style(CAT.math.color);
  blockStyles.text_blocks = style(CAT.value.color);
  blockStyles.list_blocks = style(CAT.value.color);
  blockStyles.loop_blocks = style(CAT.loop.color);
  blockStyles.variable_blocks = style(CAT.value.color);
  blockStyles.procedure_blocks = style(CAT.function.color);
  blockStyles.hat_blocks = style(CAT.event.color);
  return Blockly.Theme.defineTheme('automata-machine', {
    name: 'automata-machine',
    base: Blockly.Themes.Classic,
    blockStyles,
    componentStyles: {
      workspaceBackgroundColour: '#f3efe6',
      flyoutBackgroundColour: '#e9e3d6',
      flyoutForegroundColour: '#2c2c2a',
      flyoutOpacity: 1,
      scrollbarColour: '#cfc6b4',
      scrollbarOpacity: 1,
      insertionMarkerColour: '#2f6f8f',
      insertionMarkerOpacity: 0.35,
      cursorColour: '#2f6f8f',
      selectedGlowColour: '#2f6f8f',
    },
    fontStyle: { family: 'Instrument Sans, system-ui, sans-serif', weight: '600', size: 12.5 },
    startHats: true,
  });
}

export { argKind };
