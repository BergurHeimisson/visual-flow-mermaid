import { describe, expect, test } from 'vitest';
import { layout, type LayoutResult, type MeasureText } from './layout';
import { DEFAULT_METRICS } from './metrics';
import type { Doc } from '../model/types';

const measure: MeasureText = (text) => text.length * 8;
const run = (doc: Doc) => layout(doc, measure);
const box = (r: LayoutResult, blockId: string) => r.boxes.find((b) => b.blockId === blockId)!;

/** An edge whose bottommost point sits at exactly `stopBottomY` (± epsilon) and whose x
 *  matches the stop cap's centre is an edge leaving the terminator — the bug under test. */
function edgesLeaving(r: LayoutResult, stop: { x: number; y: number; w: number; h: number }): number {
  const cx = stop.x + stop.w / 2;
  const bottomY = stop.y + stop.h;
  return r.edges.filter((e) => e.points.some((p) => Math.abs(p.x - cx) < 0.01 && Math.abs(p.y - bottomY) < 0.01))
    .length;
}

describe('a terminated flow does not continue', () => {
  test("the user's bread document: the else arm's stop emits no merge edge, the bakery arm still does", () => {
    const doc: Doc = { preamble: [], body: [
      {
        id: 'i', kind: 'if',
        branches: [{ cond: 'bread in the house?', thenLabel: 'No', body: [
          { id: 'bakery', kind: 'action', label: 'Go to bakery', note: { side: 'right', text: 'And buy bread' } },
        ] }],
        elseBody: [{ id: 'stop1', kind: 'stop' }], elseLabel: 'Yes',
      },
      { id: 'end1', kind: 'end' },
    ]};
    const r = run(doc);
    const stopBox = box(r, 'stop1');
    expect(edgesLeaving(r, stopBox)).toBe(0);

    // The surviving ("No" / bakery) branch still merges normally.
    const bakeryEdge = r.edges.find((e) => e.id.startsWith('merge:i:'));
    expect(bakeryEdge).toBeDefined();
  });

  test('an if branch ending in `end` also emits no merge edge', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'i', kind: 'if',
      branches: [{ cond: 'a?', body: [{ id: 'x', kind: 'action', label: 'X' }] }],
      elseBody: [{ id: 'e', kind: 'end' }],
    }]};
    const r = run(doc);
    const endBox = box(r, 'e');
    expect(edgesLeaving(r, endBox)).toBe(0);
  });

  test('a fork column ending in stop emits no join edge', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'f', kind: 'fork',
      branches: [
        [{ id: 'l', kind: 'action', label: 'Left' }],
        [{ id: 's', kind: 'stop' }],
      ],
    }]};
    const r = run(doc);
    const stopBox = box(r, 's');
    expect(edgesLeaving(r, stopBox)).toBe(0);

    // The surviving branch still joins.
    const joinEdge = r.edges.find((e) => e.id === 'forkout:f:0');
    expect(joinEdge).toBeDefined();
    expect(r.edges.find((e) => e.id === 'forkout:f:1')).toBeUndefined();
  });

  test('a while body ending in stop emits no back-edge', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'w', kind: 'while', cond: 'more?',
      body: [{ id: 's', kind: 'stop' }],
    }]};
    const r = run(doc);
    expect(r.edges.find((e) => e.id === 'back:w')).toBeUndefined();
  });

  test('a repeat body ending in stop emits no back-edge', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'p', kind: 'repeat', cond: 'again?',
      body: [{ id: 's', kind: 'stop' }],
    }]};
    const r = run(doc);
    expect(r.edges.find((e) => e.id === 'back:p')).toBeUndefined();
  });

  test('recursive case: a branch ending in a fully-terminating nested if is itself terminated', () => {
    const doc: Doc = { preamble: [], body: [{
      id: 'outer', kind: 'if',
      branches: [{ cond: 'a?', body: [{ id: 'x', kind: 'action', label: 'X' }] }],
      elseBody: [{
        id: 'inner', kind: 'if',
        branches: [{ cond: 'b?', body: [{ id: 's1', kind: 'stop' }] }],
        elseBody: [{ id: 's2', kind: 'stop' }],
      }],
    }]};
    const r = run(doc);
    // The outer else arm's *last* block is `inner`, a fully-terminating if (both of its own
    // branches stop). So the outer's else column must not emit a merge edge either.
    expect(r.edges.find((e) => e.id.startsWith('merge:outer:') && e.blockId === 'outer'
      && e.points.some((p) => p.x === box(r, 's2').x + box(r, 's2').w / 2))).toBeUndefined();

    // But the inner if's own two branches (both stop) correctly emit no merge edges either.
    expect(edgesLeaving(r, box(r, 's1'))).toBe(0);
    expect(edgesLeaving(r, box(r, 's2'))).toBe(0);
    // The outer's surviving "a?" branch still merges.
    expect(r.edges.find((e) => e.id.startsWith('merge:outer:'))).toBeDefined();
  });

  test('measure/place agreement: a following sibling after an if with one terminated branch '
    + 'starts exactly gapY below the merge box, unchanged from the non-terminating case', () => {
    const doc: Doc = { preamble: [], body: [
      {
        id: 'i', kind: 'if',
        branches: [{ cond: 'a?', body: [{ id: 'x', kind: 'action', label: 'X' }] }],
        elseBody: [{ id: 's', kind: 'stop' }],
      },
      { id: 'after', kind: 'action', label: 'After' },
    ]};
    const r = run(doc);
    const merge = r.boxes.find((b) => b.kind === 'merge' && b.blockId === 'i')!;
    const after = box(r, 'after');
    expect(after.y).toBeCloseTo(merge.y + merge.h + DEFAULT_METRICS.gapY, 6);
  });

  test('measure/place agreement: a fork with one terminated column still places the join bar '
    + 'and the following sibling at the same position as before', () => {
    const doc: Doc = { preamble: [], body: [
      {
        id: 'f', kind: 'fork',
        branches: [[{ id: 'l', kind: 'action', label: 'Left' }], [{ id: 's', kind: 'stop' }]],
      },
      { id: 'after', kind: 'action', label: 'After' },
    ]};
    const r = run(doc);
    const joinBar = r.boxes.filter((b) => b.kind === 'bar' && b.blockId === 'f').sort((a, b) => a.y - b.y)[1];
    const after = box(r, 'after');
    expect(after.y).toBeCloseTo(joinBar.y + joinBar.h + DEFAULT_METRICS.gapY, 6);
  });

  test('all branches terminate: the merge box is still drawn and space is still reserved for a '
    + 'following sibling', () => {
    const doc: Doc = { preamble: [], body: [
      {
        id: 'i', kind: 'if',
        branches: [{ cond: 'a?', body: [{ id: 's1', kind: 'stop' }] }],
        elseBody: [{ id: 's2', kind: 'stop' }],
      },
      { id: 'after', kind: 'action', label: 'After' },
    ]};
    const r = run(doc);
    const merge = r.boxes.find((b) => b.kind === 'merge' && b.blockId === 'i');
    expect(merge).toBeDefined();
    const after = box(r, 'after');
    expect(after.y).toBeCloseTo(merge!.y + merge!.h + DEFAULT_METRICS.gapY, 6);
    expect(edgesLeaving(r, box(r, 's1'))).toBe(0);
    expect(edgesLeaving(r, box(r, 's2'))).toBe(0);
  });
});
