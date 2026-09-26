export type NodeId = string;

export type Note = { side: 'left' | 'right'; text: string };

export type Branch = { cond: string; thenLabel?: string; body: Block[] };

export type Block =
  | { id: NodeId; kind: 'action'; label: string; note?: Note }
  | { id: NodeId; kind: 'stop' }
  | { id: NodeId; kind: 'end' }
  | { id: NodeId; kind: 'if'; branches: Branch[]; elseBody?: Block[]; elseLabel?: string }
  | { id: NodeId; kind: 'while'; cond: string; isLabel?: string; endLabel?: string; body: Block[] }
  | { id: NodeId; kind: 'repeat'; body: Block[]; cond: string; isLabel?: string }
  | { id: NodeId; kind: 'fork'; branches: Block[][] };

export type BlockKind = Block['kind'];

export type Doc = { preamble: string[]; body: Block[] };

export const EMPTY_DOC: Doc = { preamble: [], body: [] };

/** Which text field of a block an inline edit targets. Lives here, not in `layout`,
 *  so `model` never has to import from `layout` — that would be a cycle. */
export type EditField = 'label' | 'cond' | 'thenLabel' | 'elseLabel' | 'isLabel' | 'endLabel' | 'note';
