import { useCallback, useEffect, useRef, useState } from 'react';
import { DRAG_THRESHOLD, type DragPayload, type DragTarget } from '../dnd';

/**
 * One pointer-event drag gesture, shared by every drag source in the app.
 *
 * `pointerdown` on a source only arms a *potential* drag; the drag (and with it the drop
 * zones) starts once the pointer has moved past `DRAG_THRESHOLD`, so a plain click still
 * selects or inserts. The source captures the pointer, so the gesture survives leaving the
 * element — including leaving the palette for the canvas, which is the whole point.
 *
 * Move/up/cancel are listened for on `window` rather than on the source: pointer capture
 * retargets those events to the capturing element but they still bubble, so one set of
 * listeners serves both the palette buttons and the canvas boxes without either component
 * knowing anything about the other.
 */
export type DragState = { payload: DragPayload; target: DragTarget | null };

type Pending = {
  payload: DragPayload;
  pointerId: number;
  el: Element;
  x0: number;
  y0: number;
  /** Has the pointer moved past the threshold? Only then is this a drag. */
  armed: boolean;
};

export type DragHandlers = {
  resolve: (payload: DragPayload, clientX: number, clientY: number) => DragTarget | null;
  commit: (payload: DragPayload, target: DragTarget) => void;
};

/**
 * A drag that actually moved must not also fire the source's `onClick`: Chromium fires
 * `click` on the element that held the capture, so dropping a palette item would insert
 * twice — once from the drop, once from the click. Swallow exactly one click, and drop the
 * listener on the next task in case no click follows (a drag released over the canvas).
 */
function swallowNextClick(): void {
  const stop = (event: MouseEvent) => { event.stopPropagation(); event.preventDefault(); };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, true), 0);
}

export function useDrag({ resolve, commit }: DragHandlers): {
  drag: DragState | null;
  startDrag: (payload: DragPayload, event: { button: number; pointerId: number; currentTarget: Element; clientX: number; clientY: number }) => void;
} {
  const [drag, setDrag] = useState<DragState | null>(null);
  const pending = useRef<Pending | null>(null);

  // The handlers close over `doc`/`result`, which change on every edit. Reading them
  // through a ref keeps the window listeners mounted once instead of re-binding mid-drag.
  const latest = useRef<DragHandlers>({ resolve, commit });
  latest.current = { resolve, commit };

  const cancel = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    if (p) {
      try { p.el.releasePointerCapture(p.pointerId); } catch { /* already released */ }
    }
    setDrag(null);
  }, []);

  const startDrag = useCallback((
    payload: DragPayload,
    event: { button: number; pointerId: number; currentTarget: Element; clientX: number; clientY: number },
  ) => {
    if (event.button !== 0) return; // primary button only; right-click must not drag
    const el = event.currentTarget;
    try { el.setPointerCapture(event.pointerId); } catch { /* no capture in jsdom */ }
    pending.current = {
      payload, pointerId: event.pointerId, el, x0: event.clientX, y0: event.clientY, armed: false,
    };
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const p = pending.current;
      if (!p || event.pointerId !== p.pointerId) return;
      if (!p.armed) {
        if (Math.hypot(event.clientX - p.x0, event.clientY - p.y0) < DRAG_THRESHOLD) return;
        p.armed = true;
      }
      // Suppress the browser's own text selection / touch scrolling for the rest of the drag.
      event.preventDefault();
      setDrag({ payload: p.payload, target: latest.current.resolve(p.payload, event.clientX, event.clientY) });
    };

    const onUp = (event: PointerEvent) => {
      const p = pending.current;
      if (!p || event.pointerId !== p.pointerId) return;
      const { armed, payload } = p;
      const target = armed ? latest.current.resolve(payload, event.clientX, event.clientY) : null;
      cancel();
      if (!armed) return; // a plain click: leave it to the source's own onClick
      swallowNextClick();
      if (target) latest.current.commit(payload, target); // no target: the drag just ends
    };

    const onCancel = (event: PointerEvent) => {
      if (pending.current?.pointerId === event.pointerId) cancel();
    };

    // Capture phase, so Escape aborts the drag before any other handler reads it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !pending.current) return;
      event.stopPropagation();
      cancel();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [cancel]);

  return { drag, startDrag };
}
