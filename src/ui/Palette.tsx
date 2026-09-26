import type { PointerEvent as ReactPointerEvent } from 'react';
import type { PaletteKind } from '../dnd';

export type { PaletteKind };

export const PALETTE_ITEMS: { kind: PaletteKind; label: string; hint: string }[] = [
  { kind: 'action', label: 'Action',      hint: 'id["text"]' },
  { kind: 'if',     label: 'Decision',    hint: 'if / elseif / else' },
  { kind: 'while',  label: 'While loop',  hint: 'while (subgraph)' },
  { kind: 'repeat', label: 'Repeat loop', hint: 'repeat (subgraph)' },
  { kind: 'fork',   label: 'Fork',        hint: 'fork / fork again' },
  { kind: 'stop',   label: 'Stop',        hint: '(("stop"))' },
  { kind: 'end',    label: 'End',         hint: '(("end"))' },
  { kind: 'note',   label: 'Note',        hint: '%% note right: text' },
];

/**
 * Every item stays a real `<button>`: click-to-insert is the keyboard and accessibility
 * path, and Enter/Space must keep reaching `onInsert`. The drag is layered on top as a
 * pointer gesture that only becomes a drag past `DRAG_THRESHOLD` (see `useDrag`), so a
 * click — from mouse or keyboard — still inserts.
 */
export function Palette({ onInsert, noteEnabled, onDragStart }: {
  onInsert: (kind: PaletteKind) => void;
  noteEnabled: boolean;
  onDragStart?: (kind: PaletteKind, event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {PALETTE_ITEMS.map((item) => {
        const disabled = item.kind === 'note' && !noteEnabled;
        return (
          <button
            key={item.kind}
            type="button"
            disabled={disabled}
            style={{ touchAction: 'none' }}
            onPointerDown={(event) => { if (!disabled) onDragStart?.(item.kind, event); }}
            onClick={() => onInsert(item.kind)}
            className="rounded border border-line bg-surface px-2 py-1.5 text-left text-sm
                       hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="block text-ink">{item.label}</span>
            <span className="block text-[11px] text-ink-muted">{item.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
