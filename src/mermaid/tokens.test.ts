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

test('reads the decision markers with and without labels', () => {
  expect(tokenize('%% if')[0]).toMatchObject({ type: 'markIf' });
  expect(tokenize('%% then (yes)')[0]).toMatchObject({ type: 'markThen', label: 'yes' });
  expect(tokenize('%% then')[0]).toMatchObject({ type: 'markThen', label: undefined });
  expect(tokenize('%% elseif')[0]).toMatchObject({ type: 'markElseif' });
  expect(tokenize('%% else (no)')[0]).toMatchObject({ type: 'markElse', label: 'no' });
  expect(tokenize('%% else')[0]).toMatchObject({ type: 'markElse', label: undefined });
  expect(tokenize('%% endif')[0]).toMatchObject({ type: 'markEndif' });
});

test('reads the repeat markers, with the condition no longer in the marker', () => {
  expect(tokenize('%% repeat')[0]).toMatchObject({ type: 'markRepeat' });
  expect(tokenize('%% repeat while (yes)')[0]).toMatchObject({ type: 'markRepeatWhile', label: 'yes' });
  expect(tokenize('%% repeat while')[0]).toMatchObject({ type: 'markRepeatWhile', label: undefined });
});

test('reads the while markers', () => {
  expect(tokenize('%% while')[0]).toMatchObject({ type: 'markWhile' });
  expect(tokenize('%% do (yes)')[0]).toMatchObject({ type: 'markDo', label: 'yes' });
  expect(tokenize('%% endwhile (no)')[0]).toMatchObject({ type: 'markEndwhile', label: 'no' });
  expect(tokenize('%% endwhile')[0]).toMatchObject({ type: 'markEndwhile', label: undefined });
});

test('reads the fork markers', () => {
  expect(tokenize('%% fork')[0]).toMatchObject({ type: 'markFork' });
  expect(tokenize('%% fork again')[0]).toMatchObject({ type: 'markForkAgain' });
  expect(tokenize('%% end fork')[0]).toMatchObject({ type: 'markEndFork' });
});

test('a bare `end` is no longer a token of this dialect', () => {
  expect(tokenize('end')[0]).toMatchObject({ type: 'unsupported' });
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

test('reads a diamond decision node', () => {
  expect(tokenize('n2{"In stock?"}')[0])
    .toMatchObject({ type: 'decision', id: 'n2', cond: 'In stock?' });
});

test('unescapes a condition that carries a quote or a line break', () => {
  expect(tokenize('n2{"say #quot;hi#quot;"}')[0]).toMatchObject({ cond: 'say "hi"' });
  expect(tokenize('n2{"first<br/>second"}')[0]).toMatchObject({ cond: 'first\nsecond' });
});

test('reads a fork bar', () => {
  expect(tokenize('n8@{ shape: fork }')[0]).toMatchObject({ type: 'forkBar', id: 'n8' });
  expect(tokenize('join_n8@{shape:fork}')[0]).toMatchObject({ type: 'forkBar', id: 'join_n8' });
});

test('refuses an extended shape that is not a fork, naming the shape', () => {
  expect(tokenize('n8@{ shape: cyl }')[0])
    .toMatchObject({ type: 'unsupported', construct: '@{ shape: cyl }' });
});

test('reads both labelled edge forms and discards the label', () => {
  expect(tokenize('a -- yes --> b')[0]).toMatchObject({ type: 'edge', from: 'a', to: 'b' });
  expect(tokenize('a -->|yes| b')[0]).toMatchObject({ type: 'edge', from: 'a', to: 'b' });
  expect(tokenize('a -->|"a --> b"| b')[0]).toMatchObject({ type: 'edge', from: 'a', to: 'b' });
});
