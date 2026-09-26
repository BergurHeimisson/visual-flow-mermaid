import { useEffect, useRef, useState } from 'react';

export function InlineEditor({ value, x, y, w, h, onCommit, onCancel }: {
  value: string; x: number; y: number; w: number; h: number;
  onCommit: (value: string) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  // Enter and Escape both settle the editor (commit / cancel) before the host unmounts it.
  // Per spec, removing a focused element from the document fires a native blur — a guard
  // that only covers Escape (as in the brief) lets that trailing blur commit a second time
  // for a single Enter. `settled` makes the keyboard paths and the blur path mutually
  // exclusive, whichever fires first.
  const settled = useRef(false);

  useEffect(() => { ref.current?.select(); }, []);

  return (
    <input
      ref={ref}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          settled.current = true;
          onCommit(draft);
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          settled.current = true;
          onCancel();
        }
      }}
      onBlur={() => {
        if (settled.current) return;
        settled.current = true;
        onCommit(draft);
      }}
      style={{ position: 'absolute', left: x, top: y, width: w, height: h }}
      className="z-10 rounded border-2 border-accent bg-surface px-2 text-center text-[13px] text-ink outline-none"
    />
  );
}
