'use client';
import { useState } from 'react';
import { api } from '../lib/api';
import { describeEvent, formatMoney, formatTime, zoneName } from '../lib/format';
import { ErrorNotice, SeatStrip, StatusBadge, Stepper } from './ui';

const CANCELLABLE = ['REQUESTED', 'MATCHED'];

export default function RideCard({ ride, zones, detailed, onChanged }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const route = `${zoneName(zones, ride.pickupZone)} to ${zoneName(zones, ride.destinationZone)}`;
  const pooled = ride.fareBreakdown?.pooled;
  const active = ['REQUESTED', 'MATCHED', 'DRIVER_ARRIVED', 'STARTED'].includes(ride.status);

  async function cancel() {
    if (!window.confirm('Cancel this ride?')) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/rides/${ride.id}/cancel`, { method: 'POST' });
      onChanged();
    } catch (err) {
      setError(err);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory() {
    if (events) return setEvents(null);
    try {
      const { ride: full } = await api(`/rides/${ride.id}`);
      setEvents(full.events);
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className={detailed ? 'card stack' : 'stack-sm'}>
      <div className="row spread">
        <p className="route">{route}</p>
        <StatusBadge status={ride.status} />
      </div>

      {detailed && active && <Stepper status={ride.status} />}

      <div className="row spread">
        <div>
          <p className="fare num">
            {formatMoney(ride.farePaisa)}
            {pooled && ride.status !== 'CANCELLED' && (
              <span className="fare-old num">{formatMoney(ride.fareBreakdown.gross)}</span>
            )}
          </p>
          <p className="small muted">
            {ride.seats} {ride.seats === 1 ? 'seat' : 'seats'} · {ride.paymentMethod === 'CASH' ? 'Cash' : 'TeslaPay'}
            {ride.fareLocked ? ' · fare locked' : active ? ' · fare can still change' : ''}
          </p>
          {ride.status === 'REQUESTED' && (
            <p className="small muted num">Drops to {formatMoney(ride.estimatedPooledFarePaisa)} if someone shares.</p>
          )}
        </div>
        {!detailed && <p className="small muted">{formatTime(ride.createdAt)}</p>}
      </div>

      {detailed && ride.pool && (
        <div className="stack-sm">
          <p className="small">
            <strong>{ride.pool.teslaName}</strong> ({ride.pool.plate}), driven by {ride.pool.driverName}
          </p>
          <SeatStrip
            capacity={ride.pool.capacity}
            taken={ride.seats + ride.pool.coPassengers}
            mine={ride.seats}
            label={ride.pool.coPassengers === 0 ? 'Riding alone for now' : `Sharing with ${ride.pool.coPassengers} other ${ride.pool.coPassengers === 1 ? 'passenger' : 'passengers'}`}
          />
        </div>
      )}
      {detailed && ride.status === 'REQUESTED' && (
        <p className="small muted">Looking for a Tesla heading your way. This page updates on its own.</p>
      )}

      <ErrorNotice error={error} />
      <div className="row">
        {CANCELLABLE.includes(ride.status) && (
          <button className="btn btn-danger btn-small" onClick={cancel} disabled={busy}>{busy ? 'Cancelling…' : 'Cancel ride'}</button>
        )}
        {detailed && ride.status === 'DRIVER_ARRIVED' && <p className="small muted">Your Tesla has arrived, so this ride can no longer be cancelled.</p>}
        <button className="btn btn-ghost btn-small" onClick={toggleHistory} aria-expanded={Boolean(events)}>
          {events ? 'Hide history' : 'What happened?'}
        </button>
      </div>

      {events && (
        <ul className="timeline">
          {events.map((e, i) => <li key={i}><span className="num muted">{formatTime(e.at)}</span> {describeEvent(e)}</li>)}
        </ul>
      )}
    </div>
  );
}
