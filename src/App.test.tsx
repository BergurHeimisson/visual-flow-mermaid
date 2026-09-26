import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { CANVAS_PAD } from './canvas/Canvas';

// Stubs the File System Access API on `window` the same way useFileIO.test.ts does,
// so Open/Save As exercise the real useFileIO hook deterministically instead of
// falling back to a real (unscriptable) file picker or hidden-<input> dialog.
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

beforeEach(() => localStorage.clear());

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
  delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
  localStorage.clear();
  vi.useRealTimers();
});

test('renders the app shell with all three panes', () => {
  render(<App />);
  expect(screen.getByRole('region', { name: /palette/i })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: /canvas/i })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: /mermaid/i })).toBeInTheDocument();
});

test('clicking a palette construct adds it to the canvas', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /action/i }));
  expect(screen.getByText('action')).toBeInTheDocument();
});

test('clicking a second construct appends it after the first', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  await userEvent.click(screen.getByRole('button', { name: /stop/i }));
  expect(screen.getAllByTestId(/^box:/)).toHaveLength(3); // start + action + stop
});

test('double-clicking a box opens an inline editor; Enter commits the new label', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));

  await userEvent.dblClick(screen.getByText('action'));
  const input = screen.getByRole('textbox') as HTMLInputElement;
  expect(input.value).toBe('action');

  await userEvent.clear(input);
  await userEvent.type(input, 'greet user{Enter}');

  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByText('greet user')).toBeInTheDocument();
  expect(screen.queryByText('action')).not.toBeInTheDocument();
});

test('positions the inline editor over its box when zoomed in', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  // Attach a note so the edited box sits off-centre (x !== 0) — an action box alone
  // lands exactly on the diagram's centre spine, which would leave a horizontal
  // scaling bug undetected.
  await userEvent.click(screen.getByRole('button', { name: /^note/i }));

  // One zoom-in step: 1 * 1.25 = 1.25 (see Toolbar's step formula).
  await userEvent.click(screen.getByRole('button', { name: /zoom in/i }));

  await userEvent.dblClick(screen.getByText('note'));

  const box = screen.getByText('note').closest('[data-testid^="note:"]')!;
  const shape = box.querySelector('rect')!;
  const x = Number(shape.getAttribute('x'));
  const y = Number(shape.getAttribute('y'));
  const w = Number(shape.getAttribute('width'));
  const h = Number(shape.getAttribute('height'));
  expect(x).not.toBe(0); // sanity: this box must be off-centre for the test to be meaningful

  const input = screen.getByRole('textbox');
  expect(input).toHaveStyle({
    left: `${x * 1.25 + CANVAS_PAD}px`,
    top: `${y * 1.25 + CANVAS_PAD}px`,
    width: `${w * 1.25}px`,
    height: `${h * 1.25}px`,
  });
});

test('Escape cancels an inline edit without changing the label', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));

  await userEvent.dblClick(screen.getByText('action'));
  await userEvent.type(screen.getByRole('textbox'), ' more{Escape}');

  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.getByText('action')).toBeInTheDocument();
});

test('Enter on a selection opens an editor for its primary field', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i })); // auto-selected

  await userEvent.keyboard('{Enter}');

  const input = screen.getByRole('textbox') as HTMLInputElement;
  expect(input.value).toBe('action');
});

test('Delete removes the selected block', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  expect(screen.getByText('action')).toBeInTheDocument();

  await userEvent.keyboard('{Delete}');

  expect(screen.queryByText('action')).not.toBeInTheDocument();
});

test('Delete does not remove the block while its inline editor is open', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  await userEvent.dblClick(screen.getByText('action'));

  await userEvent.keyboard('{Delete}');

  expect(screen.getByRole('textbox')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.getByText('action')).toBeInTheDocument();
});

// --- User-reported: "I cannot get rid of the delete. Which means I cannot really take a
// good screenshot." Escape is the keyboard half of the fix; the pointer half (clicking the
// pane) is covered below and, for real positioning, in e2e/editor.spec.ts.
test('Escape clears the selection, dismissing the controls bar', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /decision/i }));
  expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();

  await userEvent.keyboard('{Escape}');

  expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
});

test('Escape while editing cancels the edit without also clearing the selection underneath it', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  await userEvent.dblClick(screen.getByText('action'));
  expect(screen.getByRole('textbox')).toBeInTheDocument();

  await userEvent.keyboard('{Escape}');

  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  // Still selected: the controls bar (hidden only while `edit` was open) is back.
  expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
});

test('Cmd+Z undoes the last change', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  expect(screen.getByText('action')).toBeInTheDocument();

  await userEvent.keyboard('{Meta>}z{/Meta}');

  expect(screen.queryByText('action')).not.toBeInTheDocument();
});

test('selecting a decision offers block controls; add branch adds another branch', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /decision/i }));

  expect(screen.getAllByText('condition?')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: /add branch/i }));
  expect(screen.getAllByText('condition?')).toHaveLength(2);
});

test('block controls delete removes the whole selected block', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /decision/i }));
  expect(screen.getByText('condition?')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /^delete$/i }));

  expect(screen.queryByText('condition?')).not.toBeInTheDocument();
});

// --- Guards for the pane-level deselect added below: a click on the controls bar itself
// must not bubble into it and clear the selection before (or instead of) the bar's own
// action runs — that would dismiss the bar rather than, say, add the branch.
test('clicking a control on the bar does not clear the selection first', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /decision/i }));

  await userEvent.click(screen.getByRole('button', { name: /add branch/i }));

  expect(screen.getAllByText('condition?')).toHaveLength(2); // the click did its own job...
  expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument(); // ...and stayed selected
});

test('clicking inside the inline editor does not clear the selection underneath it', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  await userEvent.dblClick(screen.getByText('action'));

  await userEvent.click(screen.getByRole('textbox')); // reposition the caret
  await userEvent.keyboard('{Escape}'); // back out of the edit

  expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument(); // still selected
});

// --- User-reported: "I cannot get rid of the delete... cannot really take a good
// screenshot." The real positional click (a point inside the pane but outside the small
// diagram) is proven in e2e/editor.spec.ts, which is the only environment that lays
// anything out; this jsdom test only proves the pane's own click handler is wired and that
// the deselect fires for a click that reaches the pane itself (not a child that claimed it).
test('clicking the canvas pane itself (not any shape) clears the selection', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('region', { name: /^canvas$/i }));

  expect(screen.queryByRole('button', { name: /^delete$/i })).not.toBeInTheDocument();
});

// --- Part 1: empty branches must be targetable without a drag -------------------------
//
// User report: "I wanted to add an action after the no decision. I couldn't select to do
// that." An empty branch renders as nothing but an arrow — no shape to click — and
// click-to-insert (`insertionPoint`) needs a selection, which an empty branch could never
// have. `layout()` already emits exactly one drop zone for an empty sequence; Part 1
// renders it persistently (dashed, always visible, clickable) instead of drag-only, and
// clicking it selects that SLOT so the next palette click inserts there. Assert the
// resulting document (via the serialized notation), not just that some handler fired.
test('clicking an empty branch placeholder selects a slot; the next palette click fills it', async () => {
  render(<App />);
  const panel = screen.getByRole('region', { name: /mermaid/i });

  await userEvent.click(screen.getByRole('button', { name: /decision/i }));
  await expect.poll(() => panel.textContent).toMatch(
    /%% if\n\w+\{"condition\?"\}\n%% then \(yes\)\n%% else \(no\)\n%% endif/,
  );

  // The yes-branch's own empty-sequence zone (path `[{block:if,slot:'branch',index:0}]`,
  // index 0) is the one persistent zone whose id ends in "#0:0" — see `pathKey` in
  // layout.ts. Click it, then Action, to put an action in the YES arm.
  await userEvent.click(screen.getByTestId(/#0:0$/));
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  await expect.poll(() => panel.textContent).toMatch(
    /%% then \(yes\)\n\s+\w+ -- yes --> \w+\n\s+\w+\["action"\]\n%% else \(no\)\n%% endif/,
  );

  // Now the else arm — the user's exact reported case. Its zone's id ends "#else:0".
  await userEvent.click(screen.getByTestId(/#else:0$/));
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  await expect.poll(() => panel.textContent).toMatch(
    /%% then \(yes\)\n\s+\w+ -- yes --> \w+\n\s+\w+\["action"\]\n%% else \(no\)\n\s+\w+ -- no --> \w+\n\s+\w+\["action"\]\n%% endif/,
  );
});

test('selecting a placeholder clears the block selection, and vice versa', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /decision/i }));
  // Creating the decision auto-selects it — clicking a placeholder must supersede that.
  await userEvent.click(screen.getByTestId(/#0:0$/));
  expect(screen.getByTestId(/#0:0$/)).toHaveAttribute('data-selected', 'true');

  // Selecting a real block (the condition diamond) must clear the slot back off again.
  await userEvent.click(screen.getByText('condition?'));
  expect(screen.getByTestId(/#0:0$/)).toHaveAttribute('data-selected', 'false');
});

test('the panel reflects canvas edits immediately', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  expect(screen.getByText(/\["action"\]/)).toBeInTheDocument();
});

test('collapses and restores the Mermaid panel', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /hide mermaid panel/i }));
  expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /show mermaid panel/i }));
  expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument();
});

// --- File I/O integration (Task 19) ----------------------------------------------

test('a refused Open renders the import error dialog and leaves the diagram unchanged', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /^action/i }));
  expect(screen.getByText(/\["action"\]/)).toBeInTheDocument();

  stubPicker('flowchart TD\nstart(("start"))\npartition x {\n', 'bad.mmd');
  await userEvent.click(screen.getByRole('button', { name: /^open$/i }));

  const dialog = screen.getByRole('dialog', { name: /import failed/i });
  expect(within(dialog).getByText(/bad\.mmd/)).toBeInTheDocument();
  expect(within(dialog).getByText(/line 3/i)).toBeInTheDocument();

  // The currently open document is untouched by a refused import.
  expect(screen.getByText(/\["action"\]/)).toBeInTheDocument();
});

test('dismissing the import error dialog with OK removes it', async () => {
  render(<App />);
  stubPicker('flowchart TD\nstart(("start"))\npartition x {\n', 'bad.mmd');
  await userEvent.click(screen.getByRole('button', { name: /^open$/i }));
  expect(screen.getByRole('dialog', { name: /import failed/i })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /^ok$/i }));

  expect(screen.queryByRole('dialog', { name: /import failed/i })).not.toBeInTheDocument();
});

test('an Open with ignored lines shows the exact count in a dismissible notice, distinct from the refusal dialog', async () => {
  render(<App />);
  // Two cosmetic comment lines that land after the first structural line are ignored
  // rather than rejected: parse() still succeeds, but reports them.
  stubPicker('flowchart TD\nstart(("start"))\na["A"]\n%% custom one\n%% custom two\n', 'flow.mmd');
  await userEvent.click(screen.getByRole('button', { name: /^open$/i }));

  expect(screen.getByText(/\["A"\]/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

  const notice = screen.getByRole('status');
  expect(notice).toHaveTextContent('Opened flow.mmd. 2 unsupported line(s) were ignored.');

  await userEvent.click(within(notice).getByRole('button', { name: /dismiss/i }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('New clears the document and resets canSave via file.reset()', async () => {
  render(<App />);
  stubPicker('flowchart TD\nstart(("start"))\na["A"]\n', 'flow.mmd');
  await userEvent.click(screen.getByRole('button', { name: /^open$/i }));
  expect(screen.getByText(/\["A"\]/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^save$/i })).toBeEnabled();

  await userEvent.click(screen.getByRole('button', { name: /^new$/i }));

  expect(screen.queryByText(/\["A"\]/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^save$/i })).toBeDisabled();
});

test('restores the document from autosave on mount', () => {
  localStorage.setItem('vfm.autosave', 'flowchart TD\nstart(("start"))\nr["Restored"]\n');
  render(<App />);
  expect(screen.getByText('Restored')).toBeInTheDocument();
});

test('the debounced autosave writes localStorage after an edit, once the debounce elapses', () => {
  // Fake timers must be installed before the edit, so the debounce effect's own
  // setTimeout(..., 500) is the one under our control rather than a real one already
  // ticking in the background. A plain synchronous fireEvent.click (rather than
  // userEvent) sidesteps userEvent's internal pointer-event timers, which don't mix
  // well with vi.useFakeTimers() — the state change is what this test cares about,
  // not realistic pointer sequencing (already covered elsewhere in this file).
  vi.useFakeTimers();
  try {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /^action/i }));
    expect(screen.getByText(/\["action"\]/)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(499); });
    expect(localStorage.getItem('vfm.autosave')).toBeNull(); // not yet — debounce hasn't elapsed

    act(() => { vi.advanceTimersByTime(1); });
    expect(localStorage.getItem('vfm.autosave')).toContain('["action"]');
  } finally {
    vi.useRealTimers();
  }
});

// --- Final review, I4: the remove-branch control is wired end to end -------------------
test('add branch then remove branch returns the decision to one branch, and undo restores it', async () => {
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: /decision/i }));
  expect(screen.getAllByText('condition?')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: /remove branch/i })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /add branch/i }));
  expect(screen.getAllByText('condition?')).toHaveLength(2);

  await userEvent.click(screen.getByRole('button', { name: /remove branch/i }));
  expect(screen.getAllByText('condition?')).toHaveLength(1);

  await userEvent.keyboard('{Meta>}z{/Meta}');
  expect(screen.getAllByText('condition?')).toHaveLength(2);
});

// --- Final review, I5: a blocked localStorage must not stop the app rendering ----------
test('renders even when localStorage reads throw', () => {
  const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  });
  try {
    render(<App />);
    expect(screen.getByRole('region', { name: /canvas/i })).toBeInTheDocument();
  } finally {
    getItem.mockRestore();
  }
});

// --- Critical, user-reported: "I cannot move anything around" -------------------------
//
// The whole drag gesture, wired end to end: press a source, move past the threshold (which
// is what mounts the drop zones), move onto a zone, release. jsdom lays nothing out, so the
// `<svg>`'s transform is stubbed as the identity — layout coordinates then equal client
// coordinates, and the zone rects the app renders are the ones the test aims at.
//
// This replaces the transport half of the five old jsdom drag tests: they synthesised
// `dragstart`/`drop` with a stubbed `dataTransfer`, which bypassed the browser's decision
// about whether a drag may begin. Chromium never begins one on an SVG element, so they
// passed against a gesture that was dead in every real browser. Nothing here fakes the
// gesture: only the page layout the environment cannot provide.
function stubSvgTransform() {
  const proto = SVGSVGElement.prototype as unknown as { getScreenCTM?: () => DOMMatrix };
  const had = Object.prototype.hasOwnProperty.call(proto, 'getScreenCTM');
  proto.getScreenCTM = () => ({ a: 1, d: 1, e: 0, f: 0 }) as DOMMatrix;
  return () => { if (!had) delete proto.getScreenCTM; };
}

/** The rect the app painted for a zone, read back in the same coordinates it was given. */
function zoneCentre(match: RegExp) {
  const el = Array.from(document.querySelectorAll('rect[data-testid^="drop:"]'))
    .find((r) => match.test(r.getAttribute('data-testid')!));
  expect(el, `no drop zone matching ${match}`).toBeTruthy();
  const num = (name: string) => Number(el!.getAttribute(name));
  return { x: num('x') + num('width') / 2, y: num('y') + num('height') / 2 };
}

function dragFrom(el: Element, to: RegExp | null) {
  fireEvent.pointerDown(el, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 40 }); // past the threshold
  const at = to ? zoneCentre(to) : { x: -900, y: -900 };
  fireEvent.pointerMove(window, { pointerId: 1, clientX: at.x, clientY: at.y });
  return at;
}

test('dragging an existing block into a branch moves it there', async () => {
  const restore = stubSvgTransform();
  try {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /decision/i }));
    await userEvent.click(screen.getByRole('button', { name: /^action/i }));

    const panel = screen.getByRole('region', { name: /mermaid/i });
    // Both arms are empty, so the decision passes through on both labels to the action
    // that follows it — rather than leaving that action unreachable.
    expect(panel.textContent).toMatch(
      /%% endif\n\w+ -- yes --> \w+\n\w+ -- no --> \w+\n\w+\["action"\]/,
    );

    const at = dragFrom(screen.getByText('action'), /#0:0$/);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: at.x, clientY: at.y });

    expect(panel.textContent).toMatch(
      /%% if\n\w+\{"condition\?"\}\n%% then \(yes\)\n\s+\w+ -- yes --> \w+\n\s+\w+\["action"\]\n%% else \(no\)\n%% endif/,
    );
  } finally {
    restore();
  }
});

test('dragging a palette item onto a zone inserts it there', async () => {
  const restore = stubSvgTransform();
  try {
    render(<App />);
    const at = dragFrom(screen.getByRole('button', { name: /^action/i }), /^drop:root:0$/);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: at.x, clientY: at.y });
    expect(screen.getByRole('region', { name: /mermaid/i }).textContent).toContain('["action"]');
  } finally {
    restore();
  }
});

test('a drag released over empty canvas changes nothing', async () => {
  const restore = stubSvgTransform();
  try {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /^action/i }));
    const before = screen.getByRole('region', { name: /mermaid/i }).textContent;

    dragFrom(screen.getByText('action'), null);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: -900, clientY: -900 });

    expect(screen.getByRole('region', { name: /mermaid/i }).textContent).toBe(before);
  } finally {
    restore();
  }
});

test('Escape mid-drag leaves the document untouched', async () => {
  const restore = stubSvgTransform();
  try {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /decision/i }));
    await userEvent.click(screen.getByRole('button', { name: /^action/i }));
    const before = screen.getByRole('region', { name: /mermaid/i }).textContent;

    const at = dragFrom(screen.getByText('action'), /#0:0$/);
    fireEvent.keyDown(window, { key: 'Escape' });
    // Part 1: the yes-branch zone this drag was over is EMPTY, so it is now a persistent
    // placeholder and stays mounted regardless of drag state — that is the fix, not a
    // regression. What Escape must still guarantee is that the drag itself is really
    // cancelled: no zone is left "active" (highlighted as a drop target), and every
    // temporary, drag-only zone (the gaps around existing blocks) is gone.
    expect(document.querySelector('rect[data-active="true"]')).toBeNull();
    expect(document.querySelector('rect[data-testid^="drop:"]:not([data-persistent="true"])')).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 1, clientX: at.x, clientY: at.y });

    expect(screen.getByRole('region', { name: /mermaid/i }).textContent).toBe(before);
  } finally {
    restore();
  }
});

test('pointercancel mid-drag leaves the document untouched', async () => {
  const restore = stubSvgTransform();
  try {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /^action/i }));
    const before = screen.getByRole('region', { name: /mermaid/i }).textContent;

    const at = dragFrom(screen.getByText('action'), /^drop:root:0$/);
    fireEvent.pointerCancel(window, { pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: at.x, clientY: at.y });

    expect(screen.getByRole('region', { name: /mermaid/i }).textContent).toBe(before);
  } finally {
    restore();
  }
});

// `moveBlock` already refuses a move into the dragged block's own subtree and returns the
// document unchanged, and `useDocument` pushes no undo entry for a no-op — so the UI adds
// no second guard. This asserts the UI really does defer to it: the gesture is allowed to
// happen, and nothing changes.
test('dragging a decision into its own branch is refused by the model, not the UI', async () => {
  const restore = stubSvgTransform();
  try {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /decision/i }));
    const before = screen.getByRole('region', { name: /mermaid/i }).textContent;

    const at = dragFrom(screen.getByText('condition?'), /#0:0$/);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: at.x, clientY: at.y });

    expect(screen.getByRole('region', { name: /mermaid/i }).textContent).toBe(before);

    // And the refused move pushed no undo entry: one undo rewinds the INSERT, so the
    // decision is gone. If the no-op had been recorded, this undo would have done nothing.
    await userEvent.keyboard('{Meta>}z{/Meta}');
    expect(screen.getByRole('region', { name: /mermaid/i }).textContent).not.toContain('condition?');
  } finally {
    restore();
  }
});

// The parked bug the geometry rewrite was asked to fix as a bonus: the floating
// BlockControls bar sits directly over the drop zone above the selected block. Under DOM
// hit-testing it received the drop and swallowed it in silence. Nothing is hit-tested now.
test('a drop aimed at the zone under the controls bar still lands', async () => {
  const restore = stubSvgTransform();
  try {
    render(<App />);
    await userEvent.click(screen.getByRole('button', { name: /^action/i })); // inserts AND selects
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument(); // the bar is up

    const at = dragFrom(screen.getByRole('button', { name: /stop/i }), /^drop:root:0$/);
    fireEvent.pointerUp(window, { pointerId: 1, clientX: at.x, clientY: at.y });

    expect(screen.getByRole('region', { name: /mermaid/i }).textContent).toMatch(/\(\("stop"\)\)\n\w+\["action"\]/);
  } finally {
    restore();
  }
});
