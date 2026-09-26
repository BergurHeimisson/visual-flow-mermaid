import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { useDrag } from './useDrag';
import type { DragPayload, DragTarget } from '../dnd';

const ZONE: DragTarget = {
  kind: 'zone',
  zone: { id: 'drop:root:0', x: 0, y: 0, w: 10, h: 10, path: [], index: 0, persistent: false },
};
const PAYLOAD: DragPayload = { source: 'palette', kind: 'if' };

function Harness({ resolve, commit, onClick }: {
  resolve: (payload: DragPayload, x: number, y: number) => DragTarget | null;
  commit: (payload: DragPayload, target: DragTarget) => void;
  onClick?: () => void;
}) {
  const { drag, startDrag } = useDrag({ resolve, commit });
  return (
    <div>
      <button type="button" onPointerDown={(e) => startDrag(PAYLOAD, e)} onClick={onClick}>source</button>
      <span data-testid="state">
        {drag === null ? 'idle' : `dragging:${drag.target ? drag.target.kind : 'none'}`}
      </span>
    </div>
  );
}

const press = (x = 100, y = 100) =>
  fireEvent.pointerDown(screen.getByRole('button', { name: 'source' }), { button: 0, pointerId: 1, clientX: x, clientY: y });
const move = (x: number, y: number) => fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: y });
const up = (x: number, y: number) => fireEvent.pointerUp(window, { pointerId: 1, clientX: x, clientY: y });

const always = (target: DragTarget | null) => () => target;
const state = () => screen.getByTestId('state').textContent;

test('a press alone is not a drag: no zones, nothing committed', () => {
  const commit = vi.fn();
  render(<Harness resolve={always(ZONE)} commit={commit} />);
  press();
  expect(state()).toBe('idle');
  up(100, 100);
  expect(commit).not.toHaveBeenCalled();
});

test('a press that moves less than the threshold is still not a drag', () => {
  const commit = vi.fn();
  render(<Harness resolve={always(ZONE)} commit={commit} />);
  press();
  move(102, 100); // 2px, under DRAG_THRESHOLD
  expect(state()).toBe('idle');
  up(102, 100);
  expect(commit).not.toHaveBeenCalled();
});

test('moving past the threshold starts the drag and resolves a target', () => {
  render(<Harness resolve={always(ZONE)} commit={vi.fn()} />);
  press();
  move(120, 100);
  expect(state()).toBe('dragging:zone');
});

test('a drag over nothing is still a drag, just without a target', () => {
  render(<Harness resolve={always(null)} commit={vi.fn()} />);
  press();
  move(120, 100);
  expect(state()).toBe('dragging:none');
});

test('releasing over a target commits it with the payload', () => {
  const commit = vi.fn();
  render(<Harness resolve={always(ZONE)} commit={commit} />);
  press();
  move(120, 100);
  up(130, 100);
  expect(commit).toHaveBeenCalledWith(PAYLOAD, ZONE);
  expect(state()).toBe('idle');
});

test('releasing over nothing cancels cleanly, committing nothing', () => {
  const commit = vi.fn();
  render(<Harness resolve={always(null)} commit={commit} />);
  press();
  move(120, 100);
  up(130, 100);
  expect(commit).not.toHaveBeenCalled();
  expect(state()).toBe('idle');
});

test('the commit uses the target under the RELEASE point, not the last move', () => {
  const commit = vi.fn();
  const resolve = (_p: DragPayload, x: number): DragTarget | null => (x > 200 ? ZONE : null);
  render(<Harness resolve={resolve} commit={commit} />);
  press();
  move(120, 100);          // over nothing
  up(300, 100);            // released over the zone
  expect(commit).toHaveBeenCalledWith(PAYLOAD, ZONE);
});

test('Escape mid-drag aborts without committing', () => {
  const commit = vi.fn();
  render(<Harness resolve={always(ZONE)} commit={commit} />);
  press();
  move(120, 100);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(state()).toBe('idle');
  up(120, 100);
  expect(commit).not.toHaveBeenCalled();
});

test('pointercancel aborts without committing', () => {
  const commit = vi.fn();
  render(<Harness resolve={always(ZONE)} commit={commit} />);
  press();
  move(120, 100);
  fireEvent.pointerCancel(window, { pointerId: 1 });
  expect(state()).toBe('idle');
  expect(commit).not.toHaveBeenCalled();
});

// A drag that moved must not ALSO fire the source's click: Chromium fires `click` on the
// element that held the pointer capture, so a dropped palette item would insert twice —
// once from the drop, once from the click.
test('a completed drag swallows the click the browser fires on the source', () => {
  const onClick = vi.fn();
  render(<Harness resolve={always(ZONE)} commit={vi.fn()} onClick={onClick} />);
  press();
  move(120, 100);
  up(130, 100);
  fireEvent.click(screen.getByRole('button', { name: 'source' }));
  expect(onClick).not.toHaveBeenCalled();
});

test('a plain click still reaches the source, so click-to-insert keeps working', () => {
  const onClick = vi.fn();
  render(<Harness resolve={always(ZONE)} commit={vi.fn()} onClick={onClick} />);
  press();
  up(100, 100);
  fireEvent.click(screen.getByRole('button', { name: 'source' }));
  expect(onClick).toHaveBeenCalled();
});

test('a non-primary button never starts a drag', () => {
  const commit = vi.fn();
  render(<Harness resolve={always(ZONE)} commit={commit} />);
  fireEvent.pointerDown(screen.getByRole('button', { name: 'source' }), { button: 2, pointerId: 1, clientX: 100, clientY: 100 });
  move(200, 100);
  up(200, 100);
  expect(state()).toBe('idle');
  expect(commit).not.toHaveBeenCalled();
});

test('a second pointer does not hijack the gesture', () => {
  const commit = vi.fn();
  render(<Harness resolve={always(ZONE)} commit={commit} />);
  press();
  move(120, 100);
  fireEvent.pointerUp(window, { pointerId: 99, clientX: 120, clientY: 100 });
  expect(state()).toBe('dragging:zone');
  expect(commit).not.toHaveBeenCalled();
});
