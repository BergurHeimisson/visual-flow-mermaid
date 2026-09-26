import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { Splitter } from './Splitter';

test('widens the panel as the pointer moves left', () => {
  const onResize = vi.fn();
  render(<Splitter width={320} onResize={onResize} />);
  fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 500 });
  fireEvent.mouseMove(window, { clientX: 460 });
  expect(onResize).toHaveBeenCalledWith(360);
});

test('narrows the panel as the pointer moves right', () => {
  const onResize = vi.fn();
  render(<Splitter width={320} onResize={onResize} />);
  fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 500 });
  fireEvent.mouseMove(window, { clientX: 540 });
  expect(onResize).toHaveBeenCalledWith(280);
});

test('clamps to the configured bounds', () => {
  const onResize = vi.fn();
  render(<Splitter width={320} onResize={onResize} min={240} max={720} />);
  fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 500 });
  fireEvent.mouseMove(window, { clientX: 5000 });
  expect(onResize).toHaveBeenCalledWith(240);
});

test('ignores pointer movement when no drag is in progress', () => {
  const onResize = vi.fn();
  render(<Splitter width={320} onResize={onResize} />);
  fireEvent.mouseMove(window, { clientX: 100 });
  expect(onResize).not.toHaveBeenCalled();
});

test('stops resizing after mouse up', () => {
  const onResize = vi.fn();
  render(<Splitter width={320} onResize={onResize} />);
  fireEvent.mouseDown(screen.getByRole('separator'), { clientX: 500 });
  fireEvent.mouseUp(window);
  fireEvent.mouseMove(window, { clientX: 400 });
  expect(onResize).not.toHaveBeenCalled();
});
