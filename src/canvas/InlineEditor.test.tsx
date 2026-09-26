import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { expect, test, vi } from 'vitest';
import { InlineEditor } from './InlineEditor';

const rect = { x: 10, y: 20, w: 100, h: 30 };

test('mounts focused with the current value selected', () => {
  render(<InlineEditor value="hello" {...rect} onCommit={() => {}} onCancel={() => {}} />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  expect(input).toHaveFocus();
  expect(input.value).toBe('hello');
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(5);
});

test('commits on Enter', async () => {
  const onCommit = vi.fn();
  render(<InlineEditor value="a" {...rect} onCommit={onCommit} onCancel={() => {}} />);
  await userEvent.clear(screen.getByRole('textbox'));
  await userEvent.type(screen.getByRole('textbox'), 'changed{Enter}');
  expect(onCommit).toHaveBeenCalledWith('changed');
});

test('commits on blur', async () => {
  const onCommit = vi.fn();
  render(<InlineEditor value="a" {...rect} onCommit={onCommit} onCancel={() => {}} />);
  await userEvent.clear(screen.getByRole('textbox'));
  await userEvent.type(screen.getByRole('textbox'), 'b');
  await userEvent.tab();
  expect(onCommit).toHaveBeenCalledWith('b');
});

test('cancels on Escape without committing', async () => {
  const onCommit = vi.fn();
  const onCancel = vi.fn();
  render(<InlineEditor value="a" {...rect} onCommit={onCommit} onCancel={onCancel} />);
  await userEvent.type(screen.getByRole('textbox'), '{Escape}');
  expect(onCancel).toHaveBeenCalled();
  expect(onCommit).not.toHaveBeenCalled();
});

test('positions itself over the target rect', () => {
  render(<InlineEditor value="a" {...rect} onCommit={() => {}} onCancel={() => {}} />);
  expect(screen.getByRole('textbox')).toHaveStyle({ left: '10px', top: '20px', width: '100px' });
});

// App unmounts the InlineEditor as soon as onCommit fires (setEdit(null) after apply()).
// Per the HTML spec, removing a focused element from the document fires a native blur —
// a naive implementation that only guards the Escape path (not Enter) would run onBlur's
// commit a second time for a single Enter keypress. Exercise the unmount host pattern...
test('a single Enter produces exactly one commit even when the host unmounts on commit', async () => {
  const onCommit = vi.fn();

  function Host() {
    const [open, setOpen] = useState(true);
    if (!open) return null;
    return (
      <InlineEditor
        value="a"
        {...rect}
        onCommit={(value) => { onCommit(value); setOpen(false); }}
        onCancel={() => setOpen(false)}
      />
    );
  }

  render(<Host />);
  await userEvent.clear(screen.getByRole('textbox'));
  await userEvent.type(screen.getByRole('textbox'), 'changed{Enter}');

  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith('changed');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

// ...and directly, since jsdom does not reproduce blur-on-detach: fire blur explicitly
// after Enter, standing in for a real browser unfocusing the element as it is removed.
test('a trailing blur after Enter does not commit a second time', async () => {
  const onCommit = vi.fn();
  render(<InlineEditor value="a" {...rect} onCommit={onCommit} onCancel={() => {}} />);
  await userEvent.clear(screen.getByRole('textbox'));
  await userEvent.type(screen.getByRole('textbox'), 'changed{Enter}');
  fireEvent.blur(screen.getByRole('textbox'));

  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith('changed');
});
