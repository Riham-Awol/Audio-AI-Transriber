'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  Building2,
  Calendar,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Mic,
  Plug,
  Settings,
  Sparkles,
  UploadCloud,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { cn, humanizeEnum } from '@/lib/utils';

export const NAV_ITEMS = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Meetings', href: '/meetings', icon: Video },
  { label: 'Record Meeting', href: '/record', icon: Mic },
  { label: 'Upload Recording', href: '/upload', icon: UploadCloud },
  { label: 'Calendar', href: '/calendar', icon: Calendar },
  { label: 'Action Items', href: '/action-items', icon: CheckSquare },
  { label: 'AI Assistant', href: '/assistant', icon: Sparkles },
  { label: 'Integrations', href: '/integrations', icon: Plug },
  { label: 'Reports', href: '/reports', icon: BarChart3 },
  { label: 'Team Members', href: '/team', icon: Users },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export function Sidebar({ collapsed, onToggleCollapse, mobileOpen, onCloseMobile }) {
  const pathname = usePathname();
  const { user, activeOrg, logout } = useAuth();

  // Close on Escape key on mobile
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onCloseMobile?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, onCloseMobile]);

  // Lock body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [mobileOpen]);

  const renderNavLinks = (isCollapsed, isMobile = false) => (
    <nav aria-label="Main navigation" className="flex-1 space-y-1 px-2.5 py-3 overflow-y-auto">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={isMobile ? onCloseMobile : undefined}
            title={isCollapsed ? item.label : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-150',
              isActive
                ? 'bg-burgundy text-white shadow-sm'
                : 'text-slate-300 hover:bg-white/10 hover:text-white',
              isCollapsed && 'justify-center px-2',
              isMobile && 'py-3 text-base'
            )}
          >
            <Icon className={cn('h-4 w-4 shrink-0', isMobile && 'h-5 w-5')} />
            {(!isCollapsed || isMobile) && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop Sticky Sidebar — Stays anchored and never scrolls with the page */}
      <aside
        className={cn(
          'hidden lg:flex flex-col bg-midnight dark:bg-midnight-deep text-white border-r border-white/10 transition-all duration-200 shrink-0 sticky top-0 h-screen h-dvh self-start z-30 select-none',
          collapsed ? 'w-[72px]' : 'w-64'
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'h-16 flex items-center border-b border-white/10 px-4 shrink-0',
            collapsed ? 'justify-center' : 'justify-between'
          )}
        >
          <Link href="/dashboard" className="flex items-center gap-2.5 min-w-0 group">
            <div className="h-8 w-8 rounded-lg bg-burgundy flex items-center justify-center font-bold text-white shrink-0 shadow-sm group-hover:bg-burgundy-deep transition-colors">
              V
            </div>
            {!collapsed && (
              <div className="truncate">
                <div className="text-sm font-semibold tracking-tight text-white leading-tight">VoxaMeet AI</div>
                <div className="text-[11px] text-slate-400 leading-tight">Meeting Intelligence</div>
              </div>
            )}
          </Link>
          {!collapsed && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="rounded-md p-1.5 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Workspace pill when expanded */}
        {!collapsed && activeOrg && (
          <div className="px-3 pt-2.5 pb-1 shrink-0">
            <div className="flex items-center gap-2 rounded-lg bg-white/5 border border-white/10 px-2.5 py-1.5 text-xs text-slate-300">
              <Building2 className="h-3.5 w-3.5 text-burgundy-light shrink-0" />
              <span className="truncate font-medium flex-1">{activeOrg.name}</span>
              <span className="text-[10px] uppercase font-semibold text-slate-400 bg-white/10 px-1.5 py-0.5 rounded">
                {humanizeEnum(activeOrg.role)}
              </span>
            </div>
          </div>
        )}

        {/* Scrollable Navigation Links */}
        {renderNavLinks(collapsed, false)}

        {/* Footer */}
        <div className="border-t border-white/10 p-2.5 shrink-0 flex items-center justify-between">
          {collapsed ? (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="w-full rounded-lg p-2 text-slate-300 hover:bg-white/10 hover:text-white flex justify-center transition-colors"
              aria-label="Expand sidebar"
              title="Expand sidebar"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <div className="flex items-center justify-between w-full px-1">
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-7 w-7 rounded-full bg-burgundy/80 text-white font-medium text-xs flex items-center justify-center shrink-0">
                  {user?.fullName?.charAt(0) || user?.email?.charAt(0) || 'U'}
                </div>
                <div className="truncate">
                  <div className="text-xs font-medium text-white truncate">{user?.fullName || 'User'}</div>
                  <div className="text-[10px] text-slate-400 truncate">{user?.email}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={logout}
                className="rounded-md p-1.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                title="Log out"
                aria-label="Log out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Mobile Drawer Navigation — Responsive for Mobile App */}
      <div
        className={cn(
          'fixed inset-0 z-50 lg:hidden transition-all duration-300',
          mobileOpen ? 'visible' : 'invisible pointer-events-none'
        )}
        aria-hidden={!mobileOpen}
      >
        {/* Backdrop */}
        <div
          className={cn(
            'fixed inset-0 bg-midnight-deep/70 backdrop-blur-sm transition-opacity duration-300 ease-out',
            mobileOpen ? 'opacity-100' : 'opacity-0'
          )}
          onClick={onCloseMobile}
        />

        {/* Drawer Panel */}
        <aside
          className={cn(
            'relative z-10 flex w-72 max-w-[85vw] h-full h-dvh flex-col bg-midnight text-white shadow-2xl transition-transform duration-300 ease-out',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          {/* Header */}
          <div className="h-16 flex items-center justify-between border-b border-white/10 px-4 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="h-8 w-8 rounded-lg bg-burgundy flex items-center justify-center font-bold text-white shrink-0">
                V
              </div>
              <div className="truncate">
                <span className="text-sm font-semibold tracking-tight text-white block">VoxaMeet AI</span>
                <span className="text-[11px] text-slate-400 block -mt-0.5">Mobile Menu</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onCloseMobile}
              className="rounded-md p-2 text-slate-300 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Close navigation menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Active Workspace */}
          {activeOrg && (
            <div className="px-4 py-2.5 border-b border-white/10 bg-white/5 shrink-0">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Building2 className="h-3.5 w-3.5 text-burgundy-light shrink-0" />
                <span className="truncate font-medium flex-1">{activeOrg.name}</span>
                <span className="text-[10px] uppercase font-semibold text-slate-400 bg-white/10 px-1.5 py-0.5 rounded">
                  {humanizeEnum(activeOrg.role)}
                </span>
              </div>
            </div>
          )}

          {/* Scrollable Navigation Items */}
          {renderNavLinks(false, true)}

          {/* User Profile & Sign Out Footer */}
          <div className="border-t border-white/10 p-3 shrink-0 bg-midnight-deep/50 safe-bottom">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-full bg-burgundy text-white font-medium text-xs flex items-center justify-center shrink-0">
                  {user?.fullName?.charAt(0) || user?.email?.charAt(0) || 'U'}
                </div>
                <div className="truncate">
                  <div className="text-xs font-medium text-white truncate">{user?.fullName || 'User'}</div>
                  <div className="text-[11px] text-slate-400 truncate">{user?.email}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  onCloseMobile?.();
                  logout();
                }}
                className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                title="Log out"
                aria-label="Log out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
