import type { Block, Branch, Doc } from '../../model/types';

/** Deterministic PRNG so a failing seed can be replayed exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The multi-line entry exists specifically to exercise the multi-line activity-label
// and multi-line note-body paths in serialize.ts, which the original word list (all
// single-line) could never reach.
const WORDS = [
  'Receive order', 'Ship it', 'Backorder', 'check', 'notify', 'a b c', 'done?',
  'first line\nsecond line', 'count > 10?',
];

// A marker (`%% then (yes)`, `%% endwhile (no)`) is exactly one physical line and has no
// escape or continuation syntax, so a newline in a thenLabel/elseLabel/isLabel/endLabel is
// not expressible in this dialect at all -- unlike an activity label (`id["..."]`, where a
// newline is escaped to `<br/>`) or a note body (an explicit `%% note` / `%% end note`
// block). Conditions now live in a quoted diamond label (`id{"..."}`) and so could in
// principle carry a `<br/>`, but the inline editor that produces them is a single-line HTML
// <input>, so a user can never type one. Conditions therefore draw from this single-line-safe
// subset too, matching what the app can actually produce.
const SINGLE_LINE_WORDS = WORDS.filter((w) => !w.includes('\n'));

export function randomDoc(seed: number, depth = 3): Doc {
  const rnd = mulberry32(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const maybe = (v: string): string | undefined => (rnd() < 0.5 ? undefined : v);

  function seq(d: number): Block[] {
    const n = Math.floor(rnd() * 3) + (d === depth ? 1 : 0);
    return Array.from({ length: n }, () => block(d));
  }

  function block(d: number): Block {
    const leafOnly = d <= 0;
    const kinds = leafOnly
      ? (['action', 'stop', 'end'] as const)
      : (['action', 'stop', 'end', 'if', 'while', 'repeat', 'fork'] as const);
    const kind = pick([...kinds]);
    const id = `g${Math.floor(rnd() * 1e9)}`;

    switch (kind) {
      case 'stop': return { id, kind: 'stop' };
      case 'end':  return { id, kind: 'end' };
      case 'action': {
        const label = pick(WORDS);
        return rnd() < 0.25
          ? { id, kind: 'action', label, note: { side: pick(['left', 'right'] as const), text: pick(WORDS) } }
          : { id, kind: 'action', label };
      }
      case 'if': {
        const count = 1 + Math.floor(rnd() * 2);
        const branches: Branch[] = Array.from({ length: count }, () => ({
          cond: pick(SINGLE_LINE_WORDS), thenLabel: maybe('yes'), body: seq(d - 1),
        }));
        return rnd() < 0.5
          ? { id, kind: 'if', branches }
          : { id, kind: 'if', branches, elseBody: seq(d - 1), elseLabel: maybe('no') };
      }
      case 'while':
        return { id, kind: 'while', cond: pick(SINGLE_LINE_WORDS), isLabel: maybe('yes'), endLabel: maybe('no'), body: seq(d - 1) };
      case 'repeat':
        return { id, kind: 'repeat', body: seq(d - 1), cond: pick(SINGLE_LINE_WORDS), isLabel: maybe('yes') };
      case 'fork':
        return { id, kind: 'fork', branches: Array.from({ length: 2 + Math.floor(rnd() * 2) }, () => seq(d - 1)) };
    }
  }

  const preamble = rnd() < 0.3 ? ['%%{init: {"theme": "dark"}}%%', '%% a comment'] : [];
  return { preamble, body: seq(depth) };
}

/** Reassign ids in depth-first order so two structurally equal docs compare equal. */
export function normalizeIds(doc: Doc): Doc {
  let n = 0;
  const walkSeq = (seq: Block[]): Block[] => seq.map(walk);
  const walk = (b: Block): Block => {
    const id = `n${n++}`;
    switch (b.kind) {
      case 'if':     return { ...b, id, branches: b.branches.map((br) => ({ ...br, body: walkSeq(br.body) })),
                               elseBody: b.elseBody ? walkSeq(b.elseBody) : undefined };
      case 'while':
      case 'repeat': return { ...b, id, body: walkSeq(b.body) };
      case 'fork':   return { ...b, id, branches: b.branches.map(walkSeq) };
      default:       return { ...b, id };
    }
  };
  return { ...doc, body: walkSeq(doc.body) };
}
