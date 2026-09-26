import type { Block, Branch, Doc } from '../model/types';

const IND = '  ';

/** Where a construct's outgoing edge starts, and what the arrow is labelled. For `if` and
 *  `while` that is the diamond itself (an unmatched arm, or the loop's exit); for `repeat`
 *  the trailing diamond; for `fork` the join bar. The label is the model's own — a while's
 *  `endLabel`, a branch's `thenLabel` — or absent where the model has none. */
type Tail = { from: string; label?: string };

type SeqResult = { lines: string[]; entry?: string; tails: Tail[] };

function opt(label: string | undefined): string {
  return label === undefined ? '' : ` (${label})`;
}

/** Quote text for a Mermaid node label: `"` and newlines are the two characters
 *  that would otherwise break out of the quoted form. */
function q(text: string): string {
  return `"${text.replace(/"/g, '#quot;').replace(/\n/g, '<br/>')}"`;
}

/** A label safe to sit bare between `--` and `-->`. Deliberately excludes `-`: Mermaid
 *  reserves `--`, `-->`, `--o` and friends inside an unquoted label, so `wait--retry`
 *  emitted bare would be a link token sitting inside a link. Anything outside this class
 *  goes through the quoted `-->|"..."|` form. Both forms tokenize back to the same `edge`
 *  token, which the parser discards, so the choice only affects what a renderer shows. */
const SIMPLE_LABEL = /^[\w ?!.,']+$/;

/** Quote text for the `-->|"..."|` edge form. That form is delimited by `|`, so a literal
 *  pipe has to become its entity code or it closes the region early — `q()` alone is not
 *  enough here, since it only handles `"` and newlines. */
function qEdge(text: string): string {
  return q(text.replace(/\|/g, '#124;'));
}

function edgeLine(from: string, to: string, label?: string): string {
  if (label === undefined) return `${from} --> ${to}`;
  return SIMPLE_LABEL.test(label)
    ? `${from} -- ${label} --> ${to}`
    : `${from} -->|${qEdge(label)}| ${to}`;
}

/** Several arms can converge on one target carrying the same label — two empty arms of a
 *  decision, or two empty fork columns, which is what the palette's default fork is. Each
 *  would otherwise emit a byte-identical edge and Mermaid would draw it twice. */
function edgeLines(tails: Tail[], to: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tails) {
    const key = JSON.stringify([t.from, t.label ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(edgeLine(t.from, to, t.label));
  }
  return out;
}

function indent(lines: string[]): string[] {
  return lines.map((l) => IND + l);
}

function noteLines(note: { side: 'left' | 'right'; text: string }): string[] {
  if (note.text.includes('\n')) {
    return [`%% note ${note.side}`, ...note.text.split('\n').map((l) => `%% ${l}`), '%% end note'];
  }
  return [`%% note ${note.side}: ${note.text}`];
}

function emitSeq(seq: Block[], ctx: { n: number }): SeqResult {
  const lines: string[] = [];
  let entry: string | undefined;
  let pending: Tail[] = [];

  for (const block of seq) {
    const b = emitBlock(block, ctx);
    lines.push(...edgeLines(pending, b.entry));
    lines.push(...b.lines);
    if (entry === undefined) entry = b.entry;
    pending = b.tails;
  }
  return { lines, entry, tails: pending };
}

/**
 * The Mermaid node id for a block is NOT its own `NodeId` — a block's `NodeId` is
 * freshly random on every import (see `model/ids.ts`), and the id chosen here has to survive
 * a round trip byte-for-byte (`roundtrip.test.ts`'s idempotency check) so long as the tree's
 * *shape* is unchanged. A plain preorder counter, reset per `serialize()` call, gives every
 * block the same id every time it's serialized, regardless of what its actual `NodeId` was.
 */
function nextId(ctx: { n: number }): string {
  ctx.n += 1;
  return `n${ctx.n}`;
}

function emitBlock(block: Block, ctx: { n: number }): { lines: string[]; entry: string; tails: Tail[] } {
  const id = nextId(ctx);

  switch (block.kind) {
    case 'action': {
      const lines = [`${id}[${q(block.label)}]`, ...(block.note ? noteLines(block.note) : [])];
      return { lines, entry: id, tails: [{ from: id }] };
    }
    case 'stop':
      return { lines: [`${id}((${q('stop')}))`], entry: id, tails: [] };
    case 'end':
      return { lines: [`${id}((${q('end')}))`], entry: id, tails: [] };
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
        if (body.entry) {
          body.lines.unshift(edgeLine(dId, body.entry, branch.thenLabel));
          tails.push(...body.tails);
        } else {
          // An empty arm has no node to carry the flow onward, so the diamond itself is the
          // tail: the arm's labelled arrow runs straight to whatever follows the decision,
          // instead of the arm rendering as a dead end.
          tails.push({ from: dId, label: branch.thenLabel });
        }
        lines.push(...indent(body.lines));
        lastDiamond = dId;
      });
      if (block.elseBody) {
        lines.push(`%% else${opt(block.elseLabel)}`);
        const body = emitSeq(block.elseBody, ctx);
        if (body.entry) {
          body.lines.unshift(edgeLine(lastDiamond, body.entry, block.elseLabel));
          tails.push(...body.tails);
        } else {
          tails.push({ from: lastDiamond, label: block.elseLabel });
        }
        lines.push(...indent(body.lines));
      } else {
        // No else arm: the last diamond's "no" side always has somewhere live to go — see
        // layout.ts's `terminates()` for the same rule on the canvas side. It is unlabelled
        // because `elseLabel` only ever exists alongside an `elseBody` (see `edits.ts`), and
        // a labelled fall-through would have no marker to be read back from.
        tails.push({ from: lastDiamond });
      }
      lines.push('%% endif');
      return { lines, entry: id, tails };
    }
    case 'fork': {
      const joinId = `join_${id}`;
      const lines = [`%% fork (${block.branches.length})`, `${id}@{ shape: fork }`];
      const tails: Tail[] = [];
      block.branches.forEach((col, i) => {
        if (i > 0) lines.push('%% fork again');
        const body = emitSeq(col, ctx);
        if (body.entry) {
          body.lines.unshift(edgeLine(id, body.entry));
          tails.push(...body.tails);
        } else {
          // Same rule as an empty decision arm: an empty parallel column is a pass-through,
          // so the split bar connects straight to the join bar.
          tails.push({ from: id });
        }
        lines.push(...indent(body.lines));
      });
      lines.push('%% end fork', `${joinId}@{ shape: fork }`);
      lines.push(...edgeLines(tails, joinId));
      return { lines, entry: id, tails: [{ from: joinId }] };
    }
    case 'while': {
      const lines = ['%% while', `${id}{${q(block.cond)}}`, `%% do${opt(block.isLabel)}`];
      const body = emitSeq(block.body, ctx);
      if (body.entry) body.lines.unshift(edgeLine(id, body.entry, block.isLabel));
      body.lines.push(...edgeLines(body.tails, id));
      lines.push(...indent(body.lines));
      lines.push(`%% endwhile${opt(block.endLabel)}`);
      return { lines, entry: id, tails: [{ from: id, label: block.endLabel }] };
    }
    case 'repeat': {
      const lines = ['%% repeat'];
      const body = emitSeq(block.body, ctx);
      lines.push(...indent(body.lines));
      lines.push(`%% repeat while${opt(block.isLabel)}`);
      lines.push(`${id}{${q(block.cond)}}`);
      lines.push(...edgeLines(body.tails, id));
      // An empty body has no node to loop back to, so the back edge is omitted rather
      // than pointing the diamond at itself; the construct's entry is then the diamond.
      if (body.entry) lines.push(edgeLine(id, body.entry, block.isLabel));
      return { lines, entry: body.entry ?? id, tails: [{ from: id }] };
    }
  }
}

export function serialize(doc: Doc): string {
  const ctx = { n: 0 };
  const body = emitSeq(doc.body, ctx);
  const lines = ['flowchart TD', ...doc.preamble, 'start((' + q('start') + '))'];
  if (body.entry) lines.push(edgeLine('start', body.entry));
  lines.push(...body.lines);
  return [...lines, ''].join('\n');
}
