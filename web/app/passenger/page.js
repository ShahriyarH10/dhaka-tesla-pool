'use client';
import { useState } from 'react';
import RequestForm from '../../components/RequestForm';
import RideCard from '../../components/RideCard';
import Shell from '../../components/Shell';
import { Empty, ErrorNotice, Loading } from '../../components/ui';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { ACTIVE_STATUSES } from '../../lib/format';
import { usePolling } from '../../lib/usePolling';

export default function PassengerPage() {
  const { user, refreshUser } = useAuth();
  const [zones, setZones] = useState([]);
  const [rides, setRides] = useState([]);

  const { loading, error, reload } = usePolling(async () => {
    const [z, r] = await Promise.all([
      zones.length ? Promise.resolve({ zones }) : api('/zones'),
      api('/rides?limit=20'),
    ]);
    setZones(z.zones);
    setRides((prev) => {
      // A ride finishing changes the wallet (TeslaPay), so refresh it once on that transition.
      const wasActive = prev.some((p) => ACTIVE_STATUSES.includes(p.status));
      if (wasActive && !r.rides.some((x) => ACTIVE_STATUSES.includes(x.status))) refreshUser();
      return r.rides;
    });
  }, 4000);

  if (!user) return <Shell role="PASSENGER" />;

  const active = rides.find((r) => ACTIVE_STATUSES.includes(r.status));
  const history = rides.filter((r) => r !== active);

  return (
    <Shell role="PASSENGER">
      <div className="stack">
        <h1 style={{ fontSize: '1.9rem' }}>Hello, {user.name}</h1>
        {loading && <Loading rows={3} />}
        {!loading && error && <ErrorNotice error={error} onRetry={reload} />}

        {!loading && !active && zones.length > 0 && (
          <RequestForm zones={zones} onCreated={reload} />
        )}
        {!loading && active && <RideCard ride={active} zones={zones} detailed onChanged={reload} />}

        {!loading && (
          <section className="card" aria-labelledby="history-title">
            <div className="card-head"><h2 id="history-title">Your rides</h2></div>
            {history.length === 0 ? (
              <Empty title="No past rides yet">Completed and cancelled rides show up here.</Empty>
            ) : (
              <ul className="list">
                {history.map((r) => <li key={r.id}><RideCard ride={r} zones={zones} onChanged={reload} /></li>)}
              </ul>
            )}
          </section>
        )}
      </div>
    </Shell>
  );
}
