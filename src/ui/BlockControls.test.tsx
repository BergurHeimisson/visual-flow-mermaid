import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { BlockControls } from './BlockControls';
import type { Block } from '../model/types';

const ifBlock: Block = {
  id: 'i', kind: 'if', branches: [{ cond: 'c?', body: [] }], elseBody: [], elseLabel: 'no',
};

test('offers add-branch and else toggle for a decision', () => {
  render(<BlockControls block={ifBlock} onAddBranch={() => {}} onToggleElse={() => {}} onDelete={() => {}} />);
  expect(screen.getByRole('button', { name: /add branch/i })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /else/i })).toBeInTheDocument();
});

test('offers add-branch but no else toggle for a fork', () => {
  const fork: Block = { id: 'f', kind: 'fork', branches: [[], []] };
  render(<BlockControls block={fork} onAddBranch={() => {}} onToggleElse={() => {}} onDelete={() => {}} />);
  expect(screen.getByRole('button', { name: /add branch/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /else/i })).not.toBeInTheDocument();
});

test('offers only delete for a leaf block', () => {
  const action: Block = { id: 'a', kind: 'action', label: 'A' };
  render(<BlockControls block={action} onAddBranch={() => {}} onToggleElse={() => {}} onDelete={() => {}} />);
  expect(screen.queryByRole('button', { name: /add branch/i })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
});

test('reports add-branch clicks', async () => {
  const onAddBranch = vi.fn();
  render(<BlockControls block={ifBlock} onAddBranch={onAddBranch} onToggleElse={() => {}} onDelete={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /add branch/i }));
  expect(onAddBranch).toHaveBeenCalled();
});

test('reports toggle-else clicks and reflects current else state', async () => {
  const onToggleElse = vi.fn();
  const { rerender } = render(
    <BlockControls block={ifBlock} onAddBranch={() => {}} onToggleElse={onToggleElse} onDelete={() => {}} />,
  );
  expect(screen.getByRole('button', { name: /remove else/i })).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /remove else/i }));
  expect(onToggleElse).toHaveBeenCalled();

  const withoutElse: Block = { ...ifBlock, elseBody: undefined, elseLabel: undefined };
  rerender(<BlockControls block={withoutElse} onAddBranch={() => {}} onToggleElse={onToggleElse} onDelete={() => {}} />);
  expect(screen.getByRole('button', { name: /add else/i })).toBeInTheDocument();
});

test('reports delete clicks', async () => {
  const onDelete = vi.fn();
  const action: Block = { id: 'a', kind: 'action', label: 'A' };
  render(<BlockControls block={action} onAddBranch={() => {}} onToggleElse={() => {}} onDelete={onDelete} />);
  await userEvent.click(screen.getByRole('button', { name: /delete/i }));
  expect(onDelete).toHaveBeenCalled();
});

// --- Final review, I4: removing a branch had no UI at all ------------------------------
//
// Reproduction (before the fix): `removeBranch` in model/edits.ts was implemented and
// unit-tested but referenced nowhere outside its own test — no DocAction, no control. As
// shipped you could add an elseif or a fork column and never remove it except by deleting
// the whole construct. The spec: "Removing a branch removes its body, and undo covers it
// like any other delete."
test('offers remove-branch for an if above its floor of one branch', () => {
  const twoBranch: Block = {
    id: 'i', kind: 'if', branches: [{ cond: 'a?', body: [] }, { cond: 'b?', body: [] }], elseBody: [],
  };
  render(<BlockControls block={twoBranch} onAddBranch={() => {}} onToggleElse={() => {}}
                       onRemoveBranch={() => {}} onDelete={() => {}} />);
  expect(screen.getByRole('button', { name: /remove branch/i })).toBeInTheDocument();
});

test('hides remove-branch for an if at its floor of one branch', () => {
  render(<BlockControls block={ifBlock} onAddBranch={() => {}} onToggleElse={() => {}}
                       onRemoveBranch={() => {}} onDelete={() => {}} />);
  expect(screen.queryByRole('button', { name: /remove branch/i })).not.toBeInTheDocument();
});

test('hides remove-branch for a fork at its floor of two columns, offers it at three', () => {
  const two: Block = { id: 'f', kind: 'fork', branches: [[], []] };
  const { rerender } = render(<BlockControls block={two} onAddBranch={() => {}} onToggleElse={() => {}}
                                             onRemoveBranch={() => {}} onDelete={() => {}} />);
  expect(screen.queryByRole('button', { name: /remove branch/i })).not.toBeInTheDocument();

  const three: Block = { id: 'f', kind: 'fork', branches: [[], [], []] };
  rerender(<BlockControls block={three} onAddBranch={() => {}} onToggleElse={() => {}}
                          onRemoveBranch={() => {}} onDelete={() => {}} />);
  expect(screen.getByRole('button', { name: /remove branch/i })).toBeInTheDocument();
});

test('reports remove-branch clicks with the index of the last branch', async () => {
  const onRemoveBranch = vi.fn();
  const three: Block = { id: 'f', kind: 'fork', branches: [[], [], []] };
  render(<BlockControls block={three} onAddBranch={() => {}} onToggleElse={() => {}}
                       onRemoveBranch={onRemoveBranch} onDelete={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: /remove branch/i }));
  expect(onRemoveBranch).toHaveBeenCalledWith(2);
});
