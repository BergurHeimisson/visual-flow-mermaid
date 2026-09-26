import { useCallback, useReducer } from 'react';
import { addBranch, applyEdit, attachNote, removeBranch, toggleElse, type EditTarget } from '../model/edits';
import { insertAt, moveBlock, removeBlock } from '../model/ops';
import type { SeqPath, Slot } from '../model/paths';
import { EMPTY_DOC, type Block, type Doc, type NodeId } from '../model/types';

export type DocAction =
  | { type: 'insert'; path: SeqPath; index: number; block: Block }
  | { type: 'move'; id: NodeId; path: SeqPath; index: number }
  | { type: 'remove'; id: NodeId }
  | { type: 'edit'; target: EditTarget; value: string }
  | { type: 'addBranch'; id: NodeId }
  | { type: 'removeBranch'; id: NodeId; index: number }
  | { type: 'toggleElse'; id: NodeId }
  | { type: 'attachNote'; id: NodeId; side: 'left' | 'right' }
  | { type: 'replace'; doc: Doc };

type State = { doc: Doc; past: Doc[]; future: Doc[]; selectedId: NodeId | null; selectedSlot: Slot | null };
type Msg = { kind: 'apply'; action: DocAction } | { kind: 'undo' } | { kind: 'redo' }
         | { kind: 'select'; id: NodeId | null } | { kind: 'selectSlot'; slot: Slot | null };

function reduceDoc(doc: Doc, action: DocAction): Doc {
  switch (action.type) {
    case 'insert':     return insertAt(doc, action.path, action.index, action.block);
    case 'move':       return moveBlock(doc, action.id, action.path, action.index);
    case 'remove':     return removeBlock(doc, action.id);
    case 'edit':       return applyEdit(doc, action.target, action.value);
    case 'addBranch':  return addBranch(doc, action.id);
    case 'removeBranch': return removeBranch(doc, action.id, action.index);
    case 'toggleElse': return toggleElse(doc, action.id);
    case 'attachNote': return attachNote(doc, action.id, action.side);
    case 'replace':    return action.doc;
  }
}

function reducer(state: State, msg: Msg): State {
  switch (msg.kind) {
    // Selecting a block and selecting a slot are mutually exclusive — there must never be
    // an ambiguous "insert where?" — so each clears the other.
    case 'select':
      return { ...state, selectedId: msg.id, selectedSlot: null };
    case 'selectSlot':
      return { ...state, selectedId: null, selectedSlot: msg.slot };
    case 'apply': {
      const doc = reduceDoc(state.doc, msg.action);
      if (doc === state.doc) return state;
      if (msg.action.type === 'replace') {
        return { doc, past: [], future: [], selectedId: null, selectedSlot: null };
      }
      const selectedId = msg.action.type === 'remove' && state.selectedId === msg.action.id
        ? null : state.selectedId;
      return { doc, past: [...state.past, state.doc], future: [], selectedId, selectedSlot: state.selectedSlot };
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        doc: previous, past: state.past.slice(0, -1), future: [state.doc, ...state.future],
        selectedId: state.selectedId, selectedSlot: state.selectedSlot,
      };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next) return state;
      return {
        doc: next, past: [...state.past, state.doc], future: rest,
        selectedId: state.selectedId, selectedSlot: state.selectedSlot,
      };
    }
  }
}

/**
 * `initial` may be a thunk, which useReducer calls exactly once. App.tsx passes one so
 * `loadAutosave()` (which parses the whole stored document) runs on mount instead of on
 * every render — it was being evaluated as a plain argument on each keystroke and thrown
 * away.
 */
export function useDocument(initial: Doc | (() => Doc) = EMPTY_DOC) {
  const [state, dispatch] = useReducer(
    reducer,
    initial,
    (arg): State => ({
      doc: typeof arg === 'function' ? arg() : arg,
      past: [], future: [], selectedId: null, selectedSlot: null,
    }),
  );

  return {
    doc: state.doc,
    selectedId: state.selectedId,
    selectedSlot: state.selectedSlot,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    select: useCallback((id: NodeId | null) => dispatch({ kind: 'select', id }), []),
    selectSlot: useCallback((slot: Slot | null) => dispatch({ kind: 'selectSlot', slot }), []),
    apply: useCallback((action: DocAction) => dispatch({ kind: 'apply', action }), []),
    undo: useCallback(() => dispatch({ kind: 'undo' }), []),
    redo: useCallback(() => dispatch({ kind: 'redo' }), []),
  };
}
