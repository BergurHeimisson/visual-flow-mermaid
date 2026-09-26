import { parse } from '../mermaid/parse';
import { serialize } from '../mermaid/serialize';
import type { Doc } from '../model/types';

const KEY = 'vfm.autosave';

export function saveAutosave(doc: Doc): void {
  try {
    localStorage.setItem(KEY, serialize(doc));
  } catch {
    // Storage may be full or blocked (e.g. Safari private mode); losing the autosave
    // is acceptable, silently corrupting or crashing on it is not.
  }
}

export function loadAutosave(): Doc | null {
  let text: string | null;
  try {
    text = localStorage.getItem(KEY);
  } catch {
    // Storage can be blocked outright (Safari private mode, "block all cookies"), in which
    // case getItem THROWS rather than returning null. This is called during App init, so an
    // unguarded read took the whole app down with it and rendered nothing at all.
    return null;
  }
  if (!text) return null;
  const result = parse(text);
  return result.ok ? result.doc : null;
}
