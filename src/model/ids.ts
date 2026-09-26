import type { NodeId } from './types';

let counter = 0;

export function newId(): NodeId {
  counter += 1;
  return `b${counter}_${Math.random().toString(36).slice(2, 8)}`;
}
