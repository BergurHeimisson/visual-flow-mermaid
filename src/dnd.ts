/**
 * The drag protocol, in one place: what a drag carries, and where it can land.
 *
 * The app used HTML5 drag-and-drop, so this module held two MIME strings and the payload
 * travelled in a `DataTransfer`. That could never work for a canvas block: Chromium does
 * not fire `dragstart` on SVG elements (the `draggable` attribute is defined for HTML
 * elements only), so dragging a `<g>` never began. Both the palette and the canvas now use
 * pointer events instead — one drag model, not two — and pointer events have no
 * `dataTransfer`, so the payload is React state described by `DragPayload` below.
 *
 * Targeting is computed from layout GEOMETRY rather than DOM hit-testing. `result` already
 * knows every zone's and box's rect, and the `<svg>`'s live `getScreenCTM()` maps those
 * rects to the screen, so `elementFromPoint` adds nothing but failure modes — chief among
 * them the `BlockControls` bar, which floats over the drop zone above a selected block and
 * silently swallowed every drop aimed there.
 *
 * Nothing here touches the DOM: the caller reads the matrix off the `<svg>` and passes it
 * in, which is also what makes the geometry testable without a browser.
 */
import type { Box, DropZone, LayoutResult, Point, Rect } from './layout/layout';
import type { BlockKind, NodeId } from './model/types';

/** What the palette can offer. A note is not a `BlockKind`: it attaches to one. */
export type PaletteKind = BlockKind | 'note';

/** The single typed definition of what a drag carries. */
export type DragPayload =
  | { source: 'palette'; kind: PaletteKind }
  | { source: 'block'; id: NodeId };

/** Where a drag can land. */
export type DragTarget =
  | { kind: 'zone'; zone: DropZone }
  | { kind: 'note'; blockId: NodeId };

/**
 * How far the pointer must travel before a press becomes a drag, in CSS px.
 *
 * Without a threshold every click on a palette item or a box would mount the drop zones
 * and the click-to-insert path (the keyboard/accessibility path) would flicker. Small
 * enough that a deliberate drag feels immediate, large enough to survive the jitter of a
 * click on a trackpad.
 */
export const DRAG_THRESHOLD = 4;

/** The parts of a `DOMMatrix` that matter here — kept structural so tests need no browser. */
export type ScreenMatrix = { a: number; d: number; e: number; f: number };

/**
 * A client (viewport) point in the diagram's own coordinate space, or null when the page
 * has no layout to read (jsdom) or the transform is degenerate.
 */
export function toLayoutPoint(ctm: ScreenMatrix | null | undefined, clientX: number, clientY: number): Point | null {
  if (!ctm || !ctm.a || !ctm.d) return null;
  return { x: (clientX - ctm.e) / ctm.a, y: (clientY - ctm.f) / ctm.d };
}

function contains(rect: Rect, p: Point): boolean {
  return p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h;
}

/** Only an action can carry a note: this app's Mermaid dialect binds a `%% note` comment to
 *  the preceding action node. */
function takesNote(box: Box): boolean {
  return box.kind === 'action' && box.blockId !== undefined;
}

/**
 * Which target the given layout point is over, for this payload.
 *
 * A note looks for an action box and ignores drop zones — a note attaches to a block, it
 * does not occupy a gap. Everything else looks for a drop zone and ignores boxes.
 *
 * Both searches run back to front, so the answer matches what the user sees: later members
 * of `result.boxes`/`result.dropZones` are painted last, hence on top.
 */
export function targetAt(result: LayoutResult, payload: DragPayload, p: Point | null): DragTarget | null {
  if (!p) return null;

  if (payload.source === 'palette' && payload.kind === 'note') {
    for (let i = result.boxes.length - 1; i >= 0; i -= 1) {
      const box = result.boxes[i];
      if (takesNote(box) && contains(box, p)) return { kind: 'note', blockId: box.blockId! };
    }
    return null;
  }

  for (let i = result.dropZones.length - 1; i >= 0; i -= 1) {
    const zone = result.dropZones[i];
    if (contains(zone, p)) return { kind: 'zone', zone };
  }
  return null;
}
