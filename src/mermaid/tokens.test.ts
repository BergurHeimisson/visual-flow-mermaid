import { expect, test } from 'vitest';
import { tokenize } from './tokens';

test('tokenizes the header and terminators', () => {
  expect(tokenize('flowchart TD\nstart(("start"))\ns1(("stop"))\ne1(("end"))').map((t) => t.type))
    .toEqual(['flowchart', 'start', 'stop', 'end']);
});

test('accepts either flowchart direction keyword', () => {
  expect(tokenize('flowchart LR')[0]).toMatchObject({ type: 'flowchart' });
  expect(tokenize('graph TD')[0]).toMatchObject({ type: 'flowchart' });
});

test('reads an activity node and strips its shape', () => {
  expect(tokenize('a1["Receive order"]')[0]).toMatchObject({ type: 'activity', id: 'a1', label: 'Receive order' });
});

test('unescapes a label that spans lines and carries a literal quote', () => {
  expect(tokenize('a1["first<br/>second"]')[0]).toMatchObject({ label: 'first\nsecond' });
  expect(tokenize('a1["say #quot;hi#quot;"]')[0]).toMatchObject({ label: 'say "hi"' });
});

test('reads an edge but does not classify it as any node kind', () => {
  expect(tokenize('a --> b')[0]).toMatchObject({ type: 'edge', from: 'a', to: 'b' });
});

test('reads a decision subgraph with and without a then-label', () => {
  expect(tokenize('subgraph if_a ["if (In stock?) then (yes)"]')[0])
    .toMatchObject({ type: 'subgraphIf', id: 'if_a', cond: 'In stock?', thenLabel: 'yes' });
  expect(tokenize('subgraph if_a ["if (ok?) then"]')[0])
    .toMatchObject({ type: 'subgraphIf', cond: 'ok?', thenLabel: undefined });
});

test('reads elseif and else subgraphs, and a bare `end` closes any of them', () => {
  expect(tokenize('subgraph elseif_a_1 ["elseif (b?) then (maybe)"]')[0])
    .toMatchObject({ type: 'subgraphElseif', cond: 'b?', thenLabel: 'maybe' });
  expect(tokenize('subgraph else_a ["else (no)"]')[0]).toMatchObject({ type: 'subgraphElse', label: 'no' });
  expect(tokenize('subgraph else_a ["else"]')[0]).toMatchObject({ type: 'subgraphElse', label: undefined });
  expect(tokenize('end')[0]).toMatchObject({ type: 'end-sub' });
});

test('reads loop subgraphs and their trailing label comments', () => {
  expect(tokenize('subgraph while_a ["while (more?) is (yes)"]')[0])
    .toMatchObject({ type: 'subgraphWhile', cond: 'more?', isLabel: 'yes' });
  expect(tokenize('%% endwhile (no)')[0]).toMatchObject({ type: 'endwhileNote', label: 'no' });
  expect(tokenize('subgraph repeat_a ["repeat"]')[0]).toMatchObject({ type: 'subgraphRepeat' });
  expect(tokenize('%% repeat while (again?) is (yes)')[0])
    .toMatchObject({ type: 'repeatWhileNote', cond: 'again?', isLabel: 'yes' });
});

test('reads fork and fork-again subgraphs, distinct from a plain `end`', () => {
  expect(tokenize('subgraph fork_a ["fork"]\nsubgraph forkagain_a_1 ["fork again"]\nend\nend').map((t) => t.type))
    .toEqual(['subgraphFork', 'subgraphForkAgain', 'end-sub', 'end-sub']);
});

test('reads inline and block notes, stripping the %% marker from the body', () => {
  expect(tokenize('%% note right: hello')[0]).toMatchObject({ type: 'note', side: 'right', text: 'hello' });
  expect(tokenize('%% note left\n%% one\n%% two\n%% end note')[0])
    .toMatchObject({ type: 'note', side: 'left', text: 'one\ntwo' });
});

test('classifies config directives and comments as cosmetic', () => {
  expect(tokenize('%%{init: {"theme": "dark"}}%%')[0]).toMatchObject({ type: 'cosmetic' });
  expect(tokenize('classDef important fill:#f00')[0]).toMatchObject({ type: 'cosmetic' });
  expect(tokenize('%% a plain comment')[0]).toMatchObject({ type: 'cosmetic', text: '%% a plain comment' });
});

test('classifies a foreign/unrecognised subgraph as unsupported', () => {
  expect(tokenize('subgraph mystery ["huh"]')[0]).toMatchObject({ type: 'unsupported', construct: 'subgraph' });
});

test('classifies structural constructs we cannot represent as unsupported', () => {
  expect(tokenize('partition "Fulfilment" {')[0]).toMatchObject({ type: 'unsupported', construct: 'partition' });
  expect(tokenize('|Lane A|')[0]).toMatchObject({ type: 'unsupported' });
  expect(tokenize('detach')[0]).toMatchObject({ type: 'unsupported', construct: 'detach' });
});

test('reports 1-based line numbers', () => {
  expect(tokenize('flowchart TD\n\nstart(("start"))\npartition x {')[2]).toMatchObject({ line: 4 });
});
