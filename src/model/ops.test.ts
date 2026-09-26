import { describe, expect, test } from 'vitest';
import { findBlock, insertAt, isWithin, locate, mapBlock, moveBlock, removeBlock } from './ops';
import { getSeq, type SeqPath } from './paths';
import type { Doc } from './types';

const doc = (): Doc => ({
  preamble: [],
  body: [
    { id: 'a', kind: 'action', label: 'A' },
    {
      id: 'i', kind: 'if',
      branches: [{ cond: 'c?', thenLabel: 'yes', body: [{ id: 'b', kind: 'action', label: 'B' }] }],
      elseBody: [], elseLabel: 'no',
    },
  ],
});

describe('locate / findBlock', () => {
  test('finds a top-level block', () => {
    expect(locate(doc(), 'i')).toEqual({ path: [], index: 1 });
  });

  test('finds a nested block', () => {
    expect(locate(doc(), 'b')).toEqual({ path: [{ block: 'i', slot: 'branch', index: 0 }], index: 0 });
  });

  test('returns null for an unknown id', () => {
    expect(locate(doc(), 'zzz')).toBeNull();
    expect(findBlock(doc(), 'zzz')).toBeNull();
  });
});

describe('insertAt', () => {
  test('inserts at an index in the document body', () => {
    const next = insertAt(doc(), [], 1, { id: 'n', kind: 'stop' });
    expect(next.body.map((x) => x.id)).toEqual(['a', 'n', 'i']);
  });

  test('inserts into an empty else body', () => {
    const next = insertAt(doc(), [{ block: 'i', slot: 'else' }], 0, { id: 'n', kind: 'stop' });
    expect(getSeq(next, [{ block: 'i', slot: 'else' }])?.map((x) => x.id)).toEqual(['n']);
  });

  test('does not mutate the input', () => {
    const original = doc();
    insertAt(original, [], 0, { id: 'n', kind: 'stop' });
    expect(original.body).toHaveLength(2);
  });
});

describe('mapBlock', () => {
  test('rewrites a nested block', () => {
    const next = mapBlock(doc(), 'b', (b) => ({ ...b, kind: 'action', label: 'renamed' } as typeof b));
    expect(findBlock(next, 'b')).toMatchObject({ label: 'renamed' });
  });
});

describe('removeBlock', () => {
  test('removes a nested block', () => {
    expect(getSeq(removeBlock(doc(), 'b'), [{ block: 'i', slot: 'branch', index: 0 }])).toEqual([]);
  });

  test('removing a container removes its whole subtree', () => {
    const next = removeBlock(doc(), 'i');
    expect(next.body.map((x) => x.id)).toEqual(['a']);
    expect(findBlock(next, 'b')).toBeNull();
  });
});

describe('isWithin', () => {
  test('is true for a descendant and false for a sibling', () => {
    expect(isWithin(doc(), 'i', 'b')).toBe(true);
    expect(isWithin(doc(), 'a', 'b')).toBe(false);
  });

  test('a block is not within itself', () => {
    expect(isWithin(doc(), 'i', 'i')).toBe(false);
  });
});

describe('moveBlock', () => {
  test('moves a block to another sequence', () => {
    const next = moveBlock(doc(), 'a', [{ block: 'i', slot: 'else' }], 0);
    expect(next.body.map((x) => x.id)).toEqual(['i']);
    expect(getSeq(next, [{ block: 'i', slot: 'else' }])?.map((x) => x.id)).toEqual(['a']);
  });

  test('refuses to move a block into its own subtree', () => {
    const before = doc();
    const after = moveBlock(before, 'i', [{ block: 'i', slot: 'else' }], 0);
    expect(after).toEqual(before);
  });

  test('reindexes correctly when moving later within the same sequence', () => {
    const start: Doc = { preamble: [], body: [
      { id: 'a', kind: 'action', label: 'A' },
      { id: 'b', kind: 'action', label: 'B' },
      { id: 'c', kind: 'action', label: 'C' },
    ]};
    expect(moveBlock(start, 'a', [], 2).body.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  test('produces identical result regardless of SeqPath key order', () => {
    const start: Doc = { preamble: [], body: [
      { id: 'a', kind: 'action', label: 'A' },
      { id: 'b', kind: 'action', label: 'B' },
      { id: 'c', kind: 'action', label: 'C' },
    ]};
    // Path with standard key order
    const path1 = [{ block: 'b', slot: 'branch' as const, index: 0 }];
    // Path with different key order (but semantically identical)
    const path2 = [{ slot: 'branch' as const, index: 0, block: 'b' }];

    // Both paths are semantically identical, so moveBlock should produce the same result
    const result1 = moveBlock(start, 'a', path1, 0);
    const result2 = moveBlock(start, 'a', path2, 0);

    expect(result1).toEqual(result2);
  });

  test('refuses to move a block into its grandchild subtree', () => {
    const beforeGrandchild: Doc = {
      preamble: [],
      body: [
        {
          id: 'i', kind: 'if',
          branches: [{
            cond: 'c?', thenLabel: 'yes',
            body: [{
              id: 'w', kind: 'while', cond: 'w?',
              body: [{ id: 'x', kind: 'action', label: 'X' }],
            }],
          }],
          elseBody: [], elseLabel: 'no',
        },
      ],
    };
    // Try to move 'i' into the body of its grandchild 'w' (which is inside its child branch)
    const pathToWhileBody = [
      { block: 'i', slot: 'branch' as const, index: 0 },
      { block: 'w', slot: 'body' as const },
    ];
    const after = moveBlock(beforeGrandchild, 'i', pathToWhileBody, 0);
    expect(after).toEqual(beforeGrandchild);
  });
});

// --- Final review, M2: moveBlock's cycle guard is the tested `isWithin` ----------------
//
// The spec singles this guard out as the one move that could corrupt the tree, "a pure
// function with its own tests". As shipped, `isWithin` was dead code and `moveBlock`
// re-implemented the check inline (`path.some((seg) => seg.block === id)`), so the tested
// function was not the one that ran. `moveBlock` now routes through `isWithin`; these
// cases pin the two to the same answer for the destination's host block.
describe('moveBlock uses isWithin for its cycle guard', () => {
  const nested: Doc = {
    preamble: [],
    body: [
      { id: 'i', kind: 'if',
        branches: [{ cond: 'c?', body: [{ id: 'w', kind: 'while', cond: 'w?', body: [] }] }],
        elseBody: [] },
      { id: 'a', kind: 'action', label: 'A' },
    ],
  };
  const intoW: SeqPath = [
    { block: 'i', slot: 'branch', index: 0 },
    { block: 'w', slot: 'body' },
  ];

  test('agrees with isWithin that the destination host is inside the dragged block', () => {
    expect(isWithin(nested, 'i', 'w')).toBe(true);
    expect(moveBlock(nested, 'i', intoW, 0)).toBe(nested);
  });

  test('allows the move when isWithin says the destination host is elsewhere', () => {
    expect(isWithin(nested, 'a', 'w')).toBe(false);
    const after = moveBlock(nested, 'a', intoW, 0);
    expect(after).not.toBe(nested);
    expect(getSeq(after, intoW)!.map((b) => b.id)).toEqual(['a']);
  });
});
