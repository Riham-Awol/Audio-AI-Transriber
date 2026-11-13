'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  HardDrive,
  MessageSquare,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Share2,
  Shield,
  Trash2,
  Video,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api';

const CATEGORIES = [
  { id: 'all', label: 'All Integrations' },
  { id: 'calendar', label: 'Calendars', icon: Calendar },
  { id: 'meeting', label: 'Meeting Platforms', icon: Video },
  { id: 'communication', label: 'Communication', icon: MessageSquare },
  { id: 'project_management', label: 'Project Management', icon: Settings2 },
  { id: 'storage', label: 'Cloud Storage', icon: HardDrive },
];

export default function IntegrationsPage() {
  const { activeOrg, user } = useAuth();
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncingProvider, setSyncingProvider] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [actionError, setActionError] = useState(null);

  // Connect Modal state
  const [connectModalOpen, setConnectModalOpen] = useState(false);
  const [activeProvider, setActiveProvider] = useState(null);
  const [configEmail, setConfigEmail] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [connecting, setConnecting] = useState(false);

  const loadIntegrations = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/integrations');
      setIntegrations(data.integrations || []);
    } catch (err) {
      setActionError(err.message || 'Failed to load integrations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  const handleOpenConnect = (item) => {
    setActiveProvider(item);
    setConfigEmail(user?.email || '');
    setWebhookUrl('');
    setConnectModalOpen(true);
  };

  const handleConnectSubmit = async (e) => {
    e.preventDefault();
    if (!activeProvider) return;
    setConnecting(true);
    setActionError(null);

    try {
      await apiRequest(`/integrations/${activeProvider.key}/connect`, {
        method: 'POST',
        body: {
          config: {
            connectedEmail: configEmail || user?.email,
            webhookUrl: webhookUrl || undefined,
            connectedAt: new Date().toISOString(),
          },
        },
      });

      // Auto-sync initial data
      if (activeProvider.supportsSync) {
        await apiRequest(`/integrations/${activeProvider.key}/sync`, { method: 'POST' }).catch(() => {});
      }

      setConnectModalOpen(false);
      setActionSuccess(`Successfully connected ${activeProvider.displayName}!`);
      setTimeout(() => setActionSuccess(null), 4000);
      loadIntegrations();
    } catch (err) {
      setActionError(err.message || 'Connection failed.');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async (providerKey, displayName) => {
    if (!window.confirm(`Disconnect ${displayName}? Tokens will be permanently removed.`)) return;
    try {
      await apiRequest(`/integrations/${providerKey}`, { method: 'DELETE' });
      setActionSuccess(`Disconnected ${displayName}.`);
      setTimeout(() => setActionSuccess(null), 3000);
      loadIntegrations();
    } catch (err) {
      setActionError(err.message || 'Failed to disconnect.');
    }
  };

  const handleSync = async (providerKey, displayName) => {
    setSyncingProvider(providerKey);
    setActionError(null);
    try {
      const res = await apiRequest(`/integrations/${providerKey}/sync`, { method: 'POST' });
      setActionSuccess(`Synced ${displayName}! (${res.syncedCount || 1} records updated)`);
      setTimeout(() => setActionSuccess(null), 4000);
      loadIntegrations();
    } catch (err) {
      setActionError(err.message || 'Sync failed.');
    } finally {
      setSyncingProvider(null);
    }
  };

  const filteredIntegrations = integrations.filter((item) => {
    const matchesCat = selectedCategory === 'all' || item.category === selectedCategory;
    const matchesSearch =
      item.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const connectedCount = integrations.filter((i) => i.status === 'connected').length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink">
              Integrations Marketplace
            </h1>
            <Badge variant="midnight" className="text-[10px] tracking-wide uppercase">
              OAuth 2.0 Vault
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-ink-muted">
            Connect meeting platforms, calendar schedules, Slack announcements, and Jira task tracking.
          </p>
        </div>

        {/* Stats Pill */}
        <div className="flex items-center gap-2 rounded-xl border border-border bg-surface-subtle px-3.5 py-2 text-xs">
          <div className="flex h-2.5 w-2.5 rounded-full bg-green-500 animate-pulse" />
          <span className="font-semibold text-ink">{connectedCount} Active</span>
          <span className="text-ink-muted">/ {integrations.length} Providers</span>
        </div>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div className="rounded-lg border border-green-200 bg-green-50 dark:bg-green-950/30 px-4 py-2.5 text-xs text-green-800 dark:text-green-300 flex items-center justify-between">
          <span>{actionSuccess}</span>
          <button type="button" onClick={() => setActionSuccess(null)}>×</button>
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 px-4 py-2.5 text-xs text-red-800 dark:text-red-300 flex items-center justify-between">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)}>×</button>
        </div>
      )}

      {/* Filter Tabs & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                selectedCategory === cat.id
                  ? 'bg-midnight text-white shadow-xs'
                  : 'text-ink-muted hover:bg-surface-subtle hover:text-ink'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-ink-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search integrations..."
            className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:border-burgundy outline-hidden"
          />
        </div>
      </div>

      {/* Grid of Providers */}
      {loading ? (
        <div className="py-20 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin text-burgundy" />
          Loading marketplace integrations...
        </div>
      ) : filteredIntegrations.length === 0 ? (
        <div className="py-16 text-center text-xs text-ink-muted space-y-2">
          <Plug className="h-8 w-8 mx-auto text-ink-muted/50" />
          <p className="font-semibold text-ink">No integrations found</p>
          <p>Try searching for a different keyword or category.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredIntegrations.map((item) => {
            const isConnected = item.status === 'connected';
            const isSyncing = syncingProvider === item.key;

            return (
              <Card
                key={item.key}
                className={`flex flex-col justify-between transition-all ${
                  isConnected
                    ? 'border-green-200 dark:border-green-900/50 bg-surface'
                    : 'bg-surface hover:border-burgundy/40'
                }`}
              >
                <CardHeader className="p-4 sm:p-5 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-subtle border border-border font-bold text-sm text-burgundy">
                        {item.displayName.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <CardTitle className="text-sm font-semibold text-ink">
                          {item.displayName}
                        </CardTitle>
                        <span className="text-[11px] text-ink-muted capitalize">
                          {item.category.replace('_', ' ')}
                        </span>
                      </div>
                    </div>

                    {isConnected ? (
                      <Badge variant="success" className="text-[10px] tracking-wide gap-1">
                        <CheckCircle2 className="h-2.5 w-2.5" />
                        Connected
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px]">
                        Available
                      </Badge>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="p-4 sm:p-5 pt-0 space-y-4 flex-1 flex flex-col justify-between">
                  <p className="text-xs text-ink-muted leading-relaxed">
                    {item.description}
                  </p>

                  <div className="space-y-3 pt-2 border-t border-border/60">
                    {isConnected && (
                      <div className="text-[11px] text-ink-muted space-y-1">
                        {item.config?.connectedEmail && (
                          <p className="truncate">
                            Account: <span className="text-ink font-medium">{item.config.connectedEmail}</span>
                          </p>
                        )}
                        {item.lastSyncedAt && (
                          <p className="flex items-center gap-1 text-[10px]">
                            <Clock className="h-2.5 w-2.5" />
                            Last synced:{' '}
                            {new Date(item.lastSyncedAt).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </p>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1">
                      {isConnected ? (
                        <>
                          {item.supportsSync && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isSyncing}
                              onClick={() => handleSync(item.key, item.displayName)}
                              className="text-xs gap-1.5 flex-1"
                            >
                              <RefreshCw className={`h-3 w-3 ${isSyncing ? 'animate-spin' : ''}`} />
                              {isSyncing ? 'Syncing...' : 'Sync Now'}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDisconnect(item.key, item.displayName)}
                            className="text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
                          >
                            Disconnect
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          onClick={() => handleOpenConnect(item)}
                          className="w-full text-xs gap-1.5"
                        >
                          <Plug className="h-3.5 w-3.5" />
                          Connect Integration
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Connect Modal */}
      <Modal
        open={connectModalOpen}
        onClose={() => setConnectModalOpen(false)}
        title={activeProvider ? `Connect ${activeProvider.displayName}` : 'Connect Integration'}
        description="Authenticate and grant access to synchronize events or cloud recordings."
      >
        <form onSubmit={handleConnectSubmit} className="space-y-4 pt-1">
          <div className="rounded-lg border border-border bg-surface-subtle p-3 text-xs text-ink-muted space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-ink">
              <Shield className="h-3.5 w-3.5 text-burgundy" />
              Secure AES-256-GCM Vault
            </div>
            <p>
              Your OAuth tokens and credentials are encrypted at rest with hardware-backed keys.
              Permissions are strictly scoped to {activeProvider?.category} operations.
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1">
              Account Email / Workspace Identifier
            </label>
            <Input
              type="email"
              required
              value={configEmail}
              onChange={(e) => setConfigEmail(e.target.value)}
              placeholder="user@company.com"
            />
          </div>

          {activeProvider?.key === 'slack' && (
            <div>
              <label className="block text-xs font-medium text-ink mb-1">
                Incoming Webhook URL (Optional)
              </label>
              <Input
                type="url"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/..."
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConnectModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={connecting} className="gap-1.5">
              {connecting ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Authorizing...
                </>
              ) : (
                <>
                  <Plug className="h-3.5 w-3.5" />
                  Authorize & Connect
                </>
              )}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
