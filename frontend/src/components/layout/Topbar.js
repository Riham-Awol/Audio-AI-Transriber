'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Building2,
  Check,
  CheckSquare,
  ChevronDown,
  LogOut,
  Menu,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  Video,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { apiRequest } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatDateShort, humanizeEnum } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function Topbar({ onOpenMobileMenu }) {
  const { user, organizations, activeOrg, switchOrganization, logout, refreshProfile } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [orgMenuOpen, setOrgMenuOpen] = useState(false);

  const [createOrgOpen, setCreateOrgOpen] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [newOrgIndustry, setNewOrgIndustry] = useState('');
  const [orgSaving, setOrgSaving] = useState(false);

  const searchRef = useRef(null);

  const loadNotifications = useCallback(async () => {
    if (!activeOrg) return;
    try {
      const data = await apiRequest('/notifications');
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      // Ignore transient load error
    }
  }, [activeOrg]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNotif = () => loadNotifications();
    socket.on('notification:new', onNotif);
    return () => socket.off('notification:new', onNotif);
  }, [loadNotifications]);

  useEffect(() => {
    const trimmed = searchQuery.trim();
    if (trimmed.length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const data = await apiRequest(`/search?q=${encodeURIComponent(trimmed)}`);
        setSearchResults(data);
        setSearchOpen(true);
      } catch {
        setSearchResults(null);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    const onClickOutside = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const handleMarkAllRead = async () => {
    await apiRequest('/notifications/read-all', { method: 'POST' });
    setUnreadCount(0);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  };

  const handleCreateOrg = async (e) => {
    e.preventDefault();
    if (newOrgName.trim().length < 2) return;
    setOrgSaving(true);
    try {
      const res = await apiRequest('/organizations', {
        method: 'POST',
        body: { name: newOrgName.trim(), industry: newOrgIndustry.trim() },
      });
      await refreshProfile();
      switchOrganization(res.organization.id);
      setCreateOrgOpen(false);
      setNewOrgName('');
      setNewOrgIndustry('');
    } finally {
      setOrgSaving(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <>
      <header className="sticky top-0 z-20 h-16 border-b border-border bg-surface/95 dark:bg-midnight-deep/95 backdrop-blur-md px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-3 shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileMenu}
            className="lg:hidden rounded-lg p-2 text-ink-muted hover:bg-surface-muted hover:text-ink shrink-0"
            aria-label="Open navigation menu"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Global Search */}
          <div ref={searchRef} className="relative flex-1 max-w-[180px] sm:max-w-xs md:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
            <Input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchResults && setSearchOpen(true)}
              placeholder="Search meetings or tasks..."
              className="pl-9 bg-surface-muted/70 border-transparent focus:bg-surface focus:border-burgundy text-xs sm:text-sm h-9"
              aria-label="Global search"
            />
            {searchOpen && searchResults && (
              <div className="absolute left-0 right-0 mt-1.5 rounded-xl border border-border bg-surface shadow-elevated z-40 overflow-hidden">
                <div className="max-h-80 overflow-y-auto divide-y divide-border">
                  {searchResults.meetings?.length > 0 && (
                    <div className="p-2">
                      <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                        Meetings
                      </p>
                      {searchResults.meetings.map((m) => (
                        <Link
                          key={m.id}
                          href={`/meetings/${m.id}`}
                          onClick={() => setSearchOpen(false)}
                          className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-muted"
                        >
                          <span className="flex items-center gap-2 truncate">
                            <Video className="h-3.5 w-3.5 text-burgundy shrink-0" />
                            <span className="truncate font-medium">{m.title}</span>
                          </span>
                          <span className="text-xs text-ink-muted shrink-0">
                            {formatDateShort(m.scheduledAt || m.createdAt)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                  {searchResults.actionItems?.length > 0 && (
                    <div className="p-2">
                      <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                        Action Items
                      </p>
                      {searchResults.actionItems.map((ai) => (
                        <Link
                          key={ai.id}
                          href={`/meetings/${ai.meetingId}`}
                          onClick={() => setSearchOpen(false)}
                          className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-muted"
                        >
                          <span className="flex items-center gap-2 truncate">
                            <CheckSquare className="h-3.5 w-3.5 text-burgundy shrink-0" />
                            <span className="truncate">{ai.title}</span>
                          </span>
                          <span className="text-xs text-ink-muted shrink-0">
                            {humanizeEnum(ai.status)}
                          </span>
                        </Link>
                      ))}
                    </div>
                  )}
                  {searchResults.meetings?.length === 0 && searchResults.actionItems?.length === 0 && (
                    <p className="p-4 text-center text-xs text-ink-muted">
                      No matching meetings or tasks found.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Organization Switcher */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setOrgMenuOpen((v) => !v);
                setNotifOpen(false);
                setProfileOpen(false);
              }}
              className="hidden sm:flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-surface-muted"
            >
              <Building2 className="h-3.5 w-3.5 text-burgundy" />
              <span className="max-w-[140px] truncate">{activeOrg?.name || 'Workspace'}</span>
              <ChevronDown className="h-3.5 w-3.5 text-ink-muted" />
            </button>

            {orgMenuOpen && (
              <div className="absolute right-0 mt-1.5 w-64 rounded-xl border border-border bg-surface shadow-elevated z-40 p-1.5">
                <p className="px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Organizations
                </p>
                {organizations.map((org) => (
                  <button
                    key={org.id}
                    type="button"
                    onClick={() => {
                      switchOrganization(org.id);
                      setOrgMenuOpen(false);
                    }}
                    className="w-full flex items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm hover:bg-surface-muted"
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">{org.name}</div>
                      <div className="text-[11px] text-ink-muted">{humanizeEnum(org.role)}</div>
                    </div>
                    {activeOrg?.id === org.id && <Check className="h-4 w-4 text-burgundy shrink-0" />}
                  </button>
                ))}
                <div className="my-1 border-t border-border" />
                <button
                  type="button"
                  onClick={() => {
                    setOrgMenuOpen(false);
                    setCreateOrgOpen(true);
                  }}
                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-burgundy hover:bg-burgundy/10"
                >
                  <Plus className="h-4 w-4" />
                  New Organization
                </button>
              </div>
            )}
          </div>

          {/* Theme Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            className="rounded-lg p-2 text-ink-muted hover:bg-surface-muted hover:text-ink"
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setNotifOpen((v) => !v);
                setOrgMenuOpen(false);
                setProfileOpen(false);
              }}
              className="relative rounded-lg p-2 text-ink-muted hover:bg-surface-muted hover:text-ink"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-burgundy px-1 text-[10px] font-semibold text-white">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>

            {notifOpen && (
              <div className="absolute right-0 mt-1.5 w-80 rounded-xl border border-border bg-surface shadow-elevated z-40 overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-3.5 py-2.5">
                  <span className="text-xs font-semibold">Notifications</span>
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={handleMarkAllRead}
                      className="text-xs font-medium text-burgundy hover:underline"
                    >
                      Mark all read
                    </button>
                  )}
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-border">
                  {notifications.length === 0 ? (
                    <p className="p-6 text-center text-xs text-ink-muted">No notifications yet.</p>
                  ) : (
                    notifications.map((n) => (
                      <div key={n.id} className="px-3.5 py-2.5 text-xs hover:bg-surface-muted/60">
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-semibold text-ink">{n.title}</span>
                          {!n.isRead && <span className="h-2 w-2 rounded-full bg-burgundy mt-1 shrink-0" />}
                        </div>
                        <p className="mt-0.5 text-ink-muted">{n.message}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Profile Menu */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setProfileOpen((v) => !v);
                setOrgMenuOpen(false);
                setNotifOpen(false);
              }}
              className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-surface-muted"
            >
              <div className="h-7 w-7 rounded-full bg-burgundy text-white text-xs font-semibold flex items-center justify-center">
                {user?.fullName?.charAt(0)?.toUpperCase() || 'U'}
              </div>
              <span className="hidden md:block text-xs font-medium max-w-[120px] truncate">
                {user?.fullName}
              </span>
              <ChevronDown className="h-3.5 w-3.5 text-ink-muted hidden md:block" />
            </button>

            {profileOpen && (
              <div className="absolute right-0 mt-1.5 w-56 rounded-xl border border-border bg-surface shadow-elevated z-40 p-1.5">
                <div className="px-2.5 py-2 border-b border-border mb-1">
                  <p className="text-xs font-semibold truncate">{user?.fullName}</p>
                  <p className="text-[11px] text-ink-muted truncate">{user?.email}</p>
                </div>
                <Link
                  href="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium hover:bg-surface-muted"
                >
                  <Settings className="h-3.5 w-3.5" />
                  Profile & Settings
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <Modal
        open={createOrgOpen}
        onClose={() => setCreateOrgOpen(false)}
        title="Create Organization"
        description="Set up an isolated workspace for a business unit or team."
      >
        <form onSubmit={handleCreateOrg} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Organization Name</label>
            <Input
              required
              minLength={2}
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="e.g. Northstar Product Team"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Industry (optional)</label>
            <Input
              value={newOrgIndustry}
              onChange={(e) => setNewOrgIndustry(e.target.value)}
              placeholder="e.g. Enterprise SaaS"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateOrgOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={orgSaving}>
              {orgSaving ? 'Creating...' : 'Create Organization'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
