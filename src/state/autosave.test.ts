import { beforeEach, expect, test, vi } from 'vitest';
import { loadAutosave, saveAutosave } from './autosave';
import { normalizeIds } from '../mermaid/testing/arbitrary';
import type { Doc } from '../model/types';

beforeEach(() => localStorage.clear());

const doc: Doc = { preamble: [], body: [{ id: 'a', kind: 'action', label: 'A' }] };

test('returns null when nothing has been saved', () => {
  expect(loadAutosave()).toBeNull();
});

test('round-trips a document through storage', () => {
  // Autosave persists this app's Mermaid text, and ids are not part of that notation —
  // parse() regenerates fresh ids on every parse, a behaviour pinned by
  // mermaid/roundtrip.test.ts ("parse(serialize(doc)) equals doc, modulo ids"). So the
  // round trip is verified structurally, not by exact id equality.
  saveAutosave(doc);
  expect(normalizeIds(loadAutosave()!)).toEqual(normalizeIds(doc));
});

test('returns null rather than throwing on corrupted storage', () => {
  localStorage.setItem('vfm.autosave', '{not json');
  expect(loadAutosave()).toBeNull();
});

test('returns null when the stored value is not a document', () => {
  localStorage.setItem('vfm.autosave', '{"nope":1}');
  expect(loadAutosave()).toBeNull();
});

// --- Final review, I5: loadAutosave was the only unguarded storage read ----------------
//
// Reproduction (before the fix): saveAutosave, loadTheme and saveTheme all wrapped their
// storage access; loadAutosave did not. Where storage is blocked (Safari private mode,
// a "block all cookies" setting), getItem THROWS during App init and the app rendered
// nothing at all.
test('returns null rather than throwing when storage itself is blocked', () => {
  const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  });
  try {
    expect(loadAutosave()).toBeNull();
  } finally {
    getItem.mockRestore();
  }
});
