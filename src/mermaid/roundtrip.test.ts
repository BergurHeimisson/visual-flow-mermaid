import { expect, test } from 'vitest';
import { parse } from './parse';
import { serialize } from './serialize';
import { normalizeIds, randomDoc } from './testing/arbitrary';

test('parse(serialize(doc)) equals doc, modulo ids, for 200 generated documents', () => {
  for (let seed = 1; seed <= 200; seed += 1) {
    const doc = randomDoc(seed);
    const text = serialize(doc);
    const result = parse(text);

    if (!result.ok) {
      throw new Error(`seed ${seed} failed to parse at line ${result.error.line}: ${result.error.message}\n${text}`);
    }
    expect(normalizeIds(result.doc), `seed ${seed}\n${text}`).toEqual(normalizeIds(doc));
  }
});

test('serialize is idempotent across a round trip', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const text = serialize(randomDoc(seed));
    const again = parse(text);
    expect(again.ok).toBe(true);
    if (again.ok) expect(serialize(again.doc)).toBe(text);
  }
});
