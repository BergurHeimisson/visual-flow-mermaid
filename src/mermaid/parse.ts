import { newId } from '../model/ids';
import type { Block, Branch, Doc } from '../model/types';
import { tokenize, type Token } from './tokens';

export type ParseError = {
  kind: 'unsupported' | 'syntax';
  line: number;
  construct?: string;
  message: string;
};

export type IgnoredLine = { line: number; text: string };

export type ParseResult =
  | { ok: true; doc: Doc; ignored: IgnoredLine[] }
  | { ok: false; error: ParseError };

class Fail extends Error {
  constructor(readonly error: ParseError) { super(error.message); }
}

export function parse(text: string): ParseResult {
  const all = tokenize(text);

  // Refuse-don't-mangle, exactly as the PlantUML parser does: a construct the tokenizer
  // started reading and could not finish must not be silently truncated away.
  const bad = all.find((t) => t.type === 'unsupported' || t.type === 'malformed');
  if (bad?.type === 'unsupported') {
    return { ok: false, error: {
      kind: 'unsupported',
      line: bad.line,
      construct: bad.construct,
      message: `${bad.construct} is not supported in this version.`,
    }};
  }
  if (bad?.type === 'malformed') {
    return { ok: false, error: {
      kind: bad.kind, line: bad.line, construct: bad.construct, message: bad.message,
    }};
  }

  const preamble: string[] = [];
  const ignored: IgnoredLine[] = [];
  const structural: Token[] = [];
  let seenStructural = false;
  let seenFlowchart = false;

  for (const token of all) {
    if (token.type === 'flowchart') {
      // One diagram per file, exactly as the PlantUML parser allows one @startuml.
      if (seenFlowchart) {
        return { ok: false, error: {
          kind: 'syntax', line: token.line,
          message: 'This file contains more than one diagram; only one `flowchart` is supported.',
        }};
      }
      seenFlowchart = true;
      continue;
    }
    if (token.type === 'edge') continue; // decorative only — structure comes from nesting, not edges
    if (token.type === 'cosmetic') {
      if (seenStructural) ignored.push({ line: token.line, text: token.text });
      else preamble.push(token.text);
      continue;
    }
    seenStructural = true;
    if (token.type === 'start') continue;
    structural.push(token);
  }

  let i = 0;
  const peek = () => structural[i];
  const next = () => structural[i++];
  const lastLine = () => structural[structural.length - 1]?.line ?? 1;

  function expect<T extends Token['type']>(type: T, what: string): Extract<Token, { type: T }> {
    const token = peek();
    if (!token || token.type !== type) {
      throw new Fail({ kind: 'syntax', line: token?.line ?? lastLine(), message: `Expected ${what}.` });
    }
    i += 1;
    return token as Extract<Token, { type: T }>;
  }

  /** A subgraph body: every construct nests as `subgraph ... [...]` ... `end`, so any
   *  nested sequence just reads blocks until it meets its own closing `end`. */
  function parseNested(): Block[] {
    const out: Block[] = [];
    while (i < structural.length && peek().type !== 'end-sub') out.push(parseBlock());
    expect('end-sub', '`end`');
    return out;
  }

  function parseBlock(): Block {
    const token = next();
    switch (token.type) {
      case 'activity': {
        const block: Block = { id: newId(), kind: 'action', label: token.label };
        if (peek()?.type === 'note') {
          const note = next() as Extract<Token, { type: 'note' }>;
          return { ...block, note: { side: note.side, text: note.text } };
        }
        return block;
      }
      case 'stop': return { id: newId(), kind: 'stop' };
      case 'end':  return { id: newId(), kind: 'end' };
      case 'subgraphIf': {
        const branches: Branch[] = [{ cond: token.cond, thenLabel: token.thenLabel, body: parseNested() }];
        while (peek()?.type === 'subgraphElseif') {
          const head = next() as Extract<Token, { type: 'subgraphElseif' }>;
          branches.push({ cond: head.cond, thenLabel: head.thenLabel, body: parseNested() });
        }
        let elseBody: Block[] | undefined;
        let elseLabel: string | undefined;
        if (peek()?.type === 'subgraphElse') {
          const head = next() as Extract<Token, { type: 'subgraphElse' }>;
          elseLabel = head.label;
          elseBody = parseNested();
        }
        return { id: newId(), kind: 'if', branches, elseBody, elseLabel };
      }
      case 'subgraphWhile': {
        const body = parseNested();
        let endLabel: string | undefined;
        if (peek()?.type === 'endwhileNote') {
          endLabel = (next() as Extract<Token, { type: 'endwhileNote' }>).label;
        }
        return { id: newId(), kind: 'while', cond: token.cond, isLabel: token.isLabel, endLabel, body };
      }
      case 'subgraphRepeat': {
        const body = parseNested();
        const close = expect('repeatWhileNote', '`%% repeat while (cond) is (label)`');
        return { id: newId(), kind: 'repeat', body, cond: close.cond, isLabel: close.isLabel };
      }
      case 'subgraphFork': {
        const branches: Block[][] = [parseNested()];
        while (peek()?.type === 'subgraphForkAgain') { next(); branches.push(parseNested()); }
        return { id: newId(), kind: 'fork', branches };
      }
      default:
        throw new Fail({ kind: 'syntax', line: token.line, message: `Unexpected ${token.type}.` });
    }
  }

  function parseSeq(): Block[] {
    const out: Block[] = [];
    while (i < structural.length) out.push(parseBlock());
    return out;
  }

  try {
    const body = parseSeq();
    return { ok: true, doc: { preamble, body }, ignored };
  } catch (err) {
    if (err instanceof Fail) return { ok: false, error: err.error };
    throw err;
  }
}
