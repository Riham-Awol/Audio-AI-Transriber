'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      router.replace(user ? '/dashboard' : '/login');
    }
  }, [loading, user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-warm dark:bg-midnight-deep">
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 rounded-lg bg-burgundy flex items-center justify-center text-white font-bold">
          V
        </div>
        <p className="text-sm text-ink-muted">Loading VoxaMeet AI...</p>
      </div>
    </div>
  );
}

