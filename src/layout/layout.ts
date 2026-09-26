import type { SeqPath } from '../model/paths';
import type { Block, Branch, Doc, EditField, NodeId } from '../model/types';
import { DEFAULT_METRICS, measureLabel, type Metrics, type MeasureText } from './metrics';

export type { MeasureText, Metrics, EditField };
export type BoxKind = 'start' | 'action' | 'stop' | 'end' | 'decision' | 'loop' | 'bar' | 'merge' | 'note';
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number };

export type Box = {
  id: string; kind: BoxKind; x: number; y: number; w: number; h: number;
  label?: string; blockId?: NodeId; field?: EditField; branchIndex?: number;
};
export type Edge = {
  id: string; points: Point[]; label?: string; labelAt?: Point; dashed?: boolean;
  blockId?: NodeId; field?: EditField; branchIndex?: number;
};
export type DropZone = {
  id: string; x: number; y: number; w: number; h: number; path: SeqPath; index: number;
  /**
   * True for the single zone `placeSeq` emits when its sequence is EMPTY. Every other zone
   * (the gaps around and between existing blocks) is drag-only, exactly as before — Canvas
   * renders only `persistent` zones outside a drag, as the always-visible placeholder an
   * empty branch needs to be selectable and clickable at all (see the module comment on
   * `placeSeq`).
   */
  persistent: boolean;
};
export type LayoutResult = { width: number; height: number; boxes: Box[]; edges: Edge[]; dropZones: DropZone[] };

/** Intrinsic size of a subtree. `spine` is the x of its through-line, relative to its own left edge. */
type Size = { w: number; h: number; spine: number; left: number; right: number };

type Ctx = { m: Metrics; measure: MeasureText; sizes: Map<string, Size> };

/** `left`/`right` are the extents either side of the spine, so siblings align on the spine, not on x. */
function size(w: number, h: number, spine: number): Size {
  return { w, h, spine, left: spine, right: w - spine };
}

/**
 * True when a sequence's flow has terminated — nothing serialized after it in the same
 * sequence, and no `merge`/`join`/back-edge, can ever be reached. Only the LAST block in the
 * sequence matters: an earlier `stop` would be dead code, but the parser/model don't forbid
 * it, so this only asks about the tail.
 *
 * Pure and structural (walks `Block`/`Branch` shapes only), so it lives here rather than in
 * `model` — see the module-level rule this implements in the bug report this file's `if`,
 * `fork`, `while`, and `repeat` cases were fixed against.
 */
export function terminates(seq: Block[]): boolean {
  if (seq.length === 0) return false;
  return blockTerminates(seq[seq.length - 1]);
}

function blockTerminates(block: Block): boolean {
  switch (block.kind) {
    case 'stop':
    case 'end':
      return true;
    case 'if':
      // No else arm means the diamond's "no" side always has somewhere live to go (straight
      // through to after `endif`), so an `if` without one can never count as terminated no
      // matter what every branch body does.
      return block.elseBody !== undefined
        && block.branches.every((b) => terminates(b.body))
        && terminates(block.elseBody);
    case 'fork':
      return block.branches.every((col) => terminates(col));
    default:
      return false;
  }
}

// ---------- pass 1: measure ----------

function measureBlock(block: Block, ctx: Ctx): Size {
  const { m } = ctx;
  let s: Size;

  switch (block.kind) {
    case 'action': {
      const label = measureLabel(block.label, ctx.measure, m);
      const w = Math.max(m.minBoxW, label.w + m.boxPadX * 2);
      const h = label.h + m.boxPadY * 2;
      s = size(w, h, w / 2);
      if (block.note) {
        const note = measureLabel(block.note.text, ctx.measure, m);
        const noteW = note.w + m.boxPadX * 2 + m.noteGap;
        const noteH = note.h + m.boxPadY * 2;
        // The slot must be tall enough for the taller of the action's own box and its note.
        s = block.note.side === 'right'
          ? { ...s, w: s.w + noteW, right: s.right + noteW, h: Math.max(h, noteH) }
          : { ...s, w: s.w + noteW, left: s.left + noteW, spine: s.spine + noteW, h: Math.max(h, noteH) };
      }
      break;
    }
    case 'stop':
    case 'end':
      s = size(m.capW, m.capH, m.capW / 2);
      break;
    case 'if': {
      const cascade = measureIfCascade(block.branches, block.elseBody, 0, ctx);
      const totalH = cascade.h + m.gapY + m.barH;
      s = size(cascade.w, totalH, cascade.w / 2);
      break;
    }
    case 'fork': {
      const { w, h } = measureColumns(block.branches, ctx);
      const totalH = m.barH + m.gapY + h + m.gapY + m.barH;
      s = size(w, totalH, w / 2);
      break;
    }
    case 'while': {
      const head = diamondSize(block.cond, ctx);
      const body = measureSeq(block.body, ctx);
      const spine = Math.max(head.w / 2, body.spine) + m.gutter;
      const right = Math.max(head.w / 2, body.right);
      s = {
        w: spine + right, spine, left: spine, right,
        h: head.h + m.gapY + body.h + m.gapY,
      };
      break;
    }
    case 'repeat': {
      const foot = diamondSize(block.cond, ctx);
      const body = measureSeq(block.body, ctx);
      const spine = Math.max(foot.w / 2, body.spine) + m.gutter;
      const right = Math.max(foot.w / 2, body.right);
      s = {
        w: spine + right, spine, left: spine, right,
        h: body.h + m.gapY + foot.h,
      };
      break;
    }
    default:
      // Guard: unreachable for real block kinds after Task 10.
      throw new Error(`measureBlock: unhandled kind ${(block as Block).kind}`);
  }

  ctx.sizes.set(block.id, s);
  return s;
}

/** Columns laid out side by side, separated by gapX, centred as a group on the parent spine. */
function measureColumns(cols: Block[][], ctx: Ctx): { sizes: Size[]; w: number; h: number } {
  const sizes = cols.map((c) => measureSeq(c, ctx));
  const w = sizes.reduce((acc, s) => acc + s.w, 0) + ctx.m.gapX * Math.max(0, cols.length - 1);
  const h = Math.max(0, ...sizes.map((s) => s.h));
  return { sizes, w, h };
}

function diamondSize(cond: string, ctx: Ctx): { w: number; h: number } {
  const label = measureLabel(cond, ctx.measure, ctx.m);
  return { w: label.w + ctx.m.diamondPadX * 2, h: label.h + ctx.m.diamondPadY * 2 };
}

/**
 * One link of an `if`/`elseif`/`else` cascade: a diamond for `branches[index]`, its "then"
 * column, and on its "no" side either the next diamond in the chain (recursively), the else
 * body (if this is the last branch), or nothing (last branch, no else). Excludes the trailing
 * merge gap/bar — only the top-level `if` case adds that, once, after the whole cascade.
 *
 * Shared by `measureBlock`'s 'if' case and `placeIfCascade` below so the two passes cannot
 * disagree on height — see the comment on `placeIfCascade` for the invariant this maintains.
 */
function measureIfCascade(branches: Branch[], elseBody: Block[] | undefined, index: number, ctx: Ctx): Size {
  const { m } = ctx;
  const head = diamondSize(branches[index].cond, ctx);
  const thenSize = measureSeq(branches[index].body, ctx);
  const hasNext = index + 1 < branches.length;
  const rightSize = hasNext
    ? measureIfCascade(branches, elseBody, index + 1, ctx)
    : elseBody !== undefined ? measureSeq(elseBody, ctx) : null;

  const cols = rightSize ? [thenSize, rightSize] : [thenSize];
  const rowW = cols.reduce((acc, c) => acc + c.w, 0) + m.gapX * Math.max(0, cols.length - 1);
  const rowH = Math.max(0, ...cols.map((c) => c.h));
  const totalW = Math.max(rowW, head.w);
  return size(totalW, head.h + m.gapY + rowH, totalW / 2);
}

/**
 * The width every drop zone is painted at (see `placeSeq`). It is a floor, not a measured
 * value, so a sequence must reserve at least this much room around its own spine or two
 * sibling columns' zones will overlap each other — see `measureSeq`.
 */
function zoneWidth(m: Metrics): number {
  return Math.max(m.minBoxW, 60);
}

/**
 * Every sequence reserves at least `zoneWidth` around its spine, whether it is empty or
 * merely narrow. Without this floor, two empty sibling columns measure to width 0 and end
 * up `gapX` (28px) apart while their drop zones are 80px wide: a 52px overlap in which the
 * later-painted zone swallows the earlier one's clicks, so filling in the first branch of a
 * fresh `if` or `fork` put the block in the wrong arm. A column of `stop` caps (24px) is the
 * same bug with a non-empty column, which is why the floor is applied to `left`/`right`
 * rather than only to the empty case.
 *
 * The empty-sequence stub keeps its `m.gapY` height: `placeSeq([])` consumes exactly one
 * gapY, and the two passes must agree on that or nested empty branches drift.
 */
function measureSeq(seq: Block[], ctx: Ctx): Size {
  const { m } = ctx;
  const half = zoneWidth(m) / 2;
  if (seq.length === 0) return size(half * 2, m.gapY, half);

  const sizes = seq.map((b) => measureBlock(b, ctx));
  const left = Math.max(half, ...sizes.map((s) => s.left));
  const right = Math.max(half, ...sizes.map((s) => s.right));
  const h = sizes.reduce((acc, s) => acc + s.h, 0) + m.gapY * (seq.length - 1);
  return { w: left + right, h, spine: left, left, right };
}

// ---------- pass 2: place ----------

type Out = { boxes: Box[]; edges: Edge[]; dropZones: DropZone[] };

/** Places columns left to right, centred as a group on `spineX`. Returns each column's spine x. */
function placeColumns(
  cols: Block[][], paths: SeqPath[], sizes: Size[], spineX: number, top: number, ctx: Ctx, out: Out,
): number[] {
  const total = sizes.reduce((acc, s) => acc + s.w, 0) + ctx.m.gapX * Math.max(0, cols.length - 1);
  let x = spineX - total / 2;
  const spines: number[] = [];
  cols.forEach((col, i) => {
    const colSpine = x + sizes[i].spine;
    spines.push(colSpine);
    placeSeq(col, paths[i], colSpine, top, ctx, out);
    x += sizes[i].w + ctx.m.gapX;
  });
  return spines;
}

/** A leaf column's spine x and the y its content ends at — every leaf needs its own edge down
 *  to the cascade's single shared merge point, UNLESS its own body already terminated the
 *  flow (`dead`), in which case no such edge is drawn — see `terminates` above. */
type CascadeLeaf = { x: number; bottomY: number; dead: boolean };

/**
 * Places one link of an `if`/`elseif`/`else` cascade (see `measureIfCascade`) and recurses into
 * the next link on the diamond's "no" side. Returns every leaf column placed so far (this
 * branch's "then" column, plus whatever the recursion or the else arm contributed), so the
 * caller can route them all to one shared merge box.
 *
 * `measureIfCascade(branches, elseBody, index, ctx).h` must equal, for every `index`, the
 * vertical span this function actually consumes here (its diamond down to the bottom of its
 * deepest leaf) — Task 8's review caught exactly this kind of measure/place drift for empty
 * sequences; the invariant is re-verified numerically for this shape in the Task 9 fix-round-1
 * report.
 */
function placeIfCascade(
  blockId: NodeId, branches: Branch[], elseBody: Block[] | undefined, elseLabel: string | undefined,
  index: number, spineX: number, top: number, ctx: Ctx, out: Out,
): CascadeLeaf[] {
  const { m } = ctx;
  const branch = branches[index];
  const head = diamondSize(branch.cond, ctx);
  out.boxes.push({
    id: `box:${blockId}:${index}`, kind: 'decision', blockId, field: 'cond', branchIndex: index,
    x: spineX - head.w / 2, y: top, w: head.w, h: head.h, label: branch.cond,
  });

  const thenSize = measureSeq(branch.body, ctx);
  const hasNext = index + 1 < branches.length;
  const rightSize = hasNext
    ? measureIfCascade(branches, elseBody, index + 1, ctx)
    : elseBody !== undefined ? measureSeq(elseBody, ctx) : null;

  const cols = rightSize ? [thenSize, rightSize] : [thenSize];
  const total = cols.reduce((acc, c) => acc + c.w, 0) + m.gapX * Math.max(0, cols.length - 1);
  const colTop = top + head.h + m.gapY;
  let x = spineX - total / 2;

  const thenSpine = x + thenSize.spine;
  const thenPath: SeqPath = [{ block: blockId, slot: 'branch', index }];
  placeSeq(branch.body, thenPath, thenSpine, colTop, ctx, out);
  out.edges.push({
    id: `branch:${blockId}:${index}`, blockId, field: 'thenLabel', branchIndex: index,
    label: branch.thenLabel,
    labelAt: branch.thenLabel === undefined ? undefined : { x: thenSpine, y: colTop - m.gapY / 2 },
    points: [{ x: spineX, y: top + head.h }, { x: thenSpine, y: colTop - m.gapY / 2 }, { x: thenSpine, y: colTop }],
  });
  const leaves: CascadeLeaf[] = [
    { x: thenSpine, bottomY: colTop + thenSize.h, dead: terminates(branch.body) },
  ];

  x += thenSize.w + m.gapX;

  if (rightSize) {
    const rightSpine = x + rightSize.spine;
    if (hasNext) {
      // The "no" side of this diamond leads straight into the next one in the chain — there's
      // no data field for it (Branch has no "not"/"no" label), so this connector carries no
      // field/label, unlike the then-edge and the final else-edge below.
      out.edges.push({
        id: `cascade:${blockId}:${index}`,
        points: [
          { x: spineX, y: top + head.h }, { x: rightSpine, y: colTop - m.gapY / 2 }, { x: rightSpine, y: colTop },
        ],
      });
      leaves.push(
        ...placeIfCascade(blockId, branches, elseBody, elseLabel, index + 1, rightSpine, colTop, ctx, out),
      );
    } else {
      const elsePath: SeqPath = [{ block: blockId, slot: 'else' }];
      placeSeq(elseBody!, elsePath, rightSpine, colTop, ctx, out);
      out.edges.push({
        id: `branch:${blockId}:else`, blockId, field: 'elseLabel',
        label: elseLabel,
        labelAt: elseLabel === undefined ? undefined : { x: rightSpine, y: colTop - m.gapY / 2 },
        points: [
          { x: spineX, y: top + head.h }, { x: rightSpine, y: colTop - m.gapY / 2 }, { x: rightSpine, y: colTop },
        ],
      });
      leaves.push({ x: rightSpine, bottomY: colTop + rightSize.h, dead: terminates(elseBody!) });
    }
  }

  return leaves;
}

function placeBlock(block: Block, spineX: number, top: number, ctx: Ctx, out: Out): void {
  const { m } = ctx;
  const s = ctx.sizes.get(block.id)!;

  switch (block.kind) {
    case 'action': {
      // `s.h` (from measureBlock) is the *slot* height — it may include a taller note.
      // The box itself always keeps its own intrinsic height, recomputed here rather than
      // read from `s`. Do not "deduplicate" these into one value: doing so reintroduces the
      // note-overlap bug, since the box must stay label-sized while the slot reserves room
      // for the note beside it.
      const label = measureLabel(block.label, ctx.measure, m);
      const w = Math.max(m.minBoxW, label.w + m.boxPadX * 2);
      const h = label.h + m.boxPadY * 2;
      out.boxes.push({
        id: `box:${block.id}`, kind: 'action', blockId: block.id, field: 'label',
        x: spineX - w / 2, y: top, w, h, label: block.label,
      });
      if (block.note) {
        const note = measureLabel(block.note.text, ctx.measure, m);
        const nw = note.w + m.boxPadX * 2;
        const nh = note.h + m.boxPadY * 2;
        const nx = block.note.side === 'right'
          ? spineX + w / 2 + m.noteGap
          : spineX - w / 2 - m.noteGap - nw;
        out.boxes.push({
          id: `note:${block.id}`, kind: 'note', blockId: block.id, field: 'note',
          x: nx, y: top, w: nw, h: nh, label: block.note.text,
        });
        const from = block.note.side === 'right' ? spineX + w / 2 : spineX - w / 2;
        const to = block.note.side === 'right' ? nx : nx + nw;
        const edgeY = top + h / 2;
        out.edges.push({
          id: `noteedge:${block.id}`, dashed: true, blockId: block.id,
          points: [{ x: from, y: edgeY }, { x: to, y: edgeY }],
        });
      }
      break;
    }
    case 'stop':
    case 'end':
      out.boxes.push({
        id: `box:${block.id}`, kind: block.kind, blockId: block.id,
        x: spineX - s.w / 2, y: top, w: m.capW, h: m.capH,
      });
      break;
    case 'if': {
      const leaves = placeIfCascade(
        block.id, block.branches, block.elseBody, block.elseLabel, 0, spineX, top, ctx, out,
      );
      // The merge box's y (and the height `measureBlock`'s 'if' case reserves for it) is
      // derived from ALL leaves' bottomY, terminated or not — a `stop`-ended column still
      // occupies its own vertical space in the cascade row, it just doesn't route an edge
      // onward. So the box is always drawn, at the same position, whether or not every
      // branch terminated (nothing can flow past it, but the space stays reserved for
      // whatever the document serializes after `endif` — see the bug report for the numbers
      // that confirm this against `measureBlock`).
      const mergeY = Math.max(...leaves.map((leaf) => leaf.bottomY)) + m.gapY;
      out.boxes.push({
        id: `merge:${block.id}`, kind: 'merge', blockId: block.id,
        x: spineX - m.capW / 2, y: mergeY, w: m.capW, h: m.barH,
      });
      leaves.forEach((leaf, i) => {
        if (leaf.dead) return;
        out.edges.push({
          id: `merge:${block.id}:${i}`, blockId: block.id,
          points: [{ x: leaf.x, y: leaf.bottomY }, { x: leaf.x, y: mergeY }, { x: spineX, y: mergeY }],
        });
      });
      break;
    }
    case 'fork': {
      const sizes = block.branches.map((c) => measureSeq(c, ctx));
      const total = sizes.reduce((acc, x) => acc + x.w, 0) + m.gapX * Math.max(0, block.branches.length - 1);
      const paths: SeqPath[] = block.branches.map((_, index) => [{ block: block.id, slot: 'branch' as const, index }]);

      out.boxes.push({
        id: `forkbar:${block.id}`, kind: 'bar', blockId: block.id,
        x: spineX - total / 2, y: top, w: total, h: m.barH,
      });
      const colTop = top + m.barH + m.gapY;
      const spines = placeColumns(block.branches, paths, sizes, spineX, colTop, ctx, out);

      const colH = Math.max(0, ...sizes.map((x) => x.h));
      const joinY = colTop + colH + m.gapY;
      out.boxes.push({
        id: `joinbar:${block.id}`, kind: 'bar', blockId: block.id,
        x: spineX - total / 2, y: joinY, w: total, h: m.barH,
      });

      // The join bar itself, like the `if` merge box, is always drawn at the same position —
      // space for every column (terminated or not) is already reserved by `measureBlock`'s
      // 'fork' case, which takes the max column height regardless of termination. Only the
      // per-column edge INTO the join bar is conditional: a column whose flow already
      // terminated (e.g. ends in `stop`) has nothing left to join.
      spines.forEach((cx, i) => {
        out.edges.push({ id: `forkin:${block.id}:${i}`, points: [{ x: cx, y: top + m.barH }, { x: cx, y: colTop }] });
        if (terminates(block.branches[i])) return;
        out.edges.push({ id: `forkout:${block.id}:${i}`, points: [{ x: cx, y: colTop + sizes[i].h }, { x: cx, y: joinY }] });
      });
      break;
    }
    case 'while': {
      const head = diamondSize(block.cond, ctx);
      out.boxes.push({
        id: `box:${block.id}`, kind: 'decision', blockId: block.id, field: 'cond',
        x: spineX - head.w / 2, y: top, w: head.w, h: head.h, label: block.cond,
      });

      const bodyTop = top + head.h + m.gapY;
      const bodyBottom = placeSeq(block.body, [{ block: block.id, slot: 'body' }], spineX, bodyTop, ctx, out);

      out.edges.push({
        id: `loopin:${block.id}`, blockId: block.id, field: 'isLabel', label: block.isLabel,
        labelAt: block.isLabel === undefined ? undefined : { x: spineX + 6, y: top + head.h + m.gapY / 2 },
        points: [{ x: spineX, y: top + head.h }, { x: spineX, y: bodyTop }],
      });

      // No space is reserved specifically for the back-edge (it jogs sideways into the
      // gutter, consuming no extra height), so omitting it when the body has terminated
      // needs no matching change in `measureBlock`'s 'while' case.
      if (!terminates(block.body)) {
        const lane = spineX - s.spine + m.gutter / 2;
        out.edges.push({
          id: `back:${block.id}`, blockId: block.id,
          points: [
            { x: spineX, y: bodyBottom },
            { x: lane, y: bodyBottom },
            { x: lane, y: top + head.h / 2 },
            { x: spineX - head.w / 2, y: top + head.h / 2 },
          ],
        });
      }

      out.edges.push({
        id: `loopout:${block.id}`, blockId: block.id, field: 'endLabel', label: block.endLabel,
        labelAt: block.endLabel === undefined ? undefined : { x: spineX + head.w / 2 + 6, y: top + head.h / 2 },
        points: [{ x: spineX, y: top + s.h - m.gapY }, { x: spineX, y: top + s.h }],
      });
      break;
    }
    case 'repeat': {
      const foot = diamondSize(block.cond, ctx);
      const bodyBottom = placeSeq(block.body, [{ block: block.id, slot: 'body' }], spineX, top, ctx, out);
      const footY = bodyBottom + m.gapY;

      out.boxes.push({
        id: `box:${block.id}`, kind: 'decision', blockId: block.id, field: 'cond',
        x: spineX - foot.w / 2, y: footY, w: foot.w, h: foot.h, label: block.cond,
      });
      out.edges.push({
        id: `loopbody:${block.id}`, blockId: block.id,
        points: [{ x: spineX, y: bodyBottom }, { x: spineX, y: footY }],
      });

      // Same reasoning as `while` above: the back-edge reserves no height of its own, so
      // dropping it when the body terminates needs no matching change in `measureBlock`'s
      // 'repeat' case.
      if (!terminates(block.body)) {
        const lane = spineX - s.spine + m.gutter / 2;
        out.edges.push({
          id: `back:${block.id}`, blockId: block.id, field: 'isLabel', label: block.isLabel,
          labelAt: block.isLabel === undefined ? undefined : { x: lane + 6, y: (top + footY) / 2 },
          points: [
            { x: spineX - foot.w / 2, y: footY + foot.h / 2 },
            { x: lane, y: footY + foot.h / 2 },
            { x: lane, y: top - m.gapY / 2 },
            { x: spineX, y: top - m.gapY / 2 },
          ],
        });
      }
      break;
    }
    default:
      // Guard: unreachable for real block kinds after Task 10.
      throw new Error(`placeBlock: unhandled kind ${(block as Block).kind}`);
  }
}

function connect(out: Out, id: string, x: number, fromY: number, toY: number): void {
  out.edges.push({ id, points: [{ x, y: fromY }, { x, y: toY }] });
}

export function pathKey(path: SeqPath): string {
  return path.map((s) => (s.slot === 'branch' ? `${s.block}#${s.index}` : `${s.block}#${s.slot}`)).join('/') || 'root';
}

function placeSeq(seq: Block[], path: SeqPath, spineX: number, top: number, ctx: Ctx, out: Out): number {
  const { m } = ctx;
  const key = pathKey(path);
  const zoneW = zoneWidth(m);

  const zone = (index: number, y: number, persistent = false) => {
    out.dropZones.push({
      id: `drop:${key}:${index}`, path, index, persistent,
      x: spineX - zoneW / 2, y: y - m.dropH / 2, w: zoneW, h: m.dropH,
    });
  };

  // Must agree with measureSeq's empty-sequence stub (size(0, m.gapY, 0)): an empty sequence
  // still consumes one gapY of vertical room, so a nested empty branch's siblings don't get
  // measured taller than what placement actually reserves for it.
  //
  // This is the ONE zone marked `persistent`: an empty if-branch, else arm, fork column, or
  // loop body renders as nothing but an arrow with no shape to click, so its zone must stay
  // visible (and selectable) even with no drag in flight — see Canvas.tsx. Every other zone
  // below (the gaps around and between existing blocks) stays drag-only.
  if (seq.length === 0) {
    zone(0, top + m.gapY / 2, true);
    return top + m.gapY;
  }

  let y = top;
  zone(0, y - m.gapY / 2);
  seq.forEach((block, index) => {
    const s = ctx.sizes.get(block.id)!;
    if (index > 0) connect(out, `link:${key}:${index}`, spineX, y - m.gapY, y);
    placeBlock(block, spineX, y, ctx, out);
    y += s.h;
    zone(index + 1, y + m.gapY / 2);
    if (index !== seq.length - 1) y += m.gapY;
  });
  return y;
}

// ---------- public ----------

export function layout(doc: Doc, measure: MeasureText, m: Metrics = DEFAULT_METRICS): LayoutResult {
  const ctx: Ctx = { m, measure, sizes: new Map() };
  const body = measureSeq(doc.body, ctx);

  const spineX = Math.max(body.spine, m.capW / 2);
  const out: Out = { boxes: [], edges: [], dropZones: [] };

  out.boxes.push({ id: 'box:start', kind: 'start', x: spineX - m.capW / 2, y: 0, w: m.capW, h: m.capH });

  const bodyTop = m.capH + m.gapY;
  if (doc.body.length > 0) {
    connect(out, 'link:start', spineX, m.capH, bodyTop);
  }
  const bottom = placeSeq(doc.body, [], spineX, bodyTop, ctx, out);

  // A drop zone's width has a floor (see `zoneW` in placeSeq) that is independent of its
  // column's own spine, and an edge's label sits at an offset from its anchor that's
  // independent of every box's extent too (a loop's default `endLabel`/`isLabel`, e.g.
  // `createBlock('while')`'s "no", is the everyday case — it renders to the right of the
  // condition diamond, which can easily be the widest thing in the diagram). Either can
  // therefore end up outside the bounds derived from boxes alone: a zone whose x goes
  // negative (the empty document above all: one box-less zone on a spine of 0), a back-edge
  // lane running left of everything, or a label whose right edge falls past every box's and
  // zone's. Canvas.tsx renders a `viewBox="0 0 {width} {height}"` starting at the origin,
  // and a root <svg>'s default `overflow: hidden` clips anything outside it — silently, with
  // no error. jsdom (where the rest of this file's tests run) never renders or clips
  // anything, so content left outside the box-derived bounds looks fine there while being
  // invisible (and, for zones, un-hit-testable) in a real browser. Re-derive the bounds from
  // drop zones, edge points, AND edge labels' actual rendered extent — not just their
  // anchor — and shift everything right if anything needed to start left of x=0.
  const labelSize = (e: Edge) => (e.label !== undefined && e.labelAt ? measureLabel(e.label, measure, m) : null);

  const minX = Math.min(
    0,
    ...out.dropZones.map((z) => z.x),
    ...out.edges.flatMap((e) => e.points.map((p) => p.x)),
    ...out.edges.map((e) => e.labelAt?.x).filter((x): x is number => x !== undefined),
  );
  if (minX < 0) {
    const dx = -minX;
    out.boxes.forEach((b) => { b.x += dx; });
    out.edges.forEach((e) => {
      e.points.forEach((p) => { p.x += dx; });
      if (e.labelAt) e.labelAt.x += dx;
    });
    out.dropZones.forEach((z) => { z.x += dx; });
  }

  // Edge.tsx draws a label's text at `labelAt.x + 6`, left-anchored (default `text-anchor`),
  // so its right edge is that plus its measured width; vertically it's centered
  // (`dominantBaseline="middle"`) on `labelAt.y`, so it spans `labelAt.y ± size.h / 2`.
  const width = Math.max(
    ...out.boxes.map((b) => b.x + b.w),
    ...out.dropZones.map((z) => z.x + z.w),
    ...out.edges.flatMap((e) => e.points.map((p) => p.x)),
    ...out.edges.map((e) => {
      const size = labelSize(e);
      return size ? e.labelAt!.x + 6 + size.w : 0;
    }),
    spineX - minX + m.capW / 2,
  );
  const height = Math.max(
    bottom, m.capH,
    ...out.boxes.map((b) => b.y + b.h),
    ...out.dropZones.map((z) => z.y + z.h),
    ...out.edges.flatMap((e) => e.points.map((p) => p.y)),
    ...out.edges.map((e) => {
      const size = labelSize(e);
      return size ? e.labelAt!.y + size.h / 2 : 0;
    }),
  );

  // Uniform default inset: `width`/`height` above are tight to the content (leftmost/topmost
  // shapes sit at exactly x=0/y=0), which starves Box.tsx's selection ring — drawn
  // `m.ringOutset` px (plus half its stroke) outside whatever box it decorates — of room to
  // render. The <svg>'s viewBox clips anything outside [0, width] x [0, height] silently,
  // exactly as it does for drop zones and edge labels (see the comment above): a box at the
  // layout's edge, the everyday case right after "Fit", would have its ring clipped the
  // instant it's selected. Shift every box, drop zone, and edge point/label by `m.margin` on
  // both axes and grow the reported width/height by `2 * m.margin` to match — this is a
  // uniform gap on all four sides, not just enough to clear the ring.
  out.boxes.forEach((b) => { b.x += m.margin; b.y += m.margin; });
  out.edges.forEach((e) => {
    e.points.forEach((p) => { p.x += m.margin; p.y += m.margin; });
    if (e.labelAt) { e.labelAt.x += m.margin; e.labelAt.y += m.margin; }
  });
  out.dropZones.forEach((z) => { z.x += m.margin; z.y += m.margin; });

  return {
    width: width + 2 * m.margin,
    height: height + 2 * m.margin,
    boxes: out.boxes,
    edges: out.edges,
    dropZones: out.dropZones,
  };
}
