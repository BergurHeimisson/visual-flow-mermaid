import { describe, expect, test } from 'vitest';
import { layout, type LayoutResult, type MeasureText } from './layout';
import { DEFAULT_METRICS, measureLabel } from './metrics';
import { createBlock } from '../model/factory';
import type { Doc } from '../model/types';

const measure: MeasureText = (text) => text.length * 8;
const m = DEFAULT_METRICS;
const run = (doc: Doc) => layout(doc, measure);

/**
 * Everything layout() places — boxes, drop zones, edge points, and an edge label's actual
 * rendered extent (not just its anchor point) — must fall within the reported
 * width/height. Canvas.tsx's <svg> renders `viewBox="0 0 {width} {height}"` and a root
 * <svg>'s default `overflow: hidden` clips anything outside that silently, with no error,
 * in a real browser. jsdom (where every test in this file runs) never renders or clips
 * anything, so this assertion is the only thing standing between a layout bug and a
 * genuinely invisible/un-hit-testable element on screen — it is not a substitute for the
 * e2e coverage in `e2e/editor.spec.ts`, but it catches the same class of bug far earlier
 * and for far more shapes than an e2e test practically can.
 */
function assertWithinBounds(r: LayoutResult): void {
  const { width, height } = r;

  for (const b of r.boxes) {
    expect(b.x, `box ${b.id} x`).toBeGreaterThanOrEqual(0);
    expect(b.y, `box ${b.id} y`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w, `box ${b.id} right edge`).toBeLessThanOrEqual(width);
    expect(b.y + b.h, `box ${b.id} bottom edge`).toBeLessThanOrEqual(height);
  }

  for (const z of r.dropZones) {
    expect(z.x, `zone ${z.id} x`).toBeGreaterThanOrEqual(0);
    expect(z.y, `zone ${z.id} y`).toBeGreaterThanOrEqual(0);
    expect(z.x + z.w, `zone ${z.id} right edge`).toBeLessThanOrEqual(width);
    expect(z.y + z.h, `zone ${z.id} bottom edge`).toBeLessThanOrEqual(height);
  }

  for (const e of r.edges) {
    for (const p of e.points) {
      expect(p.x, `edge ${e.id} point x`).toBeGreaterThanOrEqual(0);
      expect(p.y, `edge ${e.id} point y`).toBeGreaterThanOrEqual(0);
      expect(p.x, `edge ${e.id} point x`).toBeLessThanOrEqual(width);
      expect(p.y, `edge ${e.id} point y`).toBeLessThanOrEqual(height);
    }

    if (e.label === undefined || !e.labelAt) continue;

    // Mirrors Edge.tsx: <text x={labelAt.x + 6} y={labelAt.y} dominantBaseline="middle">.
    // Left-anchored (default text-anchor) at x, vertically centered on y.
    const size = measureLabel(e.label, measure, m);
    const x0 = e.labelAt.x + 6;
    const x1 = x0 + size.w;
    const y0 = e.labelAt.y - size.h / 2;
    const y1 = e.labelAt.y + size.h / 2;
    expect(x0, `edge ${e.id} label left edge`).toBeGreaterThanOrEqual(0);
    expect(y0, `edge ${e.id} label top edge`).toBeGreaterThanOrEqual(0);
    expect(x1, `edge ${e.id} label right edge`).toBeLessThanOrEqual(width);
    expect(y1, `edge ${e.id} label bottom edge`).toBeLessThanOrEqual(height);
  }
}

/**
 * Box.tsx draws a selection ring around a selected box, outset `ringOutset` px (plus half
 * its stroke width) beyond the box on every side — see `Box.tsx`'s selection `<rect>`. The
 * layout must leave enough room for that ring to render fully inside the `<svg>`'s own
 * viewBox, or a box sitting at the layout's edge (the common case: this is what "Fit" zooms
 * to) has its ring silently clipped the instant it's selected, exactly like the drop-zone
 * and edge-label bugs above. Reads the same `m.ringOutset` Box.tsx draws its ring at, so
 * this test and the renderer can't silently drift apart.
 */
const RING_OUTSET = m.ringOutset;

function assertRingWithinBounds(r: LayoutResult): void {
  const { width, height } = r;
  for (const b of r.boxes) {
    expect(b.x - RING_OUTSET, `box ${b.id} ring left edge`).toBeGreaterThanOrEqual(0);
    expect(b.y - RING_OUTSET, `box ${b.id} ring top edge`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.w + RING_OUTSET, `box ${b.id} ring right edge`).toBeLessThanOrEqual(width);
    expect(b.y + b.h + RING_OUTSET, `box ${b.id} ring bottom edge`).toBeLessThanOrEqual(height);
  }
}

describe('every box leaves room for its selection ring (default inset)', () => {
  test('the empty document (its one drop zone) has no boxes, but must not throw', () => {
    assertRingWithinBounds(run({ preamble: [], body: [] }));
  });

  test('a bare while loop with the factory-default endLabel', () => {
    const doc: Doc = { preamble: [], body: [createBlock('while', 'w')] };
    assertRingWithinBounds(run(doc));
  });

  test('a repeat loop with the factory-default isLabel', () => {
    const doc: Doc = { preamble: [], body: [createBlock('repeat', 'p')] };
    assertRingWithinBounds(run(doc));
  });

  test('a nested loop, each level with its own default labels', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'outer', kind: 'while', cond: 'o?', isLabel: 'yes', endLabel: 'no',
      body: [{
        id: 'inner', kind: 'while', cond: 'i?', isLabel: 'yes', endLabel: 'no',
        body: [{ id: 'x', kind: 'action', label: 'X' }],
      }],
    }]};
    assertRingWithinBounds(run(doc));
  });

  test('an elseif cascade with a label on every branch', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'i', kind: 'if',
      branches: [
        { cond: 'a?', thenLabel: 'yes', body: [{ id: 'x', kind: 'action', label: 'X' }] },
        { cond: 'b?', thenLabel: 'maybe', body: [{ id: 'y', kind: 'action', label: 'Y' }] },
      ],
      elseBody: [{ id: 'z', kind: 'action', label: 'Z' }], elseLabel: 'no',
    }]};
    assertRingWithinBounds(run(doc));
  });

  test('a fork with three parallel branches', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'f', kind: 'fork',
      branches: [
        [{ id: 'a', kind: 'action', label: 'A' }],
        [{ id: 'b', kind: 'action', label: 'B' }],
        [{ id: 'c', kind: 'action', label: 'C' }],
      ],
    }]};
    assertRingWithinBounds(run(doc));
  });
});

describe('everything layout() places stays within the reported width/height', () => {
  test('the empty document (its one drop zone) — regression guard for the drop-zone fix', () => {
    assertWithinBounds(run({ preamble: [], body: [] }));
  });

  test('a bare while loop with the factory-default endLabel', () => {
    // This is the shape the reviewer measured the regression on: labelAt.x = 158 against
    // width = 152 before the edge-label fix — the "no" endLabel Edge.tsx would draw is
    // exactly what createBlock('while') gives every new loop a user creates.
    const doc: Doc = { preamble: [], body: [createBlock('while', 'w')] };
    assertWithinBounds(run(doc));
  });

  test('a repeat loop with the factory-default isLabel', () => {
    const doc: Doc = { preamble: [], body: [createBlock('repeat', 'p')] };
    assertWithinBounds(run(doc));
  });

  test('a nested loop, each level with its own default labels', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'outer', kind: 'while', cond: 'o?', isLabel: 'yes', endLabel: 'no',
      body: [{
        id: 'inner', kind: 'while', cond: 'i?', isLabel: 'yes', endLabel: 'no',
        body: [{ id: 'x', kind: 'action', label: 'X' }],
      }],
    }]};
    assertWithinBounds(run(doc));
  });

  test('an elseif cascade with a label on every branch', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'i', kind: 'if',
      branches: [
        { cond: 'a?', thenLabel: 'yes', body: [{ id: 'x', kind: 'action', label: 'X' }] },
        { cond: 'b?', thenLabel: 'maybe', body: [{ id: 'y', kind: 'action', label: 'Y' }] },
      ],
      elseBody: [{ id: 'z', kind: 'action', label: 'Z' }], elseLabel: 'no',
    }]};
    assertWithinBounds(run(doc));
  });

  test('a fork with three parallel branches', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'f', kind: 'fork',
      branches: [
        [{ id: 'a', kind: 'action', label: 'A' }],
        [{ id: 'b', kind: 'action', label: 'B' }],
        [{ id: 'c', kind: 'action', label: 'C' }],
      ],
    }]};
    assertWithinBounds(run(doc));
  });
});
