import { expect, test } from 'vitest';
import { insertionPoint } from './insertion';
import type { Doc } from '../model/types';

const doc: Doc = { preamble: [], body: [
  { id: 'a', kind: 'action', label: 'A' },
  { id: 'i', kind: 'if', branches: [{ cond: 'c?', body: [{ id: 'n', kind: 'action', label: 'N' }] }] },
]};

test('appends to the document body when nothing is selected', () => {
  expect(insertionPoint(doc, null)).toEqual({ path: [], index: 2 });
});

test('inserts directly after the selected block', () => {
  expect(insertionPoint(doc, 'a')).toEqual({ path: [], index: 1 });
});

test('inserts inside the selected block own sequence, not at the top level', () => {
  expect(insertionPoint(doc, 'n')).toEqual({
    path: [{ block: 'i', slot: 'branch', index: 0 }], index: 1,
  });
});

test('falls back to appending when the selected id no longer exists', () => {
  expect(insertionPoint(doc, 'gone')).toEqual({ path: [], index: 2 });
});

// --- Part 1: a selected empty-slot placeholder wins over any selected block -----------
test('prefers a selected slot over a selected block', () => {
  const slot = { path: [{ block: 'i', slot: 'else' as const }], index: 0 };
  expect(insertionPoint(doc, 'a', slot)).toEqual(slot);
});

test('prefers a selected slot even when nothing is selected', () => {
  const slot = { path: [{ block: 'i', slot: 'branch' as const, index: 0 }], index: 0 };
  expect(insertionPoint(doc, null, slot)).toEqual(slot);
});

test('falls back to today\'s behaviour when no slot is selected', () => {
  expect(insertionPoint(doc, 'a', null)).toEqual({ path: [], index: 1 });
});
