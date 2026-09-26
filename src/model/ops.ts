import { getSeq, withSeq, type Seg, type SeqPath } from './paths';
import type { Block, Doc, NodeId } from './types';

function childSeqs(block: Block): { seg: Seg; seq: Block[] }[] {
  switch (block.kind) {
    case 'while':
    case 'repeat':
      return [{ seg: { block: block.id, slot: 'body' }, seq: block.body }];
    case 'if': {
      const out = block.branches.map((b, index) => ({
        seg: { block: block.id, slot: 'branch', index } as Seg,
        seq: b.body,
      }));
      if (block.elseBody) out.push({ seg: { block: block.id, slot: 'else' }, seq: block.elseBody });
      return out;
    }
    case 'fork':
      return block.branches.map((seq, index) => ({
        seg: { block: block.id, slot: 'branch', index } as Seg,
        seq,
      }));
    default:
      return [];
  }
}

function pathsEqual(a: SeqPath, b: SeqPath): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const segA = a[i];
    const segB = b[i];
    if (segA.block !== segB.block || segA.slot !== segB.slot) return false;
    // index is only present on 'branch' slots
    const indexA = segA.slot === 'branch' ? (segA as Seg & { index: number }).index : undefined;
    const indexB = segB.slot === 'branch' ? (segB as Seg & { index: number }).index : undefined;
    if (indexA !== indexB) return false;
  }
  return true;
}

function search(seq: Block[], path: SeqPath, id: NodeId): { path: SeqPath; index: number } | null {
  for (let index = 0; index < seq.length; index += 1) {
    const block = seq[index];
    if (block.id === id) return { path, index };
    for (const child of childSeqs(block)) {
      const hit = search(child.seq, [...path, child.seg], id);
      if (hit) return hit;
    }
  }
  return null;
}

export function locate(doc: Doc, id: NodeId): { path: SeqPath; index: number } | null {
  return search(doc.body, [], id);
}

export function findBlock(doc: Doc, id: NodeId): Block | null {
  const at = locate(doc, id);
  if (!at) return null;
  return getSeq(doc, at.path)?.[at.index] ?? null;
}

export function mapBlock(doc: Doc, id: NodeId, fn: (b: Block) => Block): Doc {
  const at = locate(doc, id);
  if (!at) return doc;
  const seq = getSeq(doc, at.path);
  const before = seq?.[at.index];
  if (!before) return doc;
  const after = fn(before);
  if (after === before) return doc;
  return withSeq(doc, at.path, (s) => s.map((b, i) => (i === at.index ? after : b)));
}

export function insertAt(doc: Doc, path: SeqPath, index: number, block: Block): Doc {
  if (getSeq(doc, path) === null) return doc;
  return withSeq(doc, path, (seq) => [...seq.slice(0, index), block, ...seq.slice(index)]);
}

export function removeBlock(doc: Doc, id: NodeId): Doc {
  const at = locate(doc, id);
  if (!at) return doc;
  return withSeq(doc, at.path, (seq) => seq.filter((_, i) => i !== at.index));
}

/**
 * Is `id` somewhere inside `ancestorId`'s subtree? The spec singles this guard out as the
 * one move that could corrupt the tree, "a pure function with its own tests" — so
 * `moveBlock` calls it rather than re-deriving the same check inline.
 */
export function isWithin(doc: Doc, ancestorId: NodeId, id: NodeId): boolean {
  const at = locate(doc, id);
  if (!at) return false;
  return at.path.some((seg) => seg.block === ancestorId);
}

export function moveBlock(doc: Doc, id: NodeId, path: SeqPath, index: number): Doc {
  const at = locate(doc, id);
  if (!at) return doc;

  // A destination path is a chain of ancestors, so its deepest segment names the block that
  // would host the move. Refuse when that host is the dragged block itself or anything
  // inside it — dropping a block into its own subtree would detach that subtree from the
  // document. This used to be an inline `path.some(...)` duplicating `isWithin`, which left
  // the tested function dead and the running one untested.
  const host = path[path.length - 1]?.block;
  if (host !== undefined && (host === id || isWithin(doc, id, host))) return doc;

  const block = getSeq(doc, at.path)?.[at.index];
  if (!block) return doc;

  const sameSeq = pathsEqual(at.path, path);
  const target = sameSeq && index > at.index ? index - 1 : index;

  const removed = removeBlock(doc, id);
  if (getSeq(removed, path) === null) return doc;
  return insertAt(removed, path, target, block);
}
