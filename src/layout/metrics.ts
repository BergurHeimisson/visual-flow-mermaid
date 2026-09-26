export type MeasureText = (text: string, font: string) => number;

export type Metrics = {
  font: string;
  lineHeight: number;
  boxPadX: number; boxPadY: number;
  minBoxW: number;
  gapY: number; gapX: number;
  diamondPadX: number; diamondPadY: number;
  capW: number; capH: number;
  barH: number;
  gutter: number;
  dropH: number;
  noteGap: number;
  /**
   * Uniform breathing room `layout()` insets the whole diagram by, on every side, inside the
   * bounds it reports. Chosen to clear `ringOutset` (plus the selection ring's own stroke —
   * see below) with room to spare, so a box sitting flush against the layout's edge — the
   * common case right after "Fit" — still shows its full selection ring, not just visible
   * breathing room around the drawing itself.
   */
  margin: number;
  /**
   * How far outside a box's own edge Box.tsx draws its selection ring (`rect x={box.x -
   * ringOutset} ...`), before the ring's own stroke width is added on top. Shared here so
   * `layout()`'s `margin` and Box.tsx's ring can't silently drift apart — see the comment on
   * `margin` above and the long comment above the bounds computation in `layout.ts`.
   */
  ringOutset: number;
};

export const DEFAULT_METRICS: Metrics = {
  font: '13px ui-sans-serif, system-ui, sans-serif',
  lineHeight: 18,
  boxPadX: 14, boxPadY: 10,
  minBoxW: 80,
  gapY: 34, gapX: 28,
  diamondPadX: 26, diamondPadY: 16,
  capW: 24, capH: 24,
  barH: 6,
  gutter: 30,
  dropH: 14,
  noteGap: 24,
  margin: 16,
  ringOutset: 3,
};

export function measureLabel(
  text: string, measure: MeasureText, m: Metrics,
): { w: number; h: number } {
  const lines = text.split('\n');
  const w = Math.max(0, ...lines.map((line) => measure(line, m.font)));
  return { w, h: lines.length * m.lineHeight };
}
