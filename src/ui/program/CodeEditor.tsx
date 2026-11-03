import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { linter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { API_DOCS } from '../../program/apiDocs';
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

const theme = EditorView.theme(
  {
    '&': { backgroundColor: '#f4f0e6', color: '#2b2925', fontSize: '13.5px', height: '100%' },
    '.cm-content': { fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, Consolas, monospace", caretColor: '#2b2925', padding: '12px 0', fontVariantLigatures: 'none' },
    '.cm-gutters': { backgroundColor: '#ece6d8', color: '#8f8676', border: 'none', borderRight: '1px solid #b7ad98' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px' },
    '.cm-activeLine': { backgroundColor: 'rgba(221, 213, 195, 0.45)' },
    '.cm-activeLineGutter': { backgroundColor: '#ddd5c3', color: '#2b2925' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(77, 106, 138, 0.22) !important' },
    '.cm-cursor': { borderLeftColor: '#2b2925', borderLeftWidth: '2px' },
    '.cm-matchingBracket': { backgroundColor: 'transparent', outline: '1px solid #2b2925' },
    '.cm-trace-line': { backgroundColor: '#2b2925', color: '#f4f0e6' },
    '.cm-trace-line span': { color: '#f4f0e6 !important' },
    '.cm-tooltip': { backgroundColor: '#f4f0e6', border: '1px solid #2b2925', borderRadius: '0', color: '#2b2925' },
    '.cm-tooltip-autocomplete > ul': { fontFamily: "'IBM Plex Mono', monospace" },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px !important' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#2b2925', color: '#f4f0e6' },
    '.cm-completionInfo': { backgroundColor: '#ece6d8', border: '1px solid #b7ad98' },
    '.cm-diagnostic-error': { borderLeft: '3px solid #9b3b2a', backgroundColor: '#efdcd3', color: '#9b3b2a' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #9b3b2a' },
    '.cm-foldPlaceholder': { backgroundColor: '#ddd5c3', border: 'none', color: '#6b6357' },
  },
  { dark: false },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: '#5e5348', fontWeight: '600' },
  { tag: [t.string, t.special(t.string)], color: '#4f6a5c' },
  { tag: [t.number, t.bool, t.null], color: '#8a6a2e' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#8f8676', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#3f5a78' },
  { tag: t.propertyName, color: '#4a5d74' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#2b2925', fontWeight: '600' },
  { tag: [t.operator, t.arithmeticOperator, t.logicOperator, t.compareOperator], color: '#874333' },
  { tag: [t.variableName], color: '#2b2925' },
  { tag: [t.punctuation, t.bracket], color: '#6b6357' },
]);

const KEYWORDS = ['function', 'let', 'const', 'var', 'if', 'else', 'for', 'of', 'in', 'while', 'do', 'return', 'break', 'continue', 'switch', 'case', 'default', 'true', 'false', 'null', 'typeof'];
const GLOBALS = ['drone', 'Math', 'angleDiff', 'clamp', 'rad', 'deg', 'String', 'Number', 'parseInt', 'parseFloat', 'isNaN', 'update', 'onFailure'];

function complete(ctx: CompletionContext): CompletionResult | null {
  const member = ctx.matchBefore(/drone\.\w*/);
  if (member) {
    return {
      from: member.from + 6,
      options: API_DOCS.filter((d) => d.sig.startsWith('drone.')).map((d) => ({ label: d.name, type: 'function', detail: d.sig.replace(/^drone\.\w+/, ''), info: `${d.doc}${d.returns ? ` → ${d.returns}` : ''}`, apply: d.name })),
    };
  }
  const word = ctx.matchBefore(/\w+/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return {
    from: word.from,
    options: [
      ...GLOBALS.map((g) => ({ label: g, type: 'variable', info: API_DOCS.find((d) => d.name === g)?.doc })),
      ...KEYWORDS.map((k) => ({ label: k, type: 'keyword' })),
    ],
  };
}

const autoscriptLinter = linter((view) => {
  const { diagnostics } = parseProgram(view.state.doc.toString());
  return diagnostics.map<CmDiagnostic>((d) => ({ from: Math.min(d.from, view.state.doc.length), to: Math.min(Math.max(d.to, d.from + 1), view.state.doc.length), severity: 'error', message: d.message }));
});

export interface CodeEditorHandle {
  insert(text: string): void;
}

export const CodeEditor = forwardRef<CodeEditorHandle, { value: string; onChange?: (v: string) => void; highlightLine: number | null; readOnly?: boolean }>(function CodeEditor({ value, onChange, highlightLine, readOnly = false }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useImperativeHandle(ref, () => ({
    insert(text: string) {
      const v = view.current;
      if (!v || readOnly) return;
      v.dispatch(v.state.replaceSelection(text));
      v.focus();
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
          ...(readOnly ? [] : [autocompletion({ override: [complete] }), autoscriptLinter]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
    // Parent keys this component by program id; external value changes replace the doc below.
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

  return <div ref={host} className="cm-host" data-testid="code-editor" />;
});
