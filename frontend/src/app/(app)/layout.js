'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { Sidebar } from '@/components/layout/Sidebar';
import { Topbar } from '@/components/layout/Topbar';

export default function AppShellLayout({ children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-warm dark:bg-midnight-deep">
        <p className="text-sm text-ink-muted">Verifying workspace session...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-warm dark:bg-midnight-deep">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((v) => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar onOpenMobileMenu={() => setMobileOpen(true)} />
        <main className="flex-1 p-3.5 sm:p-5 md:p-6 lg:p-7 max-w-[1440px] w-full mx-auto pb-20 lg:pb-7">
          {children}
        </main>
      </div>
      <MobileBottomNav onOpenMenu={() => setMobileOpen(true)} />
    </div>
  );
}
