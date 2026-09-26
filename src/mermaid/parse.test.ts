import { expect, test } from 'vitest';
import { parse } from './parse';
import { serialize } from './serialize';

function ok(text: string) {
  const r = parse(text);
  if (!r.ok) throw new Error(`expected success, got ${r.error.message}`);
  return r;
}

test('parses a decision into branches and an else arm', () => {
  const doc = ok(
    'flowchart TD\nstart(("start"))\na["A"]\n'
    + '%% if\nx{"c?"}\n%% then (yes)\n  b["B"]\n'
    + '%% else (no)\n  c["C"]\n%% endif\n'
    + 's1(("stop"))\n',
  ).doc;
  expect(doc.body).toHaveLength(3);
  expect(doc.body[1]).toMatchObject({
    kind: 'if',
    branches: [{ cond: 'c?', thenLabel: 'yes' }],
    elseLabel: 'no',
  });
});

test('parses elseif chains in order', () => {
  const doc = ok(
    'start(("start"))\n'
    + '%% if\nx{"a?"}\n%% then\n  a["A"]\n'
    + '%% elseif\ny{"b?"}\n%% then\n  b["B"]\n%% endif\n',
  ).doc;
  const block = doc.body[0];
  expect(block.kind === 'if' && block.branches.map((b) => b.cond)).toEqual(['a?', 'b?']);
});

test('refuses a diamond that does not follow an opening marker', () => {
  const r = parse('start(("start"))\nx{"c?"}\n');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.message).toMatch(/decision must follow/i);
});

test('parses loops and fork', () => {
  const doc = ok(
    'start(("start"))\n'
    + '%% while\nw{"m?"}\n%% do (yes)\n  r["r"]\n%% endwhile (no)\n'
    + '%% repeat\n  p["p"]\n%% repeat while (yes)\nrw{"a?"}\n'
    + '%% fork\nf@{ shape: fork }\n  l["l"]\n%% fork again\n  r2["r"]\n%% end fork\njoin_f@{ shape: fork }\n',
  ).doc;
  expect(doc.body.map((b) => b.kind)).toEqual(['while', 'repeat', 'fork']);
});

test('refuses an old-dialect subgraph file rather than half-parsing it', () => {
  const r = parse(
    'flowchart TD\nstart(("start"))\nsubgraph if_a ["if (c?) then (yes)"]\n  b["B"]\nend\n',
  );
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.kind).toBe('unsupported');
    expect(r.error.message).toMatch(/subgraph is not supported/i);
    expect(r.error.line).toBe(3);
  }
});

test('attaches a note to the activity it follows', () => {
  const doc = ok('start(("start"))\nship["Ship"]\n%% note right: soon\n').doc;
  expect(doc.body[0]).toMatchObject({ kind: 'action', note: { side: 'right', text: 'soon' } });
});

test('keeps cosmetic lines before start as the preamble', () => {
  const doc = ok(
    'flowchart TD\n%% title My Flow\n%% skinparam monochrome true\nstart(("start"))\na["A"]\n',
  ).doc;
  expect(doc.preamble).toEqual(['%% title My Flow', '%% skinparam monochrome true']);
});

test('reports cosmetic lines inside the flow as ignored rather than preserving them', () => {
  const r = ok('start(("start"))\na["A"]\n%% title Late\nb["B"]\n');
  expect(r.doc.preamble).toEqual([]);
  expect(r.ignored).toEqual([{ line: 3, text: '%% title Late' }]);
});

test('refuses a structural construct it cannot represent', () => {
  const r = parse('flowchart TD\nstart(("start"))\npartition "Fulfilment" {\n');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toMatchObject({ kind: 'unsupported', line: 3, construct: 'partition' });
  }
});

test('reports a syntax error for an unclosed decision', () => {
  const r = parse('start(("start"))\n%% if\nx{"c?"}\n%% then\n  a["A"]\n');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.kind).toBe('syntax');
});

test('tolerates a missing start, since start is implicit', () => {
  expect(ok('flowchart TD\na["A"]\n').doc.body).toHaveLength(1);
});

test('round-trips a document written by the serializer', () => {
  const text = serialize({ preamble: [], body: [
    { id: '1', kind: 'action', label: 'A' },
    { id: '2', kind: 'if',
      branches: [{ cond: 'c?', thenLabel: 'yes', body: [{ id: '3', kind: 'action', label: 'B' }] }],
      elseBody: [{ id: '4', kind: 'action', label: 'C' }], elseLabel: 'no' },
    { id: '5', kind: 'stop' },
  ]});
  expect(serialize(ok(text).doc)).toBe(text);
});

test('refuses an unsupported construct nested deep inside an if inside a while', () => {
  const text = 'start(("start"))\n%% while\nw{"m?"}\n%% do (yes)\n'
    + '%% if\nx{"c?"}\n%% then\npartition "P" {\na["A"]\n}\n%% endif\n%% endwhile\n';
  const r = parse(text);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error).toMatchObject({ kind: 'unsupported', line: 8, construct: 'partition' });
  }
});

// Unlike PlantUML's `:text;`, this dialect never accumulates an activity label across raw
// lines — a node's shape must close on the SAME physical line (`^(\w+)\["(.*)"\]$` etc.), so
// there is no "unterminated activity" failure mode to refuse against in the first place. A
// malformed/incomplete node line simply falls through every recognised pattern and becomes
// `unsupported`, refusing the import exactly the same way a genuinely foreign line would.
test('refuses a malformed, unterminated node line rather than guessing at it', () => {
  const r = parse('start(("start"))\na["oops\n');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.kind).toBe('unsupported');
});

test('reports a syntax error for a stray note rather than dropping it', () => {
  const first = parse('%% note right: hi');
  expect(first.ok).toBe(false);
  if (!first.ok) expect(first.error.kind).toBe('syntax');

  const afterIf = parse('start(("start"))\n%% if\nx{"c?"}\n%% then\n  a["A"]\n%% endif\n%% note right: hi\n');
  expect(afterIf.ok).toBe(false);
  if (!afterIf.ok) expect(afterIf.error.kind).toBe('syntax');

  const afterStop = parse('start(("start"))\ns1(("stop"))\n%% note right: hi\n');
  expect(afterStop.ok).toBe(false);
  if (!afterStop.ok) expect(afterStop.error.kind).toBe('syntax');
});

// `end` used to close a subgraph. Now that nesting is carried by markers it is simply
// old-dialect syntax, so it is refused by name rather than parsed as a terminator.
test('refuses a stray closing `end` at the top level', () => {
  const r = parse('start(("start"))\na["A"]\nend\n');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.kind).toBe('unsupported');
    expect(r.error.line).toBe(3);
  }
});

test('reports the last real token line for an unterminated if, not a hardcoded 1', () => {
  const r = parse('start(("start"))\n%% if\nx{"c?"}\n%% then\n  a["A"]\n');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.kind).toBe('syntax');
    expect(r.error.line).toBeGreaterThan(1);
    expect(r.error.line).toBe(5);
  }

  const nested = parse(
    'start(("start"))\n%% if\nx{"a?"}\n%% then\n%% if\ny{"b?"}\n%% then\n  a["A"]\n',
  );
  expect(nested.ok).toBe(false);
  if (!nested.ok) {
    expect(nested.error.kind).toBe('syntax');
    expect(nested.error.line).toBeGreaterThan(1);
    expect(nested.error.line).toBe(8);
  }
});

// --- Refuse-don't-mangle, unterminated accumulate-until loop (the note block form) ------
//
// The one construct in this dialect that DOES accumulate across raw lines is the multi-line
// `%% note left` / `%% end note` block, mirroring PlantUML's own `note`/`end note` block —
// see tokens.ts. It must refuse rather than silently swallow the rest of the file (and
// whatever real content follows) when `%% end note` never arrives.
test('refuses a note block that never reaches `%% end note`', () => {
  const r = parse('start(("start"))\na["A"]\n%% note right\nhello\n');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.kind).toBe('syntax');
    expect(r.error.message).toMatch(/end note/i);
  }
});

test('refuses a file containing a second flowchart declaration', () => {
  const r = parse('flowchart TD\nstart(("start"))\na["a"]\nflowchart TD\nstart(("start"))\nb["b"]\n');
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.error.line).toBe(4);
    expect(r.error.message).toMatch(/one diagram|multiple/i);
  }
});

// --- The markers ARE the structure ----------------------------------------------------
//
// A marker that goes missing cannot be detected by spelling: `%% endwile` opens with no
// keyword this dialect knows. What protects the document instead is that every marker a
// construct needs is `expect`ed, so its absence refuses loudly. These tests pin that.
// The one case `expect` cannot catch is a dropped `%% fork again`, which would silently
// merge two parallel columns into one — so a fork is refused unless it has two branches.

test('a missing `%% then` refuses rather than guessing', () => {
  const r = parse('start(("start"))\n%% if\nx{"c?"}\n  a["A"]\n%% endif\n');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.message).toMatch(/%% then/);
});

test('a missing `%% endwhile` refuses rather than running to end of file', () => {
  const r = parse('start(("start"))\n%% while\nw{"m?"}\n%% do\n  a["A"]\n');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.message).toMatch(/%% endwhile/);
});

test('a missing `%% repeat while` refuses rather than dropping the condition', () => {
  const r = parse('start(("start"))\n%% repeat\n  a["A"]\n');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.message).toMatch(/%% repeat while/);
});

test('a fork whose `%% fork again` went missing is refused, not silently merged', () => {
  const r = parse(
    'start(("start"))\n%% fork\nf@{ shape: fork }\n  a["A"]\n  b["B"]\n'
    + '%% end fork\njoin_f@{ shape: fork }\n',
  );
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.message).toMatch(/two branches|fork again/i);
});

test('an ordinary comment that opens with a marker keyword stays a comment', () => {
  // `%% do not edit` and `%% if you change this` both open with a marker keyword. Treating
  // a keyword prefix as reserved would refuse these outright, so the dialect does not.
  const r = parse('%% do not edit\n%% if you change this, re-export it\nstart(("start"))\na["A"]\n');
  expect(r.ok).toBe(true);
  if (r.ok) {
    expect(r.doc.preamble).toEqual(['%% do not edit', '%% if you change this, re-export it']);
    expect(serialize(r.doc)).toContain('%% do not edit\n%% if you change this, re-export it\n');
  }
});
