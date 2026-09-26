import { useCallback, useRef, useState } from 'react';
import { parse, type IgnoredLine, type ParseError } from '../mermaid/parse';
import { serialize } from '../mermaid/serialize';
import type { Doc } from '../model/types';

export type OpenOutcome =
  | { status: 'cancelled' }
  | { status: 'error'; fileName: string; error: ParseError }
  | { status: 'ok'; fileName: string; doc: Doc; ignored: IgnoredLine[] };

type Writable = { write(data: string): Promise<void> | void; close(): Promise<void> | void };
type Handle = {
  name: string;
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<Writable>;
};

type Picker = {
  showOpenFilePicker?: (options?: unknown) => Promise<Handle[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<Handle>;
};
const picker = () => window as unknown as Picker;

/**
 * The single place that answers "can we use the File System Access API?" — both
 * `open` and `saveAs` route through this, so the `?nofsa=1` escape hatch (Playwright
 * cannot script the native file picker, and Chromium always exposes
 * showOpenFilePicker) only needs to be honoured in one spot.
 */
function hasFsa(): boolean {
  if (new URLSearchParams(window.location.search).get('nofsa') === '1') return false;
  return typeof picker().showOpenFilePicker === 'function';
}

const ACCEPT = [{ description: 'Mermaid', accept: { 'text/plain': ['.mmd', '.mermaid'] } }];

function pickViaInput(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mmd,.mermaid,.txt';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function useFileIO() {
  const handleRef = useRef<Handle | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [canSave, setCanSave] = useState(false);

  const open = useCallback(async (): Promise<OpenOutcome> => {
    let name: string;
    let text: string;
    let handle: Handle | null = null;

    try {
      if (hasFsa()) {
        const [chosen] = await picker().showOpenFilePicker!({ types: ACCEPT });
        handle = chosen;
        name = chosen.name;
        text = await (await chosen.getFile()).text();
      } else {
        const file = await pickViaInput();
        if (!file) return { status: 'cancelled' };
        name = file.name;
        text = await file.text();
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return { status: 'cancelled' };
      throw err;
    }

    const result = parse(text);
    if (!result.ok) return { status: 'error', fileName: name, error: result.error };

    // Only retain the handle when the parse succeeds: a refused import must never
    // leave Save pointing at a file the canvas never loaded.
    handleRef.current = handle;
    setFileName(name);
    setCanSave(handle !== null);
    return { status: 'ok', fileName: name, doc: result.doc, ignored: result.ignored };
  }, []);

  const saveAs = useCallback(async (doc: Doc) => {
    const text = serialize(doc);
    const suggestedName = fileName ?? 'diagram.mmd';

    if (hasFsa() && typeof picker().showSaveFilePicker === 'function') {
      const handle = await picker().showSaveFilePicker!({ suggestedName, types: ACCEPT });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      handleRef.current = handle;
      setFileName(handle.name);
      setCanSave(true);
      return;
    }
    handleRef.current = null;
    setCanSave(false);
    download(suggestedName, text);
  }, [fileName]);

  const save = useCallback(async (doc: Doc) => {
    const handle = handleRef.current;
    if (!handle) { await saveAs(doc); return; }
    const writable = await handle.createWritable();
    await writable.write(serialize(doc));
    await writable.close();
  }, [saveAs]);

  const reset = useCallback(() => {
    handleRef.current = null;
    setFileName(null);
    setCanSave(false);
  }, []);

  return { fileName, canSave, open, save, saveAs, reset };
}
