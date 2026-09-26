import { expect, test } from 'vitest';
import { addBranch, applyEdit, attachNote, currentValue, removeBranch, toggleElse } from './edits';
import { findBlock } from './ops';
import type { Doc, EditField } from './types';
import { serialize } from '../mermaid/serialize';

const ifDoc = (): Doc => ({ preamble: [], body: [{
  id: 'i', kind: 'if',
  branches: [{ cond: 'a?', thenLabel: 'yes', body: [] }],
  elseBody: [], elseLabel: 'no',
}]});

test('edits an action label', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'a', kind: 'action', label: 'old' }] };
  const next = applyEdit(doc, { blockId: 'a', field: 'label' }, 'new');
  expect(findBlock(next, 'a')).toMatchObject({ label: 'new' });
});

test('edits a branch condition and its then-label by index', () => {
  const withCond = applyEdit(ifDoc(), { blockId: 'i', field: 'cond', branchIndex: 0 }, 'b?');
  const block = findBlock(withCond, 'i');
  expect(block?.kind === 'if' && block.branches[0].cond).toBe('b?');

  const withLabel = applyEdit(ifDoc(), { blockId: 'i', field: 'thenLabel', branchIndex: 0 }, 'sure');
  const b2 = findBlock(withLabel, 'i');
  expect(b2?.kind === 'if' && b2.branches[0].thenLabel).toBe('sure');
});

test('edits a loop condition and its labels', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'w', kind: 'while', cond: 'c?', body: [] }] };
  expect(findBlock(applyEdit(doc, { blockId: 'w', field: 'cond' }, 'd?'), 'w')).toMatchObject({ cond: 'd?' });
  expect(findBlock(applyEdit(doc, { blockId: 'w', field: 'endLabel' }, 'done'), 'w')).toMatchObject({ endLabel: 'done' });
});

test('adds an elseif branch after the existing branches', () => {
  const block = findBlock(addBranch(ifDoc(), 'i'), 'i');
  expect(block?.kind === 'if' && block.branches).toHaveLength(2);
  expect(block?.kind === 'if' && block.elseBody).toEqual([]);
});

test('adds a parallel branch to a fork', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'f', kind: 'fork', branches: [[], []] }] };
  const block = findBlock(addBranch(doc, 'f'), 'f');
  expect(block?.kind === 'fork' && block.branches).toHaveLength(3);
});

test('refuses to remove the last branch of a decision', () => {
  const before = ifDoc();
  expect(removeBranch(before, 'i', 0)).toEqual(before);
});

test('toggles the else arm off and back on', () => {
  const off = toggleElse(ifDoc(), 'i');
  expect(findBlock(off, 'i')).toMatchObject({ elseBody: undefined });
  const on = toggleElse(off, 'i');
  expect(findBlock(on, 'i')).toMatchObject({ elseBody: [] });
});

test('attaches a note to an action with placeholder text', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'a', kind: 'action', label: 'A' }] };
  expect(findBlock(attachNote(doc, 'a', 'right'), 'a')).toMatchObject({ note: { side: 'right', text: 'note' } });
});

test('ignores a note attached to a non-action block', () => {
  const doc: Doc = { preamble: [], body: [{ id: 's', kind: 'stop' }] };
  expect(attachNote(doc, 's', 'right')).toEqual(doc);
});

test('currentValue reads back what applyEdit wrote', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'a', kind: 'action', label: 'A' }] };
  const target = { blockId: 'a', field: 'label' } as const;
  expect(currentValue(applyEdit(doc, target, 'changed'), target)).toBe('changed');
});

test('currentValue reads a branch condition by index', () => {
  expect(currentValue(ifDoc(), { blockId: 'i', field: 'cond', branchIndex: 0 })).toBe('a?');
});

test('currentValue returns an empty string for an absent optional label', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'w', kind: 'while', cond: 'c?', body: [] }] };
  expect(currentValue(doc, { blockId: 'w', field: 'endLabel' })).toBe('');
});

test('committing currentValue back with no change returns the same doc reference: action label', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'a', kind: 'action', label: 'A' }] };
  const target = { blockId: 'a', field: 'label' } as const;
  expect(applyEdit(doc, target, currentValue(doc, target))).toBe(doc);
});

test('committing currentValue back with no change returns the same doc reference: if cond by branchIndex', () => {
  const doc = ifDoc();
  const target = { blockId: 'i', field: 'cond', branchIndex: 0 } as const;
  expect(applyEdit(doc, target, currentValue(doc, target))).toBe(doc);
});

test('committing currentValue back with no change returns the same doc reference: absent optional label', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'w', kind: 'while', cond: 'c?', body: [] }] };
  const target = { blockId: 'w', field: 'endLabel' } as const;
  expect(applyEdit(doc, target, currentValue(doc, target))).toBe(doc);
});

test('applyEdit normalises an empty optional label to undefined and serializes without ()', () => {
  const fields: EditField[] = ['thenLabel', 'elseLabel', 'isLabel', 'endLabel'];
  const docs: Record<string, Doc> = {
    thenLabel: ifDoc(),
    elseLabel: ifDoc(),
    isLabel: { preamble: [], body: [{ id: 'w', kind: 'while', cond: 'c?', isLabel: 'yep', body: [] }] },
    endLabel: { preamble: [], body: [{ id: 'w', kind: 'while', cond: 'c?', endLabel: 'done', body: [] }] },
  };
  const targets: Record<string, { blockId: string; field: EditField; branchIndex?: number }> = {
    thenLabel: { blockId: 'i', field: 'thenLabel', branchIndex: 0 },
    elseLabel: { blockId: 'i', field: 'elseLabel' },
    isLabel: { blockId: 'w', field: 'isLabel' },
    endLabel: { blockId: 'w', field: 'endLabel' },
  };

  for (const field of fields) {
    const next = applyEdit(docs[field], targets[field], '');
    const block = findBlock(next, targets[field].blockId);
    if (field === 'thenLabel') {
      expect(block?.kind === 'if' && block.branches[0].thenLabel).toBeUndefined();
    } else if (field === 'elseLabel') {
      expect(block?.kind === 'if' && block.elseLabel).toBeUndefined();
    } else if (field === 'isLabel') {
      expect(block?.kind === 'while' && block.isLabel).toBeUndefined();
    } else {
      expect(block?.kind === 'while' && block.endLabel).toBeUndefined();
    }
    expect(serialize(next)).not.toContain('()');
  }
});

test('attachNote on a stop block returns the same doc reference', () => {
  const doc: Doc = { preamble: [], body: [{ id: 's', kind: 'stop' }] };
  expect(attachNote(doc, 's', 'right')).toBe(doc);
});

test('removeBranch at the if floor returns the same doc reference', () => {
  const doc = ifDoc();
  expect(removeBranch(doc, 'i', 0)).toBe(doc);
});

test('removeBranch at the fork floor returns the same doc reference', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'f', kind: 'fork', branches: [[], []] }] };
  expect(removeBranch(doc, 'f', 0)).toBe(doc);
});
