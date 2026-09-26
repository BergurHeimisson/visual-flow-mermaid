# visual-flow-mermaid

A drag-and-drop editor for flowcharts, backed by **Mermaid** notation instead of PlantUML.
Build a flowchart on a canvas, watch the Mermaid text write itself in a panel beside it, and
open or save real `.mmd` files. This is a Mermaid-flavoured sibling of
[visual-flow-plantuml](../visual-flow-plantuml) — same canvas, same drag-and-drop, same
document model; only the text format changed.

## The one thing to understand first

The app's document model is still a **tree, not a graph** — exactly like the PlantUML
version, and for the same reason: the user edits structure (an `if`'s branches, a loop's
body, a fork's parallel columns) and the app computes layout and arrows. You cannot drop a
shape at an arbitrary position or draw an arrow between any two boxes.

Mermaid's own flowchart syntax, unlike PlantUML activity syntax, has no nesting keywords —
it's a plain graph of `id[shape]` nodes and `A --> B` edges. To keep the tree faithfully
round-trippable through **valid, renderable** Mermaid, this app defines its own canonical
dialect on top of standard flowchart syntax:

- `if`/`elseif`/`else`, `while`, `repeat`, and `fork`/`fork again` each become a
  `subgraph <id> ["<clause>"]` ... `end` block — nesting stands in for PlantUML's
  `endif`/`endwhile`/`end fork` keywords, and the bracketed title carries the same clause
  text those keywords used to carry (`if (cond) then (label)`, `while (cond) is (label)`).
- A label that PlantUML puts on a *closing* keyword — `endwhile (label)`, `repeat while
  (cond) is (label)` — and an attached note both have nowhere to live in valid Mermaid
  syntax, so they ride along as `%%` comments immediately after the construct. Comments are
  inert to any renderer, so the file stays plain, valid, renderable Mermaid throughout.
- Real `-->` edges connect consecutive nodes for correct rendering elsewhere (GitHub,
  mermaid.live, …), but this app's own parser never reads them — it reconstructs the tree
  purely from subgraph nesting, node shapes, and `%%` comments, the same way the PlantUML
  parser reads keywords rather than arrows. An empty branch therefore renders with no arrow
  leading into it — a minor, deliberate cosmetic gap, not a parsing concern.

Because the dialect is a fixed subset (like PlantUML's own accepted keyword spellings), a
`subgraph`/node shape this app doesn't recognise is refused on import rather than silently
dropped — see "Opening existing `.mmd` files" below.

## What you can do

Eight constructs: **action**, **decision** (`if`/`elseif`/`else`), **while loop**,
**repeat loop**, **fork**, **stop**, **end**, and **note**.

- **Add** — click a palette item to insert after your selection, or drag it onto a gap.
- **Fill an empty branch** — empty arms show a dashed placeholder; click it, then click a
  construct.
- **Move** — drag an existing block onto any gap. Moving a block into its own subtree is
  refused.
- **Edit text** — double-click a label, or press `Enter` on a selection. Branch labels
  (`yes`/`no`) are editable too.
- **Branches** — a selected decision or fork offers `add branch`, `add`/`remove else`, and
  `remove branch`.
- **Undo/redo** — `Cmd+Z` / `Cmd+Shift+Z`. Deleting has no confirmation dialog; undo covers it.
- **Deselect** — click empty canvas or press `Escape` (useful before a screenshot).
- **Files** — `Open` / `Save` / `Save As`, plus `Cmd+S`. Your work autosaves, so a refresh
  never loses it.
- **Theme** — dark by default, with a toggle; the choice persists.

There is deliberately no PNG/SVG export — take a screenshot, or paste the Mermaid text into
a renderer of your choice.

## Opening existing `.mmd` files

The rule is **refuse, don't mangle**. A diagram that looks right but means something
different is the worst possible outcome, so the parser distinguishes two cases:

- **Structures it cannot represent** — a foreign/unrecognised `subgraph`, an unsupported
  node shape, more than one `flowchart` declaration, or any line the tokenizer doesn't
  recognise at all. These **abort the import**, naming the line and the construct. Your open
  diagram is left untouched. In practice this means the app can reliably reopen files it
  wrote itself, or files handwritten to its dialect — not arbitrary Mermaid diagrams scraped
  from elsewhere, which is the same limitation the PlantUML version has for arbitrary
  `.puml` files using constructs it doesn't model.
- **Cosmetic directives** — `%%{...}%%` config directives, `classDef`/`style`/`click`/
  `linkStyle` lines, and any other `%%` comment. Anything before the `start` node is
  preserved verbatim and written back on save, so opening and saving someone's file never
  destroys their `classDef` block.

## Running it

Requires Node (developed on v26).

```bash
npm install
npm run dev        # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run preview` | Serve the built output |
| `npm test` | Unit + component tests (Vitest, jsdom) |
| `npm run test:watch` | The same, in watch mode |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run e2e` | End-to-end tests (Playwright, Chromium) |

`npm run e2e` needs a browser once: `npx playwright install chromium`. It starts its own
dev server, so don't run it against a port you are already using.

**File open/save uses the File System Access API**, which is Chromium-only. Elsewhere it
falls back to an upload dialog and a download. Append `?nofsa=1` to force the fallback —
the e2e tests use this, since the native picker cannot be scripted.

## How it is built

React 19 + TypeScript + Vite, Tailwind CSS v4 (CSS-first `@theme`, no config file).

The design is a **pure core with a thin shell**. These three directories contain no React
and never touch the DOM — text measurement is injected as a callback — which is what makes
the hard parts testable with plain values:

```
src/model/      the document tree, path addressing, and edit operations
src/mermaid/    serializer, tokenizer, recursive-descent parser
src/layout/     two-pass measure/place engine -> boxes, edges, drop zones
src/canvas/     SVG renderer, pointer-event dragging, inline editor
src/state/      useReducer document container with an undo stack, autosave
src/ui/         palette, toolbar, text panel, file I/O, dialogs
```

Dependencies point one way only: `model` ← `layout` ← `canvas`/`ui`/`state`.

The headline test is a property test in `src/mermaid/roundtrip.test.ts`: for 200 generated
documents, `parse(serialize(doc))` must equal `doc` modulo ids. It is what stops the
serializer and parser drifting apart, and it is the primary evidence that the subgraph/
comment dialect above actually holds together across every construct, including nested and
awkward shapes.

### A note for anyone changing the layout engine

Several bugs in this project's history were invisible to jsdom and obvious in a browser —
drop zones and edge labels rendered outside the SVG's `viewBox`, a click target too small to
hit, an SVG element that could never start an HTML5 drag. jsdom has no layout and never
clips, so a unit test can prove a handler works while a user cannot reach it.

So: **anything spatial needs an end-to-end test.** And when changing `layout.ts`, keep the
measure and place passes in agreement — if one reserves space the other doesn't consume,
every following sibling shifts.
