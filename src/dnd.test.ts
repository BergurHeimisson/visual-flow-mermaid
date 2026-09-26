import { expect, test } from 'vitest';
import { targetAt, toLayoutPoint, type DragPayload, type PaletteKind } from './dnd';
import { layout, type MeasureText, type Rect } from './layout/layout';
import type { Doc } from './model/types';

const measure: MeasureText = (text) => text.length * 8;
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

const doc: Doc = { preamble: [], body: [{ id: 'a', kind: 'action', label: 'A' }] };
const result = layout(doc, measure);

const noteDoc: Doc = { preamble: [], body: [
  { id: 'a', kind: 'action', label: 'A' },
  { id: 'i', kind: 'if', branches: [{ cond: 'c?', body: [] }], elseBody: [] },
]};
const noteResult = layout(noteDoc, measure);

const palette = (kind: PaletteKind): DragPayload => ({ source: 'palette', kind });
const block = (id: string): DragPayload => ({ source: 'block', id });

// --- the screen -> diagram conversion -------------------------------------------------

test('converts a client point into the diagram coordinate space through the svg transform', () => {
  // scale 2, origin at (30, 40) on screen: the diagram point (10, 5) is at (50, 50).
  expect(toLayoutPoint({ a: 2, d: 2, e: 30, f: 40 }, 50, 50)).toEqual({ x: 10, y: 5 });
});

test('has no layout point where the page has no layout to read', () => {
  // jsdom and other layout-less environments: getScreenCTM() is absent or returns null.
  expect(toLayoutPoint(null, 10, 10)).toBeNull();
  expect(toLayoutPoint({ a: 0, d: 0, e: 0, f: 0 }, 10, 10)).toBeNull();
});

test('no pointer position means no target, so a drag there commits nothing', () => {
  expect(targetAt(result, palette('if'), null)).toBeNull();
});

// --- palette-kind and block drags land on drop zones -----------------------------------
//
// Ported from DropZone.test.tsx ("reports a palette drop with the zone it landed on" /
// "reports a block drop with the dragged block id"). Those fed a synthesised `dataTransfer`
// to the zone's own `onDrop`, which asserted the DOM had routed the drop correctly. There
// is no `dataTransfer` and no per-zone handler any more: the target is decided here, from
// the zone rects the layout already produced, so this is where the same decision is tested.

test('a palette drag over a zone targets that zone, carrying its path and index', () => {
  const zone = result.dropZones[1];
  expect(targetAt(result, palette('if'), centre(zone))).toEqual({ kind: 'zone', zone });
});

test('a block drag over a zone targets that zone', () => {
  const zone = result.dropZones[1];
  expect(targetAt(result, block('a'), centre(zone))).toEqual({ kind: 'zone', zone });
});

test('a drag over empty canvas targets nothing', () => {
  expect(targetAt(result, palette('if'), { x: -500, y: -500 })).toBeNull();
});

test('every zone is reachable at its own centre', () => {
  for (const zone of result.dropZones) {
    expect(targetAt(result, palette('action'), centre(zone))).toEqual({ kind: 'zone', zone });
  }
});

// --- a note attaches to an action box, not to a gap ------------------------------------
//
// Ported from DropZone.test.tsx's four note tests, which drove `Box`'s own
// `onDragOver`/`onDrop`. Same rules, same cases, decided from geometry.

test('a note over an action box targets that block', () => {
  const box = noteResult.boxes.find((b) => b.blockId === 'a')!;
  expect(targetAt(noteResult, palette('note'), centre(box))).toEqual({ kind: 'note', blockId: 'a' });
});

test('a note over a non-action box targets nothing, since only an action can carry one', () => {
  const decision = noteResult.boxes.find((b) => b.kind === 'decision')!;
  const start = noteResult.boxes.find((b) => b.id === 'box:start')!;
  expect(targetAt(noteResult, palette('note'), centre(decision))).toBeNull();
  expect(targetAt(noteResult, palette('note'), centre(start))).toBeNull();
});

test('a note ignores drop zones: it attaches to a block, it does not fill a gap', () => {
  expect(targetAt(noteResult, palette('note'), centre(noteResult.dropZones[0]))).toBeNull();
});

test('a block drag over an action box is not mistaken for a note', () => {
  const box = noteResult.boxes.find((b) => b.blockId === 'a')!;
  const target = targetAt(noteResult, block('a'), centre(box));
  expect(target === null || target.kind === 'zone').toBe(true);
});

test('a non-note palette drag over an action box is not mistaken for a note', () => {
  const box = noteResult.boxes.find((b) => b.blockId === 'a')!;
  const target = targetAt(noteResult, palette('action'), centre(box));
  expect(target === null || target.kind === 'zone').toBe(true);
});

// --- painting order decides ties -------------------------------------------------------

test('where rects overlap, the one painted last wins, matching what the user sees', () => {
  const zones = result.dropZones;
  const shadowed = { ...zones[0], id: 'drop:shadow' };
  const stacked = { ...result, dropZones: [shadowed, ...zones] };
  expect(targetAt(stacked, palette('if'), centre(zones[0]))).toEqual({ kind: 'zone', zone: zones[0] });
});
