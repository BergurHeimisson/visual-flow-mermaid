import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Box as BoxModel, Rect } from '../layout/layout';
import type { EditTarget } from '../model/edits';
import { DEFAULT_METRICS } from '../layout/metrics';

/**
 * How far the selection ring below is drawn outside the box it decorates. Not a local
 * choice: `layout()`'s `margin` (src/layout/metrics.ts) is sized to clear exactly this (plus
 * the ring's own stroke width) so a box at the layout's edge doesn't get its ring clipped by
 * the <svg>'s viewBox. Read from `Metrics` rather than a literal here so the two can't drift.
 */
const RING_OUTSET = DEFAULT_METRICS.ringOutset;

type Props = {
  box: BoxModel; selected: boolean; onSelect: (id: string) => void;
  onStartEdit?: (target: EditTarget, rect: Rect) => void;
  /**
   * Begins a potential drag of this block. The gesture is a pointer gesture, not an HTML5
   * drag: Chromium does not fire `dragstart` on SVG elements, so `draggable` on this `<g>`
   * was inert and no canvas block could ever be moved.
   */
  onDragStart?: (id: string, event: ReactPointerEvent<SVGGElement>) => void;
  /** True while a dragged note is hovering this box, so the user can see where it will land. */
  dropTarget?: boolean;
};

function Shape({ box }: { box: BoxModel }) {
  const { x, y, w, h, kind } = box;
  switch (kind) {
    case 'start':
      return <circle cx={x + w / 2} cy={y + h / 2} r={w / 2} className="fill-ink" />;
    case 'stop':
    case 'end':
      return (
        <g>
          <circle cx={x + w / 2} cy={y + h / 2} r={w / 2} className="fill-surface stroke-ink" strokeWidth={2} />
          <circle cx={x + w / 2} cy={y + h / 2} r={w / 2 - 5} className="fill-ink" />
        </g>
      );
    case 'decision': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      return (
        <polygon
          points={`${cx},${y} ${x + w},${cy} ${cx},${y + h} ${x},${cy}`}
          className="fill-surface-2 stroke-line"
          strokeWidth={1.5}
        />
      );
    }
    case 'bar':
    case 'merge':
      return <rect x={x} y={y} width={w} height={h} rx={2} className="fill-ink" />;
    case 'note':
      return (
        <rect x={x} y={y} width={w} height={h} rx={3}
              className="fill-surface-3 stroke-line" strokeWidth={1} strokeDasharray="3 2" />
      );
    default:
      return (
        <rect x={x} y={y} width={w} height={h} rx={5}
              className="fill-surface-2 stroke-line" strokeWidth={1.5} />
      );
  }
}

export function Box({ box, selected, onSelect, onStartEdit, onDragStart, dropTarget }: Props) {
  const lines = (box.label ?? '').split('\n');
  const interactive = box.blockId !== undefined;

  return (
    <g
      data-testid={box.id}
      data-selected={String(selected)}
      data-drop-target={String(dropTarget === true)}
      className={interactive ? 'cursor-pointer' : undefined}
      // Touch must drag the block rather than scroll the canvas under it.
      style={interactive ? { touchAction: 'none' } : undefined}
      onPointerDown={(event) => {
        if (!box.blockId) return;
        onDragStart?.(box.blockId, event);
      }}
      onClick={(event) => {
        if (!box.blockId) return;
        event.stopPropagation();
        onSelect(box.blockId);
      }}
      onDoubleClick={(event) => {
        if (!box.blockId || !box.field) return;
        event.stopPropagation();
        onStartEdit?.(
          { blockId: box.blockId, field: box.field, branchIndex: box.branchIndex },
          { x: box.x, y: box.y, w: box.w, h: box.h },
        );
      }}
    >
      <Shape box={box} />
      {(selected || dropTarget) && (
        <rect
          x={box.x - RING_OUTSET} y={box.y - RING_OUTSET}
          width={box.w + RING_OUTSET * 2} height={box.h + RING_OUTSET * 2} rx={7}
          fill="none" className="stroke-accent" strokeWidth={2}
          strokeDasharray={!selected && dropTarget ? '4 3' : undefined}
        />
      )}
      {box.label !== undefined && (
        <text
          x={box.x + box.w / 2}
          y={box.y + box.h / 2 - ((lines.length - 1) * 18) / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          className="fill-ink text-[13px] select-none"
        >
          {lines.map((line, i) => (
            <tspan key={i} x={box.x + box.w / 2} dy={i === 0 ? 0 : 18}>{line}</tspan>
          ))}
        </text>
      )}
    </g>
  );
}
