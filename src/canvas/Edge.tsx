import type { Edge as EdgeModel, Rect } from '../layout/layout';
import type { EditTarget } from '../model/edits';

export function Edge({ edge, onStartEdit }: {
  edge: EdgeModel;
  onStartEdit?: (target: EditTarget, rect: Rect) => void;
}) {
  const d = edge.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  return (
    <g data-testid={edge.id}>
      <path
        d={d}
        fill="none"
        className="stroke-line"
        strokeWidth={1.5}
        strokeDasharray={edge.dashed ? '4 3' : undefined}
        markerEnd={edge.dashed ? undefined : 'url(#vfp-arrow)'}
      />
      {edge.label !== undefined && edge.labelAt && (
        <text
          data-testid={`${edge.id}:label`}
          x={edge.labelAt.x + 6}
          y={edge.labelAt.y}
          className="fill-ink-muted text-[11px]"
          dominantBaseline="middle"
          onDoubleClick={(event) => {
            const { blockId, field, labelAt } = edge;
            if (!blockId || !field || !labelAt) return;
            event.stopPropagation();
            onStartEdit?.(
              { blockId, field, branchIndex: edge.branchIndex },
              { x: labelAt.x, y: labelAt.y - 10, w: 80, h: 20 },
            );
          }}
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}
