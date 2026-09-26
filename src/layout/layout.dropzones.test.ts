import { expect, test } from 'vitest';
import { layout, type MeasureText } from './layout';
import type { Doc } from '../model/types';

const measure: MeasureText = (text) => text.length * 8;

test('an empty document offers exactly one drop zone at index 0 of the body', () => {
  const r = layout({ preamble: [], body: [] }, measure);
  expect(r.dropZones).toHaveLength(1);
  expect(r.dropZones[0]).toMatchObject({ path: [], index: 0 });
});

test('a sequence of n blocks offers n+1 drop zones', () => {
  const doc: Doc = { preamble: [], body: [
    { id: 'a', kind: 'action', label: 'A' },
    { id: 'b', kind: 'action', label: 'B' },
  ]};
  const top = layout(doc, measure).dropZones.filter((z) => z.path.length === 0);
  expect(top.map((z) => z.index)).toEqual([0, 1, 2]);
});

test('drop zones are ordered down the page', () => {
  const doc: Doc = { preamble: [], body: [
    { id: 'a', kind: 'action', label: 'A' },
    { id: 'b', kind: 'action', label: 'B' },
  ]};
  const ys = layout(doc, measure).dropZones.filter((z) => z.path.length === 0).map((z) => z.y);
  expect([...ys].sort((p, q) => p - q)).toEqual(ys);
});

test('an empty branch body still offers a drop zone addressing it', () => {
  const doc: Doc = { preamble: [], body: [{
    id: 'i', kind: 'if', branches: [{ cond: 'c?', body: [] }], elseBody: [], elseLabel: 'no',
  }]};
  const zones = layout(doc, measure).dropZones;
  expect(zones).toContainEqual(expect.objectContaining({
    path: [{ block: 'i', slot: 'branch', index: 0 }], index: 0,
  }));
  expect(zones).toContainEqual(expect.objectContaining({
    path: [{ block: 'i', slot: 'else' }], index: 0,
  }));
});

test('a loop body offers drop zones addressing the body', () => {
  const doc: Doc = { preamble: [], body: [{
    id: 'w', kind: 'while', cond: 'c?', body: [{ id: 'x', kind: 'action', label: 'X' }],
  }]};
  const inLoop = layout(doc, measure).dropZones.filter((z) => z.path[0]?.block === 'w');
  expect(inLoop.map((z) => z.index)).toEqual([0, 1]);
});

test('every drop zone has a positive area and a unique id', () => {
  const doc: Doc = { preamble: [], body: [
    { id: 'a', kind: 'action', label: 'A' },
    { id: 'i', kind: 'if', branches: [{ cond: 'c?', body: [] }], elseBody: [] },
  ]};
  const zones = layout(doc, measure).dropZones;
  expect(zones.every((z) => z.w > 0 && z.h > 0)).toBe(true);
  expect(new Set(zones.map((z) => z.id)).size).toBe(zones.length);
});

// --- Final review, C2: sibling drop zones must never overlap ---------------------------
//
// Reproduction (before the fix): an empty sequence measured to width 0, so the two empty
// sibling columns of a fresh `if` ended up gapX (28px) apart on their spines while every
// drop zone has a hard floor of `max(minBoxW, 60)` = 80px. Measured: `drop:I#0:0` spanned
// x=12..92 and `drop:I#else:0` x=40..120 — a 52px overlap — and since zones paint in array
// order the later (else) rect covered the earlier (yes) one. `createBlock('if')` and
// `createBlock('fork')` both start with empty branches, so this hit the app's central
// gesture: filling in a decision you just created put the block in the wrong arm.
function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function overlappingPairs(doc: Doc): string[] {
  const zones = layout(doc, measure).dropZones;
  const bad: string[] = [];
  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      if (overlaps(zones[i], zones[j])) bad.push(`${zones[i].id} / ${zones[j].id}`);
    }
  }
  return bad;
}

test('a fresh if has no overlapping drop zones', () => {
  const doc: Doc = { preamble: [], body: [{
    id: 'I', kind: 'if',
    branches: [{ cond: 'condition?', thenLabel: 'yes', body: [] }], elseBody: [], elseLabel: 'no',
  }]};
  expect(overlappingPairs(doc)).toEqual([]);
});

test('a fresh fork has no overlapping drop zones', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'F', kind: 'fork', branches: [[], []] }] };
  expect(overlappingPairs(doc)).toEqual([]);
});

test('a 3-way fork has no overlapping drop zones', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'F', kind: 'fork', branches: [[], [], []] }] };
  expect(overlappingPairs(doc)).toEqual([]);
});

test('a 4-branch elseif cascade has no overlapping drop zones', () => {
  const doc: Doc = { preamble: [], body: [{
    id: 'I', kind: 'if',
    branches: [
      { cond: 'a?', body: [] }, { cond: 'b?', body: [] },
      { cond: 'c?', body: [] }, { cond: 'd?', body: [] },
    ],
    elseBody: [], elseLabel: 'no',
  }]};
  expect(overlappingPairs(doc)).toEqual([]);
});

// --- Part 1: empty slots must be persistently targetable, not drag-only ----------------
//
// The user reported: "I wanted to add an action after the no decision. I couldn't select
// to do that." An empty branch renders as nothing but an arrow — no shape to click — and
// click-to-insert needs a selection, which an empty branch can never have. `placeSeq`
// already emits exactly one zone for an empty sequence, at index 0; it just needs marking
// so Canvas can render it persistently. Gaps between existing blocks must NOT be marked:
// the user wants those visible only during a drag, to keep the canvas clean.

test('an empty if-branch\'s zone is persistent', () => {
  const doc: Doc = { preamble: [], body: [{
    id: 'i', kind: 'if', branches: [{ cond: 'c?', body: [] }],
  }]};
  const zone = layout(doc, measure).dropZones.find(
    (z) => z.path.length === 1 && z.path[0].block === 'i' && z.path[0].slot === 'branch',
  )!;
  expect(zone.persistent).toBe(true);
});

test('an empty else arm\'s zone is persistent', () => {
  const doc: Doc = { preamble: [], body: [{
    id: 'i', kind: 'if', branches: [{ cond: 'c?', body: [{ id: 'x', kind: 'action', label: 'X' }] }],
    elseBody: [], elseLabel: 'no',
  }]};
  const zone = layout(doc, measure).dropZones.find((z) => z.path.some((s) => s.slot === 'else'))!;
  expect(zone.persistent).toBe(true);
});

test('an empty fork column\'s zone is persistent', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'f', kind: 'fork', branches: [[], []] }] };
  const zones = layout(doc, measure).dropZones.filter((z) => z.path[0]?.block === 'f');
  expect(zones).toHaveLength(2);
  expect(zones.every((z) => z.persistent)).toBe(true);
});

test('an empty while body\'s zone is persistent', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'w', kind: 'while', cond: 'c?', body: [] }] };
  const zone = layout(doc, measure).dropZones.find((z) => z.path[0]?.block === 'w')!;
  expect(zone.persistent).toBe(true);
});

test('an empty repeat body\'s zone is persistent', () => {
  const doc: Doc = { preamble: [], body: [{ id: 'p', kind: 'repeat', cond: 'c?', body: [] }] };
  const zone = layout(doc, measure).dropZones.find((z) => z.path[0]?.block === 'p')!;
  expect(zone.persistent).toBe(true);
});

test('gap zones between existing top-level blocks are NOT persistent', () => {
  const doc: Doc = { preamble: [], body: [
    { id: 'a', kind: 'action', label: 'A' },
    { id: 'b', kind: 'action', label: 'B' },
  ]};
  const top = layout(doc, measure).dropZones.filter((z) => z.path.length === 0);
  expect(top.every((z) => z.persistent === false)).toBe(true);
});

test('gap zones on either side of a non-empty branch are NOT persistent', () => {
  const doc: Doc = { preamble: [], body: [{
    id: 'i', kind: 'if', branches: [{ cond: 'c?', body: [{ id: 'x', kind: 'action', label: 'X' }] }],
  }]};
  const branchZones = layout(doc, measure).dropZones.filter((z) => z.path.some((s) => s.slot === 'branch'));
  expect(branchZones).toHaveLength(2); // index 0 (before X) and index 1 (after X)
  expect(branchZones.every((z) => z.persistent === false)).toBe(true);
});

test('columns whose content is narrower than the zone floor still do not overlap', () => {
  // A `stop` cap is 24px wide — narrower than the 80px zone floor — so a column holding
  // only a stop is the non-empty twin of the empty-column bug above.
  const doc: Doc = { preamble: [], body: [{
    id: 'F', kind: 'fork',
    branches: [[{ id: 's1', kind: 'stop' }], [{ id: 's2', kind: 'stop' }]],
  }]};
  expect(overlappingPairs(doc)).toEqual([]);
});
