'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  ListTodo,
  Mic,
  Plus,
  Sparkles,
  UploadCloud,
  Video,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import {
  formatDateTime,
  formatDuration,
  formatHoursFromSeconds,
  humanizeEnum,
} from '@/lib/utils';
import { Badge, statusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { MeetingActivityChart, MeetingDurationChart } from '@/components/dashboard/ActivityCharts';
import { MeetingModal } from '@/components/meetings/MeetingModal';

export default function DashboardPage() {
  const { activeOrg } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scheduleOpen, setScheduleOpen] = useState(false);

  const loadOverview = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest('/dashboard/overview');
      setData(res);
    } catch (err) {
      setError(err.message || 'Failed to load dashboard metrics.');
    } finally {
      setLoading(false);
    }
  }, [activeOrg]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refresh = () => loadOverview();
    socket.on('meeting:created', refresh);
    socket.on('meeting:updated', refresh);
    socket.on('meeting:deleted', refresh);
    return () => {
      socket.off('meeting:created', refresh);
      socket.off('meeting:updated', refresh);
      socket.off('meeting:deleted', refresh);
    };
  }, [loadOverview]);

  const stats = data?.stats || {};
  const statCards = [
    { label: 'Total Meetings', value: stats.totalMeetings ?? 0, icon: Video },
    {
      label: 'Recorded Hours',
      value: `${formatHoursFromSeconds(stats.totalRecordedSeconds)}h`,
      icon: Clock,
    },
    { label: 'Total Transcripts', value: stats.totalTranscripts ?? 0, icon: FileText },
    { label: 'Action Items', value: stats.totalActionItems ?? 0, icon: ListTodo },
    { label: 'Pending Tasks', value: stats.pendingTasks ?? 0, icon: CheckCircle2 },
    { label: 'Meetings This Week', value: stats.meetingsThisWeek ?? 0, icon: Calendar },
  ];

  return (
    <div className="space-y-6">
      {/* Header + Quick Actions */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Executive Dashboard</h1>
          <p className="text-sm text-ink-muted">
            Live workspace metrics for <strong>{activeOrg?.name}</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link href="/record">
            <Button size="sm">
              <Mic className="h-3.5 w-3.5" />
              Start Recording
            </Button>
          </Link>
          <Link href="/upload">
            <Button variant="secondary" size="sm">
              <UploadCloud className="h-3.5 w-3.5" />
              Upload Recording
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => setScheduleOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Schedule Meeting
          </Button>
          <Link href="/assistant">
            <Button variant="outline" size="sm">
              <Sparkles className="h-3.5 w-3.5 text-burgundy" />
              Open AI Assistant
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* 6 Real KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {statCards.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-ink-muted">{item.label}</span>
                  <div className="h-8 w-8 rounded-lg bg-burgundy/10 text-burgundy flex items-center justify-center">
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-2.5 text-2xl font-semibold tracking-tight text-ink">
                  {loading ? '—' : item.value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <MeetingActivityChart data={data?.charts?.activityLast14Days || []} />
        <MeetingDurationChart data={data?.charts?.durationByType || []} />
      </div>

      {/* Main Grid: Recent & Upcoming & Processing */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Meetings</CardTitle>
            <Link href="/meetings" className="text-xs font-medium text-burgundy hover:underline">
              View all meetings
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="p-6 text-xs text-ink-muted">Loading recent meetings...</p>
            ) : !data?.recentMeetings?.length ? (
              <div className="p-5">
                <EmptyState
                  icon={Video}
                  title="No meetings yet"
                  description="Schedule a meeting or record your first conversation to populate your workspace."
                  action={<Button onClick={() => setScheduleOpen(true)}>Schedule Meeting</Button>}
                />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.recentMeetings.map((m) => (
                  <Link
                    key={m.id}
                    href={`/meetings/${m.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-surface-muted/50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{m.title}</p>
                      <p className="text-xs text-ink-muted mt-0.5">
                        {formatDateTime(m.scheduledAt || m.createdAt)} · {humanizeEnum(m.meetingType)} ·{' '}
                        {formatDuration(m.durationSeconds)}
                      </p>
                    </div>
                    <Badge variant={statusBadgeVariant(m.status)}>{humanizeEnum(m.status)}</Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          {/* Upcoming Meetings */}
          <Card>
            <CardHeader>
              <CardTitle>Upcoming Meetings</CardTitle>
              <Link href="/calendar" className="text-xs font-medium text-burgundy hover:underline">
                Calendar
              </Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {!data?.upcomingMeetings?.length ? (
                <p className="text-xs text-ink-muted">No upcoming scheduled meetings.</p>
              ) : (
                data.upcomingMeetings.map((m) => (
                  <Link
                    key={m.id}
                    href={`/meetings/${m.id}`}
                    className="block rounded-lg border border-border p-3 hover:border-burgundy/50 transition-colors"
                  >
                    <p className="text-xs font-semibold text-ink truncate">{m.title}</p>
                    <p className="text-[11px] text-ink-muted mt-1">{formatDateTime(m.scheduledAt)}</p>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          {/* Processing Status */}
          <Card>
            <CardHeader>
              <CardTitle>Processing Status</CardTitle>
              <Activity className="h-4 w-4 text-burgundy" />
            </CardHeader>
            <CardContent className="space-y-3">
              {!data?.processingMeetings?.length ? (
                <p className="text-xs text-ink-muted">All recording jobs are idle.</p>
              ) : (
                data.processingMeetings.map((job) => (
                  <div key={job.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <Link href={`/meetings/${job.id}`} className="font-medium truncate hover:underline">
                        {job.title}
                      </Link>
                      <span className="text-ink-muted">{job.processingProgress}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-surface-muted overflow-hidden">
                      <div
                        className="h-full bg-burgundy transition-all"
                        style={{ width: `${job.processingProgress}%` }}
                      />
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Bottom Row: Recent Summaries & Outstanding Action Items */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Recently Generated Summaries</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!data?.recentSummaries?.length ? (
              <p className="text-xs text-ink-muted">
                No AI summaries generated yet. Summaries appear once recordings are processed.
              </p>
            ) : (
              data.recentSummaries.map((s) => (
                <Link
                  key={s.id}
                  href={`/meetings/${s.meetingId}`}
                  className="block rounded-lg border border-border p-3.5 hover:bg-surface-muted/40 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{s.meetingTitle}</p>
                    <Badge variant="burgundy">{humanizeEnum(s.detailLevel)}</Badge>
                  </div>
                  <p className="mt-1.5 text-xs text-ink-muted line-clamp-2">{s.executiveSummary}</p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Outstanding Action Items</CardTitle>
            <Link href="/action-items" className="text-xs font-medium text-burgundy hover:underline">
              Manage tasks
            </Link>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {!data?.outstandingActionItems?.length ? (
              <p className="text-xs text-ink-muted">No pending action items across your organization.</p>
            ) : (
              data.outstandingActionItems.map((item) => (
                <Link
                  key={item.id}
                  href={`/meetings/${item.meetingId}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border px-3.5 py-2.5 hover:bg-surface-muted/40 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink truncate">{item.title}</p>
                    <p className="text-[11px] text-ink-muted mt-0.5 truncate">
                      {item.meetingTitle}
                      {item.assigneeName ? ` · ${item.assigneeName}` : ''}
                    </p>
                  </div>
                  <Badge variant={statusBadgeVariant(item.priority)}>
                    {humanizeEnum(item.priority)}
                  </Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <MeetingModal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onSaved={loadOverview}
      />
    </div>
  );
}

