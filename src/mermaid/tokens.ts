/**
 * This app's canonical Mermaid dialect is line-oriented. The graph itself is ordinary,
 * idiomatic Mermaid — `id["label"]` actions, `id{"cond"}` diamonds, `id@{ shape: fork }`
 * bars and labelled `-->` edges — so it renders correctly anywhere (Mermaid v11.3+, for
 * the fork bar). The document *tree* cannot be expressed by that graph, because an
 * elseif chain and a nested if produce identical topology, so it rides alongside as
 * inert `%%` markers: `%% if` / `%% then (l)` / `%% elseif` / `%% else (l)` / `%% endif`,
 * `%% while` / `%% do (l)` / `%% endwhile (l)`, `%% repeat` / `%% repeat while (l)`, and
 * `%% fork (n)` / `%% fork again` / `%% end fork`. Every condition lives in the diamond that
 * follows its opening marker; markers carry only the labels. Comments are inert to any
 * renderer, so the file stays plain, valid, renderable Mermaid throughout.
 *
 * A note body is the one thing that still accumulates across raw lines, via the explicit
 * `%% note left` / `%% end note` block.
 */
export type Token =
  | { type: 'flowchart'; line: number }
  | { type: 'start'; line: number }
  | { type: 'stop'; id: string; line: number }
  | { type: 'end'; id: string; line: number }
  | { type: 'activity'; id: string; label: string; line: number }
  | { type: 'decision'; id: string; cond: string; line: number }
  | { type: 'forkBar'; id: string; line: number }
  | { type: 'markIf'; line: number }
  | { type: 'markThen'; label?: string; line: number }
  | { type: 'markElseif'; line: number }
  | { type: 'markElse'; label?: string; line: number }
  | { type: 'markEndif'; line: number }
  | { type: 'markWhile'; line: number }
  | { type: 'markDo'; label?: string; line: number }
  | { type: 'markEndwhile'; label?: string; line: number }
  | { type: 'markRepeat'; line: number }
  | { type: 'markRepeatWhile'; label?: string; line: number }
  | { type: 'markFork'; count?: number; line: number }
  | { type: 'markForkAgain'; line: number }
  | { type: 'markEndFork'; line: number }
  | { type: 'edge'; from: string; to: string; line: number }
  | { type: 'note'; side: 'left' | 'right'; text: string; line: number }
  | { type: 'cosmetic'; text: string; line: number }
  | { type: 'unsupported'; construct: string; text: string; line: number }
  /** See tokens.ts (PlantUML)'s identical `malformed` case: a construct the tokenizer
   *  started reading and could not finish, so the caller refuses rather than truncates. */
  | { type: 'malformed'; kind: 'unsupported' | 'syntax'; construct?: string; message: string; line: number };

const RE = {
  flowchart: /^(?:flowchart|graph)\s+\w+$/i,
  start:     /^\w+\(\("start"\)\)$/i,
  stop:      /^(\w+)\(\("stop"\)\)$/i,
  end:       /^(\w+)\(\("end"\)\)$/i,
  activity:  /^(\w+)\["(.*)"\]$/,
  decision:  /^(\w+)\{"(.*)"\}$/,
  forkBar:   /^(\w+)@\{\s*shape:\s*fork\s*\}$/i,
  shapeAt:   /^(\w+)@\{\s*shape:\s*(\w[\w-]*)\s*\}$/i,
  edge:      /^(\w+)\s*-->\s*(\w+)$/,
  edgeLabel: /^(\w+)\s*--\s*(?:.*?)\s*-->\s*(\w+)$/,
  edgePipe:  /^(\w+)\s*-->\s*\|(?:.*?)\|\s*(\w+)$/,
  markIf:     /^%%\s*if$/i,
  markThen:   /^%%\s*then\s*(?:\((.*)\))?$/i,
  markElseif: /^%%\s*elseif$/i,
  markElse:   /^%%\s*else\s*(?:\((.*)\))?$/i,
  markEndif:  /^%%\s*endif$/i,
  markForkAgain: /^%%\s*fork\s+again$/i,
  markFork:      /^%%\s*fork(?:\s*\((\d+)\))?$/i,
  markEndFork:   /^%%\s*end\s+fork$/i,
  markWhile:    /^%%\s*while$/i,
  markDo:       /^%%\s*do\s*(?:\((.*)\))?$/i,
  markEndwhile: /^%%\s*endwhile\s*(?:\((.*)\))?$/i,
  markRepeatWhile: /^%%\s*repeat\s+while\s*(?:\((.*)\))?$/i,
  markRepeat:      /^%%\s*repeat$/i,
  noteInline: /^%%\s*note\s+(left|right)\s*:\s*(.*)$/i,
  noteBlock:  /^%%\s*note\s+(left|right)$/i,
  endNote:    /^%%\s*end\s*note$/i,
};

const COSMETIC = ['%%{', 'classdef', 'style', 'click', 'linkstyle', '%% title', '%% header', '%% footer'];

function unescape(text: string): string {
  return text.replace(/<br\s*\/?>/gi, '\n').replace(/#quot;/g, '"');
}

export function tokenize(text: string): Token[] {
  const lines = text.split(/\r?\n/);
  const out: Token[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = i + 1;
    const raw = lines[i];
    const t = raw.trim();
    i += 1;

    if (t === '') continue;

    if (RE.flowchart.test(t)) { out.push({ type: 'flowchart', line }); continue; }
    if (RE.start.test(t)) { out.push({ type: 'start', line }); continue; }

    const stop = RE.stop.exec(t);
    if (stop) { out.push({ type: 'stop', id: stop[1], line }); continue; }

    const end = RE.end.exec(t);
    if (end) { out.push({ type: 'end', id: end[1], line }); continue; }

    const activity = RE.activity.exec(t);
    if (activity) { out.push({ type: 'activity', id: activity[1], label: unescape(activity[2]), line }); continue; }

    const decision = RE.decision.exec(t);
    if (decision) { out.push({ type: 'decision', id: decision[1], cond: unescape(decision[2]), line }); continue; }

    const forkBar = RE.forkBar.exec(t);
    if (forkBar) { out.push({ type: 'forkBar', id: forkBar[1], line }); continue; }

    const shapeAt = RE.shapeAt.exec(t);
    if (shapeAt) { out.push({ type: 'unsupported', construct: `@{ shape: ${shapeAt[2]} }`, text: raw.trim(), line }); continue; }

    const edge = RE.edge.exec(t) ?? RE.edgeLabel.exec(t) ?? RE.edgePipe.exec(t);
    if (edge) { out.push({ type: 'edge', from: edge[1], to: edge[2], line }); continue; }

    if (RE.markIf.test(t)) { out.push({ type: 'markIf', line }); continue; }
    const markThen = RE.markThen.exec(t);
    if (markThen) { out.push({ type: 'markThen', label: markThen[1], line }); continue; }
    if (RE.markElseif.test(t)) { out.push({ type: 'markElseif', line }); continue; }
    const markElse = RE.markElse.exec(t);
    if (markElse) { out.push({ type: 'markElse', label: markElse[1], line }); continue; }
    if (RE.markEndif.test(t)) { out.push({ type: 'markEndif', line }); continue; }


    if (RE.markForkAgain.test(t)) { out.push({ type: 'markForkAgain', line }); continue; }
    const markFork = RE.markFork.exec(t);
    if (markFork) {
      out.push({ type: 'markFork', count: markFork[1] === undefined ? undefined : Number(markFork[1]), line });
      continue;
    }
    if (RE.markEndFork.test(t)) { out.push({ type: 'markEndFork', line }); continue; }

    if (RE.markWhile.test(t)) { out.push({ type: 'markWhile', line }); continue; }
    const markDo = RE.markDo.exec(t);
    if (markDo) { out.push({ type: 'markDo', label: markDo[1], line }); continue; }
    const markEndwhile = RE.markEndwhile.exec(t);
    if (markEndwhile) { out.push({ type: 'markEndwhile', label: markEndwhile[1], line }); continue; }

    const markRepeatWhile = RE.markRepeatWhile.exec(t);
    if (markRepeatWhile) { out.push({ type: 'markRepeatWhile', label: markRepeatWhile[1], line }); continue; }
    if (RE.markRepeat.test(t)) { out.push({ type: 'markRepeat', line }); continue; }

    const blockNote = RE.noteBlock.exec(t);
    if (blockNote) {
      const body: string[] = [];
      let closed = false;
      while (i < lines.length) {
        const nextLine = lines[i].trim();
        if (RE.endNote.test(nextLine)) { i += 1; closed = true; break; }
        body.push(nextLine.replace(/^%%\s?/, '')); i += 1;
      }
      if (!closed) {
        out.push({ type: 'malformed', kind: 'syntax', line, message: 'This note block is never closed with `%% end note`.' });
        continue;
      }
      out.push({ type: 'note', side: blockNote[1].toLowerCase() as 'left' | 'right', text: body.join('\n'), line });
      continue;
    }
    const inlineNote = RE.noteInline.exec(t);
    if (inlineNote) { out.push({ type: 'note', side: inlineNote[1].toLowerCase() as 'left' | 'right', text: inlineNote[2], line }); continue; }

    if (t.startsWith('%%') || COSMETIC.some((p) => t.toLowerCase().startsWith(p))) {
      out.push({ type: 'cosmetic', text: raw.trim(), line });
      continue;
    }
    if (t.startsWith('subgraph')) {
      out.push({ type: 'unsupported', construct: 'subgraph', text: raw.trim(), line });
      continue;
    }

    out.push({ type: 'unsupported', construct: t.split(/[\s([{]/)[0] || t, text: raw.trim(), line });
  }

  return out;
}
