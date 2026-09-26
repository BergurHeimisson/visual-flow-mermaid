import { act, renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useDocument } from './useDocument';
import type { Doc } from '../model/types';

const doc: Doc = { preamble: [], body: [{ id: 'a', kind: 'action', label: 'A' }] };

test('applies an insert and exposes the new document', () => {
  const { result } = renderHook(() => useDocument(doc));
  act(() => result.current.apply({ type: 'insert', path: [], index: 1, block: { id: 'b', kind: 'stop' } }));
  expect(result.current.doc.body.map((b) => b.id)).toEqual(['a', 'b']);
});

test('undo restores the previous document and redo reapplies it', () => {
  const { result } = renderHook(() => useDocument(doc));
  act(() => result.current.apply({ type: 'edit', target: { blockId: 'a', field: 'label' }, value: 'B' }));
  expect(result.current.doc.body[0]).toMatchObject({ label: 'B' });

  act(() => result.current.undo());
  expect(result.current.doc.body[0]).toMatchObject({ label: 'A' });

  act(() => result.current.redo());
  expect(result.current.doc.body[0]).toMatchObject({ label: 'B' });
});

test('canUndo and canRedo track the stack', () => {
  const { result } = renderHook(() => useDocument(doc));
  expect(result.current.canUndo).toBe(false);
  act(() => result.current.apply({ type: 'remove', id: 'a' }));
  expect(result.current.canUndo).toBe(true);
  expect(result.current.canRedo).toBe(false);
  act(() => result.current.undo());
  expect(result.current.canRedo).toBe(true);
});

test('a new edit after undo discards the redo stack', () => {
  const { result } = renderHook(() => useDocument(doc));
  act(() => result.current.apply({ type: 'remove', id: 'a' }));
  act(() => result.current.undo());
  act(() => result.current.apply({ type: 'insert', path: [], index: 0, block: { id: 'z', kind: 'stop' } }));
  expect(result.current.canRedo).toBe(false);
});

test('replace clears history, because a different document was opened', () => {
  const { result } = renderHook(() => useDocument(doc));
  act(() => result.current.apply({ type: 'remove', id: 'a' }));
  act(() => result.current.apply({ type: 'replace', doc: { preamble: [], body: [] } }));
  expect(result.current.canUndo).toBe(false);
});

test('removing the selected block clears the selection', () => {
  const { result } = renderHook(() => useDocument(doc));
  act(() => result.current.select('a'));
  act(() => result.current.apply({ type: 'remove', id: 'a' }));
  expect(result.current.selectedId).toBeNull();
});

test('applying a no-op edit does not change canUndo', () => {
  const { result } = renderHook(() => useDocument(doc));
  expect(result.current.canUndo).toBe(false);
  act(() => result.current.apply({ type: 'edit', target: { blockId: 'a', field: 'label' }, value: 'A' }));
  expect(result.current.canUndo).toBe(false);
});

// --- Final review, I4: removeBranch reachable as a DocAction, undoable like any delete --
test('removeBranch drops the branch and undo restores it', () => {
  const forked: Doc = { preamble: [], body: [
    { id: 'f', kind: 'fork', branches: [[{ id: 'x', kind: 'action', label: 'X' }], [], []] },
  ]};
  const { result } = renderHook(() => useDocument(forked));

  act(() => result.current.apply({ type: 'removeBranch', id: 'f', index: 2 }));
  const after = result.current.doc.body[0];
  expect(after.kind === 'fork' && after.branches).toHaveLength(2);

  act(() => result.current.undo());
  const back = result.current.doc.body[0];
  expect(back.kind === 'fork' && back.branches).toHaveLength(3);
});

test('a removeBranch at the floor is a no-op and pushes no undo entry', () => {
  const forked: Doc = { preamble: [], body: [{ id: 'f', kind: 'fork', branches: [[], []] }] };
  const { result } = renderHook(() => useDocument(forked));
  act(() => result.current.apply({ type: 'removeBranch', id: 'f', index: 1 }));
  expect(result.current.canUndo).toBe(false);
  expect(result.current.doc).toBe(forked);
});

// --- Part 1: selecting a slot and selecting a block are mutually exclusive -------------
test('selecting a slot clears the selected block', () => {
  const { result } = renderHook(() => useDocument(doc));
  act(() => result.current.select('a'));
  act(() => result.current.selectSlot({ path: [], index: 1 }));
  expect(result.current.selectedId).toBeNull();
  expect(result.current.selectedSlot).toEqual({ path: [], index: 1 });
});

test('selecting a block clears the selected slot', () => {
  const { result } = renderHook(() => useDocument(doc));
  act(() => result.current.selectSlot({ path: [], index: 1 }));
  act(() => result.current.select('a'));
  expect(result.current.selectedSlot).toBeNull();
  expect(result.current.selectedId).toBe('a');
});

// --- Final review, I5: the initial document must be built lazily ----------------------
//
// Reproduction (before the fix): App.tsx called `loadAutosave()` as a plain argument on
// every render, so parse() ran over the whole stored document on each keystroke even
// though useReducer discards it after the first.
test('builds the initial document once, not on every render', () => {
  const init = vi.fn(() => doc);
  const { result, rerender } = renderHook(() => useDocument(init));
  rerender();
  act(() => result.current.select('a'));
  rerender();
  expect(init).toHaveBeenCalledTimes(1);
  expect(result.current.doc).toBe(doc);
});
