'use client';
import { useState } from 'react';
import PoolPanel from '../../components/PoolPanel';
import Shell from '../../components/Shell';
import { Empty, ErrorNotice, Loading, SeatStrip, StatusBadge } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatMoney, formatTime, zoneName } from '../../lib/format';
import { usePolling } from '../../lib/usePolling';

export default function DriverPage() {
  const { user, refreshUser } = useAuth();
  const [zones, setZones] = useState([]);
  const [tesla, setTesla] = useState(null);
  const [pool, setPool] = useState(null);
  const [requests, setRequests] = useState([]);
  const [history, setHistory] = useState([]);
  const [actionError, setActionError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const { loading, error, reload } = usePolling(async () => {
    const [z, me, reqs, pools] = await Promise.all([
      zones.length ? Promise.resolve({ zones }) : api('/zones'),
      api('/driver/me'),
      api('/driver/requests'),
      api('/driver/pools?limit=10'),
    ]);
    setZones(z.zones);
    setTesla(me.tesla);
    setPool((prev) => {
      if (prev && !me.activePool) refreshUser(); // trip just ended: TeslaPay earnings may have changed
      return me.activePool;
    });
    setRequests(reqs.requests);
    setHistory(pools.pools.filter((p) => p.id !== me.activePool?.id));
  }, 4000);

  async function toggleOnline() {
    setActionError(null);
    try {
      const { tesla: t } = await api('/driver/availability', { method: 'PATCH', body: { online: !tesla.isOnline } });
      setTesla(t);
      reload();
    } catch (err) {
      setActionError(err);
    }
  }

  async function accept(id) {
    setBusyId(id);
    setActionError(null);
    try {
      await api(`/driver/requests/${id}/accept`, { method: 'POST' });
    } catch (err) {
      setActionError(err); // e.g. "Not enough free seats": someone else got there first
    } finally {
      setBusyId(null);
      reload();
    }
  }

  if (!user) return <Shell role="DRIVER" />;

  return (
    <Shell role="DRIVER">
      <div className="stack">
        {loading && <Loading rows={3} />}
        {!loading && error && <ErrorNotice error={error} onRetry={reload} />}

        {tesla && (
          <section className="card stack" aria-labelledby="tesla-title">
            <div className="card-head">
              <div>
                <h1 id="tesla-title" style={{ fontSize: '1.6rem' }}>{tesla.name}</h1>
                <p className="small muted">{tesla.plate} · {tesla.capacity} seats</p>
              </div>
              <div className="switch">
                <span id="online-label">{tesla.isOnline ? 'Online' : 'Offline'}</span>
                <button role="switch" aria-checked={tesla.isOnline} aria-labelledby="online-label" onClick={toggleOnline} />
              </div>
            </div>
            {!pool && <SeatStrip capacity={tesla.capacity} taken={0} label="Empty. Accept a request to start a pool." />}
            <ErrorNotice error={actionError} />
          </section>
        )}

        {pool && <PoolPanel pool={pool} zones={zones} onChanged={reload} />}

        {tesla && (
          <section className="card" aria-labelledby="req-title">
            <div className="card-head">
              <h2 id="req-title">{pool ? 'Requests that fit your pool' : 'Waiting passengers'}</h2>
            </div>
            {!tesla.isOnline ? (
              <Empty title="You are offline">Go online to see passengers waiting for a Tesla.</Empty>
            ) : pool?.status === 'STARTED' ? (
              <Empty title="Trip in progress">New passengers cannot join a moving Tesla.</Empty>
            ) : requests.length === 0 ? (
              <Empty title="No requests right now">New ones appear here automatically.</Empty>
            ) : (
              <ul className="list">
                {requests.map((r) => (
                  <li key={r.id} className="row spread">
                    <div>
                      <p className="route">{r.passengerName}: {zoneName(zones, r.pickupZone)} to {zoneName(zones, r.destinationZone)}</p>
                      <p className="small muted">{r.seats} {r.seats === 1 ? 'seat' : 'seats'} · {r.paymentMethod === 'CASH' ? 'Cash' : 'TeslaPay'} · waiting since {formatTime(r.waitingSince)}</p>
                    </div>
                    <button className="btn btn-tesla btn-small" onClick={() => accept(r.id)} disabled={busyId === r.id}>
                      {busyId === r.id ? 'Accepting…' : 'Accept'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tesla && (
          <section className="card" aria-labelledby="hist-title">
            <div className="card-head"><h2 id="hist-title">Ride history</h2></div>
            {history.length === 0 ? (
              <Empty title="No finished trips yet">Completed and cancelled pools are listed here.</Empty>
            ) : (
              <ul className="list">
                {history.map((p) => {
                  const riders = p.passengers.filter((x) => x.leftReason !== 'PASSENGER_CANCELLED' && x.leftReason !== 'DRIVER_CANCELLED');
                  const total = p.status === 'COMPLETED' ? riders.reduce((n, x) => n + x.farePaisa, 0) : 0;
                  return (
                    <li key={p.id} className="stack-sm">
                      <div className="row spread">
                        <p className="route">{zoneName(zones, p.pickupZone)} pickup · {formatTime(p.createdAt)}</p>
                        <StatusBadge kind="pool" status={p.status} />
                      </div>
                      <p className="small muted">
                        {p.passengers.length === 0 ? 'No passengers' : p.passengers.map((x) => `${x.name}${x.leftReason === 'PASSENGER_CANCELLED' ? ' (cancelled)' : ''}`).join(', ')}
                        {p.status === 'COMPLETED' && <> · earned <span className="num">{formatMoney(total)}</span></>}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </Shell>
  );
}
