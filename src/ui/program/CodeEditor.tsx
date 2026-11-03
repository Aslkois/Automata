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
    '&': { backgroundColor: '#1b2030', color: '#f7f7f2', fontSize: '13.5px', height: '100%' },
    '.cm-content': { fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", caretColor: '#ffd23f', padding: '10px 0' },
    '.cm-gutters': { backgroundColor: '#15161c', color: '#6f7486', border: 'none', borderRight: '2px solid #000' },
    '.cm-activeLine': { backgroundColor: '#222842' },
    '.cm-activeLineGutter': { backgroundColor: '#23262f', color: '#f7f7f2' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(47,107,255,0.45) !important' },
    '.cm-cursor': { borderLeftColor: '#ffd23f', borderLeftWidth: '2px' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(255,210,63,0.25)', outline: 'none' },
    '.cm-trace-line': { backgroundColor: 'rgba(255,210,63,0.22)', boxShadow: 'inset 4px 0 0 #ffd23f' },
    '.cm-tooltip': { backgroundColor: '#23262f', border: '2px solid #000', borderRadius: '8px', color: '#f7f7f2', overflow: 'hidden' },
    '.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px !important' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#ffd23f', color: '#15161c' },
    '.cm-completionInfo': { backgroundColor: '#15161c' },
    '.cm-diagnostic-error': { borderLeft: '4px solid #e8455c', backgroundColor: '#4a1620', color: '#ffb3bd' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #e8455c' },
    '.cm-foldPlaceholder': { backgroundColor: '#343846', border: 'none', color: '#c9ccd8' },
  },
  { dark: true },
);

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: '#cd8fff', fontWeight: '700' },
  { tag: [t.string, t.special(t.string)], color: '#5fd9bb' },
  { tag: [t.number, t.bool, t.null], color: '#ffd23f' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#8e97b8', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#9cc3ff' },
  { tag: t.propertyName, color: '#9cc3ff' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: '#ffb066' },
  { tag: [t.operator, t.arithmeticOperator, t.logicOperator, t.compareOperator], color: '#ff8fae' },
  { tag: [t.variableName], color: '#f7f7f2' },
  { tag: [t.punctuation, t.bracket], color: '#c9ccd8' },
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
