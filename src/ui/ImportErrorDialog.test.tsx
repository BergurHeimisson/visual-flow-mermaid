import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { ImportErrorDialog } from './ImportErrorDialog';

test('names the file, the line, and the construct, and reassures about the canvas', () => {
  render(
    <ImportErrorDialog
      fileName="flow.mmd"
      error={{ kind: 'unsupported', line: 7, construct: 'subgraph', message: 'subgraph is not supported in this version.' }}
      onClose={() => {}}
    />,
  );
  expect(screen.getByText(/flow\.mmd/)).toBeInTheDocument();
  expect(screen.getByText(/line 7/i)).toBeInTheDocument();
  expect(screen.getByText(/subgraph is not supported/i)).toBeInTheDocument();
  expect(screen.getByText(/was not changed/i)).toBeInTheDocument();
});

test('closes on OK', async () => {
  const onClose = vi.fn();
  render(<ImportErrorDialog fileName="f.mmd" error={{ kind: 'syntax', line: 2, message: 'Expected `end`.' }} onClose={onClose} />);
  await userEvent.click(screen.getByRole('button', { name: /ok/i }));
  expect(onClose).toHaveBeenCalled();
});
