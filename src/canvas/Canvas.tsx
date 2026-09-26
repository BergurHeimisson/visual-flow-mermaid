import type { PointerEvent as ReactPointerEvent, Ref } from 'react';
import type { NodeId } from '../model/types';
import type { EditTarget } from '../model/edits';
import type { DropZone as Zone, LayoutResult, Rect } from '../layout/layout';
import { Box } from './Box';
import { DropZone } from './DropZone';
import { Edge } from './Edge';

export type CanvasProps = {
  result: LayoutResult;
  selectedId: NodeId | null;
  zoom?: number;
  onSelect: (id: NodeId | null) => void;
  /** True while a drag is in flight, from either source; this is what mounts every zone. */
  dragging?: boolean;
  /** The zone the pointer is currently over, decided by geometry in `src/dnd.ts`. */
  activeZoneId?: string | null;
  /** The action block a dragged note is currently over. */
  noteTargetId?: NodeId | null;
  /** The persistent empty-slot placeholder that is currently selected, if any (Part 1). */
  selectedZoneId?: string | null;
  /** A persistent placeholder was clicked (or activated via keyboard) — selects that slot. */
  onSelectZone?: (zone: Zone) => void;
  onStartEdit?: (target: EditTarget, rect: Rect) => void;
  /** A pointerdown on a block: a potential drag of that block (see `useDrag`). */
  onDragBlock?: (id: NodeId, event: ReactPointerEvent<SVGGElement>) => void;
  svgRef?: Ref<SVGSVGElement>;
};

/**
 * Padding in px around the drawing, applied to the WRAPPER, never to the `<svg>` itself.
 *
 * Tailwind's preflight sets `box-sizing: border-box` globally, so padding on the `<svg>`
 * came out of the `width`/`height` attributes: the viewBox was then fitted into
 * `(W-48) x (H-48)` under the default preserveAspectRatio and the drawing rendered at
 * `min((W-48)/W, (H-48)/H)` — a scale nobody computed, varying with diagram size (measured
 * 0.582 at zoom 1 on a fresh decision, 0.222 after two zoom-out clicks) and collapsing
 * entirely as `width * zoom` approached 48. With the padding on the wrapper the rendered
 * scale is exactly `zoom`.
 *
 * Still exported because it is the fallback offset App.tsx uses where `getScreenCTM()` is
 * unavailable (jsdom): with this layout, `x * zoom + CANVAS_PAD` is genuinely the box's
 * position again.
 */
export const CANVAS_PAD = 24;

export function Canvas({
  result, selectedId, zoom = 1, onSelect, dragging, activeZoneId, noteTargetId,
  selectedZoneId, onSelectZone, onStartEdit, onDragBlock, svgRef,
}: CanvasProps) {
  return (
    <div className="w-max" style={{ padding: CANVAS_PAD }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${result.width} ${result.height}`}
        width={result.width * zoom}
        height={result.height * zoom}
        className="block"
      >
        <defs>
          <marker id="vfp-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className="fill-line" />
          </marker>
        </defs>

        {result.edges.map((edge) => <Edge key={edge.id} edge={edge} onStartEdit={onStartEdit} />)}
        {result.dropZones
          .filter((zone) => dragging || zone.persistent)
          .map((zone) => (
            <DropZone
              key={zone.id} zone={zone} dragging={dragging}
              active={zone.id === activeZoneId}
              selected={!dragging && zone.id === selectedZoneId}
              onSelect={onSelectZone}
            />
          ))}
        {result.boxes.map((box) => (
          <Box
            key={box.id} box={box} selected={box.blockId != null && box.blockId === selectedId}
            onSelect={onSelect} onStartEdit={onStartEdit} onDragStart={onDragBlock}
            dropTarget={box.blockId != null && box.blockId === noteTargetId}
          />
        ))}
      </svg>
    </div>
  );
}
