'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Gavel,
  ListTodo,
  RefreshCw,
  Shield,
  TrendingUp,
  User,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api';

function formatDurationHours(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

export default function ReportsPage() {
  const { activeOrg } = useAuth();
  const [activeTab, setActiveTab] = useState('analytics'); // 'analytics' | 'audit'
  const [analytics, setAnalytics] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditSearch, setAuditSearch] = useState('');
  const [error, setError] = useState(null);

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiRequest('/reports/analytics');
      setAnalytics(data);
    } catch (err) {
      setError(err.message || 'Failed to load organization analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const data = await apiRequest('/reports/audit-logs');
      setAuditLogs(data.auditLogs || []);
    } catch {
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  useEffect(() => {
    if (activeTab === 'audit') {
      loadAuditLogs();
    }
  }, [activeTab, loadAuditLogs]);

  const handleDownloadCsv = async (type) => {
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('voxameet_access_token') : '';
      const orgId = typeof window !== 'undefined' ? localStorage.getItem('voxameet_org_id') : '';
      const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

      const res = await fetch(`${baseUrl}/reports/export?type=${type}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          ...(orgId ? { 'X-Organization-Id': orgId } : {}),
        },
      });

      if (!res.ok) throw new Error('Download failed.');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `voxameet_${type}_report.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message || 'Failed to download report.');
    }
  };

  const kpis = analytics?.kpis || {};
  const actionStats = analytics?.actionItems || {};
  const decisionStats = analytics?.decisions || {};
  const topSpeakers = analytics?.topSpeakers || [];
  const monthlyTrends = analytics?.meetingsByMonth || [];

  const filteredLogs = auditLogs.filter((log) => {
    if (!auditSearch.trim()) return true;
    const q = auditSearch.toLowerCase();
    return (
      (log.action || '').toLowerCase().includes(q) ||
      (log.userName || '').toLowerCase().includes(q) ||
      (log.resourceType || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink">
              Reports & Organization Intelligence
            </h1>
            <Badge variant="midnight" className="text-[10px] tracking-wide uppercase">
              Phase 7 Enterprise
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-ink-muted">
            Cross-meeting executive metrics, speaker participation, task completion velocity, and audit trail.
          </p>
        </div>

        {/* Consolidated Export Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDownloadCsv('action_items')}
            className="text-xs gap-1.5"
            title="Download all organization action items as CSV"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-burgundy" />
            Export Tasks (CSV)
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleDownloadCsv('decisions')}
            className="text-xs gap-1.5"
            title="Download all decisions made across meetings"
          >
            <Gavel className="h-3.5 w-3.5 text-midnight" />
            Export Decisions (CSV)
          </Button>
        </div>
      </div>

      {/* KPI Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between text-ink-muted text-xs font-medium">
              <span>Total Meetings</span>
              <Calendar className="h-4 w-4 text-burgundy" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="text-2xl font-bold text-ink">{kpis.totalMeetings || 0}</div>
            <p className="text-[11px] text-ink-muted mt-0.5">
              {kpis.transcribedMeetings || 0} transcribed · {kpis.summarizedMeetings || 0} summarized
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between text-ink-muted text-xs font-medium">
              <span>Recorded Duration</span>
              <Clock className="h-4 w-4 text-midnight" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="text-2xl font-bold text-ink">{kpis.totalHours || 0} hrs</div>
            <p className="text-[11px] text-ink-muted mt-0.5">
              Avg {kpis.avgMeetingDurationMinutes || 0} mins per meeting
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between text-ink-muted text-xs font-medium">
              <span>Task Completion Rate</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="text-2xl font-bold text-ink">{kpis.actionItemCompletionRate || 0}%</div>
            <p className="text-[11px] text-ink-muted mt-0.5">
              {actionStats.completed || 0} of {actionStats.total || 0} action items finished
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between text-ink-muted text-xs font-medium">
              <span>Agreed Decisions</span>
              <Gavel className="h-4 w-4 text-burgundy" />
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4 pt-0">
            <div className="text-2xl font-bold text-ink">{decisionStats.agreed || decisionStats.total || 0}</div>
            <p className="text-[11px] text-ink-muted mt-0.5">
              {decisionStats.proposed || 0} proposed · {decisionStats.rejected || 0} rejected
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('analytics')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'analytics'
              ? 'bg-midnight text-white shadow-xs'
              : 'text-ink-muted hover:bg-surface-subtle hover:text-ink'
          }`}
        >
          <BarChart3 className="h-3.5 w-3.5" />
          Intelligence & Trends
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
            activeTab === 'audit'
              ? 'bg-midnight text-white shadow-xs'
              : 'text-ink-muted hover:bg-surface-subtle hover:text-ink'
          }`}
        >
          <Shield className="h-3.5 w-3.5" />
          Compliance & Audit Trail
        </button>
      </div>

      {/* Tab 1: Intelligence & Trends */}
      {activeTab === 'analytics' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Monthly Meeting Volume */}
          <Card className="lg:col-span-2">
            <CardHeader className="py-4 px-6 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-ink flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-burgundy" />
                  Meeting Volume & Speaking Hours by Month
                </CardTitle>
                <Badge variant="outline" className="text-[10px]">
                  Trailing 6 Months
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {monthlyTrends.length === 0 ? (
                <p className="text-xs text-ink-muted py-8 text-center">No trend data recorded yet.</p>
              ) : (
                <div className="space-y-4">
                  {monthlyTrends.map((m, idx) => {
                    const hours = Math.round((m.durationSeconds / 3600) * 10) / 10;
                    return (
                      <div key={idx} className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs font-medium">
                          <span className="text-ink">{m.month}</span>
                          <span className="text-ink-muted">
                            {m.meetingCount} meetings · {hours} hrs
                          </span>
                        </div>
                        <div className="h-2 w-full rounded-full bg-surface-subtle overflow-hidden">
                          <div
                            className="h-full rounded-full bg-burgundy transition-all"
                            style={{
                              width: `${Math.min(100, Math.max(10, m.meetingCount * 12))}%`,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Speakers Insights */}
          <Card>
            <CardHeader className="py-4 px-6 border-b border-border">
              <CardTitle className="text-sm font-semibold text-ink flex items-center gap-2">
                <Users className="h-4 w-4 text-midnight" />
                Speaker Participation
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-3.5">
              {topSpeakers.length === 0 ? (
                <p className="text-xs text-ink-muted py-6 text-center">No speaker data available.</p>
              ) : (
                topSpeakers.map((spk, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2.5 truncate">
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white font-bold text-[11px]"
                        style={{ backgroundColor: spk.colorHex || '#762F48' }}
                      >
                        {spk.displayName.slice(0, 1)}
                      </div>
                      <div className="truncate">
                        <p className="font-semibold text-ink truncate">{spk.displayName}</p>
                        <p className="text-[10px] text-ink-muted">
                          {spk.meetingsCount} {spk.meetingsCount === 1 ? 'meeting' : 'meetings'}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-ink-muted text-[11px] shrink-0">
                      {formatDurationHours(spk.totalSpeakingSeconds)}
                    </span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {/* Action Items Velocity */}
          <Card className="lg:col-span-3">
            <CardHeader className="py-4 px-6 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-ink flex items-center gap-2">
                  <ListTodo className="h-4 w-4 text-burgundy" />
                  Task Execution & Breakdown
                </CardTitle>
                <Link href="/action-items">
                  <Button variant="ghost" size="sm" className="text-xs">
                    View All Action Items →
                  </Button>
                </Link>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center">
                <div className="rounded-xl border border-border bg-surface-subtle p-3.5">
                  <div className="text-xl font-bold text-emerald-600">{actionStats.completed || 0}</div>
                  <div className="text-xs text-ink-muted mt-0.5">Completed</div>
                </div>
                <div className="rounded-xl border border-border bg-surface-subtle p-3.5">
                  <div className="text-xl font-bold text-blue-600">{actionStats.inProgress || 0}</div>
                  <div className="text-xs text-ink-muted mt-0.5">In Progress</div>
                </div>
                <div className="rounded-xl border border-border bg-surface-subtle p-3.5">
                  <div className="text-xl font-bold text-amber-600">{actionStats.pending || 0}</div>
                  <div className="text-xs text-ink-muted mt-0.5">Pending</div>
                </div>
                <div className="rounded-xl border border-border bg-surface-subtle p-3.5">
                  <div className="text-xl font-bold text-red-600">{actionStats.urgent || 0}</div>
                  <div className="text-xs text-ink-muted mt-0.5">Urgent Priority</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Tab 2: Compliance & Audit Trail */}
      {activeTab === 'audit' && (
        <Card>
          <CardHeader className="py-4 px-6 border-b border-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-semibold text-ink flex items-center gap-2">
                  <Shield className="h-4 w-4 text-burgundy" />
                  Organization Security Audit Trail
                </CardTitle>
                <p className="text-xs text-ink-muted">
                  Immutable record of user actions, recording modifications, and permissions.
                </p>
              </div>

              <div className="w-full sm:w-64">
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Filter logs by action or user..."
                  className="w-full rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-ink placeholder:text-ink-muted focus:border-burgundy outline-hidden"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {auditLoading ? (
              <div className="py-16 text-center text-xs text-ink-muted flex items-center justify-center gap-2">
                <RefreshCw className="h-4 w-4 animate-spin text-burgundy" />
                Loading audit trail...
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="py-16 text-center text-xs text-ink-muted space-y-1">
                <Shield className="h-8 w-8 mx-auto text-ink-muted/50" />
                <p className="font-semibold text-ink">No audit logs matching query</p>
                <p>Actions taken within your organization will appear here automatically.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-surface-subtle border-b border-border text-[11px] font-semibold text-ink-muted uppercase">
                    <tr>
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">User</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Resource</th>
                      <th className="py-3 px-4">IP Address</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {filteredLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-surface-subtle/50 transition-colors">
                        <td className="py-3 px-4 font-mono text-ink-muted text-[11px] whitespace-nowrap">
                          {new Date(log.createdAt).toLocaleString([], {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-3 px-4 font-medium text-ink">
                          {log.userName}
                          {log.userEmail && (
                            <span className="block text-[10px] text-ink-muted">{log.userEmail}</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {log.action}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-ink-muted capitalize">
                          {log.resourceType || '—'}
                        </td>
                        <td className="py-3 px-4 font-mono text-ink-muted text-[11px]">
                          {log.ipAddress || '127.0.0.1'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
