import { useEffect } from 'react';

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
}

/**
 * Global document shortcuts, bound on `window`. Every shortcut here is suppressed while the
 * event target is a text input, not just Delete/Backspace as the brief states: Enter would
 * otherwise both commit the InlineEditor's own input AND re-open an editor from the
 * (still-stale) selection, and Cmd/Ctrl+Z would otherwise hijack the browser's native
 * per-field undo and silently rewind the whole document behind the user's cursor.
 *
 * Escape follows the same rule: while the InlineEditor's `<input>` has focus, `isTyping`
 * skips this handler entirely, leaving Escape to the input's own `onKeyDown` (cancel the
 * edit) rather than also clearing the selection underneath it. Escape mid-drag is likewise
 * untouched — `useDrag` binds its own cancel-the-drag listener on `window` in the CAPTURE
 * phase and calls `stopPropagation()`, so in a real browser (where the event travels down
 * from `window` before bubbling back up to it) that listener sees Escape and stops it
 * before it ever reaches this bubble-phase one.
 */
export function useKeyboard(handlers: {
  onDelete: () => void; onEnter: () => void; onUndo: () => void; onRedo: () => void; onSave: () => void;
  onEscape: () => void;
}): void {
  const { onDelete, onEnter, onUndo, onRedo, onSave, onEscape } = handlers;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isTyping(e.target)) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        onDelete();
        return;
      }
      if (e.key === 'Enter') {
        onEnter();
        return;
      }
      if (e.key === 'Escape') {
        onEscape();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) onRedo(); else onUndo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onSave();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDelete, onEnter, onUndo, onRedo, onSave, onEscape]);
}
