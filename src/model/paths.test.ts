import { describe, expect, test } from 'vitest';
import { getSeq, withSeq } from './paths';
import type { Doc } from './types';

const doc: Doc = {
  preamble: [],
  body: [
    { id: 'a', kind: 'action', label: 'A' },
    {
      id: 'i', kind: 'if',
      branches: [{ cond: 'c?', thenLabel: 'yes', body: [{ id: 'b', kind: 'action', label: 'B' }] }],
      elseBody: [{ id: 'c', kind: 'action', label: 'C' }],
      elseLabel: 'no',
    },
    { id: 'w', kind: 'while', cond: 'c?', body: [{ id: 'd', kind: 'action', label: 'D' }] },
  ],
};

const docWithFork: Doc = {
  preamble: [],
  body: [
    { id: 'a', kind: 'action', label: 'A' },
    {
      id: 'f', kind: 'fork',
      branches: [
        [{ id: 'b', kind: 'action', label: 'B' }],
        [{ id: 'c', kind: 'action', label: 'C' }],
      ],
    },
    { id: 'd', kind: 'action', label: 'D' },
  ],
};

describe('getSeq', () => {
  test('empty path addresses the document body', () => {
    expect(getSeq(doc, [])?.map((b) => b.id)).toEqual(['a', 'i', 'w']);
  });

  test('addresses an if branch body', () => {
    expect(getSeq(doc, [{ block: 'i', slot: 'branch', index: 0 }])?.map((b) => b.id)).toEqual(['b']);
  });

  test('addresses an else body', () => {
    expect(getSeq(doc, [{ block: 'i', slot: 'else' }])?.map((b) => b.id)).toEqual(['c']);
  });

  test('addresses a loop body', () => {
    expect(getSeq(doc, [{ block: 'w', slot: 'body' }])?.map((b) => b.id)).toEqual(['d']);
  });

  test('returns null for a path that does not exist', () => {
    expect(getSeq(doc, [{ block: 'nope', slot: 'body' }])).toBeNull();
  });

  test('addresses a fork branch body by index 0', () => {
    expect(getSeq(docWithFork, [{ block: 'f', slot: 'branch', index: 0 }])?.map((b) => b.id)).toEqual(['b']);
  });

  test('addresses a fork branch body by index 1', () => {
    expect(getSeq(docWithFork, [{ block: 'f', slot: 'branch', index: 1 }])?.map((b) => b.id)).toEqual(['c']);
  });

  test('returns null for out-of-range fork branch index', () => {
    expect(getSeq(docWithFork, [{ block: 'f', slot: 'branch', index: 2 }])).toBeNull();
    expect(getSeq(docWithFork, [{ block: 'f', slot: 'branch', index: 99 }])).toBeNull();
  });

  test('returns null for out-of-range if branch index', () => {
    expect(getSeq(doc, [{ block: 'i', slot: 'branch', index: 1 }])).toBeNull();
    expect(getSeq(doc, [{ block: 'i', slot: 'branch', index: 99 }])).toBeNull();
  });
});

describe('withSeq', () => {
  test('replaces a nested sequence without mutating the original', () => {
    const next = withSeq(doc, [{ block: 'w', slot: 'body' }], () => []);
    expect(getSeq(next, [{ block: 'w', slot: 'body' }])).toEqual([]);
    expect(getSeq(doc, [{ block: 'w', slot: 'body' }])).toHaveLength(1);
  });

  test('replaces a fork branch body without mutating the original or other branch', () => {
    const newAction = { id: 'x', kind: 'action', label: 'X' } as const;
    const next = withSeq(docWithFork, [{ block: 'f', slot: 'branch', index: 0 }], () => [newAction]);

    // Modified doc has new action in branch 0
    expect(getSeq(next, [{ block: 'f', slot: 'branch', index: 0 }])?.map((b) => b.id)).toEqual(['x']);

    // Original doc is untouched
    expect(getSeq(docWithFork, [{ block: 'f', slot: 'branch', index: 0 }])?.map((b) => b.id)).toEqual(['b']);

    // Other branch in modified doc is untouched
    expect(getSeq(next, [{ block: 'f', slot: 'branch', index: 1 }])?.map((b) => b.id)).toEqual(['c']);
  });
});
