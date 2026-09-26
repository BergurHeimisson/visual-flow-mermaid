import { useEffect, useState } from 'react';

export function TextPanel({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex h-full flex-col gap-2">
      <pre className="flex-1 overflow-auto whitespace-pre rounded bg-surface p-2
                      font-mono text-[12px] leading-5 text-ink">{text}</pre>
      <div className="flex items-center justify-end gap-2">
        {copied && <span className="text-xs text-ink-muted">copied</span>}
        <button
          type="button"
          className="rounded border border-line px-2 py-1 text-xs text-ink hover:border-accent"
          onClick={async () => {
            if (!navigator.clipboard) return;
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          copy
        </button>
      </div>
    </div>
  );
}
