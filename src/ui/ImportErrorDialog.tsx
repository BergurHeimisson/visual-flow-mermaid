import type { ParseError } from '../mermaid/parse';

export function ImportErrorDialog({ fileName, error, onClose }: {
  fileName: string; error: ParseError; onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-scrim/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Import failed"
        className="w-96 rounded border border-line bg-surface p-4 text-ink shadow-lg"
      >
        <h2 className="mb-3 text-sm font-semibold">Cannot open {fileName}</h2>
        <p className="mb-1 font-mono text-xs text-ink-muted">Line {error.line}</p>
        <p className="mb-3 text-sm">{error.message}</p>
        <p className="mb-4 text-xs text-ink-muted">Your current diagram was not changed.</p>
        <div className="flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={onClose}
            className="rounded border border-line px-3 py-1 text-xs hover:border-accent"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
