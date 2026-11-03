// Programming symbols for touch keyboards: shown on touch devices under the code editor.
const SYMBOLS = ['(', ')', '{', '}', '[', ']', ';', '.', ',', '=', '"', '+', '-', '*', '/', '<', '>', '!', '&&', '||', '?', ':'];

export function SymbolBar({ onInsert }: { onInsert: (t: string) => void }) {
  return (
    <div className="symbol-bar" role="toolbar" aria-label="Programming symbols">
      <button onPointerDown={(e) => e.preventDefault()} onClick={() => onInsert('  ')} aria-label="Indent">
        ⇥
      </button>
      {SYMBOLS.map((s) => (
        <button key={s} onPointerDown={(e) => e.preventDefault()} onClick={() => onInsert(s)} aria-label={`Insert ${s}`}>
          {s}
        </button>
      ))}
    </div>
  );
}
