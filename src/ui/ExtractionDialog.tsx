import { useMemo, useState } from 'react';
import { acceptExtraction, closeExtraction, rerunWithReference } from '../app/extractionActions';
import type { ExtractionResult, FloorPlanAnnotations, PxPoint, ReviewProblem } from '../floorplan';
import { pxWallGeometry, spanAlongWall } from '../floorplan/wallGeometry';
import { useExtraction } from '../state/extractionStore';
import { IconX } from './icons';

const pct = (x: number | undefined) => (x === undefined ? '—' : `${Math.round(x * 100)} %`);
const STATUS: Record<'ok' | 'needs-review' | 'failed', { badge: string; label: string }> = {
  ok: { badge: 'badge--green', label: 'Ready' },
  'needs-review': { badge: 'badge--amber', label: 'Needs review' },
  failed: { badge: 'badge--red', label: 'Extraction requires review' },
};

/** Upload review: what was found, how sure the extractor is, and what a person must check. */
export function ExtractionDialog() {
  const s = useExtraction();
  if (!s.open) return null;
  return (
    <div className="modal-backdrop" onClick={closeExtraction}>
      <div
        className="modal modal--wide extraction"
        role="dialog"
        aria-modal="true"
        aria-labelledby="extract-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button className="close-btn" onClick={closeExtraction} aria-label="Close">
          <IconX size={14} />
        </button>
        <h2 id="extract-title">Import floor plan{s.fileName ? ` — ${s.fileName}` : ''}</h2>
        {s.phase === 'running' && <Progress steps={s.progress} />}
        {s.phase === 'error' && (
          <div className="note note--error" role="alert">
            <strong>Extraction failed.</strong> {s.error}
            {!!s.errorDetails?.length && (
              <ul className="small">
                {s.errorDetails.slice(0, 8).map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {s.phase === 'done' && s.result && s.imageUrl && <Review result={s.result} imageUrl={s.imageUrl} />}
      </div>
    </div>
  );
}

function Progress({ steps }: { steps: { stage: string; message: string }[] }) {
  return (
    <div className="extraction__progress" aria-live="polite">
      <p className="muted small">Extracting on this device — the image is not uploaded anywhere.</p>
      <ol>
        {steps.map((p, i) => (
          <li key={`${p.stage}-${i}`} className={i === steps.length - 1 ? 'is-current' : 'is-done'}>
            {p.message}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Review({ result, imageUrl }: { result: ExtractionResult; imageUrl: string }) {
  const { highlight, acknowledged, set } = useExtraction();
  const ann = result.annotations;
  const status = result.review?.status ?? 'needs-review';
  const problems = result.review?.problems ?? [];
  const c = result.confidence;
  const cal = result.calibration;
  return (
    <div className="extraction__body">
      <PlanOverlay ann={ann} imageUrl={imageUrl} highlight={highlight} />
      <div className="extraction__side">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className={`badge ${STATUS[status].badge}`}>{STATUS[status].label}</span>
          <span className="muted small">overall confidence {pct(c?.overall)}</span>
        </div>
        <dl className="kv kv--small">
          <Count
            label="Walls"
            n={ann.walls.length}
            conf={c?.walls}
            extra={
              ann.walls.some((w) => w.kind === 'railing')
                ? `${ann.walls.filter((w) => w.kind === 'railing').length} railing`
                : undefined
            }
          />
          <Count
            label="Rooms"
            n={ann.rooms.length}
            conf={c?.rooms}
            extra={`${ann.rooms.filter((r) => r.labelSource === 'plan-label').length} named`}
          />
          <Count
            label="Doors"
            n={ann.doors.filter((d) => d.kind !== 'opening').length}
            conf={c?.doors}
            extra={
              ann.doors.some((d) => d.kind === 'opening')
                ? `+${ann.doors.filter((d) => d.kind === 'opening').length} uncertain`
                : undefined
            }
          />
          <Count label="Windows" n={ann.windows.length} conf={c?.windows} />
          <div className="kv__row">
            <dt>Scale</dt>
            <dd>
              {cal ? (
                <>
                  {cal.pixelsPerMeter.toFixed(1)} px/m ·{' '}
                  {cal.strategy === 'estimated' ? (
                    <strong>ESTIMATED</strong>
                  ) : cal.strategy === 'dimension-labels' ? (
                    'printed dimensions'
                  ) : (
                    cal.strategy
                  )}{' '}
                  ({cal.confidence})
                </>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        <ScaleCorrection ann={ann} />
        <section className="field">
          <span>Review ({problems.length})</span>
          <ul className="extraction__problems">
            {problems.map((p, i) => (
              <ProblemItem
                key={`${p.code}-${i}`}
                p={p}
                active={!!highlight.length && ids(p).every((id) => highlight.includes(id))}
                onSelect={() => set({ highlight: ids(p) })}
              />
            ))}
            {!problems.length && <li className="muted small">Nothing to review.</li>}
          </ul>
        </section>
        {status === 'failed' ? (
          <div className="note note--error">
            <strong>Extraction requires review.</strong> No 3D model is built from this result. Check the
            errors above; a clearer scan (or a plan with closed walls) is needed.
          </div>
        ) : (
          <>
            {status === 'needs-review' && (
              <label className="check small">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => set({ acknowledged: e.target.checked })}
                />{' '}
                I have reviewed the items above; build the model with them flagged.
              </label>
            )}
            <button
              className="btn btn--primary btn--lg"
              disabled={status === 'needs-review' && !acknowledged}
              onClick={acceptExtraction}
            >
              Accept and build 3D model
            </button>
          </>
        )}
        <button className="btn btn--sm" onClick={closeExtraction}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const ids = (p: ReviewProblem) => p.elementIds ?? (p.elementId ? [p.elementId] : []);

function Count({ label, n, conf, extra }: { label: string; n: number; conf?: number; extra?: string }) {
  return (
    <div className="kv__row">
      <dt>{label}</dt>
      <dd>
        {n}
        {extra ? ` (${extra})` : ''} · {pct(conf)}
      </dd>
    </div>
  );
}

function ProblemItem({ p, active, onSelect }: { p: ReviewProblem; active: boolean; onSelect: () => void }) {
  const tone = p.severity === 'error' ? 'note--error' : p.severity === 'warning' ? 'note--warning' : '';
  const canLocate = ids(p).length > 0;
  return (
    <li>
      <button
        type="button"
        className={`note ${tone} extraction__problem`}
        aria-pressed={active}
        disabled={!canLocate}
        onClick={onSelect}
        title={canLocate ? 'Show on the plan' : undefined}
      >
        {p.message}
      </button>
    </li>
  );
}

/** Correction: "this room is N m wide" becomes a reference measurement and extraction re-runs. */
function ScaleCorrection({ ann }: { ann: FloorPlanAnnotations }) {
  const [roomId, setRoomId] = useState(ann.rooms[0]?.id ?? '');
  const [axis, setAxis] = useState<'x' | 'y'>('x');
  const [meters, setMeters] = useState('');
  const room = ann.rooms.find((r) => r.id === roomId);
  const m = Number(meters.replace(',', '.'));
  if (!ann.rooms.length) return null;
  const apply = () => {
    if (!room || !(m > 0)) return;
    const xs = room.polygon.map((p) => p.x);
    const ys = room.polygon.map((p) => p.y);
    const a = axis === 'x' ? { x: Math.min(...xs), y: ys[0]! } : { x: xs[0]!, y: Math.min(...ys) };
    const b = axis === 'x' ? { x: Math.max(...xs), y: ys[0]! } : { x: xs[0]!, y: Math.max(...ys) };
    void rerunWithReference({ a, b, meters: m });
  };
  return (
    <details className="details">
      <summary className="small">Correct the scale with a known measurement</summary>
      <div className="row small" style={{ flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        <select
          className="select"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          aria-label="Room"
        >
          {ann.rooms.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={axis}
          onChange={(e) => setAxis(e.target.value as 'x' | 'y')}
          aria-label="Direction"
        >
          <option value="x">is wide (left–right)</option>
          <option value="y">is deep (top–bottom)</option>
        </select>
        <input
          className="input"
          style={{ width: 80 }}
          inputMode="decimal"
          placeholder="metres"
          value={meters}
          onChange={(e) => setMeters(e.target.value)}
          aria-label="Metres"
        />
        <button className="btn btn--sm" disabled={!(m > 0)} onClick={apply}>
          Re-run
        </button>
      </div>
    </details>
  );
}

/** The plan image with what was extracted drawn over it. */
function PlanOverlay({
  ann,
  imageUrl,
  highlight,
}: {
  ann: FloorPlanAnnotations;
  imageUrl: string;
  highlight: string[];
}) {
  const { widthPx: W, heightPx: H } = ann.image;
  const openings = useMemo(() => {
    const walls = new Map(ann.walls.map((w) => [w.id, pxWallGeometry(w)]));
    const seg = (wallId: string, span: [number, number]): [PxPoint, PxPoint] | null => {
      const g = walls.get(wallId);
      if (!g) return null;
      const { from, to } = spanAlongWall(g, span);
      return [
        { x: g.a.x + g.dir.x * from, y: g.a.y + g.dir.y * from },
        { x: g.a.x + g.dir.x * to, y: g.a.y + g.dir.y * to },
      ];
    };
    return [
      ...ann.doors.map((d) => ({
        id: d.id,
        kind: d.kind === 'opening' ? 'opening' : 'door',
        t: walls.get(d.wallId)?.thicknessPx ?? 8,
        s: seg(d.wallId, d.span),
      })),
      ...ann.windows.map((w) => ({
        id: w.id,
        kind: 'window',
        t: walls.get(w.wallId)?.thicknessPx ?? 8,
        s: seg(w.wallId, w.span),
      })),
    ];
  }, [ann]);
  const hl = new Set(highlight);
  const stroke = Math.max(1.5, Math.max(W, H) / 500);
  return (
    <svg
      className="extraction__plan"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Extracted walls, openings and rooms over the plan image"
    >
      <image href={imageUrl} x={0} y={0} width={W} height={H} opacity={0.55} />
      {ann.rooms.map((r) => {
        const xs = r.polygon.map((p) => p.x);
        const ys = r.polygon.map((p) => p.y);
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        // Fit the name inside the room's box (small cupboards get small labels).
        const size = Math.min(H / 45, (0.9 * (x1 - x0)) / (0.6 * r.name.length), 0.5 * (y1 - y0));
        return (
          <g key={r.id}>
            <polygon
              points={r.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
              className={`ov-room${r.labelSource === 'plan-label' ? '' : ' ov-room--uncertain'}${hl.has(r.id) ? ' ov--hl' : ''}`}
            />
            <text x={(x0 + x1) / 2} y={(y0 + y1) / 2} className="ov-label" fontSize={size}>
              {r.name}
            </text>
          </g>
        );
      })}
      {ann.walls.map((w) => {
        const g = pxWallGeometry(w);
        return (
          <line
            key={w.id}
            x1={g.a.x}
            y1={g.a.y}
            x2={g.b.x}
            y2={g.b.y}
            strokeWidth={w.kind === 'railing' ? stroke : Math.max(stroke, g.thicknessPx * 0.5)}
            className={`ov-wall ov-wall--${w.kind}${(w.confidence ?? 1) < 0.6 ? ' ov--weak' : ''}${hl.has(w.id) ? ' ov--hl' : ''}`}
          />
        );
      })}
      {openings.map((o) =>
        o.s ? (
          <line
            key={o.id}
            x1={o.s[0].x}
            y1={o.s[0].y}
            x2={o.s[1].x}
            y2={o.s[1].y}
            strokeWidth={o.t + 4}
            className={`ov-${o.kind}${hl.has(o.id) ? ' ov--hl' : ''}`}
          />
        ) : null,
      )}
    </svg>
  );
}
