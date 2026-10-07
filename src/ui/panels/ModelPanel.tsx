import { roomMetrics } from '../../domain/topology';
import { formatArea } from '../../domain/units';
import { selectFloor, useDocument } from '../../state/documentStore';
import { useScene } from '../../state/sceneStore';

/** Everything the reconstruction knows and does not know — shown, not hidden. */
export function ModelPanel() {
  const apt = useDocument((s) => s.apartment);
  const validation = useDocument((s) => s.validation);
  const floor = useDocument(selectFloor);
  const selection = useScene((s) => s.selection);
  const select = useScene((s) => s.select);
  const setCamera = useScene((s) => s.setCamera);
  const plan = apt.coordinateSystem.plan;
  const cal = plan?.calibration;
  const notes = [...apt.metadata.notes].sort((a, b) =>
    a.severity === b.severity ? 0 : a.severity === 'warning' ? -1 : 1,
  );
  const totalRoomArea = floor.rooms.filter((r) => !r.exterior).reduce((a, r) => a + roomMetrics(r).area, 0);
  const errors = validation.issues.filter((i) => i.severity === 'error');
  const warnings = validation.issues.filter((i) => i.severity === 'warning');

  return (
    <>
      <div>
        <h2>Model</h2>
        <p className="muted small" style={{ margin: '2px 0 0' }}>
          {apt.metadata.name} · source <code>{plan?.image.file}</code>
        </p>
      </div>
      <div className="scroll">
        <section className="field">
          <span>Validation</span>
          {errors.length === 0 ? (
            <div className="note">
              <span className="badge badge--green">Geometry valid</span>{' '}
              {warnings.length ? `${warnings.length} warning(s)` : 'No issues.'}
            </div>
          ) : (
            <div className="note note--error">{errors.length} error(s) — see below.</div>
          )}
          {[...errors, ...warnings].map((i, k) => (
            <div key={k} className={`note ${i.severity === 'error' ? 'note--error' : 'note--warning'}`}>
              {i.message}
            </div>
          ))}
        </section>

        <section className="field">
          <span>Rooms</span>
          <ul className="list">
            {floor.rooms.map((r) => {
              const m = roomMetrics(r);
              return (
                <li key={r.id}>
                  <button
                    className="list-item"
                    aria-current={selection?.kind === 'room' && selection.id === r.id}
                    onClick={() => select({ kind: 'room', id: r.id })}
                    onDoubleClick={() => setCamera('room', r.id)}
                  >
                    <span>
                      {r.name}{' '}
                      {r.labelSource !== 'plan-label' && (
                        <span className="badge badge--amber">
                          {r.labelSource === 'user' ? 'renamed' : 'unlabelled'}
                        </span>
                      )}
                    </span>
                    <span className="muted small">{formatArea(m.area)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <dl className="kv">
            <dt>Room floor area (excl. balcony)</dt>
            <dd>{formatArea(totalRoomArea)}</dd>
            {apt.metadata.reportedAreaM2 && (
              <>
                <dt>Printed on plan</dt>
                <dd>{apt.metadata.reportedAreaM2.value} m²</dd>
              </>
            )}
          </dl>
        </section>

        {cal && (
          <section className="field">
            <span>Scale</span>
            <div className="note">
              <strong>{cal.pixelsPerMeter.toFixed(2)} px/m</strong>{' '}
              {cal.method === 'dimension-labels'
                ? `calibrated from printed room dimensions (max deviation ${(cal.maxResidual * 100).toFixed(1)} %).`
                : 'set manually — all dimensions are estimates.'}
            </div>
            <table className="calibration">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Printed</th>
                  <th>Drawn</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cal.samples.map((s, i) => (
                  <tr key={i}>
                    <td>{floor.rooms.find((r) => r.id === s.roomId)?.name ?? s.roomId}</td>
                    <td>{s.labelMeters.toFixed(2)} m</td>
                    <td>{(s.measuredPx / cal.pixelsPerMeter).toFixed(2)} m</td>
                    <td>
                      {s.accepted ? (
                        <span className="badge badge--green">ok</span>
                      ) : (
                        <span className="badge badge--red">{(s.residual * 100).toFixed(0)} %</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="field">
          <span>Assumptions (not on the plan)</span>
          {apt.metadata.assumptions.map((a) => (
            <div key={a.id} className="note">
              {a.description}:{' '}
              <strong>{typeof a.value === 'number' ? `${a.value} ${a.unit ?? ''}` : a.value}</strong>
            </div>
          ))}
        </section>

        <section className="field">
          <span>Reconstruction notes</span>
          {notes.map((n, i) => (
            <div key={i} className={`note ${n.severity === 'warning' ? 'note--warning' : ''}`}>
              {n.message}
            </div>
          ))}
        </section>
      </div>
    </>
  );
}
