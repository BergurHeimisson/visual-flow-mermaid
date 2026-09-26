import { findBlock, mapBlock } from './ops';
import type { Block, Doc, EditField, NodeId } from './types';

export type EditTarget = { blockId: NodeId; field: EditField; branchIndex?: number };

// An empty optional label and no label at all mean the same thing in this app's Mermaid
// dialect (`opt()` in the serializer treats only `undefined` as "no label"). Normalising
// '' to undefined here keeps a no-op commit a true no-op and keeps the file from
// growing a spurious ` ()`. `label` (an action's own text) and `cond` (never
// optional) are deliberately excluded.
const OPTIONAL_LABEL_FIELDS: ReadonlySet<EditField> = new Set(['thenLabel', 'elseLabel', 'isLabel', 'endLabel']);

function normalizeOptionalLabel(field: EditField, value: string): string | undefined {
  return value === '' && OPTIONAL_LABEL_FIELDS.has(field) ? undefined : value;
}

export function applyEdit(doc: Doc, target: EditTarget, value: string): Doc {
  const { field, branchIndex } = target;
  return mapBlock(doc, target.blockId, (block): Block => {
    if (block.kind === 'action') {
      if (field === 'label') return value === block.label ? block : { ...block, label: value };
      if (field === 'note' && block.note) {
        return value === block.note.text ? block : { ...block, note: { ...block.note, text: value } };
      }
      return block;
    }
    if (block.kind === 'if') {
      if (field === 'elseLabel') {
        const next = normalizeOptionalLabel(field, value);
        return next === block.elseLabel ? block : { ...block, elseLabel: next };
      }
      if ((field === 'cond' || field === 'thenLabel') && branchIndex !== undefined) {
        const branch = block.branches[branchIndex];
        if (!branch) return block;
        if (field === 'cond') {
          if (value === branch.cond) return block;
          const branches = block.branches.map((b, i) => (i === branchIndex ? { ...b, cond: value } : b));
          return { ...block, branches };
        }
        const next = normalizeOptionalLabel(field, value);
        if (next === branch.thenLabel) return block;
        const branches = block.branches.map((b, i) => (i === branchIndex ? { ...b, thenLabel: next } : b));
        return { ...block, branches };
      }
      return block;
    }
    if (block.kind === 'while') {
      if (field === 'cond') return value === block.cond ? block : { ...block, cond: value };
      if (field === 'isLabel') {
        const next = normalizeOptionalLabel(field, value);
        return next === block.isLabel ? block : { ...block, isLabel: next };
      }
      if (field === 'endLabel') {
        const next = normalizeOptionalLabel(field, value);
        return next === block.endLabel ? block : { ...block, endLabel: next };
      }
      return block;
    }
    if (block.kind === 'repeat') {
      if (field === 'cond') return value === block.cond ? block : { ...block, cond: value };
      if (field === 'isLabel') {
        const next = normalizeOptionalLabel(field, value);
        return next === block.isLabel ? block : { ...block, isLabel: next };
      }
      return block;
    }
    return block;
  });
}

export function addBranch(doc: Doc, id: NodeId): Doc {
  return mapBlock(doc, id, (block): Block => {
    if (block.kind === 'if') {
      return { ...block, branches: [...block.branches, { cond: 'condition?', thenLabel: 'yes', body: [] }] };
    }
    if (block.kind === 'fork') return { ...block, branches: [...block.branches, []] };
    return block;
  });
}

export function removeBranch(doc: Doc, id: NodeId, index: number): Doc {
  return mapBlock(doc, id, (block): Block => {
    if (block.kind === 'if') {
      if (block.branches.length <= 1) return block;
      return { ...block, branches: block.branches.filter((_, i) => i !== index) };
    }
    if (block.kind === 'fork') {
      if (block.branches.length <= 2) return block;
      return { ...block, branches: block.branches.filter((_, i) => i !== index) };
    }
    return block;
  });
}

export function toggleElse(doc: Doc, id: NodeId): Doc {
  return mapBlock(doc, id, (block): Block => {
    if (block.kind !== 'if') return block;
    return block.elseBody
      ? { ...block, elseBody: undefined, elseLabel: undefined }
      : { ...block, elseBody: [], elseLabel: 'no' };
  });
}

export function attachNote(doc: Doc, id: NodeId, side: 'left' | 'right'): Doc {
  return mapBlock(doc, id, (block): Block =>
    block.kind === 'action' ? { ...block, note: { side, text: 'note' } } : block);
}

/** The text an inline editor should open with. The exact inverse of `applyEdit`. */
export function currentValue(doc: Doc, target: EditTarget): string {
  const block = findBlock(doc, target.blockId);
  if (!block) return '';
  const { field, branchIndex } = target;

  if (block.kind === 'action') return field === 'note' ? block.note?.text ?? '' : block.label;
  if (block.kind === 'if') {
    if (field === 'elseLabel') return block.elseLabel ?? '';
    const branch = block.branches[branchIndex ?? 0];
    if (!branch) return '';
    return field === 'cond' ? branch.cond : branch.thenLabel ?? '';
  }
  if (block.kind === 'while') {
    if (field === 'cond') return block.cond;
    if (field === 'isLabel') return block.isLabel ?? '';
    if (field === 'endLabel') return block.endLabel ?? '';
  }
  if (block.kind === 'repeat') {
    if (field === 'cond') return block.cond;
    if (field === 'isLabel') return block.isLabel ?? '';
  }
  return '';
}
