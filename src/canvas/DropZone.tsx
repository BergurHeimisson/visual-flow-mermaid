import type { DropZone as Zone } from '../layout/layout';

/**
 * A gap a block can be dropped into. Has two rendering modes:
 *
 * - Mid-drag (`dragging`): unchanged from before — a translucent accent fill, brighter over
 *   the zone the drag is currently over. Purely presentational: it owns neither the hover
 *   state nor the drop. Targeting comes from layout geometry (see `src/dnd.ts`), so the
 *   zone that is `active` is decided once, for all zones, from a single pointer position —
 *   a zone can no longer be shadowed by anything painted over it, such as the floating
 *   `BlockControls` bar.
 * - No drag in flight, `zone.persistent`: the always-visible placeholder an EMPTY branch
 *   needs to be selectable at all (see the brief: "I wanted to add an action after the no
 *   decision. I couldn't select to do that."). Dashed, muted, no fill — visually distinct
 *   from a real block per the brief — and clickable/focusable: clicking or pressing
 *   Enter/Space selects this slot (`onSelect`), which `insertionPoint` then targets. It is
 *   the one shape on the canvas whose selectability does not require a `NodeId`, so it is
 *   given its own affordance rather than trying to reuse `Box`'s.
 *
 * Every other (non-persistent) zone stays invisible with no drag in flight — Canvas simply
 * does not mount it — keeping the canvas clean for the screenshots the brief calls out.
 *
 * Default `pointer-events` stay on either way: the drag source holds the pointer capture,
 * so nothing here can steal a drag gesture, and leaving the rect hit-testable keeps
 * `document.elementFromPoint` honest about whether two sibling zones overlap — which is
 * what the "yes branch" e2e test checks.
 */
export function DropZone({
  zone, active = false, dragging = false, selected = false, onSelect,
}: {
  zone: Zone; active?: boolean; dragging?: boolean; selected?: boolean;
  onSelect?: (zone: Zone) => void;
}) {
  if (dragging) {
    return (
      <rect
        data-testid={zone.id}
        data-active={String(active)}
        x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx={4}
        className={active ? 'fill-accent opacity-60' : 'fill-accent opacity-15'}
      />
    );
  }

  return (
    <rect
      data-testid={zone.id}
      data-active="false"
      data-persistent="true"
      data-selected={String(selected)}
      x={zone.x} y={zone.y} width={zone.w} height={zone.h} rx={4}
      fill="none"
      // SVG's default `pointer-events: visiblePainted` only hit-tests the STROKE when
      // `fill="none"` — the interior of the rect (most of its area, and where a real
      // browser's click lands) would silently miss and fall through to whatever is
      // painted underneath (`canvas-background`). Force the whole rect hit-testable.
      pointerEvents="all"
      strokeDasharray="4 3"
      strokeWidth={selected ? 2 : 1.5}
      tabIndex={0}
      role="button"
      aria-label="Empty — select to insert here"
      aria-pressed={selected}
      className={`cursor-pointer outline-none ${selected ? 'stroke-accent' : 'stroke-line focus:stroke-accent'}`}
      onClick={(event) => { event.stopPropagation(); onSelect?.(zone); }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect?.(zone);
      }}
    />
  );
}
