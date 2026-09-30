'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '../lib/auth';
import { formatMoney } from '../lib/format';
import { Loading } from './ui';

export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
  );
}

/** Page frame. With `role` set it also guards the page: wrong or missing login is redirected. */
export default function Shell({ role, children }) {
  const { user, ready, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!ready || !role) return;
    if (!user) router.replace('/login');
    else if (user.role !== role) router.replace(user.role === 'DRIVER' ? '/driver' : '/passenger');
  }, [ready, user, role, router]);

  const blocked = role && (!ready || !user || user.role !== role);

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand"><BrandMark /> Dhaka Tesla Pool</Link>
          {user && (
            <div className="who">
              <span>{user.name}</span>
              {user.role === 'PASSENGER' && <span className="wallet num" title="TeslaPay wallet">{formatMoney(user.walletBalancePaisa)}</span>}
              {user.role === 'DRIVER' && user.walletBalancePaisa > 0 && <span className="wallet num" title="TeslaPay earnings">{formatMoney(user.walletBalancePaisa)}</span>}
              <button className="btn btn-ghost btn-small" onClick={() => { signOut(); router.push('/'); }}>Sign out</button>
            </div>
          )}
        </div>
      </header>
      <main className="page">{blocked ? <Loading rows={3} /> : children}</main>
    </>
  );
}
