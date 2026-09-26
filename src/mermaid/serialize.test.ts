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

// An empty arm has no node to carry the flow onward, so its tail is the diamond itself.
// Without this the arm's arrow leads nowhere and the decision renders as a dead end.
test('an empty then-arm routes its labelled edge to whatever follows the decision', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'if',
      branches: [{ cond: 'c?', thenLabel: 'yes', body: [] }],
      elseBody: [{ id: '2', kind: 'action', label: 'b' }], elseLabel: 'no' },
    { id: '3', kind: 'action', label: 'after' },
  ]};
  expect(serialize(doc)).toContain('%% endif\nn1 -- yes --> n3\nn2 --> n3\nn3["after"]');
});

test('an empty else-arm routes its labelled edge to whatever follows the decision', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'if',
      branches: [{ cond: 'c?', thenLabel: 'yes', body: [{ id: '2', kind: 'action', label: 'a' }] }],
      elseBody: [], elseLabel: 'no' },
    { id: '3', kind: 'action', label: 'after' },
  ]};
  expect(serialize(doc)).toContain('%% endif\nn2 --> n3\nn1 -- no --> n3\nn3["after"]');
});

test('an empty fork column connects the split bar straight to the join bar', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'fork', branches: [[], [{ id: '2', kind: 'action', label: 'right' }]] },
  ]};
  expect(serialize(doc)).toContain('%% end fork\njoin_n1@{ shape: fork }\nn1 --> join_n1\nn2 --> join_n1');
});

// A fork straight from the palette is `branches: [[], []]` (see factory.ts), so this is the
// very first thing the text panel shows after clicking Fork. Both empty columns converge on
// the join bar with the same label, and Mermaid would draw the identical edge twice.
test('two empty fork columns converge on the join bar without duplicating the edge', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'fork', branches: [[], []] },
    { id: '2', kind: 'action', label: 'after' },
  ]};
  const out = serialize(doc);
  expect(out.match(/n1 --> join_n1/g)).toHaveLength(1);
});

test('two empty decision arms converge without duplicating an unlabelled edge', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'if', branches: [{ cond: 'c?', body: [] }], elseBody: [] },
    { id: '2', kind: 'action', label: 'after' },
  ]};
  const out = serialize(doc);
  expect(out.match(/n1 --> n2/g)).toHaveLength(1);
});

// `-` was in the bare-label allowlist, so `wait--retry` was emitted between `--` and `-->`
// — a link token sitting inside a link. Mermaid reserves `--` in unquoted labels.
test('a label containing a link delimiter takes the quoted form, not the bare one', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'if',
      branches: [{ cond: 'c?', thenLabel: 'wait--retry', body: [{ id: '2', kind: 'action', label: 'x' }] }] },
  ]};
  const out = serialize(doc);
  expect(out).toContain('n1 -->|"wait--retry"| n2');
  expect(out).not.toContain('-- wait--retry -->');
});

// The quoted fallback is delimited by `|`, so a `|` in the label has to be escaped or it
// closes the delimited region early.
test('a pipe in a label is escaped inside the quoted edge form', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'if',
      branches: [{ cond: 'c?', thenLabel: 'a|b', body: [{ id: '2', kind: 'action', label: 'x' }] }] },
  ]};
  expect(serialize(doc)).toContain('n1 -->|"a#124;b"| n2');
});

// The parser cannot tell a 3-column fork that lost a `%% fork again` from a genuine
// 2-column one, so the column count travels in the opening marker.
test('the fork marker carries its column count', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'fork', branches: [[], [], []] },
  ]};
  expect(serialize(doc)).toContain('%% fork (3)\nn1@{ shape: fork }');
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

test('serializes a while loop as a diamond with a back edge and a labelled exit', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'while', cond: 'more?', isLabel: 'yes', endLabel: 'no',
      body: [{ id: '2', kind: 'action', label: 'read' }] },
    { id: '3', kind: 'action', label: 'done' },
  ]};
  expect(serialize(doc)).toContain(
    '%% while\nn1{"more?"}\n%% do (yes)\n  n1 -- yes --> n2\n  n2["read"]\n  n2 --> n1\n%% endwhile (no)\nn1 -- no --> n3\nn3["done"]',
  );
});

test('omits optional labels when they are absent', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'while', cond: 'more?', body: [] },
  ]};
  const out = serialize(doc);
  expect(out).toContain('%% while\nn1{"more?"}\n%% do\n%% endwhile\n');
  expect(out).not.toContain('()');
});

test('serializes a fork as split and join bars', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'fork', branches: [
      [{ id: '2', kind: 'action', label: 'left' }],
      [{ id: '3', kind: 'action', label: 'right' }],
    ] },
  ]};
  expect(serialize(doc)).toContain(
    '%% fork (2)\nn1@{ shape: fork }\n  n1 --> n2\n  n2["left"]\n%% fork again\n  n1 --> n3\n  n3["right"]\n'
    + '%% end fork\njoin_n1@{ shape: fork }\nn2 --> join_n1\nn3 --> join_n1\n',
  );
});

test('an empty fork branch emits no edge to nothing', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'fork', branches: [[], [{ id: '2', kind: 'action', label: 'right' }]] },
  ]};
  const out = serialize(doc);
  expect(out).toContain('%% fork (2)\nn1@{ shape: fork }\n%% fork again\n  n1 --> n2\n');
  expect(out).not.toMatch(/n1 --> *$/m);
});

test('serializes a repeat loop with its diamond after the body', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'repeat', cond: 'again?', isLabel: 'yes',
      body: [{ id: '2', kind: 'action', label: 'poll' }] },
  ]};
  expect(serialize(doc)).toContain(
    '%% repeat\n  n2["poll"]\n%% repeat while (yes)\nn1{"again?"}\nn2 --> n1\nn1 -- yes --> n2\n',
  );
});

test('an empty repeat body emits no self-referential back edge', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'repeat', cond: 'again?', body: [] },
  ]};
  const out = serialize(doc);
  expect(out).toContain('%% repeat\n%% repeat while\nn1{"again?"}\n');
  expect(out).not.toContain('n1 --> n1');
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
