import { render, screen, type RenderResult } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Toolbar } from './Toolbar';

const props = {
  theme: 'dark' as const, onToggleTheme: () => {},
  zoom: 1, onZoom: () => {},
  onNew: () => {}, onOpen: () => {}, onSave: () => {}, onSaveAs: () => {},
  canSave: true,
};

test('renders the file actions', () => {
  render(<Toolbar {...props} />);
  for (const name of [/new/i, /open/i, /^save$/i, /save as/i]) {
    expect(screen.getByRole('button', { name })).toBeInTheDocument();
  }
});

test('reports a theme toggle', async () => {
  const onToggleTheme = vi.fn();
  render(<Toolbar {...props} onToggleTheme={onToggleTheme} />);
  await userEvent.click(screen.getByRole('button', { name: /theme/i }));
  expect(onToggleTheme).toHaveBeenCalled();
});

test('steps zoom up and down and resets to fit', async () => {
  const onZoom = vi.fn();
  render(<Toolbar {...props} onZoom={onZoom} />);
  await userEvent.click(screen.getByRole('button', { name: /zoom in/i }));
  expect(onZoom).toHaveBeenCalledWith(1.25);
  await userEvent.click(screen.getByRole('button', { name: /fit/i }));
  expect(onZoom).toHaveBeenCalledWith(1);
});

test('disables Save when there is no file to save back to', () => {
  render(<Toolbar {...props} canSave={false} />);
  expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
});

// Toolbar is a controlled component: it reports the next zoom via onZoom rather than
// holding it itself. To exercise the clamp across repeated presses we re-render with
// each returned value, the same way App drives it via setZoom — this reads as "the
// component behaves correctly when driven the way its real caller drives it," rather
// than asserting on the raw sequence of mock-call arguments.
function rerenderWithZoom(rerender: RenderResult['rerender'], onZoom: (zoom: number) => void, zoom: number) {
  rerender(<Toolbar {...props} zoom={zoom} onZoom={onZoom} />);
}

test('clamps zoom in at 3 and stays there on further presses', async () => {
  const onZoom = vi.fn();
  let zoom = 1;
  const { rerender } = render(<Toolbar {...props} zoom={zoom} onZoom={onZoom} />);
  const zoomIn = () => screen.getByRole('button', { name: /zoom in/i });

  // 1 -> 1.25 -> 1.56 -> 1.95 -> 2.44 -> 3 (reaches the bound on the 5th press).
  for (let i = 0; i < 6; i++) {
    await userEvent.click(zoomIn());
    zoom = onZoom.mock.calls.at(-1)![0];
    rerenderWithZoom(rerender, onZoom, zoom);
    expect(zoom).toBeLessThanOrEqual(3);
  }
  expect(zoom).toBe(3);

  // Stable at the bound: one more press must leave it unchanged.
  await userEvent.click(zoomIn());
  expect(onZoom).toHaveBeenLastCalledWith(3);
});

test('clamps zoom out at 0.5 and stays there on further presses', async () => {
  const onZoom = vi.fn();
  let zoom = 1;
  const { rerender } = render(<Toolbar {...props} zoom={zoom} onZoom={onZoom} />);
  const zoomOut = () => screen.getByRole('button', { name: /zoom out/i });

  // 1 -> 0.8 -> 0.64 -> 0.51 -> 0.5 (reaches the bound on the 4th press).
  for (let i = 0; i < 5; i++) {
    await userEvent.click(zoomOut());
    zoom = onZoom.mock.calls.at(-1)![0];
    rerenderWithZoom(rerender, onZoom, zoom);
    expect(zoom).toBeGreaterThanOrEqual(0.5);
  }
  expect(zoom).toBe(0.5);

  // Stable at the bound: one more press must leave it unchanged.
  await userEvent.click(zoomOut());
  expect(onZoom).toHaveBeenLastCalledWith(0.5);
});

test('fit resets to exactly 1 from the high clamp bound', async () => {
  const onZoom = vi.fn();
  render(<Toolbar {...props} zoom={3} onZoom={onZoom} />);
  await userEvent.click(screen.getByRole('button', { name: /fit/i }));
  expect(onZoom).toHaveBeenCalledWith(1);
});

test('fit resets to exactly 1 from the low clamp bound', async () => {
  const onZoom = vi.fn();
  render(<Toolbar {...props} zoom={0.5} onZoom={onZoom} />);
  await userEvent.click(screen.getByRole('button', { name: /fit/i }));
  expect(onZoom).toHaveBeenCalledWith(1);
});

test('stepping up then back down the same number of times returns to exactly 1 (no rounding drift)', async () => {
  const onZoom = vi.fn();
  let zoom = 1;
  const { rerender } = render(<Toolbar {...props} zoom={zoom} onZoom={onZoom} />);
  const zoomIn = () => screen.getByRole('button', { name: /zoom in/i });
  const zoomOut = () => screen.getByRole('button', { name: /zoom out/i });
  const N = 4; // stays well clear of the [0.5, 3] clamp (peaks at 2.44) so this isolates rounding drift from saturation.

  for (let i = 0; i < N; i++) {
    await userEvent.click(zoomIn());
    zoom = onZoom.mock.calls.at(-1)![0];
    rerenderWithZoom(rerender, onZoom, zoom);
  }
  for (let i = 0; i < N; i++) {
    await userEvent.click(zoomOut());
    zoom = onZoom.mock.calls.at(-1)![0];
    rerenderWithZoom(rerender, onZoom, zoom);
  }

  expect(zoom).toBe(1);
});
