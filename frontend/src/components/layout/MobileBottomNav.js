'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Menu, Mic, UploadCloud, Video } from 'lucide-react';
import { cn } from '@/lib/utils';

export function MobileBottomNav({ onOpenMenu }) {
  const pathname = usePathname();

  const items = [
    { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { label: 'Meetings', href: '/meetings', icon: Video },
    { label: 'Record', href: '/record', icon: Mic, highlight: true },
    { label: 'Upload', href: '/upload', icon: UploadCloud },
  ];

  return (
    <nav
      aria-label="Mobile bottom navigation"
      className="fixed bottom-0 left-0 right-0 z-40 flex lg:hidden items-center justify-around border-t border-border bg-surface/95 dark:bg-midnight-deep/95 backdrop-blur-md px-2 py-1.5 shadow-lg safe-bottom"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));

        if (item.highlight) {
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-label={item.label}
              className={cn(
                'flex flex-col items-center justify-center -mt-4 relative group',
                isActive ? 'text-burgundy dark:text-burgundy-light' : 'text-ink'
              )}
            >
              <div
                className={cn(
                  'h-11 w-11 rounded-full flex items-center justify-center shadow-md transition-transform active:scale-95 duration-150',
                  isActive
                    ? 'bg-burgundy text-white ring-4 ring-burgundy/20'
                    : 'bg-burgundy text-white hover:bg-burgundy-deep'
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <span className="text-[10px] font-semibold mt-0.5 tracking-tight">{item.label}</span>
            </Link>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex flex-col items-center justify-center min-w-[56px] py-1 px-2 rounded-lg text-[10px] font-medium transition-colors active:scale-95',
              isActive
                ? 'text-burgundy dark:text-burgundy-light font-semibold'
                : 'text-ink-muted hover:text-ink'
            )}
          >
            <Icon className={cn('h-5 w-5 mb-0.5', isActive && 'text-burgundy dark:text-burgundy-light')} />
            <span className="truncate max-w-[64px]">{item.label}</span>
          </Link>
        );
      })}

      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open full menu"
        className="flex flex-col items-center justify-center min-w-[56px] py-1 px-2 rounded-lg text-[10px] font-medium text-ink-muted hover:text-ink active:scale-95 transition-colors"
      >
        <Menu className="h-5 w-5 mb-0.5" />
        <span>Menu</span>
      </button>
    </nav>
  );
}

