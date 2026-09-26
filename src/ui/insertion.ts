import { locate } from '../model/ops';
import type { SeqPath, Slot } from '../model/paths';
import type { Doc, NodeId } from '../model/types';

export type { Slot };

/**
 * Where the next inserted block lands. A selected SLOT (an empty branch/else/fork
 * column/loop body the user clicked — see Canvas's persistent placeholders) always wins:
 * it names an insertion point directly, with no block to `locate`. Otherwise this is
 * exactly the pre-existing behaviour — after the selected block, or appended to the root.
 */
export function insertionPoint(doc: Doc, selectedId: NodeId | null, selectedSlot?: Slot | null): { path: SeqPath; index: number } {
  if (selectedSlot) return selectedSlot;
  const at = selectedId ? locate(doc, selectedId) : null;
  if (!at) return { path: [], index: doc.body.length };
  return { path: at.path, index: at.index + 1 };
}
