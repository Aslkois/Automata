import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { linter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, keymap, type DecorationSet } from '@codemirror/view';
import { CALLS } from '../../program/brain/catalog';
import { parseProgram } from '../../program/interpreter';

const setHighlight = StateEffect.define<number | null>();
const highlightField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setHighlight)) continue;
      if (e.value === null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
      const line = tr.state.doc.line(e.value);
      return Decoration.set([Decoration.line({ class: 'cm-trace-line' }).range(line.from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

const MONO = "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";
const theme = EditorView.theme(
  {
    '&': { backgroundColor: '#f6f3ec', color: '#2c2c2a', fontSize: '14px', height: '100%' },
    '.cm-scroller': { fontFamily: MONO, lineHeight: '1.6' },
    '.cm-content': { caretColor: '#2f6f8f', padding: '14px 0', fontVariantLigatures: 'none' },
    '.cm-gutters': { backgroundColor: '#ece7dc', color: '#9a978f', border: 'none', borderRight: '1px solid #ddd5c5' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 16px' },
    '.cm-activeLine': { backgroundColor: 'rgba(47, 111, 143, 0.05)' },
    '.cm-activeLineGutter': { backgroundColor: '#e2dccf', color: '#2c2c2a' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(47, 111, 143, 0.2) !important' },
    '.cm-cursor': { borderLeftColor: '#2f6f8f', borderLeftWidth: '2px' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(47,111,143,0.12)', outline: '1px solid rgba(47,111,143,0.5)' },
    '.cm-trace-line': { backgroundColor: 'rgba(47, 111, 143, 0.16)', boxShadow: 'inset 3px 0 0 #2f6f8f' },
    '.cm-tooltip': { backgroundColor: '#f6f3ec', border: '1px solid #cfc6b4', borderRadius: '6px', color: '#2c2c2a', boxShadow: '0 8px 24px rgba(29,29,28,.14)' },
    '.cm-tooltip-autocomplete > ul': { fontFamily: MONO, fontSize: '13px' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px !important' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#2f6f8f', color: '#f6f3ec' },
    '.cm-completionInfo': { backgroundColor: '#ece7dc', border: '1px solid #cfc6b4', borderRadius: '6px', fontFamily: 'Instrument Sans, sans-serif', fontSize: '13px', padding: '8px 10px', maxWidth: '340px' },
    '.cm-completionDetail': { color: '#5d5c58', marginLeft: '10px', fontStyle: 'normal' },
    '.cm-diagnostic-error': { borderLeft: '3px solid #a8402b', backgroundColor: '#f4e2db', color: '#7f2e1f' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #a8402b' },
    '.cm-foldPlaceholder': { backgroundColor: '#ddd5c5', border: 'none', color: '#5d5c58' },
  },
  { dark: false },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: '#24566f', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#37806c' },
  { tag: [t.number, t.bool, t.null], color: '#9a7128' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#8a877f', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#3f62a0' },
  { tag: t.propertyName, color: '#4b5a6e' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#2c2c2a', fontWeight: '600' },
  { tag: [t.operator, t.arithmeticOperator, t.logicOperator, t.compareOperator], color: '#a1452f' },
  { tag: [t.variableName], color: '#2c2c2a' },
  { tag: [t.punctuation, t.bracket], color: '#76705f' },
]);

const KEYWORDS = ['function', 'let', 'const', 'var', 'if', 'else', 'for', 'of', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default', 'true', 'false', 'null', 'typeof'];
const GLOBALS = ['drone', 'Math', 'update', 'onFailure', 'String', 'Number'];

function complete(ctx: CompletionContext): CompletionResult | null {
  const member = ctx.matchBefore(/(drone|Math)\.\w*/);
  if (member) {
    const obj = member.text.split('.')[0];
    return {
      from: member.from + obj.length + 1,
      options: CALLS.filter((c) => c.callee.startsWith(obj + '.')).map((c) => ({ label: c.callee.slice(obj.length + 1), type: 'function', detail: `(${c.params.map((p) => p.name + (p.optional ? '?' : '')).join(', ')})${c.returns ? ` → ${c.returns}` : ''}`, info: c.doc })),
    };
  }
  const word = ctx.matchBefore(/\w+/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return {
    from: word.from,
    options: [
      ...CALLS.filter((c) => !c.callee.includes('.')).map((c) => ({ label: c.callee, type: 'function', detail: `(${c.params.map((p) => p.name).join(', ')})`, info: c.doc })),
      ...GLOBALS.map((g) => ({ label: g, type: 'variable' })),
      ...KEYWORDS.map((k) => ({ label: k, type: 'keyword' })),
    ],
  };
}

const autoscriptLinter = linter(
  (view) => {
    const { diagnostics } = parseProgram(view.state.doc.toString());
    return diagnostics.map<CmDiagnostic>((d) => ({ from: Math.min(d.from, view.state.doc.length), to: Math.min(Math.max(d.to, d.from + 1), view.state.doc.length), severity: 'error', message: d.message }));
  },
  { delay: 250 },
);

export interface CodeHandle {
  insert(text: string): void;
  revealLine(line: number): void;
}

interface Props {
  value: string;
  onChange?: (v: string) => void;
  highlightLine: number | null;
  readOnly?: boolean;
  compact?: boolean;
}

export const CodeEditor = forwardRef<CodeHandle, Props>(function CodeEditor({ value, onChange, highlightLine, readOnly = false, compact = false }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const v = view.current;
      if (!v || readOnly) return;
      const sel = v.state.selection.main;
      const line = v.state.doc.lineAt(sel.head);
      // statements go on their own line, indented like the current one
      const multi = text.includes('\n') || (text.length > 2 && (text.endsWith(';') || text.endsWith('}')));
      if (multi && line.text.trim() !== '') {
        const indent = /^\s*/.exec(line.text)![0];
        const ins = '\n' + text.split('\n').map((l) => indent + l).join('\n');
        v.dispatch({ changes: { from: line.to, insert: ins }, selection: { anchor: line.to + ins.length } });
      } else if (multi) {
        const indent = /^\s*/.exec(line.text)![0];
        const ins = text.split('\n').map((l, i) => (i === 0 ? l : indent + l)).join('\n');
        v.dispatch(v.state.replaceSelection(ins));
      } else v.dispatch(v.state.replaceSelection(text));
      v.focus();
    },
    revealLine(line: number) {
      const v = view.current;
      if (!v || line < 1 || line > v.state.doc.lines) return;
      v.dispatch({ effects: [setHighlight.of(line), EditorView.scrollIntoView(v.state.doc.line(line).from, { y: 'center' })] });
    },
  }));

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          javascript(),
          theme,
          syntaxHighlighting(highlight),
          highlightField,
          EditorState.readOnly.of(readOnly),
          EditorState.tabSize.of(2),
          keymap.of([]),
          ...(readOnly ? [] : [autocompletion({ override: [complete], icons: false }), autoscriptLinter]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    if (compact) v.focus();
    return () => v.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    v.dispatch({ effects: setHighlight.of(highlightLine) });
    if (highlightLine && highlightLine <= v.state.doc.lines) v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.line(highlightLine).from, { y: 'center' }) });
  }, [highlightLine]);

  return <div ref={host} className={`cm-host ${compact ? 'compact' : ''}`} data-testid={compact ? 'module-editor' : 'code-editor'} />;
});
