'use client';
import { PASSENGER_STEPS, POOL_STATUS, REQUEST_STATUS } from '../lib/format';

export function StatusBadge({ kind = 'request', status }) {
  const meta = (kind === 'pool' ? POOL_STATUS : REQUEST_STATUS)[status] ?? { label: status, tone: 'done' };
  return <span className={`badge tone-${meta.tone}`}>{meta.label}</span>;
}

export function Loading({ rows = 2 }) {
  return (
    <div className="stack-sm" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}
    </div>
  );
}

export function ErrorNotice({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="notice notice-error" role="alert">
      <p>{error.message}</p>
      {onRetry && <button className="btn btn-ghost btn-small" style={{ marginTop: '0.5rem' }} onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="notice notice-empty">
      <p><strong>{title}</strong></p>
      {children && <p className="small" style={{ marginTop: '0.25rem' }}>{children}</p>}
    </div>
  );
}

/** Bullet's seats. `taken` seats are filled; `mine` (passenger view) highlights the viewer's own seats. */
export function SeatStrip({ capacity, taken, mine = 0, label }) {
  return (
    <div>
      <div className="seats" role="img" aria-label={`${taken} of ${capacity} seats taken`}>
        {Array.from({ length: capacity }, (_, i) => {
          const cls = i < mine ? 'seat taken mine' : i < taken ? 'seat taken' : 'seat';
          return <div key={i} className={cls}>{i < taken ? '' : 'free'}</div>;
        })}
      </div>
      <p className="seat-caption num">{label ?? `${taken} of ${capacity} seats taken`}</p>
    </div>
  );
}

export function Stepper({ status }) {
  const idx = PASSENGER_STEPS.findIndex((s) => s.key === status);
  return (
    <ol className="steps" aria-label="Ride progress">
      {PASSENGER_STEPS.map((s, i) => (
        <li key={s.key} className={i < idx || status === 'COMPLETED' ? 'done' : i === idx ? 'current' : ''} aria-current={i === idx ? 'step' : undefined}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}
