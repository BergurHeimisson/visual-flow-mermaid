# Idiomatic Mermaid dialect: diamonds and labelled edges

Date: 2026-09-26
Status: approved, ready for planning

## Problem

The app's canonical dialect is a mechanical transcription of PlantUML's activity
keywords rather than a translation into Mermaid. Every control-flow construct is
emitted as a `subgraph` whose bracketed title carries the PlantUML clause text
verbatim:

```
subgraph if_a ["if (In stock?) then (yes)"]
  s1["Ship it"]
end
subgraph else_a ["else (no)"]
  b1["Backorder"]
end
```

This is *valid* Mermaid and it renders, but it renders as two captioned grey
boxes. There is no diamond and no `yes`/`no` on any arrow. A reader who knows
Mermaid sees a container, not a decision. The output of a flowchart editor
should look like a flowchart in the renderer people actually paste it into.

The obstacle is that subgraph nesting is load-bearing. `README.md` states the
contract: the parser never reads arrows and rebuilds the document tree purely
from subgraph nesting, node shapes and `%%` comments. `src/mermaid/roundtrip.test.ts`
property-tests `parse(serialize(doc)) === doc` over 200 generated documents.
Flat diamonds and labelled edges carry no nesting, so the tree needs a new home.

## Goals

- Every construct emits idiomatic Mermaid: diamonds (`n{"cond"}`) with labelled
  edges (`n -- yes --> m`) for `if`, `while` and `repeat`; native fork bars
  (`n@{ shape: fork }`) for `fork`.
- The exact round-trip guarantee survives unchanged. `roundtrip.test.ts` keeps
  its current code and its current strength.
- "Refuse, don't mangle" still holds, and is extended to cover the new carrier.

## Non-goals

- Reading arbitrary third-party Mermaid. The dialect stays a fixed subset.
- A backwards-compatible reader for the old subgraph dialect (see Migration).
- Changing the document model, the layout engine or the canvas. This change is
  confined to `src/mermaid/`, the e2e fixtures, two palette strings and the README.
- Changing the `start`/`stop`/`end` terminator syntax, which is already fine.
- PNG/SVG export, still deliberately absent.

## Decisions taken

Three alternatives were considered for where the tree lives once subgraphs are
gone.

**A. Structure rides in `%%` comments — chosen.** The graph becomes fully
idiomatic; inert comments mark the tree. This is the trick the codebase already
uses for `endwhile` labels and notes, so the parser keeps its existing rule
(read comments and node shapes, never arrows) and the round-trip property test
survives untouched. Cost: structural comments in every file, and a hand-written
file must carry them.

**B. Pure graph, recover the tree from topology.** No structural comments; the
parser recovers structure by post-dominator analysis. Rejected: `if A / elseif B
/ else C` and `if A / else { if B else C }` produce byte-identical graphs, and
an empty branch emits no arrow at all. The model distinguishes these cases and
the graph cannot, so the headline property test would weaken from "equal" to
"equal after normalisation" and reopening a file could silently reshape it.

**C. Diamond inside the subgraph.** Smallest diff, but every branch still
renders inside a grey box, so it does not solve the stated problem.

Fork bars require Mermaid v11.3.0+. Accepted: emitted files target v11.3+.

## The dialect

Structure moves from `subgraph`/`end` to `%%` markers. One marker opens each
clause; the condition lives in the diamond that immediately follows its marker,
so no text is duplicated between marker and node. Construct bodies stay
indented — cosmetic to Mermaid, trimmed by the tokenizer, and it preserves the
visual nesting the subgraphs gave for free.

| Construct | Marker sequence | Model fields carried by markers |
| --- | --- | --- |
| `if` | `%% if` · `%% then (l)` · `%% elseif` · `%% else (l)` · `%% endif` | `thenLabel`, `elseLabel` |
| `while` | `%% while` · `%% do (l)` · `%% endwhile (l)` | `isLabel`, `endLabel` |
| `repeat` | `%% repeat` · `%% repeat while (l)` | `isLabel` |
| `fork` | `%% fork` · `%% fork again` · `%% end fork` | none |

Every `cond` comes from a diamond node, never from a marker. A label is omitted
from its marker entirely when the model field is `undefined`, matching the
existing `opt()` behaviour.

### Worked example

```
flowchart TD
start(("start"))
start --> n1
n1["Receive order"]
n1 --> n2
%% if
n2{"In stock?"}
%% then (yes)
  n2 -- yes --> n3
  n3["Ship it"]
%% else (no)
  n2 -- no --> n4
  n4["Backorder"]
%% endif
n3 --> n5
n4 --> n5
n5["Invoice"]
n5 --> n6
%% while
n6{"more items?"}
%% do (yes)
  n6 -- yes --> n7
  n7["Pick item"]
  n7 --> n6
%% endwhile (no)
n6 -- no --> n8
%% fork
n8@{ shape: fork }
  n8 --> n9
  n9["Email customer"]
%% fork again
  n8 --> n10
  n10["Update stock"]
%% end fork
join_n8@{ shape: fork }
n9 --> join_n8
n10 --> join_n8
join_n8 --> n11
n11(("stop"))
```

### Three consequences

**`endLabel` finally renders.** Today `%% endwhile (no)` is a dead comment. It
becomes the label on the loop's exit arrow, so the field means something
visually for the first time.

**`repeat` loses a marker and `%% repeat while` changes meaning.** There is no
`%% endrepeat`: the `%% repeat while (label)` marker plus its trailing diamond
closes the construct. The existing marker carries `(cond) is (label)`; the cond
moves to the diamond and only the label stays.

**An `elseif` chain becomes real nested diamonds.** `n2 -- no --> n4{...}` is
what makes it render correctly, while `%% elseif` keeps it a flat `branches[]`
in the model on reopen. This is exactly the distinction alternative B lost.

## Module changes

### `src/mermaid/tokens.ts`

Removed token types: `subgraphIf`, `subgraphElseif`, `subgraphElse`,
`subgraphWhile`, `subgraphRepeat`, `subgraphFork`, `subgraphForkAgain`,
`end-sub`, `endwhileNote`, `repeatWhileNote`.

Added: two node tokens — `decision` (`^(\w+)\{"(.*)"\}$`) and `forkBar`
(`^(\w+)@\{\s*shape:\s*fork\s*\}$`) — plus one marker token per keyword in the
table above. `activity`, `start`, `stop`, `end`, `note` and `cosmetic` are
unchanged, as is the `unescape` handling of `<br/>` and `#quot;`.

Two rules carry real weight:

**Labelled edges must tokenize.** The current `RE.edge` accepts only `A --> B`.
It widens to cover `A -- text --> B` and `A -->|text| B`. The parser still
discards edge tokens, but if a labelled edge fell through to `unsupported` it
would abort the import of the app's own output.

**Marker keywords become a reserved namespace.** This is the one new hazard the
comment carrier introduces: the generic `%%` → `cosmetic` fallback would swallow
a misspelled `%% endwile` as an inert comment, and the parser would then fail at
an unrelated line or, worse, succeed with the wrong shape. Therefore a `%%`
comment opening with one of the reserved keyword phrases — `if`, `then`,
`elseif`, `else`, `endif`, `while`, `do`, `endwhile`, `repeat`, `repeat while`,
`fork`, `fork again`, `end fork` — but which does not match that marker's exact
grammar becomes `malformed`, not `cosmetic`. Unknown comments stay cosmetic and
preserved.

Two precedence rules make this unambiguous. Marker matching precedes the
cosmetic fallback. And `%% note`, `%% end note` and the `%%{...}%%` directives
keep their current precedence *above* the reserved check, so `%% end note` is
still a note terminator and never a malformed `end fork` — the reserved phrases
are matched whole, not by first word alone.

An `@{ shape: X }` where `X` is not `fork` becomes `unsupported`, consistent with
the existing treatment of any unrecognised node shape.

### `src/mermaid/parse.ts`

`parseNested()`, which reads until `end-sub`, is replaced by `parseBody(stopAt)`,
which reads blocks until it meets one of its own construct's closing markers.
Nesting works for free: a nested `%% if` is consumed by the recursive
`parseBlock()` along with its own `%% endif`, so the stop-set is only ever
consulted at block-start position — the same property `end-sub` relied on.

Per construct:

- `if` — marker, `decision`, `then`, body, zero or more (`elseif`, `decision`,
  `then`, body), optional (`else`, body), `endif`.
- `while` — marker, `decision`, `do`, body, `endwhile`.
- `repeat` — marker, body, `repeatWhile`, `decision`.
- `fork` — marker, `forkBar`, body, zero or more (`forkAgain`, body), `endFork`,
  `forkBar`.

The `Fail`/`expect` machinery, the preamble/ignored split and the top-level
refuse-don't-mangle scan are unchanged. Error messages are reworded to name
markers instead of subgraphs.

New error case: a `decision` or `forkBar` token at block-start position is a
syntax error reading "a `{...}` decision must follow `%% if`, `%% elseif`,
`%% while` or `%% repeat while`", rather than a generic `Unexpected decision`.

### `src/mermaid/serialize.ts`

- `Tail` gains a label: `{ from: string; label?: string }`, and `edgeLine` emits
  `from -- label --> to` when one is present. This is what lets a `while`'s exit
  arrow carry `endLabel` and an `else`-less `if` carry its last `no`.
- The preorder id counter is unchanged, preserving byte-identical idempotency.
- Entry ids simplify: an `if` or `while` entry is the diamond's own `n<k>`
  rather than `if_n<k>`.

Identifier scheme. The counter still allocates exactly one `n<k>` per block, so
every node a construct needs beyond its own must derive a deterministic id from
it — the requirement is only that the same tree shape yields the same ids on
every call:

| Node | Id |
| --- | --- |
| `if` first diamond, `while` diamond, `repeat` trailing diamond, `fork` split bar | the block's own `n<k>` |
| `if` diamond for elseif arm `i` (1-based) | `elseif_n<k>_<i>` |
| `fork` join bar | `join_n<k>` |

A `repeat`'s entry is its body's first node, not its diamond, so the block's
`n<k>` naming its diamond creates no conflict.
- `indent()` is retained for construct bodies.

Tail edges keep their current emission point. `emitSeq` flushes a construct's
pending tails immediately before the *next* sibling's lines, so an `if`'s join
edges appear after `%% endif` rather than inside the arm that produced them, as
in the worked example above. A loop's back edge is different: it is emitted by
the loop block itself, from its own body's tails, and so sits inside the body.

An `else`-less `if` emits its fall-through edge from the last diamond
**unlabelled**. `elseLabel` is only ever set alongside an `elseBody` (`edits.ts`
sets and clears the two together), and a labelled fall-through would have no
marker to be read back from, which would break the round trip.

Two empty-body cases must be pinned down. An empty `repeat` body has no first
node, so the construct's entry falls back to its trailing diamond and the back
edge is omitted rather than pointing the diamond at itself.

An empty `if` arm has no node to carry the flow onward, so **the diamond itself
becomes the arm's tail**: the arm's labelled arrow runs straight to whatever
follows the decision, and a decision with two empty arms passes through on both
labels. An empty `fork` column behaves the same way, connecting the split bar
straight to the join bar.

*(Amended after approval, at the user's request. The original text here omitted
the edge entirely, preserving the dead-end arm the old subgraph dialect had and
which `README.md` documented as a deliberate cosmetic gap. Tails affect only
edges, which the parser discards, so the round trip is unaffected either way.)*

## Testing

Test-driven, red first.

`src/mermaid/roundtrip.test.ts` is the net and **its code does not change**: 200
generated documents, `parse(serialize(doc))` equal to `doc` modulo ids, plus the
byte-identical idempotency check. It goes red the moment the serializer moves and
returns green only when serializer and parser agree again. `testing/arbitrary.ts`
generates model values, so it is untouched.

Rewritten construct by construct: `serialize.test.ts`, `parse.test.ts`,
`tokens.test.ts`.

New cases:

- Both labelled-edge input forms tokenize as `edge` and are discarded.
- A misspelled structural keyword produces `malformed`, not `cosmetic`.
- An unknown `%%` comment is still preserved as `cosmetic`.
- A bare `decision` at block-start position is a syntax error.
- `@{ shape: cyl }` is `unsupported`.
- Empty `repeat` body; empty `if` branch.
- `endLabel` appears on the while's exit edge.

## Fallout

- `e2e/fixtures/simple.mmd` and `e2e/fixtures/terminator.mmd` are rewritten in
  the new dialect. `e2e/fixtures/partition.mmd` is the deliberately unparseable
  fixture and stays as it is.
- `e2e/editor.spec.ts` asserts on `subgraph if_… ["if (condition?) then (yes)"]`
  in three places; those patterns are replaced.
- `src/ui/Palette.tsx` hints read `while (subgraph)` and `repeat (subgraph)`.
- `src/model/edits.test.ts` asserts only that an empty optional label serializes
  without `()`, which still holds.
- `README.md`'s "The one thing to understand first" section describes the
  subgraph dialect and is rewritten around markers, along with the Mermaid
  v11.3+ requirement for fork bars.

## Migration

No backwards-compatible reader for the old dialect: one commit of history, no
files in the wild, and a dual-dialect parser would double the surface the
round-trip test has to cover.

Consequences, stated plainly:

- **An existing autosave is lost.** `loadAutosave` parses localStorage and
  returns `null` on failure, so an old-dialect autosave silently becomes an empty
  document on the first load after this lands. No crash and no corruption, but
  unsaved browser work should be saved to a file first.
- **Old `.mmd` files on disk fail loudly and correctly**, with the existing
  "subgraph is not supported in this version" refusal, leaving the open diagram
  untouched.

## Risks

- **A misspelled marker degrading to a comment** is the main new failure mode.
  The reserved-keyword rule is the mitigation and needs direct test coverage.
- **Fork bars need Mermaid v11.3.0+.** Files will not render correctly on older
  deployments. Accepted deliberately; recorded in the README.
- **Anything spatial needs an end-to-end test.** This change does not touch
  `layout.ts`, but the e2e assertions it does touch are the ones that catch
  drift between the text panel and the canvas.
