'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatMoney } from '../lib/format';
import { ErrorNotice } from './ui';

export default function RequestForm({ zones, onCreated }) {
  const [pickup, setPickup] = useState('banani');
  const [destination, setDestination] = useState('');
  const [seats, setSeats] = useState(1);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [estimate, setEstimate] = useState(null);
  const [estimateError, setEstimateError] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const sameZone = destination && destination === pickup;

  // Live fare estimate whenever the route or seat count changes.
  useEffect(() => {
    setEstimate(null);
    setEstimateError(null);
    if (!destination || sameZone) return;
    let stale = false;
    api(`/fare/estimate?pickup=${pickup}&destination=${destination}&seats=${seats}`)
      .then((r) => !stale && setEstimate(r))
      .catch((e) => !stale && setEstimateError(e));
    return () => { stale = true; };
  }, [pickup, destination, seats, sameZone]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ride } = await api('/rides', { method: 'POST', body: { pickup, destination, seats, paymentMethod } });
      onCreated(ride);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="card-head"><h2>Where to?</h2></div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="pickup">Pickup</label>
          <select id="pickup" value={pickup} onChange={(e) => setPickup(e.target.value)}>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="destination">Destination</label>
          <select id="destination" value={destination} onChange={(e) => setDestination(e.target.value)} required>
            <option value="" disabled>Choose a zone</option>
            {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </div>
      </div>
      {sameZone && <p className="notice notice-error" role="alert">Pickup and destination must be different zones.</p>}

      <div className="grid-2">
        <div className="field">
          <span className="label-like" id="seats-label" style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.3rem' }}>Seats</span>
          <div className="choice" role="radiogroup" aria-labelledby="seats-label">
            {[1, 2, 3].map((n) => (
              <label key={n}><input type="radio" name="seats" checked={seats === n} onChange={() => setSeats(n)} /><span>{n}</span></label>
            ))}
          </div>
        </div>
        <div className="field">
          <span id="pay-label" style={{ display: 'block', fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.3rem' }}>Pay with</span>
          <div className="choice" role="radiogroup" aria-labelledby="pay-label">
            {[['CASH', 'Cash'], ['TESLAPAY', 'TeslaPay']].map(([v, t]) => (
              <label key={v}><input type="radio" name="pay" checked={paymentMethod === v} onChange={() => setPaymentMethod(v)} /><span>{t}</span></label>
            ))}
          </div>
        </div>
      </div>

      {estimate && (
        <div className="notice" aria-live="polite">
          <p className="fare num">{formatMoney(estimate.soloTotal)} <span className="small muted" style={{ fontWeight: 500 }}>riding alone</span></p>
          <p className="small">
            <strong className="num">{formatMoney(estimate.pooledTotal)}</strong> if someone joins you (saves {formatMoney(estimate.soloTotal - estimate.pooledTotal)}).
          </p>
        </div>
      )}
      <ErrorNotice error={estimateError} />
      <ErrorNotice error={error} />
      <button className="btn btn-tesla btn-block" disabled={busy || !estimate}>{busy ? 'Requesting…' : 'Request ride'}</button>
    </form>
  );
}
