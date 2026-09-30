'use client';
import { useState } from 'react';
import { api } from '../lib/api';
import { formatMoney, zoneName } from '../lib/format';
import { ErrorNotice, SeatStrip, StatusBadge } from './ui';

// The one action that makes sense next for each pool status (mirrors the backend state machine).
const NEXT = {
  ACCEPTED: { action: 'arrive', label: 'I have arrived at pickup' },
  DRIVER_ARRIVED: { action: 'start', label: 'Start trip' },
  STARTED: { action: 'complete', label: 'Complete trip' },
};

export default function PoolPanel({ pool, zones, onChanged }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const next = NEXT[pool.status];
  const riders = pool.passengers.filter((p) => p.active);
  const canCancel = pool.status === 'ACCEPTED' || pool.status === 'DRIVER_ARRIVED';

  async function run(action) {
    if (action === 'cancel' && !window.confirm('Cancel this pool? Passengers go back to the waiting queue.')) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/driver/pools/${pool.id}/${action}`, { method: 'POST' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <section className="card stack" aria-labelledby="pool-title">
      <div className="card-head">
        <h2 id="pool-title">Current pool · {pool.tesla.name}</h2>
        <StatusBadge kind="pool" status={pool.status} />
      </div>
      <SeatStrip capacity={pool.capacity} taken={pool.seatsTaken} label={`${pool.seatsTaken} of ${pool.capacity} seats taken · pickup ${zoneName(zones, pool.pickupZone)}`} />

      {riders.length === 0 ? (
        <p className="small muted">No passengers right now. Accept a request below, or cancel this pool.</p>
      ) : (
        <ul className="list">
          {riders.map((p) => (
            <li key={p.requestId} className="row spread">
              <div>
                <p className="route">{p.name}</p>
                <p className="small muted">
                  to {zoneName(zones, p.destinationZone)} · {p.seats} {p.seats === 1 ? 'seat' : 'seats'} · {p.paymentMethod === 'CASH' ? 'collect cash' : 'TeslaPay'}
                </p>
              </div>
              <p className="fare num" style={{ fontSize: '1.2rem' }}>{formatMoney(p.farePaisa)}</p>
            </li>
          ))}
        </ul>
      )}

      <ErrorNotice error={error} />
      <div className="row">
        {next && (
          <button className="btn btn-tesla" onClick={() => run(next.action)} disabled={busy || riders.length === 0}>
            {busy ? 'Working…' : next.label}
          </button>
        )}
        {canCancel && <button className="btn btn-danger" onClick={() => run('cancel')} disabled={busy}>Cancel pool</button>}
      </div>
    </section>
  );
}
