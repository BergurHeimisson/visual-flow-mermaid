import { expect, test } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The package is ESM ("type": "module"), so this file has no CJS `__dirname` — derive an
// equivalent from `import.meta.url` instead.
const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) => path.join(dirname, 'fixtures', name);

// The two file-I/O tests below navigate to `/?nofsa=1` rather than `/`. Chromium always
// exposes `showOpenFilePicker`, and Playwright cannot script that native OS picker — so
// without this flag `useFileIO` would try the File System Access path and the
// `filechooser` event these tests wait for would never fire. `?nofsa=1` forces the
// `<input type="file">` fallback, which Playwright drives via `filechooser`.

test('inserting a decision and editing its condition updates the notation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /decision/i }).click();

  const panel = page.getByRole('region', { name: /mermaid/i });
  await expect(panel).toContainText('if (condition?) then (yes)');

  await page.getByText('condition?').first().dblclick();
  await page.keyboard.type('In stock?');
  await page.keyboard.press('Enter');

  await expect(panel).toContainText('if (In stock?) then (yes)');
});

test('undo reverses an insertion', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^action/i }).click();
  await expect(page.getByRole('region', { name: /mermaid/i })).toContainText('["action"]');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByRole('region', { name: /mermaid/i })).not.toContainText('["action"]');
});

test('opening a valid file renders it on the canvas and preserves the preamble', async ({ page }) => {
  await page.goto('/?nofsa=1');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /open/i }).click();
  (await chooser).setFiles(fixture('simple.mmd'));

  // Scoped to the canvas region: `getByText('Receive order')` unscoped is a strict-mode
  // violation — the same text also appears verbatim in the Mermaid text panel, since
  // that panel literally renders the serialized source.
  await expect(page.getByRole('region', { name: /^canvas$/i }).getByText('Receive order')).toBeVisible();
  await expect(page.getByRole('region', { name: /mermaid/i })).toContainText('title Fixture');
});

test('opening an unsupported file is refused and leaves the canvas untouched', async ({ page }) => {
  await page.goto('/?nofsa=1');
  await page.getByRole('button', { name: /^action/i }).click();

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /open/i }).click();
  (await chooser).setFiles(fixture('partition.mmd'));

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('partition');
  await expect(dialog).toContainText('Line 3');
  await page.getByRole('button', { name: /ok/i }).click();
  await expect(page.getByRole('region', { name: /mermaid/i })).toContainText('["action"]');
});

test('the theme toggle survives a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: /theme/i }).click();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
  await page.reload();
  await expect(page.locator('html')).not.toHaveClass(/dark/);
});

test('the diagram survives a reload via autosave', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^action/i }).click();
  await page.waitForTimeout(700); // let the 500ms debounce fire
  await page.reload();
  await expect(page.getByRole('region', { name: /mermaid/i })).toContainText('["action"]');
});

// Controller ruling: the brief (written before this ruling) has no drag-and-drop test.
// Task 15's 5 drag tests all use a hand-rolled `dataTransfer` stub under jsdom, which can
// only prove the *handlers* run correctly when fed a fake event — it cannot prove that a
// real browser fires HTML5 drag events at all on the elements involved. That matters here
// specifically because `Box.tsx` marks an SVG `<g>` draggable and `DropZone.tsx` renders
// the drop target as an SVG `<rect>`; HTML5 DnD on SVG has a long history of being flaky
// across browsers.
//
// Investigation note (see task-20-report.md for the full writeup): `page.dragAndDrop` and
// `locator.dragTo` both resolve source AND target up front, so they hang forever against a
// drop zone that (by design, per the brief) only renders once a drag has already started —
// that is a limitation of Playwright's high-level helper, not of the browser. Driving the
// same gesture by hand (mouse down, a small move to let Chromium recognise it as a native
// drag and fire `dragstart`, locate the now-rendered zone, move onto it, mouse up) DOES
// work and produces real `dragstart`/`dragenter`/`dragover`/`drop` events with a real
// DataTransfer. That investigation also caught a genuine app bug — see the "app bug found"
// section of the report: the empty document's one drop zone was being laid out at a
// negative x (outside the SVG's own viewBox), so a real browser clipped it and it was
// neither visible nor hit-testable; fixed in `src/layout/layout.ts`.
test('dragging a palette item onto the canvas drop zone inserts a block (real browser DnD)', async ({ page }) => {
  await page.goto('/');

  const source = page.getByRole('button', { name: /^action/i });
  const sourceBox = (await source.boundingBox())!;

  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  // A small move first: the drag only begins once the pointer passes DRAG_THRESHOLD, which
  // is what makes Canvas.tsx mount the drop zone at all — the default document is empty,
  // which lays out to exactly one zone, `drop:root:0`. (This gesture used to depend on
  // Chromium recognising an HTML5 drag and firing `dragstart`; the app now drives both the
  // palette and the canvas with pointer events, so the same mouse script still drives it.)
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 10, sourceBox.y + sourceBox.height / 2 + 10, { steps: 5 });

  const zone = page.getByTestId('drop:root:0');
  await expect(zone).toBeVisible();
  const zoneBox = (await zone.boundingBox())!;
  await page.mouse.move(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect(page.getByRole('region', { name: /mermaid/i })).toContainText('["action"]');
});

// Fix round 1 review (finding: "edge labels can render outside the viewBox, silently
// clipped"). This whole bug class is invisible to jsdom — src/layout/layout.bounds.test.ts
// covers many shapes at the layout level, but only a real browser can confirm the glyphs
// Edge.tsx actually draws land on screen rather than past the clipped edge of the <svg>.
// A bare while loop is the sharpest case: createBlock('while') gives every new loop a
// default `endLabel: 'no'`, so this is what a user sees the very first time they add one.
test('a while loop\'s exit label is visible on the canvas (real browser)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /while loop/i }).click();

  const label = page.getByTestId(/^loopout:.*:label$/);
  await expect(label).toBeVisible();
  await expect(label).toHaveText('no');
});

// --- Final review, C1: the rendered scale must be the zoom the user asked for ----------
//
// Reproduction (before the fix): `<svg>` carried `style={{padding: 24}}` while Tailwind
// preflight sets `box-sizing: border-box` globally, so 48px of padding came OUT of the
// `width`/`height` attributes and the viewBox was fitted into what was left. The rendered
// scale was therefore `min((W-48)/W, (H-48)/H)` — a number nobody computed, varying with
// diagram size and collapsing to 0 as `width * zoom` approached 48. Only a real browser
// lays anything out, which is why this needs Playwright, not jsdom.
test('the canvas renders at exactly the requested zoom (real browser)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /decision/i }).click();

  const scale = () => page.evaluate(() => {
    const svg = document.querySelector('svg')!;
    return (svg as SVGSVGElement).getScreenCTM()!.a;
  });

  expect(await scale()).toBeCloseTo(1, 2);
  await page.getByRole('button', { name: /zoom out/i }).click();   // 0.8
  expect(await scale()).toBeCloseTo(0.8, 2);
  await page.getByRole('button', { name: /zoom out/i }).click();   // 0.64
  expect(await scale()).toBeCloseTo(0.64, 2);
  await page.getByRole('button', { name: /zoom in/i }).click();    // 0.8
  await page.getByRole('button', { name: /zoom in/i }).click();    // 1
  await page.getByRole('button', { name: /zoom in/i }).click();    // 1.25
  expect(await scale()).toBeCloseTo(1.25, 2);
});

// --- Final review, C1 (knock-on): the inline editor must land on the box it edits ------
//
// Reproduction (before the fix): App.tsx positioned the editor at `rect.x * zoom + PAD`,
// which assumed the rendered scale equalled `zoom`. On a fresh `if` the editor landed
// dx=-26px, dy=+32px from the diamond it was editing. The assertion below compares the
// editor's client rect against the browser's OWN transform of the diamond's geometry
// (`getBBox()` through `getScreenCTM()`), so it fails for any overlay arithmetic that does
// not match what the browser actually painted. `boundingBox()` is deliberately not used
// for the diamond: an acute polygon vertex adds ~3px of miter to its painted bounds.
test('the inline editor overlays the box it edits, at every zoom (real browser)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /decision/i }).click();

  for (const zoomOutClicks of [0, 2]) {
    for (let n = 0; n < zoomOutClicks; n += 1) await page.getByRole('button', { name: /zoom out/i }).click();

    await page.getByText('condition?').first().dblclick();
    await expect(page.getByRole('textbox')).toBeVisible();

    const drift = await page.evaluate(() => {
      const svg = document.querySelector('svg') as SVGSVGElement;
      const poly = document.querySelector('polygon') as SVGPolygonElement;
      const input = document.querySelector('input') as HTMLInputElement;
      const ctm = svg.getScreenCTM()!;
      const bbox = poly.getBBox();          // the diamond's own geometry, stroke excluded
      const rect = input.getBoundingClientRect();
      return {
        dx: rect.left - (ctm.a * bbox.x + ctm.e),
        dy: rect.top - (ctm.d * bbox.y + ctm.f),
        dw: rect.width - ctm.a * bbox.width,
        dh: rect.height - ctm.d * bbox.height,
      };
    });

    expect(Math.abs(drift.dx)).toBeLessThanOrEqual(1);
    expect(Math.abs(drift.dy)).toBeLessThanOrEqual(1);
    expect(Math.abs(drift.dw)).toBeLessThanOrEqual(1);
    expect(Math.abs(drift.dh)).toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /fit/i }).click();
  }
});

// --- Final review, C2: a branch drop zone must be hit-testable and land in its own arm --
//
// Reproduction (before the fix): an empty sequence measured to width 0, so a fresh `if`'s
// two empty sibling columns sat gapX (28px) apart while each drop zone has a hard 80px
// floor — a 52px overlap, with the later zone painted over the earlier one. Aiming at the
// exact centre of the yes-branch zone hit the ELSE zone and the block landed in the wrong
// arm. Only a real browser does hit-testing, so only Playwright can see this.
test('dropping into the yes branch of a fresh decision lands in that branch (real browser)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /decision/i }).click();

  const source = page.getByRole('button', { name: /^action/i });
  const sourceBox = (await source.boundingBox())!;
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 10, sourceBox.y + sourceBox.height / 2 + 10, { steps: 5 });

  const zone = page.getByTestId(/^drop:.*#0:0$/);
  await expect(zone).toBeVisible();
  const zoneBox = (await zone.boundingBox())!;
  const cx = zoneBox.x + zoneBox.width / 2;
  const cy = zoneBox.y + zoneBox.height / 2;

  // The zone's own centre must actually belong to that zone — not to an overlapping sibling.
  const hitId = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x as number, y as number);
    return el?.getAttribute('data-testid') ?? null;
  }, [cx, cy]);
  expect(hitId).toMatch(/#0:0$/);

  await page.mouse.move(cx, cy, { steps: 10 });
  await page.mouse.up();

  // The action must land in the `if` arm, not the `else` arm: nested inside its subgraph.
  const text = await page.getByRole('region', { name: /mermaid/i }).innerText();
  expect(text).toMatch(/subgraph if_\w+ \["if \(condition\?\) then \(yes\)"\]\n\s*\w+\["action"\]/);
});

// --- Final review, I3: "drag a note onto a box" (spec interaction table) ---------------
//
// Reproduction (before the fix): `Box` had `onDragStart` but no `onDragOver`/`onDrop`, so
// a box was never a drop target; a note dropped anywhere hit `if (kind === 'note') return;`
// and did nothing at all. The Note palette item was rendered draggable regardless, so the
// affordance existed and every outcome was silence.
test('dragging a note from the palette onto an action attaches it (real browser DnD)', async ({ page }) => {
  await page.goto('/');
  // Inserting the action also selects it, which is what enables the Note palette item —
  // a note has to belong to some action, so the palette keeps it disabled until one exists.
  await page.getByRole('button', { name: /^action/i }).click();
  const panel = page.getByRole('region', { name: /mermaid/i });
  await expect(panel).not.toContainText('note right');

  const source = page.getByRole('button', { name: /^note/i });
  const sourceBox = (await source.boundingBox())!;
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 10, sourceBox.y + sourceBox.height / 2 + 10, { steps: 5 });

  const target = page.getByRole('region', { name: /^canvas$/i }).getByText('action');
  const targetBox = (await target.boundingBox())!;
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 10 });
  await page.mouse.up();

  await expect(panel).toContainText('%% note right: note');
});

// --- Critical, user-reported: "I cannot move anything around" -------------------------
//
// Reproduction (before the fix): `Box.tsx` marked an SVG `<g>` `draggable="true"`, but the
// HTML5 `draggable` attribute is defined for HTML elements only — Chromium never fires
// `dragstart` on an SVG element. Measured in Chromium:
//
//   SVG box   draggable="true"  tag=<g>       -> drag events fired: []
//   palette   draggable="true"  tag=<BUTTON>  -> dragstart, dragover x5, dragend
//
// So a canvas-block drag never BEGAN: no `dragstart`, so App's `setDragging(true)` never
// ran, so `Canvas` never mounted any drop zones ("zones visible during drag: []"), so
// there was nowhere to drop. The five jsdom tests covering block moves synthesised
// `dragstart`/`drop` with a stubbed `dataTransfer`, which bypasses the browser's decision
// about whether a drag may begin at all — they passed against code that could never run.
// Only a real browser can see this, which is why the regression test lives here.
test('dragging an existing block into a branch moves it there (real browser)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /decision/i }).click();
  await page.getByRole('button', { name: /^action/i }).click();

  const panel = page.getByRole('region', { name: /mermaid/i });
  // The action lands after the if construct's closing `end` — that is the starting state
  // this test moves away from.
  await expect(panel).toContainText('["action"]');
  expect(await panel.innerText()).toMatch(/end\n\w+\["action"\]/);

  const source = page.getByRole('region', { name: /^canvas$/i }).getByText('action');
  const sourceBox = (await source.boundingBox())!;
  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  // Past the drag threshold, which is what mounts the drop zones.
  await page.mouse.move(sx + 12, sy + 12, { steps: 5 });

  const zone = page.getByTestId(/^drop:.*#0:0$/);
  await expect(zone).toBeVisible();
  const zoneBox = (await zone.boundingBox())!;
  await page.mouse.move(zoneBox.x + zoneBox.width / 2, zoneBox.y + zoneBox.height / 2, { steps: 10 });
  await page.mouse.up();

  const text = await panel.innerText();
  expect(text).toMatch(
    /subgraph if_\w+ \["if \(condition\?\) then \(yes\)"\]\n\s+\w+\["action"\]\nend\nsubgraph else_\w+ \["else \(no\)"\]\nend/,
  );
});

// --- Part 1, user-reported: "I wanted to add an action after the no decision. I couldn't
// select to do that." --------------------------------------------------------------------
//
// Reproduction (before the fix): an empty branch renders as nothing but an arrow to the
// merge point — no shape to click — and click-to-insert (`insertionPoint`) needs a
// selection, which an empty branch could never have. Drag-to-insert worked, but its drop
// zone only existed mid-drag, so it was undiscoverable, and there was no keyboard path at
// all. The fix renders the zone `layout()` already emits for an empty sequence as a
// persistent, clickable placeholder. This test reproduces the user's exact report: put an
// action in the yes arm, then add one to the (still empty) no arm — entirely by clicking,
// no drag — and asserts the resulting Mermaid notation, not just DOM presence.
test('clicking the empty "no" branch placeholder lets you add an action there (real browser)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /decision/i }).click();

  const panel = page.getByRole('region', { name: /mermaid/i });
  await expect(panel).toContainText('if (condition?) then (yes)');
  await expect(panel).toContainText('else (no)');

  // Fill the yes arm the same way: click its (empty, persistent) placeholder, then Action.
  const yesZone = page.getByTestId(/#0:0$/);
  await expect(yesZone).toBeVisible();
  await yesZone.click();
  await page.getByRole('button', { name: /^action/i }).click();
  await expect(panel).toContainText(/if \(condition\?\) then \(yes\)\n\s*\w+\["action"\]/);

  // The user's exact case: the no/else arm is still empty. Its placeholder must be visible
  // with no drag in flight, and clicking it must select that slot for the next insert.
  const noZone = page.getByTestId(/#else:0$/);
  await expect(noZone).toBeVisible();
  await noZone.click();
  await page.getByRole('button', { name: /^action/i }).click();

  const text = await panel.innerText();
  expect(text).toMatch(
    /subgraph if_\w+ \["if \(condition\?\) then \(yes\)"\]\n\s*\w+\["action"\]\nend\nsubgraph else_\w+ \["else \(no\)"\]\n\s*\w+\["action"\]\nend/,
  );
});

// --- Part 2: finish the selection-ring bounds coverage with a real-browser assertion ---
//
// `db53b0f` added a layout `margin` and a shared `ringOutset` metric (Box.tsx draws the
// selection ring `ringOutset` px outside the box, plus its own stroke) so a box sitting
// flush against the layout's edge — the everyday case right after "Fit" — keeps its full
// ring inside the <svg>'s viewBox instead of being silently clipped by the default
// `overflow: hidden`. `layout.bounds.test.ts` covers this numerically under jsdom, which
// never renders or clips anything; only a real browser can confirm the ring actually lands
// on screen. A bare action block is the sharpest case: its box (>= minBoxW) is wider than
// the start cap it shares a spine with, so it — not the cap — is the leftmost shape.
test('the selection ring of the leftmost block stays inside the svg (real browser)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /^action/i }).click(); // inserts AND selects it

  const geometry = await page.evaluate(() => {
    const svg = document.querySelector('svg') as SVGSVGElement;
    const ring = document.querySelector('g[data-selected="true"] rect[fill="none"]') as SVGRectElement;
    const svgRect = svg.getBoundingClientRect();
    const ringRect = ring.getBoundingClientRect();
    return {
      svgLeft: svgRect.left, svgTop: svgRect.top, svgRight: svgRect.right, svgBottom: svgRect.bottom,
      ringLeft: ringRect.left, ringTop: ringRect.top, ringRight: ringRect.right, ringBottom: ringRect.bottom,
    };
  });

  // Sub-pixel rounding slack only — this must not tolerate a real clip.
  const slack = 0.5;
  expect(geometry.ringLeft).toBeGreaterThanOrEqual(geometry.svgLeft - slack);
  expect(geometry.ringTop).toBeGreaterThanOrEqual(geometry.svgTop - slack);
  expect(geometry.ringRight).toBeLessThanOrEqual(geometry.svgRight + slack);
  expect(geometry.ringBottom).toBeLessThanOrEqual(geometry.svgBottom + slack);
});

// --- User-reported: "I cannot get rid of the delete. Which means I cannot really take a
// good screenshot." -----------------------------------------------------------------------
//
// Reproduction (before the fix): the only deselect target was the in-SVG `<rect
// data-testid="canvas-background">`, sized to the DIAGRAM's own bounds (`result.width` x
// `result.height`), not the visible canvas pane. A click at the pane's own edges — exactly
// where a user clicks to dismiss a selection before a screenshot — lands on the `<section>`
// past the diagram's small bounding box and hits nothing at all. The point below is derived
// from the pane's and the diagram's own live bounding boxes, not a hardcoded guess, so this
// keeps testing the real gap regardless of viewport size or diagram layout.
test('clicking the canvas pane well away from the diagram clears the selection (real browser)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /decision/i }).click(); // inserts AND selects it

  await expect(page.getByRole('button', { name: /^delete$/i })).toBeVisible();
  await expect(page.locator('[data-selected="true"]').first()).toBeVisible();

  const pane = page.getByRole('region', { name: /^canvas$/i });
  const paneBox = (await pane.boundingBox())!;
  const diagramBox = (await page.locator('svg').first().boundingBox())!;

  // Aim at the pane's own bottom-right corner — inside the pane, well outside the diagram.
  const x = paneBox.x + paneBox.width - 10;
  const y = paneBox.y + paneBox.height - 10;

  // Sanity: the point really is outside the diagram, not just a lucky gap inside it.
  expect(x).toBeGreaterThan(diagramBox.x + diagramBox.width);
  expect(y).toBeGreaterThan(diagramBox.y + diagramBox.height);

  await page.mouse.click(x, y);

  await expect(page.getByRole('button', { name: /^delete$/i })).not.toBeVisible();
  await expect(page.locator('[data-selected="true"]')).toHaveCount(0);
});

test('Escape clears the selection (real browser)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /decision/i }).click(); // inserts AND selects it

  await expect(page.getByRole('button', { name: /^delete$/i })).toBeVisible();

  await page.keyboard.press('Escape');

  await expect(page.getByRole('button', { name: /^delete$/i })).not.toBeVisible();
  await expect(page.locator('[data-selected="true"]')).toHaveCount(0);
});

// Guards against the pane-level deselect above swallowing the control bar's own clicks:
// clicking "delete" must still delete, not deselect (and thereby dismiss the bar) first.
test('clicking delete on the controls bar still deletes the block (real browser)', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /decision/i }).click();
  const panel = page.getByRole('region', { name: /mermaid/i });
  await expect(panel).toContainText('if (condition?)');

  await page.getByRole('button', { name: /^delete$/i }).click();

  await expect(panel).not.toContainText('if (condition?)');
});

// Regression for the bug the user reported ("I would not expect a line to go out of the end
// state right?"): `stop`/`end` terminate the flow, so no edge should leave the `stop` cap in
// the `else` arm of `terminator.mmd`'s `if`. This is checked via real SVG geometry rendered
// by a real browser, not the DOM structure or box/edge counts alone — see layout.terminator.
// test.ts for the same assertion done directly against layout() in isolation.
test("no edge leaves the terminator in the else arm (user's bread document)", async ({ page }) => {
  await page.goto('/?nofsa=1');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /open/i }).click();
  (await chooser).setFiles(fixture('terminator.mmd'));

  const canvas = page.getByRole('region', { name: /^canvas$/i });
  await expect(canvas.getByText('Go to bakery')).toBeVisible();

  // Every 'stop'/'end' box renders as two concentric <circle>s (Box.tsx's Shape for
  // kind stop/end) inside a `g[data-testid^="box:"]`. The fixture has exactly two such
  // boxes: the branch's `stop` (inside the else arm, above the merge) and the document's
  // trailing `end` (below the merge) — the branch stop is the one with the smaller cy.
  const terminatorCircles = await canvas.locator('svg').evaluate((svg) => {
    const groups = Array.from(svg.querySelectorAll('g[data-testid^="box:"]'));
    return groups
      .map((g) => Array.from(g.querySelectorAll('circle')))
      .filter((circles) => circles.length === 2)
      .map((circles) => {
        const c = circles[0] as SVGCircleElement;
        return { cx: c.cx.baseVal.value, cy: c.cy.baseVal.value, r: c.r.baseVal.value };
      });
  });
  expect(terminatorCircles.length).toBe(2);
  const branchStop = terminatorCircles.sort((a, b) => a.cy - b.cy)[0];
  const stopBottomY = branchStop.cy + branchStop.r;

  // Every rendered edge is exactly one <path> inside its `g[data-testid]` (Edge.tsx) — check
  // ALL of them, not just the merge/join/back kinds the fix touched, so this is a genuine
  // geometry assertion about the finished diagram rather than a check of the fix's own
  // mechanism.
  const allPoints = await canvas.locator('svg').evaluate((svg) => {
    const paths = Array.from(svg.querySelectorAll('g[data-testid] > path'));
    return paths.map((p) => (p as SVGPathElement).getAttribute('d') ?? '');
  });

  // No merge/join/back-edge path may start (or pass through) the terminator's own centre-x
  // at its bottom edge — that would be exactly the "line out of the stop circle" bug.
  const leavesTerminator = allPoints.some((d) => {
    const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (Math.abs(nums[i] - branchStop.cx) < 1 && Math.abs(nums[i + 1] - stopBottomY) < 1) return true;
    }
    return false;
  });
  expect(leavesTerminator).toBe(false);
});
