import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { Canvas } from './Canvas';
import { layout, type MeasureText } from '../layout/layout';
import type { Doc } from '../model/types';

const measure: MeasureText = (text) => text.length * 8;
const doc: Doc = { preamble: [], body: [
  { id: 'a', kind: 'action', label: 'Receive order' },
  { id: 'i', kind: 'if', branches: [{ cond: 'ok?', thenLabel: 'yes', body: [] }], elseBody: [], elseLabel: 'no' },
  { id: 's', kind: 'stop' },
]};
const result = layout(doc, measure);

// Task 9's right-leaning elseif cascade gives decision boxes ids of the shape
// `box:<blockId>:<branchIndex>` rather than `box:<blockId>`. Derive the id from the
// layout result instead of hardcoding it, per the task-12 controller ruling.
const iBoxId = result.boxes.find((b) => b.blockId === 'i' && b.kind === 'decision')!.id;

test('renders one element per box, including the start cap', () => {
  render(<Canvas result={result} selectedId={null} onSelect={() => {}} />);
  expect(screen.getByTestId('box:start')).toBeInTheDocument();
  expect(screen.getByTestId('box:a')).toBeInTheDocument();
  expect(screen.getByTestId(iBoxId)).toBeInTheDocument();
  expect(screen.getByTestId('box:s')).toBeInTheDocument();
});

test('renders block labels as text', () => {
  render(<Canvas result={result} selectedId={null} onSelect={() => {}} />);
  expect(screen.getByText('Receive order')).toBeInTheDocument();
  expect(screen.getByText('ok?')).toBeInTheDocument();
});

test('renders branch labels from edges', () => {
  render(<Canvas result={result} selectedId={null} onSelect={() => {}} />);
  expect(screen.getByText('yes')).toBeInTheDocument();
  expect(screen.getByText('no')).toBeInTheDocument();
});

test('marks the selected box', () => {
  render(<Canvas result={result} selectedId="a" onSelect={() => {}} />);
  expect(screen.getByTestId('box:a')).toHaveAttribute('data-selected', 'true');
  expect(screen.getByTestId('box:s')).toHaveAttribute('data-selected', 'false');
});

test('reports selection when a box is clicked', async () => {
  const onSelect = vi.fn();
  render(<Canvas result={result} selectedId={null} onSelect={onSelect} />);
  await userEvent.click(screen.getByTestId('box:a'));
  expect(onSelect).toHaveBeenCalledWith('a');
});

test('scales the viewBox with zoom without changing the coordinate space', () => {
  const { container } = render(<Canvas result={result} selectedId={null} zoom={2} onSelect={() => {}} />);
  const svg = container.querySelector('svg')!;
  expect(svg.getAttribute('viewBox')).toBe(`0 0 ${result.width} ${result.height}`);
  expect(svg.getAttribute('width')).toBe(String(result.width * 2));
});

test('renders edge labels as their own addressable text element, not on the polyline', () => {
  // Task 10's review found a while-loop's exit label sits beside the diamond while the
  // polyline runs elsewhere, so click-to-edit (Task 16) must hit-test the <text>, not the
  // <path>. Assert the label is independently addressable and is a <text>, not folded into
  // the path's own markup.
  render(<Canvas result={result} selectedId={null} onSelect={() => {}} />);
  const branchEdge = result.edges.find((e) => e.blockId === 'i' && e.field === 'thenLabel')!;
  const labelEl = screen.getByTestId(`${branchEdge.id}:label`);
  expect(labelEl.tagName).toBe('text');
  expect(labelEl.textContent).toBe('yes');
});

test('double-clicking an editable box starts an edit with its field, branchIndex, and rect', async () => {
  const onStartEdit = vi.fn();
  render(<Canvas result={result} selectedId={null} onSelect={() => {}} onStartEdit={onStartEdit} />);
  await userEvent.dblClick(screen.getByTestId(iBoxId));
  const box = result.boxes.find((b) => b.id === iBoxId)!;
  expect(onStartEdit).toHaveBeenCalledWith(
    { blockId: 'i', field: 'cond', branchIndex: 0 },
    { x: box.x, y: box.y, w: box.w, h: box.h },
  );
});

test('double-clicking a non-editable box (no field) does not start an edit', async () => {
  const onStartEdit = vi.fn();
  render(<Canvas result={result} selectedId={null} onSelect={() => {}} onStartEdit={onStartEdit} />);
  await userEvent.dblClick(screen.getByTestId('box:start'));
  expect(onStartEdit).not.toHaveBeenCalled();
});

test('double-clicking an edge label starts an edit anchored at labelAt, not the polyline', async () => {
  const onStartEdit = vi.fn();
  render(<Canvas result={result} selectedId={null} onSelect={() => {}} onStartEdit={onStartEdit} />);
  const branchEdge = result.edges.find((e) => e.blockId === 'i' && e.field === 'thenLabel')!;
  await userEvent.dblClick(screen.getByTestId(`${branchEdge.id}:label`));
  expect(onStartEdit).toHaveBeenCalledWith(
    { blockId: 'i', field: 'thenLabel', branchIndex: 0 },
    { x: branchEdge.labelAt!.x, y: branchEdge.labelAt!.y - 10, w: 80, h: 20 },
  );
});
