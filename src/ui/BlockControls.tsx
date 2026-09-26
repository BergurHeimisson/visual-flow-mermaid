import type { Block } from '../model/types';

export function BlockControls({ block, onAddBranch, onToggleElse, onRemoveBranch, onDelete }: {
  block: Block;
  onAddBranch: () => void; onToggleElse: () => void; onDelete: () => void;
  onRemoveBranch?: (index: number) => void;
}) {
  const branching = block.kind === 'if' || block.kind === 'fork';
  // The floors `removeBranch` itself enforces: an `if` keeps at least one branch (it would
  // otherwise have no condition at all), a `fork` at least two columns (one column is not a
  // fork). The control simply disappears at the floor rather than offering a no-op.
  const branchCount = branching ? block.branches.length : 0;
  const canRemoveBranch = branching && branchCount > (block.kind === 'if' ? 1 : 2);
  const cls = 'rounded border border-line bg-surface px-2 py-1 text-xs text-ink hover:border-accent';
  const dangerCls = 'rounded border border-line bg-surface px-2 py-1 text-xs text-danger hover:border-danger';

  return (
    <div className="flex items-center gap-1">
      {branching && <button type="button" className={cls} onClick={onAddBranch}>add branch</button>}
      {canRemoveBranch && (
        <button type="button" className={cls} onClick={() => onRemoveBranch?.(branchCount - 1)}>
          remove branch
        </button>
      )}
      {block.kind === 'if' && (
        <button type="button" className={cls} onClick={onToggleElse}>
          {block.elseBody ? 'remove else' : 'add else'}
        </button>
      )}
      <button type="button" className={dangerCls} onClick={onDelete}>delete</button>
    </div>
  );
}
