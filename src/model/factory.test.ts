import { expect, test } from 'vitest';
import { createBlock } from './factory';

test('action gets the spec default label', () => {
  expect(createBlock('action', 'x')).toEqual({ id: 'x', kind: 'action', label: 'action' });
});

test('if gets one branch, an else arm, and yes/no labels', () => {
  expect(createBlock('if', 'x')).toEqual({
    id: 'x', kind: 'if',
    branches: [{ cond: 'condition?', thenLabel: 'yes', body: [] }],
    elseBody: [], elseLabel: 'no',
  });
});

test('while and repeat get their spec default conditions', () => {
  expect(createBlock('while', 'x')).toMatchObject({ cond: 'condition?', body: [] });
  expect(createBlock('repeat', 'x')).toMatchObject({ cond: 'again?', body: [] });
});

test('fork starts with two empty parallel branches', () => {
  expect(createBlock('fork', 'x')).toEqual({ id: 'x', kind: 'fork', branches: [[], []] });
});

test('terminators carry no extra fields', () => {
  expect(createBlock('stop', 'x')).toEqual({ id: 'x', kind: 'stop' });
  expect(createBlock('end', 'x')).toEqual({ id: 'x', kind: 'end' });
});
