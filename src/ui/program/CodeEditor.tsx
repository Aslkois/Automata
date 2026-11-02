import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { linter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
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
    '&': { backgroundColor: '#000', color: '#e6e7ea', fontSize: '13px', height: '100%' },
    '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', caretColor: '#5fa8a8' },
    '.cm-gutters': { backgroundColor: '#0a0a0b', color: '#4f5258', border: 'none', borderRight: '1px solid #1c1d20' },
    '.cm-activeLine': { backgroundColor: '#0d0e10' },
    '.cm-activeLineGutter': { backgroundColor: '#111215' },
    '.cm-selectionBackground, ::selection': { backgroundColor: '#1d3536 !important' },
    '.cm-cursor': { borderLeftColor: '#5fa8a8' },
    '.cm-trace-line': { backgroundColor: '#2b2614' },
    '.cm-tooltip': { backgroundColor: '#141517', border: '1px solid #34363b', color: '#e6e7ea' },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: '#1d3536', color: '#fff' },
    '.cm-diagnostic-error': { borderLeft: '3px solid #d0605a' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #d0605a' },
    '.cm-foldPlaceholder': { backgroundColor: '#1a1b1e', border: 'none', color: '#8a8d94' },
  },
  { dark: true },
);

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

export function CodeEditor({ value, onChange, highlightLine, readOnly = false }: { value: string; onChange?: (v: string) => void; highlightLine: number | null; readOnly?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          javascript(),
          theme,
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
}
