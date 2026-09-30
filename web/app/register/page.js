'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import Shell from '../../components/Shell';
import { ErrorNotice } from '../../components/ui';
import { useAuth } from '../../lib/auth';

export default function Register() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [role, setRole] = useState('PASSENGER');
  const [form, setForm] = useState({ name: '', email: '', password: '', teslaName: '', plate: '', capacity: 3 });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { role, name: form.name, email: form.email, password: form.password };
    if (role === 'DRIVER') body.tesla = { name: form.teslaName, plate: form.plate, capacity: Number(form.capacity) };
    try {
      const user = await signIn('/auth/register', body);
      router.replace(user.role === 'DRIVER' ? '/driver' : '/passenger');
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Shell>
      <div className="stack" style={{ maxWidth: 440 }}>
        <h1 style={{ fontSize: '1.9rem' }}>Create your account</h1>
        <form className="card stack" onSubmit={submit}>
          <div className="choice" role="radiogroup" aria-label="I am a">
            {[['PASSENGER', 'Passenger'], ['DRIVER', 'Driver']].map(([value, text]) => (
              <label key={value}>
                <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} />
                <span>{text}</span>
              </label>
            ))}
          </div>
          <div className="field"><label htmlFor="name">Name</label><input id="name" required maxLength={100} value={form.name} onChange={set('name')} autoComplete="name" /></div>
          <div className="field"><label htmlFor="email">Email</label><input id="email" type="email" required value={form.email} onChange={set('email')} autoComplete="email" /></div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" required minLength={8} maxLength={72} value={form.password} onChange={set('password')} autoComplete="new-password" />
            <p className="small muted">At least 8 characters.</p>
          </div>
          {role === 'DRIVER' && (
            <>
              <hr className="divider" />
              <div className="grid-2">
                <div className="field"><label htmlFor="teslaName">Tesla name</label><input id="teslaName" required maxLength={50} placeholder="Bullet" value={form.teslaName} onChange={set('teslaName')} /></div>
                <div className="field"><label htmlFor="plate">Plate</label><input id="plate" required minLength={3} maxLength={20} placeholder="DHAKA-METRO-TESLA-2" value={form.plate} onChange={set('plate')} /></div>
              </div>
              <div className="field">
                <label htmlFor="capacity">Passenger seats</label>
                <select id="capacity" value={form.capacity} onChange={set('capacity')}>
                  {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </>
          )}
          <ErrorNotice error={error} />
          <button className="btn btn-tesla btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
        </form>
        <p className="small">Already registered? <Link href="/login">Sign in</Link></p>
      </div>
    </Shell>
  );
}
