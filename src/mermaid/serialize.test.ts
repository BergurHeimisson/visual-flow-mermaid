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

test('serializes a decision as a diamond with labelled edges and markers', () => {
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
    'n1 --> n2\n' +
    '%% if\n' +
    'n2{"In stock?"}\n' +
    '%% then (yes)\n' +
    '  n2 -- yes --> n3\n' +
    '  n3["Ship it"]\n' +
    '%% else (no)\n' +
    '  n2 -- no --> n4\n' +
    '  n4["Backorder"]\n' +
    '%% endif\n' +
    'n3 --> n5\n' +
    'n4 --> n5\n' +
    'n5(("stop"))\n',
  );
});

test('serializes elseif arms as a chain of diamonds', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'if', branches: [
      { cond: 'a?', thenLabel: 'yes', body: [] },
      { cond: 'b?', thenLabel: 'maybe', body: [] },
    ] },
  ]};
  expect(serialize(doc)).toContain(
    '%% if\nn1{"a?"}\n%% then (yes)\n%% elseif\nelseif_n1_1{"b?"}\nn1 --> elseif_n1_1\n%% then (maybe)\n%% endif',
  );
});

test('quotes a branch label that would otherwise break the arrow', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'if',
      branches: [{ cond: 'c?', thenLabel: 'a --> b', body: [{ id: '2', kind: 'action', label: 'x' }] }] },
  ]};
  expect(serialize(doc)).toContain('n1 -->|"a --> b"| n2');
  expect(serialize(doc)).not.toContain('-- a --> b -->');
});

test('escapes a quote and a line break inside a condition', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'if', branches: [{ cond: 'say "hi"\nagain?', body: [] }] },
  ]};
  expect(serialize(doc)).toContain('n1{"say #quot;hi#quot;<br/>again?"}');
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
