import { useEffect, useRef } from 'react';

export function Splitter({ width, onResize, min = 240, max = 720 }: {
  width: number; onResize: (width: number) => void; min?: number; max?: number;
}) {
  const drag = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      if (!drag.current) return;
      const next = drag.current.w - (event.clientX - drag.current.x);
      onResize(Math.min(max, Math.max(min, next)));
    };
    const up = () => { drag.current = null; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [max, min, onResize]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize Mermaid panel"
      className="w-1 shrink-0 cursor-col-resize bg-line/40 hover:bg-accent"
      onMouseDown={(event) => { drag.current = { x: event.clientX, w: width }; }}
    />
  );
}
