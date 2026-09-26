import { beforeEach, expect, test, vi } from 'vitest';
import { applyTheme, loadTheme, saveTheme } from './theme';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});

test('defaults to dark when nothing is stored', () => {
  expect(loadTheme()).toBe('dark');
});

test('round-trips a stored preference', () => {
  saveTheme('light');
  expect(loadTheme()).toBe('light');
});

test('ignores a corrupted stored value and falls back to dark', () => {
  localStorage.setItem('vfm.theme', 'banana');
  expect(loadTheme()).toBe('dark');
});

test('applyTheme adds and removes the dark class', () => {
  applyTheme('dark');
  expect(document.documentElement).toHaveClass('dark');
  applyTheme('light');
  expect(document.documentElement).not.toHaveClass('dark');
});

test('falls back to dark when localStorage.getItem throws', () => {
  const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(loadTheme()).toBe('dark');
  spy.mockRestore();
});

test('does not throw when localStorage.setItem throws', () => {
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota exceeded');
  });
  expect(() => saveTheme('light')).not.toThrow();
  spy.mockRestore();
});
