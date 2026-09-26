import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Palette, PALETTE_ITEMS } from './Palette';

test('offers exactly the eight spec constructs', () => {
  expect(PALETTE_ITEMS.map((i) => i.kind))
    .toEqual(['action', 'if', 'while', 'repeat', 'fork', 'stop', 'end', 'note']);
});

test('renders one button per construct', () => {
  render(<Palette onInsert={() => {}} noteEnabled />);
  expect(screen.getAllByRole('button')).toHaveLength(8);
});

test('reports the kind when a construct is clicked', async () => {
  const onInsert = vi.fn();
  render(<Palette onInsert={onInsert} noteEnabled />);
  await userEvent.click(screen.getByRole('button', { name: /decision/i }));
  expect(onInsert).toHaveBeenCalledWith('if');
});

test('disables note when no action is selected, since a note must attach to one', () => {
  render(<Palette onInsert={() => {}} noteEnabled={false} />);
  expect(screen.getByRole('button', { name: /note/i })).toBeDisabled();
});

// Ported from HTML5 drag-and-drop to pointer events. This was "a palette drag carries the
// kind under the shared KIND_MIME type": it synthesised a `dragstart` and asserted the MIME
// string written to a stubbed `dataTransfer`. Pointer events have no `dataTransfer`, so the
// payload is a typed value (`DragPayload` in src/dnd.ts) handed straight to the caller —
// there is no string left to typo, but the item still has to report the right kind.
test('pressing a palette item begins a drag carrying that kind', () => {
  const onDragStart = vi.fn();
  render(<Palette onInsert={() => {}} noteEnabled onDragStart={onDragStart} />);
  fireEvent.pointerDown(screen.getByRole('button', { name: /decision/i }), { button: 0, pointerId: 1 });
  expect(onDragStart).toHaveBeenCalledWith('if', expect.anything());
});

// The palette items must stay real, focusable buttons: click-to-insert is the keyboard and
// accessibility path, and layering a pointer drag on top must not take that away.
test('every palette item is a real button, so Enter and Space still insert', async () => {
  const onInsert = vi.fn();
  render(<Palette onInsert={onInsert} noteEnabled />);
  const decision = screen.getByRole('button', { name: /decision/i });
  decision.focus();
  expect(decision).toHaveFocus();
  await userEvent.keyboard('{Enter}');
  expect(onInsert).toHaveBeenCalledWith('if');
});

test('a disabled note item begins no drag', () => {
  const onDragStart = vi.fn();
  render(<Palette onInsert={() => {}} noteEnabled={false} onDragStart={onDragStart} />);
  fireEvent.pointerDown(screen.getByRole('button', { name: /note/i }), { button: 0, pointerId: 1 });
  expect(onDragStart).not.toHaveBeenCalled();
});
