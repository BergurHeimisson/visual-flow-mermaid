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

  const IF_STOP = new Set<Token['type']>(['markElseif', 'markElse', 'markEndif']);
  const WHILE_STOP = new Set<Token['type']>(['markEndwhile']);
  const REPEAT_STOP = new Set<Token['type']>(['markRepeatWhile']);
  const FORK_STOP = new Set<Token['type']>(['markForkAgain', 'markEndFork']);

  /** A marker-delimited body: read blocks until one of this construct's own closing
   *  markers, which the caller consumes. A nested construct is consumed whole by the
   *  recursive `parseBlock`, so the stop set is only ever consulted at block-start
   *  position — the same property the retired `subgraph`/`end` nesting relied on. */
  function parseBody(stop: ReadonlySet<Token['type']>): Block[] {
    const out: Block[] = [];
    while (i < structural.length && !stop.has(peek().type)) out.push(parseBlock());
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
      case 'markWhile': {
        const diamond = expect('decision', 'a `{"condition"}` decision node');
        const doMark = expect('markDo', '`%% do`');
        const body = parseBody(WHILE_STOP);
        const close = expect('markEndwhile', '`%% endwhile`');
        return { id: newId(), kind: 'while', cond: diamond.cond,
                 isLabel: doMark.label, endLabel: close.label, body };
      }
      case 'markRepeat': {
        const body = parseBody(REPEAT_STOP);
        const close = expect('markRepeatWhile', '`%% repeat while`');
        const diamond = expect('decision', 'a `{"condition"}` decision node');
        return { id: newId(), kind: 'repeat', body, cond: diamond.cond, isLabel: close.label };
      }
      case 'markFork': {
        expect('forkBar', 'a `@{ shape: fork }` split bar');
        const branches: Block[][] = [parseBody(FORK_STOP)];
        while (peek()?.type === 'markForkAgain') { next(); branches.push(parseBody(FORK_STOP)); }
        expect('markEndFork', '`%% end fork`');
        expect('forkBar', 'a `@{ shape: fork }` join bar');
        // Every other missing marker is caught by an `expect` above. A dropped
        // `%% fork again` is the one that would not be: its column would simply be
        // absorbed into the previous one, silently turning parallel work into
        // sequential. A fork always has at least two branches (`edits.ts` refuses to
        // remove below two), so a single branch means a marker went missing.
        if (branches.length < 2) {
          throw new Fail({ kind: 'syntax', line: token.line,
            message: 'A fork needs at least two branches; a `%% fork again` is missing.' });
        }
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
