import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { useFileIO } from './useFileIO';
import type { Doc } from '../model/types';

const doc: Doc = { preamble: [], body: [{ id: 'a', kind: 'action', label: 'A' }] };

function stubPicker(text: string, name = 'flow.mmd') {
  const write = vi.fn();
  const handle = {
    name,
    getFile: async () => ({ text: async () => text }),
    createWritable: async () => ({ write, close: vi.fn() }),
  };
  (window as unknown as Record<string, unknown>).showOpenFilePicker = vi.fn(async () => [handle]);
  (window as unknown as Record<string, unknown>).showSaveFilePicker = vi.fn(async () => handle);
  return { handle, write };
}

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  window.history.pushState({}, '', '/');
  vi.restoreAllMocks();
});

test('opens a valid file and reports the parsed document', async () => {
  stubPicker('flowchart TD\nstart(("start"))\na["A"]\n');
  const { result } = renderHook(() => useFileIO());
  let outcome!: Awaited<ReturnType<typeof result.current.open>>;
  await act(async () => { outcome = await result.current.open(); });
  expect(outcome.status).toBe('ok');
  if (outcome.status === 'ok') expect(outcome.doc.body).toHaveLength(1);
  expect(result.current.fileName).toBe('flow.mmd');
  expect(result.current.canSave).toBe(true);
});

test('reports a refusal without retaining the handle', async () => {
  stubPicker('flowchart TD\nstart(("start"))\npartition x {\n');
  const { result } = renderHook(() => useFileIO());
  let outcome!: Awaited<ReturnType<typeof result.current.open>>;
  await act(async () => { outcome = await result.current.open(); });
  expect(outcome.status).toBe('error');
  expect(result.current.canSave).toBe(false);
});

test('a second open that fails to parse does not clobber the first file\'s retained handle', async () => {
  // Regression coverage for the property this task exists to guarantee: open a real
  // file successfully, retaining its handle, then attempt a second open that the
  // parser refuses. The FIRST file's handle — and therefore where Save writes — must
  // survive untouched. A refused import must never leave Save pointing at a
  // different file than the one the canvas actually loaded.
  const { write } = stubPicker('flowchart TD\nstart(("start"))\na["A"]\n', 'good.mmd');
  const { result } = renderHook(() => useFileIO());

  let first!: Awaited<ReturnType<typeof result.current.open>>;
  await act(async () => { first = await result.current.open(); });
  expect(first.status).toBe('ok');
  expect(result.current.fileName).toBe('good.mmd');
  expect(result.current.canSave).toBe(true);

  // A different file, picked second, that fails to parse.
  stubPicker('flowchart TD\nstart(("start"))\npartition x {\n', 'bad.mmd');
  let second!: Awaited<ReturnType<typeof result.current.open>>;
  await act(async () => { second = await result.current.open(); });
  expect(second.status).toBe('error');

  // The first file's handle must still be the one in play.
  expect(result.current.fileName).toBe('good.mmd');
  expect(result.current.canSave).toBe(true);

  await act(async () => { await result.current.save(doc); });
  expect(write).toHaveBeenCalledWith(expect.stringContaining('["A"]'));
});

test('reports cancellation when the picker is dismissed', async () => {
  (window as unknown as Record<string, unknown>).showOpenFilePicker =
    vi.fn(async () => { throw new DOMException('aborted', 'AbortError'); });
  const { result } = renderHook(() => useFileIO());
  let outcome!: Awaited<ReturnType<typeof result.current.open>>;
  await act(async () => { outcome = await result.current.open(); });
  expect(outcome.status).toBe('cancelled');
});

test('save writes serialized text back through the retained handle', async () => {
  const { write } = stubPicker('flowchart TD\nstart(("start"))\na["A"]\n');
  const { result } = renderHook(() => useFileIO());
  await act(async () => { await result.current.open(); });
  await act(async () => { await result.current.save(doc); });
  expect(write).toHaveBeenCalledWith(expect.stringContaining('["A"]'));
});

test('canSave is false when no file has been opened', () => {
  const { result } = renderHook(() => useFileIO());
  expect(result.current.canSave).toBe(false);
});

// --- ?nofsa=1 escape hatch -------------------------------------------------
//
// Playwright cannot script the native File System Access picker, and Chromium always
// exposes showOpenFilePicker, so e2e tests need a way to force the hidden-<input>/
// download fallback even in a real Chromium browser. Task 20 navigates to /?nofsa=1
// for its file tests; these tests pin the hook's side of that contract.

function stubInputPicker(file: File | null) {
  const originalCreateElement = document.createElement.bind(document);
  return vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = originalCreateElement(tag) as HTMLInputElement;
    if (tag === 'input') {
      Object.defineProperty(el, 'files', { value: file ? [file] : [] });
      queueMicrotask(() => el.dispatchEvent(new Event('change')));
    }
    return el;
  });
}

test('open() ignores the File System Access API when the URL carries ?nofsa=1', async () => {
  const { handle } = stubPicker('unused');
  window.history.pushState({}, '', '/?nofsa=1');
  const file = new File(['flowchart TD\nstart(("start"))\na["A"]\n'], 'flow.mmd', { type: 'text/plain' });
  stubInputPicker(file);

  const { result } = renderHook(() => useFileIO());
  let outcome!: Awaited<ReturnType<typeof result.current.open>>;
  await act(async () => { outcome = await result.current.open(); });

  expect((window as unknown as Record<string, unknown>).showOpenFilePicker).not.toHaveBeenCalled();
  expect(outcome.status).toBe('ok');
  expect(result.current.fileName).toBe('flow.mmd');
  // The hidden-<input> fallback never yields a writable handle.
  expect(result.current.canSave).toBe(false);
  void handle;
});

test('saveAs() ignores the File System Access API when the URL carries ?nofsa=1', async () => {
  stubPicker('unused');
  window.history.pushState({}, '', '/?nofsa=1');

  const originalCreateElement = document.createElement.bind(document);
  const anchorClick = vi.fn();
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = originalCreateElement(tag);
    if (tag === 'a') el.click = anchorClick;
    return el;
  });
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });

  const { result } = renderHook(() => useFileIO());
  await act(async () => { await result.current.saveAs(doc); });

  expect((window as unknown as Record<string, unknown>).showSaveFilePicker).not.toHaveBeenCalled();
  expect(anchorClick).toHaveBeenCalled();
  expect(result.current.canSave).toBe(false);
});
