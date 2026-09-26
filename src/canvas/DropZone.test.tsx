import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Canvas } from './Canvas';
import { layout, type MeasureText } from '../layout/layout';
import type { Doc } from '../model/types';

const measure: MeasureText = (text) => text.length * 8;
const doc: Doc = { preamble: [], body: [{ id: 'a', kind: 'action', label: 'A' }] };
const result = layout(doc, measure);

// Ported from HTML5 drag-and-drop to pointer events. Every test below used to synthesise a
// `dragstart`/`dragover`/`drop` with a hand-rolled `dataTransfer`, which bypassed the
// browser's decision about whether a drag may begin at all — and Chromium never begins one
// on an SVG element, so they passed against code that could never run. Which target a
// pointer is over is now geometry, tested in src/dnd.test.ts; what remains here is what
// this component is actually responsible for: rendering.

test('hides drop zones until a drag starts', () => {
  const { rerender } = render(<Canvas result={result} selectedId={null} onSelect={() => {}} />);
  expect(screen.queryByTestId(result.dropZones[0].id)).not.toBeInTheDocument();
  rerender(<Canvas result={result} selectedId={null} dragging onSelect={() => {}} />);
  expect(screen.getByTestId(result.dropZones[0].id)).toBeInTheDocument();
});

// Was "highlights the zone under the cursor" (a `dragOver` on the zone flipping its own
// internal state). The zone no longer decides: exactly one zone is active, chosen once for
// all of them from a single pointer position, which is what stops a zone hidden under the
// floating BlockControls bar from being unreachable.
test('highlights exactly the zone the drag is over', () => {
  const [first, second] = result.dropZones;
  render(<Canvas result={result} selectedId={null} dragging activeZoneId={second.id} onSelect={() => {}} />);
  expect(screen.getByTestId(second.id)).toHaveAttribute('data-active', 'true');
  expect(screen.getByTestId(first.id)).toHaveAttribute('data-active', 'false');
});

test('highlights no zone while the drag is over empty canvas', () => {
  render(<Canvas result={result} selectedId={null} dragging activeZoneId={null} onSelect={() => {}} />);
  for (const zone of result.dropZones) {
    expect(screen.getByTestId(zone.id)).toHaveAttribute('data-active', 'false');
  }
});

// Was "makes canvas blocks draggable", which asserted `draggable="true"` on the `<g>`. That
// attribute was the bug: it is defined for HTML elements, and Chromium fires no `dragstart`
// on SVG. The real question is whether pressing a block begins a drag of that block.
test('pressing a canvas block begins a drag carrying its id', () => {
  const onDragBlock = vi.fn();
  render(<Canvas result={result} selectedId={null} onSelect={() => {}} onDragBlock={onDragBlock} />);
  fireEvent.pointerDown(screen.getByTestId('box:a'), { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
  expect(onDragBlock).toHaveBeenCalledWith('a', expect.anything());
});

test('pressing a decoration with no block behind it begins no drag', () => {
  const onDragBlock = vi.fn();
  render(<Canvas result={result} selectedId={null} onSelect={() => {}} onDragBlock={onDragBlock} />);
  fireEvent.pointerDown(screen.getByTestId('box:start'), { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
  expect(onDragBlock).not.toHaveBeenCalled();
});

// Was "an action box accepts a note drag (preventDefault marks it a valid target)". With no
// dataTransfer there is no preventDefault to assert; the user-visible equivalent is that
// the box the note will attach to is marked as the live target.
test('marks the action box a dragged note will attach to', () => {
  render(<Canvas result={result} selectedId={null} dragging noteTargetId="a" onSelect={() => {}} />);
  expect(screen.getByTestId('box:a')).toHaveAttribute('data-drop-target', 'true');
  expect(screen.getByTestId('box:start')).toHaveAttribute('data-drop-target', 'false');
});

test('marks no box when the drag is not over one', () => {
  render(<Canvas result={result} selectedId={null} dragging noteTargetId={null} onSelect={() => {}} />);
  expect(screen.getByTestId('box:a')).toHaveAttribute('data-drop-target', 'false');
});
