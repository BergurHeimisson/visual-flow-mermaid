import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Canvas, CANVAS_PAD } from './canvas/Canvas';
import { InlineEditor } from './canvas/InlineEditor';
import { layout, pathKey, type DropZone as Zone, type LayoutResult, type MeasureText, type Rect } from './layout/layout';
import { createBlock } from './model/factory';
import { currentValue, type EditTarget } from './model/edits';
import { findBlock } from './model/ops';
import { EMPTY_DOC, type BlockKind, type NodeId } from './model/types';
import type { ParseError } from './mermaid/parse';
import { serialize } from './mermaid/serialize';
import { BlockControls } from './ui/BlockControls';
import { ImportErrorDialog } from './ui/ImportErrorDialog';
import { Palette } from './ui/Palette';
import { Splitter } from './ui/Splitter';
import { TextPanel } from './ui/TextPanel';
import { Toolbar } from './ui/Toolbar';
import { applyTheme, loadTheme, saveTheme, type Theme } from './ui/theme';
import { insertionPoint } from './ui/insertion';
import { useFileIO } from './ui/useFileIO';
import { useKeyboard } from './ui/useKeyboard';
import { useDrag } from './ui/useDrag';
import { targetAt, toLayoutPoint, type DragPayload, type DragTarget, type PaletteKind } from './dnd';
import { loadAutosave, saveAutosave } from './state/autosave';
import { useDocument } from './state/useDocument';

/**
 * The field Enter opens when a block is selected: the first box carrying this blockId and
 * a `field` (an if-cascade's first branch condition, an action's own label, a loop's
 * condition — always pushed before any of its edge-only fields like `thenLabel` or
 * `isLabel`), falling back to the first such edge for completeness. Fork/merge/join boxes
 * carry a `blockId` but no `field`, so selecting a fork this way finds nothing to edit —
 * its branches hold the editable blocks, not the fork itself.
 */
function primaryEditTarget(result: LayoutResult, blockId: NodeId): { target: EditTarget; rect: Rect } | null {
  const box = result.boxes.find((b) => b.blockId === blockId && b.field !== undefined);
  if (box) {
    return { target: { blockId, field: box.field!, branchIndex: box.branchIndex }, rect: box };
  }
  const edge = result.edges.find((e) => e.blockId === blockId && e.field !== undefined && e.labelAt);
  if (edge) {
    const { x, y } = edge.labelAt!;
    return { target: { blockId, field: edge.field!, branchIndex: edge.branchIndex }, rect: { x, y: y - 10, w: 80, h: 20 } };
  }
  return null;
}

/** Real text measurement, the one place layout touches the DOM. */
function makeMeasurer(): MeasureText {
  const ctx = document.createElement('canvas').getContext('2d');
  const cache = new Map<string, number>();
  return (text, font) => {
    const key = `${font}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    if (!ctx) return text.length * 8;
    ctx.font = font;
    const w = ctx.measureText(text).width;
    cache.set(key, w);
    return w;
  };
}

/**
 * Where a rect in the diagram's own coordinate space lands on screen, as CSS offsets inside
 * the canvas section.
 *
 * Read off the `<svg>`'s live `getScreenCTM()` rather than re-derived as `x * zoom + PAD`.
 * The final review caught exactly that arithmetic drifting from reality: padding on the
 * `<svg>` (with Tailwind's global `box-sizing: border-box`) shrank the drawing area, so the
 * rendered scale was `min((W-48)/W, (H-48)/H)` instead of `zoom` — the inline editor landed
 * dx=-26px, dy=+32px from the diamond it was editing and the controls bar painted across
 * the whole diagram. The padding now lives on a wrapper (see CANVAS_PAD), so the two agree
 * again — but reading the real transform means they cannot silently disagree a second time.
 *
 * `scrollLeft`/`scrollTop` convert the viewport-relative CTM into the scrolled content box
 * that absolutely-positioned overlays are laid out in, which also makes the result
 * scroll-invariant: `ctm.e` moves by exactly `-scrollLeft` when the section scrolls.
 */
type ScreenTransform = { scale: number; dx: number; dy: number };

function readTransform(svg: SVGSVGElement | null, host: HTMLElement | null): ScreenTransform | null {
  if (!svg || !host || typeof svg.getScreenCTM !== 'function') return null;
  let ctm: DOMMatrix | null = null;
  try {
    ctm = svg.getScreenCTM();
  } catch {
    return null; // jsdom and other layout-less environments
  }
  if (!ctm) return null;
  const box = host.getBoundingClientRect();
  return { scale: ctm.a, dx: ctm.e - box.left + host.scrollLeft, dy: ctm.f - box.top + host.scrollTop };
}

export default function App() {
  const measure = useMemo(makeMeasurer, []);
  // Lazy: useReducer keeps only the first result, and parsing the whole stored document on
  // every render (once per keystroke) was pure waste.
  const { doc, selectedId, selectedSlot, select, selectSlot, apply, undo, redo } = useDocument(() => loadAutosave() ?? EMPTY_DOC);
  const result = useMemo(() => layout(doc, measure), [doc, measure]);
  const text = useMemo(() => serialize(doc), [doc]);
  const [panelWidth, setPanelWidth] = useState(320);
  const [panelOpen, setPanelOpen] = useState(true);
  const [theme, setTheme] = useState<Theme>(loadTheme);
  const [zoom, setZoom] = useState(1);
  const file = useFileIO();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLElement | null>(null);
  const [transform, setTransform] = useState<ScreenTransform | null>(null);
  const [importError, setImportError] = useState<{ fileName: string; error: ParseError } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => saveAutosave(doc), 500);
    return () => clearTimeout(timer);
  }, [doc]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      saveTheme(next);
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    const next = readTransform(svgRef.current, canvasRef.current);
    setTransform((current) => (
      current && next
      && current.scale === next.scale && current.dx === next.dx && current.dy === next.dy
        ? current
        : next
    ));
  }, [result, zoom, panelWidth, panelOpen]);

  // Fallback for environments with no layout (jsdom): with CANVAS_PAD on the wrapper rather
  // than the <svg>, this is the same answer the real transform gives.
  const view = transform ?? { scale: zoom, dx: CANVAS_PAD, dy: CANVAS_PAD };
  const onScreen = useCallback((rect: Rect) => ({
    left: rect.x * view.scale + view.dx,
    top: rect.y * view.scale + view.dy,
    width: rect.w * view.scale,
    height: rect.h * view.scale,
  }), [view.scale, view.dx, view.dy]);

  const selected = selectedId ? findBlock(doc, selectedId) : null;

  const [edit, setEdit] = useState<{ target: EditTarget; rect: Rect; value: string } | null>(null);

  const startEdit = useCallback((target: EditTarget, rect: Rect) => {
    setEdit({ target, rect, value: currentValue(doc, target) });
  }, [doc]);

  const onEnter = useCallback(() => {
    if (!selectedId) return;
    const found = primaryEditTarget(result, selectedId);
    if (found) startEdit(found.target, found.rect);
  }, [selectedId, result, startEdit]);

  const onDeleteSelected = useCallback(() => {
    if (selectedId) apply({ type: 'remove', id: selectedId });
  }, [apply, selectedId]);

  const onOpen = useCallback(async () => {
    const outcome = await file.open();
    if (outcome.status === 'cancelled') return;
    if (outcome.status === 'error') {
      setImportError({ fileName: outcome.fileName, error: outcome.error });
      return; // the open document is left untouched
    }
    apply({ type: 'replace', doc: outcome.doc });
    setNotice(outcome.ignored.length > 0
      ? `Opened ${outcome.fileName}. ${outcome.ignored.length} unsupported line(s) were ignored.`
      : null);
  }, [apply, file]);

  const onNew = useCallback(() => {
    apply({ type: 'replace', doc: EMPTY_DOC });
    file.reset();
    setNotice(null);
  }, [apply, file]);

  const onSave = useCallback(() => { void file.save(doc); }, [file, doc]);

  const onEscape = useCallback(() => select(null), [select]);

  useKeyboard({ onDelete: onDeleteSelected, onEnter, onUndo: undo, onRedo: redo, onSave, onEscape });

  const onInsert = useCallback((kind: PaletteKind) => {
    if (kind === 'note') {
      if (selectedId) apply({ type: 'attachNote', id: selectedId, side: 'right' });
      return;
    }
    const at = insertionPoint(doc, selectedId, selectedSlot);
    const block = createBlock(kind);
    apply({ type: 'insert', path: at.path, index: at.index, block });
    select(block.id); // also clears the selected slot, filled by this very insert
  }, [apply, doc, select, selectedId, selectedSlot]);

  // The zone id a selected slot corresponds to, so Canvas can highlight the right
  // placeholder without either side needing to compare `SeqPath`s structurally — the id is
  // already the unique key `layout()` derives from path+index (see `pathKey`).
  const selectedZoneId = selectedSlot ? `drop:${pathKey(selectedSlot.path)}:${selectedSlot.index}` : null;
  const onSelectZone = useCallback((zone: Zone) => {
    selectSlot({ path: zone.path, index: zone.index });
  }, [selectSlot]);

  /**
   * Where the pointer is, in the diagram's own coordinates, and what lives there.
   *
   * Read off the `<svg>`'s live `getScreenCTM()` — the same transform the overlays use —
   * and answered from `result`'s own rects rather than `document.elementFromPoint`. DOM
   * hit-testing would hand the drop to whatever happens to be painted on top, which is how
   * the floating `BlockControls` bar came to swallow every drop aimed at the zone above a
   * selected block.
   */
  const resolveTarget = useCallback((payload: DragPayload, clientX: number, clientY: number) => {
    const svg = svgRef.current;
    let ctm: DOMMatrix | null = null;
    try {
      ctm = svg && typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
    } catch {
      ctm = null; // jsdom and other layout-less environments
    }
    return targetAt(result, payload, toLayoutPoint(ctm, clientX, clientY));
  }, [result]);

  /**
   * The drop itself. `moveBlock` is the authority on which moves are legal — it already
   * refuses a move into the dragged block's own subtree and returns the document unchanged,
   * and `useDocument` pushes no undo entry for a no-op — so there is deliberately no second
   * guard here.
   */
  const commitDrag = useCallback((payload: DragPayload, target: DragTarget) => {
    if (target.kind === 'note') {
      if (payload.source === 'palette' && payload.kind === 'note') apply({ type: 'attachNote', id: target.blockId, side: 'right' });
      return;
    }
    const { zone } = target;
    if (payload.source === 'block') {
      apply({ type: 'move', id: payload.id, path: zone.path, index: zone.index });
      return;
    }
    if (payload.kind === 'note') return; // a note attaches to a block, never to a gap
    const block = createBlock(payload.kind as BlockKind);
    apply({ type: 'insert', path: zone.path, index: zone.index, block });
    select(block.id);
  }, [apply, select]);

  const { drag, startDrag } = useDrag({ resolve: resolveTarget, commit: commitDrag });
  const dragging = drag !== null;
  const activeZoneId = drag?.target?.kind === 'zone' ? drag.target.zone.id : null;
  const noteTargetId = drag?.target?.kind === 'note' ? drag.target.blockId : null;

  const onDragPalette = useCallback((kind: PaletteKind, event: { button: number; pointerId: number; currentTarget: Element; clientX: number; clientY: number }) => {
    startDrag({ source: 'palette', kind }, event);
  }, [startDrag]);

  const onDragBlock = useCallback((id: NodeId, event: { button: number; pointerId: number; currentTarget: Element; clientX: number; clientY: number }) => {
    startDrag({ source: 'block', id }, event);
  }, [startDrag]);

  const onAddBranch = useCallback(() => {
    if (selectedId) apply({ type: 'addBranch', id: selectedId });
  }, [apply, selectedId]);

  const onRemoveBranch = useCallback((index: number) => {
    if (selectedId) apply({ type: 'removeBranch', id: selectedId, index });
  }, [apply, selectedId]);

  const onToggleElse = useCallback(() => {
    if (selectedId) apply({ type: 'toggleElse', id: selectedId });
  }, [apply, selectedId]);

  // Anchor the floating BlockControls on the selected block's own first box — the branch
  // diamond for `if`/`while`/`repeat`, the fork bar for `fork`, the box itself for a leaf.
  const controlsAnchor = selectedId ? result.boxes.find((b) => b.blockId === selectedId) : undefined;

  return (
    <div className="flex h-full flex-col bg-surface text-ink">
      <Toolbar
        theme={theme}
        onToggleTheme={toggleTheme}
        zoom={zoom}
        onZoom={setZoom}
        onNew={onNew}
        onOpen={onOpen}
        onSave={onSave}
        onSaveAs={() => { void file.saveAs(doc); }}
        canSave={file.canSave}
      />
      {importError && (
        <ImportErrorDialog
          fileName={importError.fileName}
          error={importError.error}
          onClose={() => setImportError(null)}
        />
      )}
      {notice && (
        <div role="status" className="border-b border-line bg-surface-3 px-3 py-1 text-xs text-ink">
          {notice}
          <button type="button" className="ml-2 underline" onClick={() => setNotice(null)}>dismiss</button>
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        <section aria-label="Palette" className="w-44 shrink-0 overflow-auto border-r border-line bg-surface-2 p-2">
          <Palette onInsert={onInsert} noteEnabled={selected?.kind === 'action'} onDragStart={onDragPalette} />
        </section>
        {/*
          The deselect target for the whole visible pane, not just the diagram's own
          bounds (see canvas/Canvas.tsx: the in-SVG background rect it used to render was
          sized to `result.width x result.height`, so a click anywhere in the pane's empty
          margin — exactly where a user clicks to dismiss a selection before a screenshot —
          landed on this `<section>` and did nothing). A shape (Box.tsx), a drop-zone
          placeholder (DropZone.tsx) and the two overlays below all stop propagation on
          their own clicks, so this only ever fires for a click that none of them claimed.
        */}
        <section
          aria-label="Canvas"
          ref={canvasRef}
          className="relative flex-1 overflow-auto"
          onClick={() => select(null)}
        >
          <Canvas
            svgRef={svgRef}
            result={result}
            selectedId={selectedId}
            zoom={zoom}
            onSelect={select}
            dragging={dragging}
            activeZoneId={activeZoneId}
            noteTargetId={noteTargetId}
            selectedZoneId={selectedZoneId}
            onSelectZone={onSelectZone}
            onDragBlock={onDragBlock}
            onStartEdit={startEdit}
          />
          {selected && controlsAnchor && !edit && !dragging && (
            <div
              className="absolute"
              // The bar's own buttons (delete included) must fire their own action, not
              // also bubble into the pane's deselect above — clicking delete must delete,
              // not deselect (which would dismiss the bar) first.
              onClick={(event) => event.stopPropagation()}
              style={{
                left: onScreen(controlsAnchor).left,
                top: onScreen(controlsAnchor).top - 30,
              }}
            >
              <BlockControls
                block={selected}
                onAddBranch={onAddBranch}
                onToggleElse={onToggleElse}
                onRemoveBranch={onRemoveBranch}
                onDelete={onDeleteSelected}
              />
            </div>
          )}
          {edit && (
            // Clicking inside the editor (e.g. to move the caret) must not bubble into the
            // pane's deselect either — same reasoning as the controls bar above.
            <div onClick={(event) => event.stopPropagation()}>
              <InlineEditor
                value={edit.value}
                x={onScreen(edit.rect).left}
                y={onScreen(edit.rect).top}
                w={onScreen(edit.rect).width}
                h={onScreen(edit.rect).height}
                onCommit={(value) => { apply({ type: 'edit', target: edit.target, value }); setEdit(null); }}
                onCancel={() => setEdit(null)}
              />
            </div>
          )}
        </section>
        {panelOpen && <Splitter width={panelWidth} onResize={setPanelWidth} />}
        <section
          aria-label="Mermaid"
          className="flex shrink-0 flex-col border-l border-line bg-surface-2 p-2"
          style={{ width: panelOpen ? panelWidth : 40 }}
        >
          <button
            type="button"
            aria-label={panelOpen ? 'Hide Mermaid panel' : 'Show Mermaid panel'}
            className="mb-2 self-end rounded border border-line px-2 py-1 text-xs text-ink hover:border-accent"
            onClick={() => setPanelOpen((open) => !open)}
          >
            {panelOpen ? '>' : '<'}
          </button>
          {panelOpen && <TextPanel text={text} />}
        </section>
      </div>
    </div>
  );
}
