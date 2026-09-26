import type { Block, Doc, NodeId } from './types';

export type Seg =
  | { block: NodeId; slot: 'body' }
  | { block: NodeId; slot: 'branch'; index: number }
  | { block: NodeId; slot: 'else' };

export type SeqPath = Seg[];

/** An insertion point: a sequence (by path) and a position within it. Also what a selected
 *  empty-slot placeholder names — see `src/ui/insertion.ts`. */
export type Slot = { path: SeqPath; index: number };

function childSeq(block: Block, seg: Seg): Block[] | null {
  if (block.id !== seg.block) return null;
  if (seg.slot === 'body' && (block.kind === 'while' || block.kind === 'repeat')) return block.body;
  if (seg.slot === 'branch' && block.kind === 'if') return block.branches[seg.index]?.body ?? null;
  if (seg.slot === 'branch' && block.kind === 'fork') return block.branches[seg.index] ?? null;
  if (seg.slot === 'else' && block.kind === 'if') return block.elseBody ?? null;
  return null;
}

function replaceChildSeq(block: Block, seg: Seg, next: Block[]): Block {
  if (seg.slot === 'body' && (block.kind === 'while' || block.kind === 'repeat')) {
    return { ...block, body: next };
  }
  if (seg.slot === 'branch' && block.kind === 'if') {
    const branches = block.branches.map((b, i) => (i === seg.index ? { ...b, body: next } : b));
    return { ...block, branches };
  }
  if (seg.slot === 'branch' && block.kind === 'fork') {
    return { ...block, branches: block.branches.map((b, i) => (i === seg.index ? next : b)) };
  }
  if (seg.slot === 'else' && block.kind === 'if') {
    return { ...block, elseBody: next };
  }
  return block;
}

function seqAt(seq: Block[], path: SeqPath): Block[] | null {
  if (path.length === 0) return seq;
  const [seg, ...rest] = path;
  for (const block of seq) {
    const child = childSeq(block, seg);
    if (child) return seqAt(child, rest);
  }
  return null;
}

export function getSeq(doc: Doc, path: SeqPath): Block[] | null {
  return seqAt(doc.body, path);
}

function mapSeq(seq: Block[], path: SeqPath, fn: (s: Block[]) => Block[]): Block[] {
  if (path.length === 0) return fn(seq);
  const [seg, ...rest] = path;
  return seq.map((block) => {
    const child = childSeq(block, seg);
    if (!child) return block;
    return replaceChildSeq(block, seg, mapSeq(child, rest, fn));
  });
}

export function withSeq(doc: Doc, path: SeqPath, fn: (seq: Block[]) => Block[]): Doc {
  return { ...doc, body: mapSeq(doc.body, path, fn) };
}
