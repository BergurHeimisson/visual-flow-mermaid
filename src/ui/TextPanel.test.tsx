import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { TextPanel } from './TextPanel';

test('renders the notation as read-only text', () => {
  render(<TextPanel text={'flowchart TD\nstart(("start"))\n'} />);
  expect(screen.getByText(/flowchart TD/)).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

test('copies the notation to the clipboard', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<TextPanel text={'flowchart TD\n'} />);
  await userEvent.click(screen.getByRole('button', { name: /copy/i }));
  expect(writeText).toHaveBeenCalledWith('flowchart TD\n');
});

test('confirms the copy to the user', async () => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  render(<TextPanel text="x" />);
  await userEvent.click(screen.getByRole('button', { name: /copy/i }));
  expect(await screen.findByText(/copied/i)).toBeInTheDocument();
});

test('does not throw when navigator.clipboard is absent (non-secure origin)', async () => {
  Object.assign(navigator, { clipboard: undefined });
  render(<TextPanel text="x" />);
  await expect(userEvent.click(screen.getByRole('button', { name: /copy/i }))).resolves.not.toThrow();
  expect(screen.queryByText(/copied/i)).not.toBeInTheDocument();
});
