'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Shell from '../../components/Shell';
import { ErrorNotice } from '../../components/ui';
import { useAuth } from '../../lib/auth';

const DEMO = [
  { name: 'Nusrat', email: 'nusrat@teslapool.dev', role: 'Passenger' },
  { name: 'Rafiq', email: 'rafiq@teslapool.dev', role: 'Passenger' },
  { name: 'Shirin', email: 'shirin@teslapool.dev', role: 'Passenger' },
  { name: 'Jashim', email: 'jashim@teslapool.dev', role: 'Driver (Bullet)' },
];
const DEMO_PASSWORD = 'tesla-pool-demo';

export default function Login() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await signIn('/auth/login', { email, password });
      router.replace(user.role === 'DRIVER' ? '/driver' : '/passenger');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="stack" style={{ maxWidth: 440 }}>
        <h1 style={{ fontSize: '1.9rem' }}>Sign in</h1>
        <form className="card stack" onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <ErrorNotice error={error} />
          <button className="btn btn-tesla btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <div className="card stack-sm">
          <h2>Try the demo cast</h2>
          <p className="small muted">Fills the form with a seeded account. Password for all: <code>{DEMO_PASSWORD}</code></p>
          <div className="demo-chips">
            {DEMO.map((d) => (
              <button key={d.email} type="button" className="btn btn-ghost btn-small" onClick={() => { setEmail(d.email); setPassword(DEMO_PASSWORD); }}>
                {d.name} <span className="muted">({d.role})</span>
              </button>
            ))}
          </div>
        </div>
        <p className="small">No account yet? <Link href="/register">Create one</Link></p>
      </div>
    </Shell>
  );
}
