'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Calendar as CalendarIcon, Plus } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api';
import { formatDateTime, humanizeEnum } from '@/lib/utils';
import { Badge, statusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MeetingModal } from '@/components/meetings/MeetingModal';

export default function CalendarPage() {
  const { activeOrg } = useAuth();
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);

  const loadMeetings = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const data = await apiRequest('/meetings?limit=50');
      setMeetings(data.meetings || []);
    } finally {
      setLoading(false);
    }
  }, [activeOrg]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  const scheduled = meetings.filter((m) => m.status === 'scheduled');
  const recorded = meetings.filter((m) => m.status !== 'scheduled');

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Calendar</h1>
          <p className="text-sm text-ink-muted">
            Scheduled vs. recorded meetings for <strong>{activeOrg?.name}</strong> (Google &
            Outlook sync arrives in Phase 6).
          </p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" />
          Schedule Meeting
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarIcon className="h-4 w-4 text-burgundy" />
              Scheduled Meetings ({scheduled.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {loading ? (
              <p className="text-xs text-ink-muted">Loading...</p>
            ) : scheduled.length === 0 ? (
              <p className="text-xs text-ink-muted">No upcoming scheduled meetings.</p>
            ) : (
              scheduled.map((m) => (
                <Link
                  key={m.id}
                  href={`/meetings/${m.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 hover:bg-surface-muted/40"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.title}</p>
                    <p className="text-xs text-ink-muted">{formatDateTime(m.scheduledAt)}</p>
                  </div>
                  <Badge variant="midnight">Scheduled</Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recorded / Active Meetings ({recorded.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {loading ? (
              <p className="text-xs text-ink-muted">Loading...</p>
            ) : recorded.length === 0 ? (
              <p className="text-xs text-ink-muted">No recorded meetings yet.</p>
            ) : (
              recorded.map((m) => (
                <Link
                  key={m.id}
                  href={`/meetings/${m.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 hover:bg-surface-muted/40"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{m.title}</p>
                    <p className="text-xs text-ink-muted">
                      {formatDateTime(m.scheduledAt || m.createdAt)}
                    </p>
                  </div>
                  <Badge variant={statusBadgeVariant(m.status)}>{humanizeEnum(m.status)}</Badge>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <MeetingModal open={modalOpen} onClose={() => setModalOpen(false)} onSaved={loadMeetings} />
    </div>
  );
}

