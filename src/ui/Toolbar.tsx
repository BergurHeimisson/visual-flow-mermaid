import type { Theme } from './theme';

const BTN = 'rounded border border-line px-2 py-1 text-xs text-ink hover:border-accent disabled:opacity-40';

export function Toolbar({
  theme, onToggleTheme, zoom, onZoom, onNew, onOpen, onSave, onSaveAs, canSave,
}: {
  theme: Theme; onToggleTheme: () => void;
  zoom: number; onZoom: (zoom: number) => void;
  onNew: () => void; onOpen: () => void; onSave: () => void; onSaveAs: () => void;
  canSave: boolean;
}) {
  const step = (factor: number) =>
    onZoom(Math.min(3, Math.max(0.5, Math.round(zoom * factor * 100) / 100)));

  return (
    <header className="flex items-center gap-2 border-b border-line bg-surface-2 px-3 py-2">
      <span className="mr-2 text-sm font-semibold text-ink">visual-flow-mermaid</span>
      <button type="button" className={BTN} onClick={onNew}>New</button>
      <button type="button" className={BTN} onClick={onOpen}>Open</button>
      <button type="button" className={BTN} onClick={onSave} disabled={!canSave}>Save</button>
      <button type="button" className={BTN} onClick={onSaveAs}>Save As</button>

      <div className="ml-auto flex items-center gap-1">
        <button type="button" aria-label="Zoom out" className={BTN} onClick={() => step(1 / 1.25)}>-</button>
        <button type="button" aria-label="Fit" className={BTN} onClick={() => onZoom(1)}>fit</button>
        <button type="button" aria-label="Zoom in" className={BTN} onClick={() => step(1.25)}>+</button>
        <button type="button" aria-label="Toggle theme" className={BTN} onClick={onToggleTheme}>
          {theme === 'dark' ? 'D' : 'L'}
        </button>
      </div>
    </header>
  );
}
