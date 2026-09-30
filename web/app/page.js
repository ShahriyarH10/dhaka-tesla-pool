'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import Shell from '../components/Shell';
import { SeatStrip } from '../components/ui';
import { useAuth } from '../lib/auth';

export default function Home() {
  const { user, ready } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && user) router.replace(user.role === 'DRIVER' ? '/driver' : '/passenger');
  }, [ready, user, router]);

  return (
    <Shell>
      <section className="hero stack">
        <h1>Share a seat. Split the fare.</h1>
        <p className="lead">
          Book a three-seat Tesla from Banani. If someone is heading the same way, you share the ride and both pay less.
        </p>
        <div className="card" style={{ maxWidth: 420 }}>
          <div className="card-head"><h2>Bullet, 8:43 AM, Banani Road 11</h2></div>
          <SeatStrip capacity={3} taken={2} label="Nusrat and Rafiq are in. One seat left." />
        </div>
        <div className="row">
          <Link href="/register" className="btn btn-tesla" style={{ textDecoration: 'none' }}>Create account</Link>
          <Link href="/login" className="btn btn-ghost" style={{ textDecoration: 'none' }}>Sign in</Link>
        </div>
      </section>
    </Shell>
  );
}
