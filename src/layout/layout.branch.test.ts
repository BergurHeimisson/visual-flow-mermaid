import { describe, expect, test } from 'vitest';
import { layout, type LayoutResult, type MeasureText } from './layout';
import { DEFAULT_METRICS } from './metrics';
import type { Doc } from '../model/types';

const measure: MeasureText = (text) => text.length * 8;
const run = (doc: Doc) => layout(doc, measure);
const box = (r: LayoutResult, blockId: string) => r.boxes.find((b) => b.blockId === blockId)!;

const decision: Doc = { preamble: [], body: [{
  id: 'i', kind: 'if',
  branches: [{ cond: 'In stock?', thenLabel: 'yes', body: [{ id: 't', kind: 'action', label: 'Ship' }] }],
  elseBody: [{ id: 'e', kind: 'action', label: 'Backorder' }], elseLabel: 'no',
}]};

describe('decision', () => {
  test('renders a diamond for the condition', () => {
    expect(box(run(decision), 'i')).toMatchObject({ kind: 'decision', label: 'In stock?', field: 'cond' });
  });

  test('places both branches below the diamond', () => {
    const r = run(decision);
    expect(box(r, 't').y).toBeGreaterThan(box(r, 'i').y + box(r, 'i').h);
    expect(box(r, 'e').y).toBeGreaterThan(box(r, 'i').y + box(r, 'i').h);
  });

  test('places branches side by side without overlapping', () => {
    const r = run(decision);
    const [left, right] = [box(r, 't'), box(r, 'e')].sort((a, b) => a.x - b.x);
    expect(left.x + left.w).toBeLessThanOrEqual(right.x);
  });

  test('emits an editable label edge per branch', () => {
    const r = run(decision);
    const labels = r.edges.filter((e) => e.label !== undefined);
    expect(labels.map((e) => e.label).sort()).toEqual(['no', 'yes']);
    expect(labels.every((e) => e.labelAt !== undefined)).toBe(true);
    expect(labels.find((e) => e.label === 'yes')).toMatchObject({ field: 'thenLabel', branchIndex: 0 });
    expect(labels.find((e) => e.label === 'no')).toMatchObject({ field: 'elseLabel' });
  });

  test('merges the branches back onto one spine', () => {
    const r = run(decision);
    const merge = r.boxes.find((b) => b.kind === 'merge')!;
    expect(merge.y).toBeGreaterThan(Math.max(box(r, 't').y, box(r, 'e').y));
  });

  test('handles an elseif chain with three columns', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'i', kind: 'if',
      branches: [
        { cond: 'a?', thenLabel: 'yes', body: [{ id: 'x', kind: 'action', label: 'X' }] },
        { cond: 'b?', thenLabel: 'maybe', body: [{ id: 'y', kind: 'action', label: 'Y' }] },
      ],
      elseBody: [{ id: 'z', kind: 'action', label: 'Z' }], elseLabel: 'no',
    }]};
    const r = run(doc);
    const xs = ['x', 'y', 'z'].map((id) => box(r, id).x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  test('handles a decision with no else arm', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'i', kind: 'if', branches: [{ cond: 'a?', body: [{ id: 'x', kind: 'action', label: 'X' }] }],
    }]};
    expect(() => run(doc)).not.toThrow();
  });

  test('keeps a following block below the whole decision', () => {
    const doc: Doc = { preamble: [], body: [...decision.body, { id: 'after', kind: 'stop' }] };
    const r = run(doc);
    expect(box(r, 'after').y).toBeGreaterThan(box(r, 't').y + box(r, 't').h);
    expect(box(r, 'after').y).toBeGreaterThan(box(r, 'e').y + box(r, 'e').h);
  });

  test('nests a decision inside a branch without overlap', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'outer', kind: 'if',
      branches: [{ cond: 'o?', body: [{
        id: 'inner', kind: 'if',
        branches: [{ cond: 'i?', body: [{ id: 'deep', kind: 'action', label: 'D' }] }],
        elseBody: [{ id: 'deep2', kind: 'action', label: 'E' }],
      }] }],
      elseBody: [{ id: 'other', kind: 'action', label: 'O' }],
    }]};
    const r = run(doc);
    const deep = box(r, 'deep');
    const other = box(r, 'other');
    expect(deep.x + deep.w <= other.x || other.x + other.w <= deep.x).toBe(true);
  });
});

describe('elseif cascade', () => {
  const twoBranch: Doc = { preamble: [], body: [{
    id: 'i', kind: 'if',
    branches: [
      { cond: 'a?', thenLabel: 'yes', body: [{ id: 'x', kind: 'action', label: 'X' }] },
      { cond: 'b?', thenLabel: 'maybe', body: [{ id: 'y', kind: 'action', label: 'Y' }] },
    ],
    elseBody: [{ id: 'z', kind: 'action', label: 'Z' }], elseLabel: 'no',
  }]};

  test('emits one decision box per branch condition, not one diamond fanning into columns', () => {
    const r = run(twoBranch);
    const decisions = r.boxes.filter((b) => b.kind === 'decision' && b.blockId === 'i');
    expect(decisions.map((b) => b.label).sort()).toEqual(['a?', 'b?']);
  });

  test('each decision box carries field: cond and its own branchIndex', () => {
    const r = run(twoBranch);
    const decisions = r.boxes.filter((b) => b.kind === 'decision' && b.blockId === 'i');
    const a = decisions.find((b) => b.label === 'a?')!;
    const b = decisions.find((b) => b.label === 'b?')!;
    expect(a).toMatchObject({ field: 'cond', branchIndex: 0 });
    expect(b).toMatchObject({ field: 'cond', branchIndex: 1 });
  });

  test('the second diamond sits below and to one side of the first (cascade, not a level fan)', () => {
    const r = run(twoBranch);
    const decisions = r.boxes.filter((b) => b.kind === 'decision' && b.blockId === 'i');
    const a = decisions.find((b) => b.label === 'a?')!;
    const b = decisions.find((b) => b.label === 'b?')!;
    expect(b.y).toBeGreaterThan(a.y + a.h);
    expect(b.x).not.toEqual(a.x);
  });

  test('a plain if/else (single branch) still lays out exactly as the two-column degenerate case', () => {
    const r = run(decision);
    const [left, right] = [box(r, 't'), box(r, 'e')].sort((a, b) => a.x - b.x);
    expect(left.x + left.w).toBeLessThanOrEqual(right.x);
    expect(box(r, 't').y).toBeGreaterThan(box(r, 'i').y + box(r, 'i').h);
    const merge = r.boxes.find((b) => b.kind === 'merge')!;
    expect(merge.y).toBeGreaterThan(Math.max(box(r, 't').y, box(r, 'e').y));
    const decisions = r.boxes.filter((b) => b.kind === 'decision' && b.blockId === 'i');
    expect(decisions).toHaveLength(1);
  });

  test('elseBody: [] still gets a merge-bound else column; elseBody: undefined gets none', () => {
    const withEmptyElse: Doc = { preamble: [], body: [{
      id: 'i', kind: 'if',
      branches: [{ cond: 'a?', body: [{ id: 'x', kind: 'action', label: 'X' }] }],
      elseBody: [],
    }]};
    const withoutElse: Doc = { preamble: [], body: [{
      id: 'i', kind: 'if',
      branches: [{ cond: 'a?', body: [{ id: 'x', kind: 'action', label: 'X' }] }],
    }]};
    const withElse = run(withEmptyElse);
    const noElse = run(withoutElse);
    expect(withElse.edges.filter((e) => e.field === 'elseLabel')).toHaveLength(1);
    expect(noElse.edges.filter((e) => e.field === 'elseLabel')).toHaveLength(0);
  });

  test('measure/place agree for a 3-branch cascade: the next block starts gapY below the merge', () => {
    const doc: Doc = { preamble: [], body: [
      {
        id: 'i', kind: 'if',
        branches: [
          { cond: 'a?', body: [{ id: 'x', kind: 'action', label: 'X' }] },
          { cond: 'b?', body: [{ id: 'y', kind: 'action', label: 'Y' }] },
          { cond: 'c?', body: [{ id: 'w', kind: 'action', label: 'W' }] },
        ],
        elseBody: [{ id: 'z', kind: 'action', label: 'Z' }],
      },
      { id: 'after', kind: 'stop' },
    ]};
    const r = run(doc);
    const merge = r.boxes.find((b) => b.kind === 'merge' && b.blockId === 'i')!;
    const after = box(r, 'after');
    expect(after.y).toBeCloseTo(merge.y + merge.h + DEFAULT_METRICS.gapY, 6);
  });
});

describe('fork', () => {
  const doc: Doc = { preamble: [], body: [{
    id: 'f', kind: 'fork',
    branches: [[{ id: 'l', kind: 'action', label: 'Left' }], [{ id: 'r', kind: 'action', label: 'Right' }]],
  }]};

  test('renders a fork bar and a join bar', () => {
    expect(run(doc).boxes.filter((b) => b.kind === 'bar')).toHaveLength(2);
  });

  test('places branches side by side between the bars', () => {
    const r = run(doc);
    const [top, bottom] = r.boxes.filter((b) => b.kind === 'bar').sort((a, b) => a.y - b.y);
    expect(box(r, 'l').y).toBeGreaterThan(top.y);
    expect(box(r, 'l').y + box(r, 'l').h).toBeLessThanOrEqual(bottom.y);
    expect(box(r, 'l').x + box(r, 'l').w).toBeLessThanOrEqual(box(r, 'r').x);
  });

  test('supports three parallel branches', () => {
    const three: Doc = { preamble: [], body: [{
      id: 'f', kind: 'fork',
      branches: [[{ id: 'a', kind: 'action', label: 'A' }], [{ id: 'b', kind: 'action', label: 'B' }],
                 [{ id: 'c', kind: 'action', label: 'C' }]],
    }]};
    const r = run(three);
    expect([box(r, 'a').x, box(r, 'b').x, box(r, 'c').x]).toEqual(
      [box(r, 'a').x, box(r, 'b').x, box(r, 'c').x].sort((x, y) => x - y),
    );
  });
});
