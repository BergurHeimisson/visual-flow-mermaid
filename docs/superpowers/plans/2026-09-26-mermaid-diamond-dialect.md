# Idiomatic Mermaid Diamond Dialect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the PlantUML-transcribed `subgraph` dialect with idiomatic Mermaid — diamonds, labelled edges and native fork bars — carrying the document tree in inert `%%` markers.

**Architecture:** The document tree moves from `subgraph`/`end` nesting to `%%` markers, one per clause, with every condition living in the diamond node that follows its marker. The parser keeps its existing rule — read markers and node shapes, never arrows — so `roundtrip.test.ts` keeps its current code and full strength. The conversion is done **one construct at a time**: `tokens.ts`, `serialize.ts` and `parse.ts` are coupled through the `Token` union, but each construct is independent within it, so `if` can move to markers while `while` still uses subgraphs. That keeps the whole suite, including the 200-document round-trip, green at every commit.

**Tech Stack:** TypeScript, Vitest (jsdom), Playwright (Chromium). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-26-mermaid-diamond-dialect-design.md`

## Global Constraints

- Emitted files target **Mermaid v11.3.0+** (the `@{ shape: fork }` bar needs it). Do not add a `mermaid` dependency — this project only writes `.mmd`.
- The parser **never reads edges**. Every structural fact must come from a marker or a node shape. `parse.ts`'s `if (token.type === 'edge') continue;` stays.
- `src/mermaid/roundtrip.test.ts` **is not edited by any task**. It is the regression net; if a task makes it red, that task is not finished.
- `src/mermaid/testing/arbitrary.ts` generates model values and its generator logic is not edited (one stale comment is corrected in Task 8).
- The document model (`src/model/types.ts`), the layout engine and the canvas are **not touched**.
- Construct bodies stay indented with the existing `IND` two-space `indent()` helper.
- Refuse, don't mangle: anything the dialect cannot represent aborts the import naming the line; cosmetic `%%` comments and directives stay preserved.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Review Focus

- **A branch label containing `-->` or `|` mangles the edge it sits on.** Labels are free text from the inline editor; the old dialect kept them inside a quoted subgraph title, the new one puts them on a bare edge. `thenLabel` of `a --> b` must not produce `n1 -- a --> b --> n2`. Pinned in Task 2, Step 7.
- **A condition containing `"` or a newline must escape inside the diamond.** `q()` already handles `#quot;` and `<br/>`; the diamond is a new call site for it. Pinned in Task 2, Step 9.
- **An old-dialect `.mmd` must refuse loudly, not half-parse.** After Task 5 no `subgraph` token remains; the file must still abort with the existing "subgraph is not supported" message rather than silently producing a truncated document. Pinned in Task 5, Step 9.
- **A misspelled marker must be `malformed`, not silently `cosmetic`.** `%% endwile` degrading to an inert comment is the central hazard of the comment carrier. Pinned in Task 6.
- **Empty bodies must not emit dangling or self-referential edges.** An empty `repeat` body would otherwise produce `n1 --> n1`; an empty fork branch would produce an edge to nothing. Pinned in Task 4, Step 3 and Task 5, Step 7.

---

### Task 1: Tokenizer groundwork — node shapes and labelled edges

Purely additive. No existing token is removed, so `parse.ts` and `serialize.ts` are untouched and the whole suite stays green.

**Files:**
- Modify: `src/mermaid/tokens.ts`
- Test: `src/mermaid/tokens.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: two new `Token` members used by every later task —
  `{ type: 'decision'; id: string; cond: string; line: number }` and
  `{ type: 'forkBar'; id: string; line: number }`. Labelled edges tokenize as the
  existing `{ type: 'edge'; from: string; to: string; line: number }`, with the
  label discarded.

- [ ] **Step 1: Write the failing tests**

Append to `src/mermaid/tokens.test.ts`:

```ts
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

test('refuses an extended shape that is not a fork', () => {
  expect(tokenize('n8@{ shape: cyl }')[0]).toMatchObject({ type: 'unsupported' });
});

test('reads both labelled edge forms and discards the label', () => {
  expect(tokenize('a -- yes --> b')[0]).toMatchObject({ type: 'edge', from: 'a', to: 'b' });
  expect(tokenize('a -->|yes| b')[0]).toMatchObject({ type: 'edge', from: 'a', to: 'b' });
  expect(tokenize('a -->|"a --> b"| b')[0]).toMatchObject({ type: 'edge', from: 'a', to: 'b' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/mermaid/tokens.test.ts`
Expected: FAIL — the new lines tokenize as `unsupported`, not `decision`/`forkBar`/`edge`.

- [ ] **Step 3: Add the two token types**

In `src/mermaid/tokens.ts`, add to the `Token` union, directly after the `activity` member:

```ts
  | { type: 'decision'; id: string; cond: string; line: number }
  | { type: 'forkBar'; id: string; line: number }
```

- [ ] **Step 4: Add the regexes**

In the `RE` object, add:

```ts
  decision:  /^(\w+)\{"(.*)"\}$/,
  forkBar:   /^(\w+)@\{\s*shape:\s*fork\s*\}$/i,
  shapeAt:   /^(\w+)@\{\s*shape:\s*(\w[\w-]*)\s*\}$/i,
  edgeLabel: /^(\w+)\s*--\s*(?:.*?)\s*-->\s*(\w+)$/,
  edgePipe:  /^(\w+)\s*-->\s*\|(?:.*?)\|\s*(\w+)$/,
```

`shapeAt` exists only so a non-fork extended shape is named in the refusal rather than falling into the generic `unsupported` branch.

- [ ] **Step 5: Wire them into `tokenize`**

In `src/mermaid/tokens.ts`, immediately after the existing `activity` block:

```ts
    const decision = RE.decision.exec(t);
    if (decision) { out.push({ type: 'decision', id: decision[1], cond: unescape(decision[2]), line }); continue; }

    const forkBar = RE.forkBar.exec(t);
    if (forkBar) { out.push({ type: 'forkBar', id: forkBar[1], line }); continue; }

    const shapeAt = RE.shapeAt.exec(t);
    if (shapeAt) { out.push({ type: 'unsupported', construct: `@{ shape: ${shapeAt[2]} }`, text: raw.trim(), line }); continue; }
```

And replace the single existing `edge` dispatch with all three forms:

```ts
    const edge = RE.edge.exec(t) ?? RE.edgeLabel.exec(t) ?? RE.edgePipe.exec(t);
    if (edge) { out.push({ type: 'edge', from: edge[1], to: edge[2], line }); continue; }
```

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS, including `roundtrip.test.ts` — nothing that emits or parses has changed yet.

- [ ] **Step 7: Commit**

```bash
git add src/mermaid/tokens.ts src/mermaid/tokens.test.ts
git commit -m "Tokenize diamonds, fork bars and labelled edges

Additive groundwork for the marker dialect: the old subgraph tokens are
untouched, so serializer and parser are unaffected.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Convert `if` / `elseif` / `else` to diamonds and markers

The largest task, because it establishes the marker machinery every later construct reuses. `while`, `repeat` and `fork` still use subgraphs after this task, and the round-trip test must stay green across the mixed dialect.

**Files:**
- Modify: `src/mermaid/tokens.ts`, `src/mermaid/serialize.ts`, `src/mermaid/parse.ts`
- Test: `src/mermaid/tokens.test.ts`, `src/mermaid/serialize.test.ts`, `src/mermaid/parse.test.ts`

**Interfaces:**
- Consumes: `decision` and `forkBar` tokens from Task 1.
- Produces, for Tasks 3–6:
  - Token members `{ type: 'markIf'; line: number }`, `{ type: 'markThen'; label?: string; line: number }`, `{ type: 'markElseif'; line: number }`, `{ type: 'markElse'; label?: string; line: number }`, `{ type: 'markEndif'; line: number }`.
  - `type Tail = { from: string; label?: string }` in `serialize.ts`.
  - `function edgeLine(from: string, to: string, label?: string): string`.
  - `function parseBody(stop: ReadonlySet<Token['type']>): Block[]` in `parse.ts`, which reads blocks until it meets a stop token and does **not** consume it.

- [ ] **Step 1: Write the failing tokenizer tests**

Replace the existing `reads a decision subgraph with and without a then-label` and `reads elseif and else subgraphs, and a bare 'end' closes any of them` tests in `src/mermaid/tokens.test.ts` with:

```ts
test('reads the decision markers with and without labels', () => {
  expect(tokenize('%% if')[0]).toMatchObject({ type: 'markIf' });
  expect(tokenize('%% then (yes)')[0]).toMatchObject({ type: 'markThen', label: 'yes' });
  expect(tokenize('%% then')[0]).toMatchObject({ type: 'markThen', label: undefined });
  expect(tokenize('%% elseif')[0]).toMatchObject({ type: 'markElseif' });
  expect(tokenize('%% else (no)')[0]).toMatchObject({ type: 'markElse', label: 'no' });
  expect(tokenize('%% else')[0]).toMatchObject({ type: 'markElse', label: undefined });
  expect(tokenize('%% endif')[0]).toMatchObject({ type: 'markEndif' });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mermaid/tokens.test.ts`
Expected: FAIL — `%% if` currently tokenizes as `cosmetic`.

- [ ] **Step 3: Add the decision markers to the tokenizer**

In `src/mermaid/tokens.ts`, remove the `subgraphIf`, `subgraphElseif` and `subgraphElse` members from the `Token` union and add:

```ts
  | { type: 'markIf'; line: number }
  | { type: 'markThen'; label?: string; line: number }
  | { type: 'markElseif'; line: number }
  | { type: 'markElse'; label?: string; line: number }
  | { type: 'markEndif'; line: number }
```

Remove the `subgraphIf`, `subgraphElseif` and `subgraphElse` entries from `RE` and add:

```ts
  markIf:     /^%%\s*if$/i,
  markThen:   /^%%\s*then\s*(?:\((.*)\))?$/i,
  markElseif: /^%%\s*elseif$/i,
  markElse:   /^%%\s*else\s*(?:\((.*)\))?$/i,
  markEndif:  /^%%\s*endif$/i,
```

Delete the three `subgraph*` dispatch blocks for `if`/`elseif`/`else` in `tokenize` and add, **above** the generic `%%` cosmetic fallback:

```ts
    if (RE.markIf.test(t)) { out.push({ type: 'markIf', line }); continue; }
    const markThen = RE.markThen.exec(t);
    if (markThen) { out.push({ type: 'markThen', label: markThen[1], line }); continue; }
    if (RE.markElseif.test(t)) { out.push({ type: 'markElseif', line }); continue; }
    const markElse = RE.markElse.exec(t);
    if (markElse) { out.push({ type: 'markElse', label: markElse[1], line }); continue; }
    if (RE.markEndif.test(t)) { out.push({ type: 'markEndif', line }); continue; }
```

- [ ] **Step 4: Write the failing serializer test**

Replace `serializes a decision with an else arm, nesting each arm in its own subgraph` in `src/mermaid/serialize.test.ts` with:

```ts
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
```

And replace `serializes elseif branches in order, each its own subgraph` with:

```ts
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
```

- [ ] **Step 5: Run to verify failure**

Run: `npx vitest run src/mermaid/serialize.test.ts`
Expected: FAIL — the serializer still emits `subgraph if_n2 [...]`.

- [ ] **Step 6: Give `Tail` a label, and `edgeLine` a third parameter that cannot be mangled**

A label is free text from the inline editor, so `a --> b` or `a | b` emitted bare between `--` and `-->` would break the arrow. That is the Review Focus item, and the guard belongs in `edgeLine` itself rather than at its call sites. Replace `Tail` and `edgeLine` in `src/mermaid/serialize.ts` with:

```ts
type Tail = { from: string; label?: string };

/** A label safe to sit bare between `--` and `-->`. Anything else (an arrow, a pipe, a
 *  brace) goes through the quoted `-->|"..."|` form instead, where `q()`'s escaping
 *  applies. Both forms tokenize back to the same `edge` token, which the parser
 *  discards, so this choice is purely about what a renderer shows. */
const SIMPLE_LABEL = /^[\w ?!.,'-]+$/;

function edgeLine(from: string, to: string, label?: string): string {
  if (label === undefined) return `${from} --> ${to}`;
  return SIMPLE_LABEL.test(label)
    ? `${from} -- ${label} --> ${to}`
    : `${from} -->|${q(label)}| ${to}`;
}
```

and in `emitSeq`, pass the tail's label through:

```ts
    for (const t of pending) lines.push(edgeLine(t.from, b.entry, t.label));
```

- [ ] **Step 7: Pin the label-mangling guard with a test**

Add to `src/mermaid/serialize.test.ts`:

```ts
test('quotes a branch label that would otherwise break the arrow', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'if',
      branches: [{ cond: 'c?', thenLabel: 'a --> b', body: [{ id: '2', kind: 'action', label: 'x' }] }] },
  ]};
  expect(serialize(doc)).toContain('n1 -->|"a --> b"| n2');
  expect(serialize(doc)).not.toContain('-- a --> b -->');
});
```

- [ ] **Step 8: Rewrite the `if` case of `emitBlock`**

Replace the whole `case 'if':` block in `src/mermaid/serialize.ts` with:

```ts
    case 'if': {
      const lines: string[] = [];
      const tails: Tail[] = [];
      let lastDiamond = id;
      block.branches.forEach((branch: Branch, i) => {
        const dId = i === 0 ? id : `elseif_${id}_${i}`;
        lines.push(i === 0 ? '%% if' : '%% elseif');
        lines.push(`${dId}{${q(branch.cond)}}`);
        // The no-path into an elseif arm carries no label: the model has a label only
        // for the final `else`, exactly as PlantUML does.
        if (i > 0) lines.push(edgeLine(lastDiamond, dId));
        lines.push(`%% then${opt(branch.thenLabel)}`);
        const body = emitSeq(branch.body, ctx);
        if (body.entry) body.lines.unshift(edgeLine(dId, body.entry, branch.thenLabel));
        lines.push(...indent(body.lines));
        tails.push(...body.tails);
        lastDiamond = dId;
      });
      if (block.elseBody) {
        lines.push(`%% else${opt(block.elseLabel)}`);
        const body = emitSeq(block.elseBody, ctx);
        if (body.entry) body.lines.unshift(edgeLine(lastDiamond, body.entry, block.elseLabel));
        lines.push(...indent(body.lines));
        tails.push(...body.tails);
      } else {
        // No else arm: the last diamond's no-side always has somewhere live to go. It is
        // unlabelled because `elseLabel` only ever exists alongside an `elseBody` (see
        // `edits.ts`), and a labelled fall-through would have no marker to be read back from.
        tails.push({ from: lastDiamond });
      }
      lines.push('%% endif');
      return { lines, entry: id, tails };
    }
```

- [ ] **Step 9: Add the condition-escaping test**

This is the Review Focus item for conditions. Add to `src/mermaid/serialize.test.ts`:

```ts
test('escapes a quote and a line break inside a condition', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'if', branches: [{ cond: 'say "hi"\nagain?', body: [] }] },
  ]};
  expect(serialize(doc)).toContain('n1{"say #quot;hi#quot;<br/>again?"}');
});
```

- [ ] **Step 10: Write the failing parser test**

Replace `parses a decision into branches and an else arm` and `parses elseif chains in order` in `src/mermaid/parse.test.ts` with:

```ts
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
```

- [ ] **Step 11: Run to verify failure**

Run: `npx vitest run src/mermaid/parse.test.ts`
Expected: FAIL — the parser has no `markIf` case.

- [ ] **Step 12: Add `parseBody` and rewrite the `if` case of `parseBlock`**

In `src/mermaid/parse.ts`, add beside `parseNested` (which stays until Task 5 for the constructs still using subgraphs):

```ts
  const IF_STOP = new Set<Token['type']>(['markElseif', 'markElse', 'markEndif']);

  /** A marker-delimited body: read blocks until one of this construct's own closing
   *  markers, which the caller consumes. A nested construct is consumed whole by the
   *  recursive `parseBlock`, so the stop set is only ever consulted at block-start
   *  position — the same property `parseNested` relied on with `end`. */
  function parseBody(stop: ReadonlySet<Token['type']>): Block[] {
    const out: Block[] = [];
    while (i < structural.length && !stop.has(peek().type)) out.push(parseBlock());
    return out;
  }
```

Replace `case 'subgraphIf':` with:

```ts
      case 'markIf': {
        const branches: Branch[] = [];
        for (;;) {
          const diamond = expect('decision', 'a `{"condition"}` decision node');
          const then = expect('markThen', '`%% then`');
          branches.push({ cond: diamond.cond, thenLabel: then.label, body: parseBody(IF_STOP) });
          if (peek()?.type !== 'markElseif') break;
          next();
        }
        let elseBody: Block[] | undefined;
        let elseLabel: string | undefined;
        if (peek()?.type === 'markElse') {
          elseLabel = (next() as Extract<Token, { type: 'markElse' }>).label;
          elseBody = parseBody(IF_STOP);
        }
        expect('markEndif', '`%% endif`');
        return { id: newId(), kind: 'if', branches, elseBody, elseLabel };
      }
      case 'decision':
      case 'forkBar':
        throw new Fail({ kind: 'syntax', line: token.line,
          message: 'A `{...}` decision must follow `%% if`, `%% elseif`, `%% while` or `%% repeat while`.' });
```

- [ ] **Step 13: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS, `roundtrip.test.ts` included — `if` now round-trips through markers while the other constructs still round-trip through subgraphs.

- [ ] **Step 14: Commit**

```bash
git add src/mermaid/
git commit -m "Serialize decisions as diamonds with labelled edges

if/elseif/else move from subgraph containers to %% markers with a real
diamond per arm. Adds Tail labels, edgeLine label support with a quoted
fallback for labels that would break the arrow, and parseBody.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Convert `while` to a diamond with a back edge

**Files:**
- Modify: `src/mermaid/tokens.ts`, `src/mermaid/serialize.ts`, `src/mermaid/parse.ts`
- Test: `src/mermaid/tokens.test.ts`, `src/mermaid/serialize.test.ts`, `src/mermaid/parse.test.ts`

**Interfaces:**
- Consumes: `Tail`, `edgeLine`, `parseBody` from Task 2.
- Produces: token members `{ type: 'markWhile'; line: number }`, `{ type: 'markDo'; label?: string; line: number }`, `{ type: 'markEndwhile'; label?: string; line: number }`. `markEndwhile` replaces the removed `endwhileNote`.

- [ ] **Step 1: Write the failing tests**

In `src/mermaid/tokens.test.ts`, add:

```ts
test('reads the while markers', () => {
  expect(tokenize('%% while')[0]).toMatchObject({ type: 'markWhile' });
  expect(tokenize('%% do (yes)')[0]).toMatchObject({ type: 'markDo', label: 'yes' });
  expect(tokenize('%% endwhile (no)')[0]).toMatchObject({ type: 'markEndwhile', label: 'no' });
  expect(tokenize('%% endwhile')[0]).toMatchObject({ type: 'markEndwhile', label: undefined });
});
```

In `src/mermaid/serialize.test.ts`, replace the `while` assertion inside `serializes while, repeat, and fork` and the `omits optional labels when they are absent` test with:

```ts
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
```

In `src/mermaid/parse.test.ts`, replace the `while` line of `parses loops and fork` — the full rewrite of that test lands in Task 5; for now change only its while clause to `'%% while\nw{"m?"}\n%% do (yes)\n  r["r"]\n%% endwhile (no)\n'`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mermaid/`
Expected: FAIL in all three files.

- [ ] **Step 3: Add the while markers to the tokenizer**

In `src/mermaid/tokens.ts`, remove the `subgraphWhile` and `endwhileNote` members from the `Token` union and add:

```ts
  | { type: 'markWhile'; line: number }
  | { type: 'markDo'; label?: string; line: number }
  | { type: 'markEndwhile'; label?: string; line: number }
```

Remove the `subgraphWhile` and `endwhileNote` entries from `RE` and add:

```ts
  markWhile:    /^%%\s*while$/i,
  markDo:       /^%%\s*do\s*(?:\((.*)\))?$/i,
  markEndwhile: /^%%\s*endwhile\s*(?:\((.*)\))?$/i,
```

Delete the `subgraphWhile` and `endwhileNote` dispatch blocks and add alongside the decision markers:

```ts
    if (RE.markWhile.test(t)) { out.push({ type: 'markWhile', line }); continue; }
    const markDo = RE.markDo.exec(t);
    if (markDo) { out.push({ type: 'markDo', label: markDo[1], line }); continue; }
    const markEndwhile = RE.markEndwhile.exec(t);
    if (markEndwhile) { out.push({ type: 'markEndwhile', label: markEndwhile[1], line }); continue; }
```

- [ ] **Step 4: Rewrite the `while` case of `emitBlock`**

Replace the whole `case 'while':` block in `src/mermaid/serialize.ts` with:

```ts
    case 'while': {
      const lines = ['%% while', `${id}{${q(block.cond)}}`, `%% do${opt(block.isLabel)}`];
      const body = emitSeq(block.body, ctx);
      if (body.entry) body.lines.unshift(edgeLine(id, body.entry, block.isLabel));
      for (const t of body.tails) body.lines.push(edgeLine(t.from, id, t.label));
      lines.push(...indent(body.lines));
      lines.push(`%% endwhile${opt(block.endLabel)}`);
      return { lines, entry: id, tails: [{ from: id, label: block.endLabel }] };
    }
```

The exit label is now a real `Tail` label, so `endLabel` renders on the loop's exit arrow instead of sitting in a dead comment.

- [ ] **Step 5: Rewrite the `while` case of `parseBlock`**

In `src/mermaid/parse.ts`, add beside `IF_STOP`:

```ts
  const WHILE_STOP = new Set<Token['type']>(['markEndwhile']);
```

Replace `case 'subgraphWhile':` with:

```ts
      case 'markWhile': {
        const diamond = expect('decision', 'a `{"condition"}` decision node');
        const doMark = expect('markDo', '`%% do`');
        const body = parseBody(WHILE_STOP);
        const close = expect('markEndwhile', '`%% endwhile`');
        return { id: newId(), kind: 'while', cond: diamond.cond,
                 isLabel: doMark.label, endLabel: close.label, body };
      }
```

- [ ] **Step 6: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS including `roundtrip.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/mermaid/
git commit -m "Serialize while loops as a diamond with a back edge

endLabel becomes the label on the loop's exit arrow rather than a dead
%% endwhile comment.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Convert `repeat` to a trailing diamond

**Files:**
- Modify: `src/mermaid/tokens.ts`, `src/mermaid/serialize.ts`, `src/mermaid/parse.ts`
- Test: `src/mermaid/tokens.test.ts`, `src/mermaid/serialize.test.ts`, `src/mermaid/parse.test.ts`

**Interfaces:**
- Consumes: `parseBody`, `edgeLine` from Task 2.
- Produces: token members `{ type: 'markRepeat'; line: number }` and `{ type: 'markRepeatWhile'; label?: string; line: number }`. `markRepeatWhile` replaces the removed `repeatWhileNote` and **no longer carries a condition** — the condition now comes from the trailing diamond.

- [ ] **Step 1: Write the failing tests**

In `src/mermaid/tokens.test.ts`, add:

```ts
test('reads the repeat markers, with the condition no longer in the marker', () => {
  expect(tokenize('%% repeat')[0]).toMatchObject({ type: 'markRepeat' });
  expect(tokenize('%% repeat while (yes)')[0]).toMatchObject({ type: 'markRepeatWhile', label: 'yes' });
  expect(tokenize('%% repeat while')[0]).toMatchObject({ type: 'markRepeatWhile', label: undefined });
});
```

In `src/mermaid/serialize.test.ts`, replace the `repeat` assertion inside `serializes while, repeat, and fork` with:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mermaid/`
Expected: FAIL.

- [ ] **Step 3: Add the repeat markers to the tokenizer**

In `src/mermaid/tokens.ts`, remove `subgraphRepeat` and `repeatWhileNote` from the `Token` union and add:

```ts
  | { type: 'markRepeat'; line: number }
  | { type: 'markRepeatWhile'; label?: string; line: number }
```

Remove their `RE` entries and add:

```ts
  markRepeatWhile: /^%%\s*repeat\s+while\s*(?:\((.*)\))?$/i,
  markRepeat:      /^%%\s*repeat$/i,
```

Delete their dispatch blocks and add — `markRepeatWhile` **must be tested first**, since `%% repeat while (yes)` would otherwise be checked against the bare-`repeat` pattern:

```ts
    const markRepeatWhile = RE.markRepeatWhile.exec(t);
    if (markRepeatWhile) { out.push({ type: 'markRepeatWhile', label: markRepeatWhile[1], line }); continue; }
    if (RE.markRepeat.test(t)) { out.push({ type: 'markRepeat', line }); continue; }
```

- [ ] **Step 4: Rewrite the `repeat` case of `emitBlock`**

Replace the whole `case 'repeat':` block in `src/mermaid/serialize.ts` with:

```ts
    case 'repeat': {
      const lines = ['%% repeat'];
      const body = emitSeq(block.body, ctx);
      lines.push(...indent(body.lines));
      lines.push(`%% repeat while${opt(block.isLabel)}`);
      lines.push(`${id}{${q(block.cond)}}`);
      for (const t of body.tails) lines.push(edgeLine(t.from, id, t.label));
      // An empty body has no node to loop back to, so the back edge is omitted rather
      // than pointing the diamond at itself; the construct's entry is then the diamond.
      if (body.entry) lines.push(edgeLine(id, body.entry, block.isLabel));
      return { lines, entry: body.entry ?? id, tails: [{ from: id }] };
    }
```

- [ ] **Step 5: Remove the now-unused `optIs` helper**

`optIs` in `src/mermaid/serialize.ts` existed only for the `while (cond) is (label)` and `repeat while (cond) is (label)` subgraph titles. Both are gone; delete the function. `npm run typecheck` will confirm nothing else references it.

- [ ] **Step 6: Rewrite the `repeat` case of `parseBlock`**

In `src/mermaid/parse.ts`, add beside `WHILE_STOP`:

```ts
  const REPEAT_STOP = new Set<Token['type']>(['markRepeatWhile']);
```

Replace `case 'subgraphRepeat':` with:

```ts
      case 'markRepeat': {
        const body = parseBody(REPEAT_STOP);
        const close = expect('markRepeatWhile', '`%% repeat while`');
        const diamond = expect('decision', 'a `{"condition"}` decision node');
        return { id: newId(), kind: 'repeat', body, cond: diamond.cond, isLabel: close.label };
      }
```

- [ ] **Step 7: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS including `roundtrip.test.ts`.

- [ ] **Step 8: Commit**

```bash
git add src/mermaid/
git commit -m "Serialize repeat loops with a trailing diamond

The condition moves out of the %% repeat while marker and into a real
diamond, so the marker now carries only the loop-back label.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Convert `fork` to native fork bars, and retire the subgraph dialect

The last construct. When this lands, no `subgraph` token remains and `parseNested` can go.

**Files:**
- Modify: `src/mermaid/tokens.ts`, `src/mermaid/serialize.ts`, `src/mermaid/parse.ts`
- Test: `src/mermaid/tokens.test.ts`, `src/mermaid/serialize.test.ts`, `src/mermaid/parse.test.ts`

**Interfaces:**
- Consumes: `forkBar` token from Task 1; `parseBody` from Task 2.
- Produces: token members `{ type: 'markFork'; line: number }`, `{ type: 'markForkAgain'; line: number }`, `{ type: 'markEndFork'; line: number }`. After this task `parseNested` and the `end-sub` token no longer exist.

- [ ] **Step 1: Write the failing tests**

In `src/mermaid/tokens.test.ts`, add:

```ts
test('reads the fork markers', () => {
  expect(tokenize('%% fork')[0]).toMatchObject({ type: 'markFork' });
  expect(tokenize('%% fork again')[0]).toMatchObject({ type: 'markForkAgain' });
  expect(tokenize('%% end fork')[0]).toMatchObject({ type: 'markEndFork' });
});

test('a bare `end` is no longer a token of this dialect', () => {
  expect(tokenize('end')[0]).toMatchObject({ type: 'unsupported' });
});
```

In `src/mermaid/serialize.test.ts`, replace the remaining `serializes while, repeat, and fork` test with:

```ts
test('serializes a fork as split and join bars', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'fork', branches: [
      [{ id: '2', kind: 'action', label: 'left' }],
      [{ id: '3', kind: 'action', label: 'right' }],
    ] },
  ]};
  expect(serialize(doc)).toContain(
    '%% fork\nn1@{ shape: fork }\n  n1 --> n2\n  n2["left"]\n%% fork again\n  n1 --> n3\n  n3["right"]\n'
    + '%% end fork\njoin_n1@{ shape: fork }\nn2 --> join_n1\nn3 --> join_n1\n',
  );
});
```

In `src/mermaid/parse.test.ts`, replace `parses loops and fork` with:

```ts
test('parses loops and fork', () => {
  const doc = ok(
    'start(("start"))\n'
    + '%% while\nw{"m?"}\n%% do (yes)\n  r["r"]\n%% endwhile (no)\n'
    + '%% repeat\n  p["p"]\n%% repeat while (yes)\nrw{"a?"}\n'
    + '%% fork\nf@{ shape: fork }\n  l["l"]\n%% fork again\n  r2["r"]\n%% end fork\njoin_f@{ shape: fork }\n',
  ).doc;
  expect(doc.body.map((b) => b.kind)).toEqual(['while', 'repeat', 'fork']);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mermaid/`
Expected: FAIL.

- [ ] **Step 3: Add the fork markers and drop the last subgraph tokens**

In `src/mermaid/tokens.ts`, remove `subgraphFork`, `subgraphForkAgain` and `end-sub` from the `Token` union and add:

```ts
  | { type: 'markFork'; line: number }
  | { type: 'markForkAgain'; line: number }
  | { type: 'markEndFork'; line: number }
```

Remove the `subgraphFork`, `subgraphForkAgain` and `endSub` entries from `RE` and add — `markForkAgain` before `markFork`:

```ts
  markForkAgain: /^%%\s*fork\s+again$/i,
  markFork:      /^%%\s*fork$/i,
  markEndFork:   /^%%\s*end\s+fork$/i,
```

Delete the `subgraphFork`, `subgraphForkAgain` and `endSub` dispatch blocks — a bare `end` now falls through to `unsupported`, which is correct: it is old-dialect syntax. Add:

```ts
    if (RE.markForkAgain.test(t)) { out.push({ type: 'markForkAgain', line }); continue; }
    if (RE.markFork.test(t)) { out.push({ type: 'markFork', line }); continue; }
    if (RE.markEndFork.test(t)) { out.push({ type: 'markEndFork', line }); continue; }
```

- [ ] **Step 4: Update the file-header comment**

The block comment at the top of `src/mermaid/tokens.ts` describes the subgraph dialect and is now wrong. Replace it with:

```ts
/**
 * This app's canonical Mermaid dialect is line-oriented. The graph itself is ordinary,
 * idiomatic Mermaid — `id["label"]` actions, `id{"cond"}` diamonds, `id@{ shape: fork }`
 * bars and labelled `-->` edges — so it renders correctly anywhere (Mermaid v11.3+, for
 * the fork bar). The document *tree* cannot be expressed by that graph, because an
 * elseif chain and a nested if produce identical topology, so it rides alongside as
 * inert `%%` markers: `%% if` / `%% then (l)` / `%% elseif` / `%% else (l)` / `%% endif`,
 * `%% while` / `%% do (l)` / `%% endwhile (l)`, `%% repeat` / `%% repeat while (l)`, and
 * `%% fork` / `%% fork again` / `%% end fork`. Every condition lives in the diamond that
 * follows its opening marker; markers carry only the labels. Comments are inert to any
 * renderer, so the file stays plain, valid, renderable Mermaid throughout.
 *
 * Because the markers are the structure, a `%%` comment that opens with a marker keyword
 * but does not match that marker's grammar is `malformed` rather than `cosmetic` — see
 * the reserved-keyword check below.
 */
```

- [ ] **Step 5: Rewrite the `fork` case of `emitBlock`**

Replace the whole `case 'fork':` block in `src/mermaid/serialize.ts` with:

```ts
    case 'fork': {
      const joinId = `join_${id}`;
      const lines = ['%% fork', `${id}@{ shape: fork }`];
      const tails: Tail[] = [];
      block.branches.forEach((col, i) => {
        if (i > 0) lines.push('%% fork again');
        const body = emitSeq(col, ctx);
        if (body.entry) body.lines.unshift(edgeLine(id, body.entry));
        lines.push(...indent(body.lines));
        tails.push(...body.tails);
      });
      lines.push('%% end fork', `${joinId}@{ shape: fork }`);
      for (const t of tails) lines.push(edgeLine(t.from, joinId, t.label));
      return { lines, entry: id, tails: [{ from: joinId }] };
    }
```

- [ ] **Step 6: Rewrite the `fork` case of `parseBlock` and delete `parseNested`**

In `src/mermaid/parse.ts`, add beside `REPEAT_STOP`:

```ts
  const FORK_STOP = new Set<Token['type']>(['markForkAgain', 'markEndFork']);
```

Replace `case 'subgraphFork':` with:

```ts
      case 'markFork': {
        expect('forkBar', 'a `@{ shape: fork }` split bar');
        const branches: Block[][] = [parseBody(FORK_STOP)];
        while (peek()?.type === 'markForkAgain') { next(); branches.push(parseBody(FORK_STOP)); }
        expect('markEndFork', '`%% end fork`');
        expect('forkBar', 'a `@{ shape: fork }` join bar');
        return { id: newId(), kind: 'fork', branches };
      }
```

Delete the `parseNested` function entirely — no caller remains.

- [ ] **Step 7: Add the empty-fork-branch test**

This is the Review Focus item for empty bodies. Add to `src/mermaid/serialize.test.ts`:

```ts
test('an empty fork branch emits no edge to nothing', () => {
  const doc: Doc = { preamble: [], body: [
    { id: '1', kind: 'fork', branches: [[], [{ id: '2', kind: 'action', label: 'right' }]] },
  ]};
  const out = serialize(doc);
  expect(out).toContain('%% fork\nn1@{ shape: fork }\n%% fork again\n  n1 --> n2\n');
  expect(out).not.toMatch(/n1 --> *$/m);
});
```

- [ ] **Step 8: Add the old-dialect refusal test**

This is the Review Focus item for old files. Add to `src/mermaid/parse.test.ts`:

```ts
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
```

- [ ] **Step 9: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS including `roundtrip.test.ts`. The dialect is now entirely marker-based.

- [ ] **Step 10: Commit**

```bash
git add src/mermaid/
git commit -m "Serialize forks as native fork bars and retire the subgraph dialect

Completes the marker conversion: no subgraph token remains and parseNested
is gone. Old-dialect files now refuse with the existing unsupported message.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Reserve the marker keywords

The comment carrier's central hazard: a misspelled marker silently degrading into an inert comment, so the parser fails at an unrelated line or succeeds with the wrong shape.

**Files:**
- Modify: `src/mermaid/tokens.ts`
- Test: `src/mermaid/tokens.test.ts`, `src/mermaid/parse.test.ts`

**Interfaces:**
- Consumes: every marker regex from Tasks 2–5.
- Produces: no new types. A reserved-but-malformed comment emits the existing `{ type: 'malformed'; kind: 'syntax'; ... }` token, which `parse.ts` already refuses on.

- [ ] **Step 1: Write the failing tests**

In `src/mermaid/tokens.test.ts`:

```ts
test('a misspelled marker is malformed, not silently cosmetic', () => {
  expect(tokenize('%% endwile')[0]).toMatchObject({ type: 'malformed', kind: 'syntax' });
  expect(tokenize('%% endif please')[0]).toMatchObject({ type: 'malformed' });
  expect(tokenize('%% fork twice')[0]).toMatchObject({ type: 'malformed' });
});

test('an ordinary comment is still preserved as cosmetic', () => {
  expect(tokenize('%% just a note to self')[0]).toMatchObject({ type: 'cosmetic' });
  expect(tokenize('%% elsewhere in the file')[0]).toMatchObject({ type: 'cosmetic' });
  expect(tokenize('%% title Fixture')[0]).toMatchObject({ type: 'cosmetic' });
});

test('note handling keeps precedence over the reserved keywords', () => {
  expect(tokenize('%% note left\n%% body\n%% end note')[0]).toMatchObject({ type: 'note' });
});
```

In `src/mermaid/parse.test.ts`:

```ts
test('a misspelled marker aborts the import naming its line', () => {
  const r = parse('start(("start"))\n%% if\nx{"c?"}\n%% then (yes)\n  a["A"]\n%% endif please\n');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.line).toBe(6);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/mermaid/tokens.test.ts src/mermaid/parse.test.ts`
Expected: FAIL — the misspelled markers currently tokenize as `cosmetic`.

- [ ] **Step 3: Add the reserved-keyword check**

In `src/mermaid/tokens.ts`, add to `RE`:

```ts
  reserved: /^%%\s*(?:if|then|elseif|else|endif|while|do|endwhile|repeat\s+while|repeat|fork\s+again|fork|end\s+fork)\b/i,
```

Then, in `tokenize`, immediately **above** the generic `%%`/`COSMETIC` fallback and **below** every marker and note dispatch:

```ts
    // Marker keywords are a reserved namespace. Without this, `%% endwile` would fall
    // through to `cosmetic` and be silently dropped, leaving the parser to fail at an
    // unrelated line -- or, worse, to succeed with the wrong tree.
    if (RE.reserved.test(t)) {
      out.push({ type: 'malformed', kind: 'syntax', line,
        message: `\`${raw.trim()}\` looks like a structure marker but is not one.` });
      continue;
    }
```

Placement matters in both directions: `%% note`, `%% end note` and the `%%{...}%%` directives are dispatched earlier and so keep their meaning, and `%% elsewhere` fails the `\b` after `else` and stays cosmetic.

- [ ] **Step 4: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mermaid/
git commit -m "Reserve the marker keywords so a typo cannot degrade to a comment

A %% comment opening with a marker keyword but not matching its grammar is
now malformed, which the parser refuses, instead of silently cosmetic.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Rewrite the e2e fixtures and assertions

`README.md` warns that anything spatial needs an end-to-end test, because jsdom has no layout. These assertions are what catch the text panel and the canvas drifting apart.

**Files:**
- Modify: `e2e/fixtures/simple.mmd`, `e2e/fixtures/terminator.mmd`, `e2e/editor.spec.ts:248`, `e2e/editor.spec.ts:323`, `e2e/editor.spec.ts:362`
- Leave alone: `e2e/fixtures/partition.mmd` (the deliberately unparseable fixture)

**Interfaces:**
- Consumes: the finished dialect from Tasks 1–6.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Rewrite `e2e/fixtures/simple.mmd`**

```
flowchart TD
%% title Fixture
start(("start"))
start --> a1
a1["Receive order"]
a1 --> d1
%% if
d1{"In stock?"}
%% then (yes)
  d1 -- yes --> s1
  s1["Ship it"]
%% else (no)
  d1 -- no --> b1
  b1["Backorder"]
%% endif
s1 --> stop1
b1 --> stop1
stop1(("stop"))
```

- [ ] **Step 2: Rewrite `e2e/fixtures/terminator.mmd`**

```
flowchart TD
start(("start"))
start --> d1
%% if
d1{"bread in the house?"}
%% then (No)
  d1 -- No --> g1
  g1["Go to bakery"]
  %% note right: And buy bread
%% else (Yes)
  d1 -- Yes --> s1
  s1(("stop"))
%% endif
g1 --> e1
e1(("end"))
```

- [ ] **Step 3: Verify both fixtures parse**

Run: `npx vitest run src/mermaid/` after adding this temporary check to `src/mermaid/parse.test.ts`, then keep it — it is cheap and guards the fixtures against drift:

```ts
test('both e2e fixtures parse in the current dialect', async () => {
  const fs = await import('node:fs/promises');
  for (const name of ['simple', 'terminator']) {
    const text = await fs.readFile(new URL(`../../e2e/fixtures/${name}.mmd`, import.meta.url), 'utf8');
    expect(parse(text).ok, name).toBe(true);
  }
});
```

- [ ] **Step 4: Update the three e2e assertions**

`e2e/editor.spec.ts:248` — the action must land in the `if` arm, not the `else` arm:

```ts
  expect(text).toMatch(/%% if\n\w+\{"condition\?"\}\n%% then \(yes\)\n\s+\w+ -- yes --> \w+\n\s+\w+\["action"\]/);
```

`e2e/editor.spec.ts:323` — an added else arm is empty:

```ts
    /%% if\n\w+\{"condition\?"\}\n%% then \(yes\)\n\s+\w+ -- yes --> \w+\n\s+\w+\["action"\]\n%% else \(no\)\n%% endif/,
```

`e2e/editor.spec.ts:362` — both arms hold an action:

```ts
    /%% then \(yes\)\n\s+\w+ -- yes --> \w+\n\s+\w+\["action"\]\n%% else \(no\)\n\s+\w+ -- no --> \w+\n\s+\w+\["action"\]\n%% endif/,
```

- [ ] **Step 5: Run the e2e suite**

Run: `npx playwright install chromium` (once, if not already installed), then `npm run e2e`
Expected: PASS. If the `terminator.mmd` geometry test fails, the fixture's `else` arm no longer holds the `stop` terminator — re-check Step 2 against the original fixture.

- [ ] **Step 6: Commit**

```bash
git add e2e/ src/mermaid/parse.test.ts
git commit -m "Rewrite e2e fixtures and assertions for the marker dialect

Adds a unit test that both fixtures parse, so they cannot drift from the
dialect without the fast suite noticing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Update the prose — README, palette hints, stale comments

The README's "one thing to understand first" is the project's main explanation of itself and currently describes a dialect that no longer exists.

**Files:**
- Modify: `README.md`, `src/ui/Palette.tsx:9-10`, `src/mermaid/testing/arbitrary.ts`
- Test: `src/ui/Palette.test.tsx` (check whether it asserts on the hint strings)

**Interfaces:**
- Consumes: the finished dialect.
- Produces: nothing.

- [ ] **Step 1: Check whether the palette hints are asserted on**

Run: `grep -n "subgraph" src/ui/Palette.test.tsx src/ui/Palette.tsx`
If the test asserts the hint text, update it in the same step as the component.

- [ ] **Step 2: Update the palette hints**

In `src/ui/Palette.tsx`, the `while` and `repeat` entries read `hint: 'while (subgraph)'` and `hint: 'repeat (subgraph)'`. Change them to `hint: 'while (loop)'` and `hint: 'repeat (loop)'`.

- [ ] **Step 3: Correct the stale comment in the generator**

In `src/mermaid/testing/arbitrary.ts`, the long comment above `SINGLE_LINE_WORDS` justifies the single-line restriction by pointing at subgraph titles. The generator logic does not change; replace that comment's reasoning with:

```ts
// A marker (`%% then (yes)`, `%% endwhile (no)`) is exactly one physical line and has no
// escape or continuation syntax, so a newline in a thenLabel/elseLabel/isLabel/endLabel is
// not expressible in this dialect. Conditions now live in a quoted diamond label and could
// in principle carry a `<br/>`, but the inline editor that produces them is a single-line
// HTML <input>, so a user can never type one -- the generator keeps them single-line to
// match what the app can actually produce.
```

- [ ] **Step 4: Rewrite the README's dialect section**

In `README.md`, replace the three bullets under "The one thing to understand first" (the `subgraph`-per-construct bullet, the closing-label bullet and the real-`-->`-edges bullet) with:

```markdown
- The graph itself is ordinary, idiomatic Mermaid: `id["label"]` actions, `id{"cond"}`
  diamonds with labelled `-- yes -->` edges, and `id@{ shape: fork }` bars. It renders
  correctly in any Mermaid renderer — GitHub, mermaid.live, and so on. **The fork bar
  needs Mermaid v11.3.0+**; everything else is core syntax.
- The document *tree* cannot be recovered from that graph, because an `elseif` chain and
  a nested `if` produce identical topology and an empty branch produces no edge at all.
  So the tree rides alongside as inert `%%` markers — `%% if` / `%% then (l)` /
  `%% elseif` / `%% else (l)` / `%% endif`, `%% while` / `%% do (l)` / `%% endwhile (l)`,
  `%% repeat` / `%% repeat while (l)`, `%% fork` / `%% fork again` / `%% end fork`.
  Every condition lives in the diamond following its opening marker; markers carry only
  labels. Comments are inert to any renderer, so the file stays plain, valid Mermaid.
- This app's parser **never reads edges** — it reconstructs the tree purely from markers
  and node shapes, the same way the PlantUML parser reads keywords rather than arrows.
  Because the markers *are* the structure, a `%%` comment that opens with a marker
  keyword but does not match that marker's grammar is refused rather than treated as an
  ordinary comment.
```

- [ ] **Step 5: Update the README's round-trip paragraph**

Further down, the paragraph describing `roundtrip.test.ts` ends "...the subgraph/comment dialect above actually holds together". Change "the subgraph/comment dialect" to "the marker dialect".

- [ ] **Step 6: Run everything**

Run: `npm test && npm run typecheck && npm run e2e`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add README.md src/ui/ src/mermaid/testing/arbitrary.ts
git commit -m "Document the marker dialect

Rewrites the README's dialect explanation, drops the subgraph wording from
the palette hints, and corrects the generator's stale rationale comment.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```
