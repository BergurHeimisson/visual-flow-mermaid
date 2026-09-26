import { renderHook } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useKeyboard } from './useKeyboard';

function handlers() {
  return {
    onDelete: vi.fn(), onEnter: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onSave: vi.fn(), onEscape: vi.fn(),
  };
}

function fireKey(init: KeyboardEventInit, target: EventTarget = window) {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}

test('Delete calls onDelete', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  fireKey({ key: 'Delete' });
  expect(h.onDelete).toHaveBeenCalledTimes(1);
});

test('Backspace calls onDelete', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  fireKey({ key: 'Backspace' });
  expect(h.onDelete).toHaveBeenCalledTimes(1);
});

test('Delete does not fire while the event target is an input', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  const input = document.createElement('input');
  document.body.appendChild(input);
  fireKey({ key: 'Delete' }, input);
  expect(h.onDelete).not.toHaveBeenCalled();
  input.remove();
});

test('Backspace does not fire while the event target is a textarea', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  fireKey({ key: 'Backspace' }, textarea);
  expect(h.onDelete).not.toHaveBeenCalled();
  textarea.remove();
});

test('Enter calls onEnter when not typing', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  fireKey({ key: 'Enter' });
  expect(h.onEnter).toHaveBeenCalledTimes(1);
});

test('Enter does not call onEnter while the event target is an input', () => {
  // The InlineEditor's own <input> handles its own Enter (commit). Without this guard,
  // committing an edit would also re-open an editor from the (still stale) selection.
  const h = handlers();
  renderHook(() => useKeyboard(h));
  const input = document.createElement('input');
  document.body.appendChild(input);
  fireKey({ key: 'Enter' }, input);
  expect(h.onEnter).not.toHaveBeenCalled();
  input.remove();
});

test('Escape calls onEscape when not typing', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  fireKey({ key: 'Escape' });
  expect(h.onEscape).toHaveBeenCalledTimes(1);
});

test('Escape does not call onEscape while the event target is an input', () => {
  // The InlineEditor's own <input> handles its own Escape (cancel the edit). Without this
  // guard, cancelling an edit would also clear the selection underneath it.
  const h = handlers();
  renderHook(() => useKeyboard(h));
  const input = document.createElement('input');
  document.body.appendChild(input);
  fireKey({ key: 'Escape' }, input);
  expect(h.onEscape).not.toHaveBeenCalled();
  input.remove();
});

test('Cmd+Z calls onUndo', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  fireKey({ key: 'z', metaKey: true });
  expect(h.onUndo).toHaveBeenCalledTimes(1);
  expect(h.onRedo).not.toHaveBeenCalled();
});

test('Ctrl+Z calls onUndo', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  fireKey({ key: 'z', ctrlKey: true });
  expect(h.onUndo).toHaveBeenCalledTimes(1);
});

test('Cmd+Shift+Z calls onRedo, not onUndo', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  fireKey({ key: 'z', metaKey: true, shiftKey: true });
  expect(h.onRedo).toHaveBeenCalledTimes(1);
  expect(h.onUndo).not.toHaveBeenCalled();
});

test('Cmd+Z while typing in an input does not call onUndo', () => {
  // Leave the browser's native per-field undo alone while the InlineEditor's <input> has
  // focus, rather than silently rewinding the document behind the user's cursor.
  const h = handlers();
  renderHook(() => useKeyboard(h));
  const input = document.createElement('input');
  document.body.appendChild(input);
  fireKey({ key: 'z', metaKey: true }, input);
  expect(h.onUndo).not.toHaveBeenCalled();
  input.remove();
});

test('plain "z" without a modifier does nothing', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  fireKey({ key: 'z' });
  expect(h.onUndo).not.toHaveBeenCalled();
  expect(h.onRedo).not.toHaveBeenCalled();
});

test('Cmd+S calls onSave and prevents the browser default', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  const event = new KeyboardEvent('keydown', { bubbles: true, key: 's', metaKey: true, cancelable: true });
  window.dispatchEvent(event);
  expect(h.onSave).toHaveBeenCalledTimes(1);
  expect(event.defaultPrevented).toBe(true);
});

test('Ctrl+S calls onSave', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  fireKey({ key: 's', ctrlKey: true });
  expect(h.onSave).toHaveBeenCalledTimes(1);
});

test('Cmd+S while typing in an input does not call onSave', () => {
  const h = handlers();
  renderHook(() => useKeyboard(h));
  const input = document.createElement('input');
  document.body.appendChild(input);
  fireKey({ key: 's', metaKey: true }, input);
  expect(h.onSave).not.toHaveBeenCalled();
  input.remove();
});

test('unbinds its listener on unmount', () => {
  const h = handlers();
  const { unmount } = renderHook(() => useKeyboard(h));
  unmount();
  fireKey({ key: 'Delete' });
  expect(h.onDelete).not.toHaveBeenCalled();
});
