import { describe, expect, test } from 'vitest';
import { layout, type LayoutResult, type MeasureText } from './layout';
import { DEFAULT_METRICS } from './metrics';
import type { Doc } from '../model/types';

const measure: MeasureText = (text) => text.length * 8;
const run = (doc: Doc) => layout(doc, measure);
const box = (r: LayoutResult, blockId: string) => r.boxes.find((b) => b.blockId === blockId)!;
const centre = (b: { x: number; w: number }) => b.x + b.w / 2;

describe('the start cap', () => {
  test('an empty document still renders exactly one start cap', () => {
    const r = run({ preamble: [], body: [] });
    expect(r.boxes.filter((b) => b.kind === 'start')).toHaveLength(1);
  });

  test('the start cap is the topmost box', () => {
    const r = run({ preamble: [], body: [{ id: 'a', kind: 'action', label: 'A' }] });
    const start = r.boxes.find((b) => b.kind === 'start')!;
    expect(start.y).toBeLessThan(box(r, 'a').y);
  });

  // measureSeq() budgets one gapY of height for an empty sequence (its stub), so a nested
  // empty branch doesn't collapse to zero height against its measured siblings. placeSeq()
  // must consume that same gapY when it places an empty sequence, or the two passes
  // disagree and downstream content sits gapY higher than it was measured for.
  //
  // Tasks 9/10 will be able to trigger this directly with an empty if-branch or while-body,
  // but neither block kind exists yet in Task 8 (measureBlock/placeBlock still throw on
  // 'if'/'while'). The only empty-sequence path reachable today is the document's own body,
  // so this test exercises that path: an empty document's reported height must include the
  // stub gapY that measurement already budgeted for it, not just the start cap plus the gap
  // before the (empty) body.
  test('an empty body still consumes the stub height that measurement budgeted for it', () => {
    const r = run({ preamble: [], body: [] });
    const start = r.boxes.find((b) => b.kind === 'start')!;
    // `start.y` already carries the default inset (`DEFAULT_METRICS.margin`), so the
    // uninset stub math only needs the bottom margin added back on top of it.
    const bodyTop = start.y + start.h + DEFAULT_METRICS.gapY;
    expect(r.height).toBe(bodyTop + DEFAULT_METRICS.gapY + DEFAULT_METRICS.margin);
  });
});

describe('a sequence of leaves', () => {
  const doc: Doc = { preamble: [], body: [
    { id: 'a', kind: 'action', label: 'Receive order' },
    { id: 'b', kind: 'action', label: 'Ship' },
    { id: 'c', kind: 'stop' },
  ]};

  test('stacks blocks downward in document order', () => {
    const r = run(doc);
    expect(box(r, 'a').y).toBeLessThan(box(r, 'b').y);
    expect(box(r, 'b').y).toBeLessThan(box(r, 'c').y);
  });

  test('does not overlap consecutive blocks', () => {
    const r = run(doc);
    expect(box(r, 'a').y + box(r, 'a').h).toBeLessThan(box(r, 'b').y);
  });

  test('aligns every block on a common spine', () => {
    const r = run(doc);
    expect(centre(box(r, 'b'))).toBeCloseTo(centre(box(r, 'a')));
    expect(centre(box(r, 'c'))).toBeCloseTo(centre(box(r, 'a')));
  });

  test('sizes a box to its label', () => {
    const r = run(doc);
    expect(box(r, 'a').w).toBeGreaterThan(box(r, 'b').w);
  });

  test('carries the block id and edit field so the canvas can start an edit', () => {
    expect(box(run(doc), 'a')).toMatchObject({ kind: 'action', label: 'Receive order', field: 'label' });
  });

  test('connects consecutive blocks with one edge each, plus start', () => {
    expect(run(doc).edges).toHaveLength(3);
  });

  test('reports a bounding size that contains every box', () => {
    const r = run(doc);
    for (const b of r.boxes) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(r.width);
      expect(b.y + b.h).toBeLessThanOrEqual(r.height);
    }
  });
});

describe('terminators', () => {
  test('stop and end get distinct kinds', () => {
    const r = run({ preamble: [], body: [{ id: 's', kind: 'stop' }, { id: 'e', kind: 'end' }] });
    expect(box(r, 's').kind).toBe('stop');
    expect(box(r, 'e').kind).toBe('end');
  });
});

describe('notes', () => {
  const doc: Doc = { preamble: [], body: [
    { id: 'a', kind: 'action', label: 'Ship', note: { side: 'right', text: 'within 24h' } },
  ]};

  test('places a right-hand note to the right of its block, vertically overlapping it', () => {
    const r = run(doc);
    const note = r.boxes.find((b) => b.kind === 'note')!;
    expect(note.x).toBeGreaterThan(box(r, 'a').x + box(r, 'a').w);
    expect(note.y).toBeLessThan(box(r, 'a').y + box(r, 'a').h);
  });

  test('places a left-hand note to the left of its block', () => {
    const left: Doc = { preamble: [], body: [
      { id: 'a', kind: 'action', label: 'Ship', note: { side: 'left', text: 'soon' } },
    ]};
    const r = run(left);
    const note = r.boxes.find((b) => b.kind === 'note')!;
    expect(note.x + note.w).toBeLessThanOrEqual(box(r, 'a').x);
  });

  test('joins the note to its block with a dashed edge', () => {
    expect(run(doc).edges.some((e) => e.dashed)).toBe(true);
  });

  test('keeps the note inside the reported width', () => {
    const r = run(doc);
    const note = r.boxes.find((b) => b.kind === 'note')!;
    expect(note.x + note.w).toBeLessThanOrEqual(r.width);
  });
});

describe('a note taller than its action', () => {
  const doc: Doc = { preamble: [], body: [
    { id: 'a', kind: 'action', label: 'X', note: { side: 'right', text: 'one\ntwo\nthree' } },
    { id: 'b', kind: 'action', label: 'Y' },
  ]};

  test('does not overlap the following block', () => {
    const r = run(doc);
    const note = r.boxes.find((b) => b.kind === 'note')!;
    expect(note.y + note.h).toBeLessThanOrEqual(box(r, 'b').y);
  });

  test('joins the note to its block with a horizontal edge, even when their heights differ', () => {
    const r = run(doc);
    const edge = r.edges.find((e) => e.dashed)!;
    expect(edge.points[0].y).toBe(edge.points[1].y);
  });
});

describe('a note shorter than its action', () => {
  // Note shorter than its action's (multi-line) label: this is the reverse height relationship
  // from the "taller" describe block above, and is the case that catches a slanted note edge —
  // `min(h, nh)` on only one endpoint equals `h` (not slanted) whenever the note is the taller
  // one, so that direction alone can't prove the edge is horizontal.
  const doc: Doc = { preamble: [], body: [
    { id: 'a', kind: 'action', label: 'multi\nline\nlabel', note: { side: 'right', text: 'short' } },
  ]};

  test('joins the note to its block with a horizontal edge', () => {
    const r = run(doc);
    const edge = r.edges.find((e) => e.dashed)!;
    expect(edge.points[0].y).toBe(edge.points[1].y);
  });
});
