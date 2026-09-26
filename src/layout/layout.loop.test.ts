import { describe, expect, test } from 'vitest';
import { layout, type LayoutResult, type MeasureText } from './layout';
import type { Doc } from '../model/types';

const measure: MeasureText = (text) => text.length * 8;
const run = (doc: Doc) => layout(doc, measure);
const box = (r: LayoutResult, blockId: string) => r.boxes.find((b) => b.blockId === blockId)!;
const backEdge = (r: LayoutResult, blockId: string) => r.edges.find((e) => e.id === `back:${blockId}`)!;

describe('while', () => {
  const doc: Doc = { preamble: [], body: [{
    id: 'w', kind: 'while', cond: 'more?', isLabel: 'yes', endLabel: 'no',
    body: [{ id: 'r', kind: 'action', label: 'read file' }],
  }]};

  test('renders the condition as a diamond', () => {
    expect(box(run(doc), 'w')).toMatchObject({ kind: 'decision', label: 'more?', field: 'cond' });
  });

  test('places the body below the condition', () => {
    const r = run(doc);
    expect(box(r, 'r').y).toBeGreaterThan(box(r, 'w').y);
  });

  test('routes a back-edge that leaves the body extent horizontally', () => {
    const r = run(doc);
    const body = box(r, 'r');
    const xs = backEdge(r, 'w').points.map((p) => p.x);
    expect(Math.min(...xs)).toBeLessThan(body.x);
  });

  test('the back-edge returns to the top of the condition', () => {
    const r = run(doc);
    const points = backEdge(r, 'w').points;
    expect(points[points.length - 1].y).toBeLessThanOrEqual(box(r, 'w').y + box(r, 'w').h);
  });

  test('exposes both loop labels as editable edges', () => {
    const r = run(doc);
    expect(r.edges.find((e) => e.field === 'isLabel')).toMatchObject({ label: 'yes', blockId: 'w' });
    expect(r.edges.find((e) => e.field === 'endLabel')).toMatchObject({ label: 'no', blockId: 'w' });
  });

  test('keeps everything within the reported bounds, gutter included', () => {
    const r = run(doc);
    const xs = r.edges.flatMap((e) => e.points.map((p) => p.x));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(r.width);
  });
});

describe('repeat', () => {
  const doc: Doc = { preamble: [], body: [{
    id: 'p', kind: 'repeat', cond: 'again?', isLabel: 'yes',
    body: [{ id: 'b', kind: 'action', label: 'poll' }],
  }]};

  test('places the condition below the body', () => {
    const r = run(doc);
    expect(box(r, 'p').y).toBeGreaterThan(box(r, 'b').y);
  });

  test('routes a back-edge from the condition up past the body', () => {
    const r = run(doc);
    expect(backEdge(r, 'p').points.some((p) => p.y < box(r, 'b').y)).toBe(true);
  });
});

describe('nested loops', () => {
  test('reserves a separate gutter per nesting level so back-edges do not collide', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'outer', kind: 'while', cond: 'o?', body: [{
        id: 'inner', kind: 'while', cond: 'i?', body: [{ id: 'x', kind: 'action', label: 'X' }],
      }],
    }]};
    const r = run(doc);
    const outerX = Math.min(...backEdge(r, 'outer').points.map((p) => p.x));
    const innerX = Math.min(...backEdge(r, 'inner').points.map((p) => p.x));
    expect(outerX).toBeLessThan(innerX);
  });
});
