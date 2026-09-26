import { newId } from './ids';
import type { Block, BlockKind, NodeId } from './types';

export function createBlock(kind: BlockKind, id: NodeId = newId()): Block {
  switch (kind) {
    case 'action': return { id, kind: 'action', label: 'action' };
    case 'stop':   return { id, kind: 'stop' };
    case 'end':    return { id, kind: 'end' };
    case 'if':     return {
      id, kind: 'if',
      branches: [{ cond: 'condition?', thenLabel: 'yes', body: [] }],
      elseBody: [], elseLabel: 'no',
    };
    case 'while':  return { id, kind: 'while', cond: 'condition?', isLabel: 'yes', endLabel: 'no', body: [] };
    case 'repeat': return { id, kind: 'repeat', body: [], cond: 'again?', isLabel: 'yes' };
    case 'fork':   return { id, kind: 'fork', branches: [[], []] };
  }
}
