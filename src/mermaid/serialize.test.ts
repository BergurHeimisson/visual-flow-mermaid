import { expect, test } from 'vitest';
import { serialize } from './serialize';
import type { Doc } from '../model/types';

test('serializes the smallest possible document', () => {
  expect(serialize({ preamble: [], body: [] })).toBe('flowchart TD\nstart(("start"))\n');
});

test('emits the preamble verbatim between the header and the start node', () => {
  const doc: Doc = { preamble: ['%% title My Flow', '%% skinparam monochrome true'], body: [] };
  expect(serialize(doc)).toBe(
    'flowchart TD\n%% title My Flow\n%% skinparam monochrome true\nstart(("start"))\n',
  );
});

test('serializes a decision with an else arm, nesting each arm in its own subgraph', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'action', label: 'Receive order' },
    { id: '2', kind: 'if',
      branches: [{ cond: 'In stock?', thenLabel: 'yes', body: [{ id: '3', kind: 'action', label: 'Ship it' }] }],
      elseBody: [{ id: '4', kind: 'action', label: 'Backorder' }], elseLabel: 'no' },
    { id: '5', kind: 'stop' },
  ]};
  expect(serialize(doc)).toBe(
    'flowchart TD\n' +
    'start(("start"))\n' +
    'start --> n1\n' +
    'n1["Receive order"]\n' +
    'n1 --> if_n2\n' +
    'subgraph if_n2 ["if (In stock?) then (yes)"]\n' +
    '  n3["Ship it"]\n' +
    'end\n' +
    'subgraph else_n2 ["else (no)"]\n' +
    '  n4["Backorder"]\n' +
    'end\n' +
    'n3 --> n5\n' +
    'n4 --> n5\n' +
    'n5(("stop"))\n',
  );
});

test('serializes elseif branches in order, each its own subgraph', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'if', branches: [
      { cond: 'a?', thenLabel: 'yes', body: [] },
      { cond: 'b?', thenLabel: 'maybe', body: [] },
    ] },
  ]};
  expect(serialize(doc)).toContain(
    'subgraph if_n1 ["if (a?) then (yes)"]\nend\nsubgraph elseif_n1_1 ["elseif (b?) then (maybe)"]\nend',
  );
});

test('omits optional labels when they are absent', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'while', cond: 'more?', body: [] },
  ]};
  expect(serialize(doc)).toContain('subgraph while_n1 ["while (more?)"]\nend');
  expect(serialize(doc)).not.toContain('%% endwhile');
});

test('serializes while, repeat, and fork', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'while', cond: 'more?', isLabel: 'yes', endLabel: 'no',
      body: [{ id: '2', kind: 'action', label: 'read' }] },
    { id: '3', kind: 'repeat', cond: 'again?', isLabel: 'yes',
      body: [{ id: '4', kind: 'action', label: 'poll' }] },
    { id: '5', kind: 'fork', branches: [
      [{ id: '6', kind: 'action', label: 'left' }],
      [{ id: '7', kind: 'action', label: 'right' }],
    ] },
  ]};
  const out = serialize(doc);
  expect(out).toContain('subgraph while_n1 ["while (more?) is (yes)"]\n  n2["read"]\n  n2 --> while_n1\nend\n%% endwhile (no)');
  expect(out).toContain('subgraph repeat_n3 ["repeat"]\n  n4["poll"]\n  n4 --> repeat_n3\nend\n%% repeat while (again?) is (yes)');
  expect(out).toContain('subgraph fork_n5 ["fork"]\n  n6["left"]\nend\nsubgraph forkagain_n5_1 ["fork again"]\n  n7["right"]\nend');
});

test('serializes a single-line note as a %% comment after its activity', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'action', label: 'Ship it', note: { side: 'right', text: 'within 24h' } },
  ]};
  expect(serialize(doc)).toContain('n1["Ship it"]\n%% note right: within 24h');
});

test('uses the block note form when the note text spans lines', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'action', label: 'Ship it', note: { side: 'left', text: 'one\ntwo' } },
  ]};
  expect(serialize(doc)).toContain('n1["Ship it"]\n%% note left\n%% one\n%% two\n%% end note');
});

test('escapes a double quote and a newline inside a node label', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'action', label: 'say "hi"\nagain' },
  ]};
  expect(serialize(doc)).toContain('n1["say #quot;hi#quot;<br/>again"]');
});
