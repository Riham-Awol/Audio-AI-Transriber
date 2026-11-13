'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  ExternalLink,
  MapPin,
  Plus,
  RefreshCw,
  Sparkles,
  Video,
} from 'lucide-react';
import { Badge, statusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { MeetingModal } from '@/components/meetings/MeetingModal';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export default function CalendarPage() {
  const { activeOrg } = useAuth();
  const [meetings, setMeetings] = useState([]);
  const [calendarEvents, setCalendarEvents] = useState([]);
  const [integrations, setIntegrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importingId, setImportingId] = useState(null);
  const [message, setMessage] = useState(null);

  // Modals
  const [meetingModalOpen, setMeetingModalOpen] = useState(false);
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [eventForm, setEventForm] = useState({
    title: '',
    description: '',
    locationOrUrl: '',
    startTime: '',
    endTime: '',
  });

  const loadData = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const [meetingsRes, eventsRes, intRes] = await Promise.all([
        apiRequest('/meetings?limit=50'),
        apiRequest('/calendar/events'),
        apiRequest('/integrations'),
      ]);
      setMeetings(meetingsRes.meetings || []);
      setCalendarEvents(eventsRes.events || []);
      setIntegrations(intRes.integrations || []);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to load calendar data.' });
    } finally {
      setLoading(false);
    }
  }, [activeOrg]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSyncCalendars = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const res = await apiRequest('/calendar/sync', { method: 'POST' });
      setMessage({
        type: 'success',
        text: `Calendar sync completed! Synced ${res.totalSynced || 0} events.`,
      });
      loadData();
      setTimeout(() => setMessage(null), 4000);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to sync calendar.' });
    } finally {
      setSyncing(false);
    }
  };

  const handleImportAsMeeting = async (eventId) => {
    setImportingId(eventId);
    try {
      const res = await apiRequest(`/calendar/events/${eventId}/create-meeting`, {
        method: 'POST',
      });
      setMessage({
        type: 'success',
        text: `Meeting scheduled successfully for "${res.title}"!`,
      });
      loadData();
      setTimeout(() => setMessage(null), 4000);
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to import event as meeting.' });
    } finally {
      setImportingId(null);
    }
  };

  const handleCreateEventSubmit = async (e) => {
    e.preventDefault();
    try {
      await apiRequest('/calendar/events', {
        method: 'POST',
        body: eventForm,
      });
      setEventModalOpen(false);
      setEventForm({ title: '', description: '', locationOrUrl: '', startTime: '', endTime: '' });
      loadData();
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Failed to create calendar event.' });
    }
  };

  const scheduledMeetings = meetings.filter((m) => m.status === 'scheduled');
  const pastMeetings = meetings.filter((m) => m.status !== 'scheduled');

  const connectedCalendars = integrations.filter(
    (i) => i.category === 'calendar' && i.status === 'connected'
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink">Calendar & Schedule</h1>
            <Badge variant="midnight" className="text-[10px] tracking-wide uppercase">
              Phase 6 Sync
            </Badge>
          </div>
          <p className="text-xs sm:text-sm text-ink-muted">
            Synchronized calendar events from Google Calendar & Outlook. Convert any invite into a VoxaMeet recording session with 1 click.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setEventModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add Event
          </Button>
          <Button size="sm" onClick={() => setMeetingModalOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Schedule Meeting
          </Button>
        </div>
      </div>

      {/* Sync Status Banner */}
      <Card className="bg-surface-subtle border-border">
        <CardContent className="p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2.5">
            <CalendarIcon className="h-4 w-4 text-burgundy" />
            <div className="space-y-0.5">
              <span className="font-semibold text-ink">Connected Calendar Integrations: </span>
              {connectedCalendars.length > 0 ? (
                <span className="text-ink-muted">
                  {connectedCalendars.map((c) => c.displayName).join(', ')}
                </span>
              ) : (
                <span className="text-ink-muted">
                  No external calendars connected.{' '}
                  <Link href="/integrations" className="text-midnight underline font-medium">
                    Connect Google or Outlook in Marketplace
                  </Link>
                </span>
              )}
            </div>
          </div>

          {connectedCalendars.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={syncing}
              onClick={handleSyncCalendars}
              className="text-xs gap-1.5 self-start sm:self-auto"
            >
              <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync Calendars Now'}
            </Button>
          )}
        </CardContent>
      </Card>

      {message && (
        <div
          className={`rounded-lg border px-4 py-2.5 text-xs ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800 dark:border-green-900/50 dark:bg-green-950/30 dark:text-green-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Main Grid: Calendar Events & Scheduled Meetings */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Synced Calendar Events */}
        <Card>
          <CardHeader className="py-4 px-6 border-b border-border">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-ink flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-burgundy" />
                Synced Calendar Events ({calendarEvents.length})
              </CardTitle>
              <Badge variant="outline" className="text-[10px]">
                Google & Outlook
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 space-y-3">
            {loading ? (
              <p className="text-xs text-ink-muted py-6 text-center">Loading events...</p>
            ) : calendarEvents.length === 0 ? (
              <div className="py-12 text-center text-xs text-ink-muted space-y-2">
                <CalendarIcon className="h-8 w-8 mx-auto text-ink-muted/50" />
                <p className="font-semibold text-ink">No calendar events found</p>
                <p>Connect your Google or Outlook calendar to automatically populate meeting invites.</p>
                <Link href="/integrations">
                  <Button variant="outline" size="sm" className="mt-2 text-xs">
                    Browse Marketplace
                  </Button>
                </Link>
              </div>
            ) : (
              calendarEvents.map((ev) => {
                const isImporting = importingId === ev.id;
                return (
                  <div
                    key={ev.id}
                    className="rounded-xl border border-border bg-surface-subtle p-3.5 space-y-2 hover:border-burgundy/40 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-0.5">
                        <h4 className="text-xs font-semibold text-ink">{ev.title}</h4>
                        <p className="text-[11px] text-ink-muted flex items-center gap-1.5">
                          <Clock className="h-3 w-3" />
                          {formatDateTime(ev.startTime)}
                        </p>
                      </div>

                      <Badge variant="outline" className="text-[10px] capitalize">
                        {ev.provider.replace('_', ' ')}
                      </Badge>
                    </div>

                    {ev.description && (
                      <p className="text-[11px] text-ink-muted line-clamp-2">{ev.description}</p>
                    )}

                    {ev.locationOrUrl && (
                      <div className="flex items-center gap-1 text-[11px] text-midnight truncate">
                        <MapPin className="h-3 w-3 shrink-0" />
                        <span className="truncate">{ev.locationOrUrl}</span>
                      </div>
                    )}

                    <div className="pt-2 border-t border-border/50 flex items-center justify-between">
                      {ev.meetingId ? (
                        <Link
                          href={`/meetings/${ev.meetingId}`}
                          className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 font-medium hover:underline"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          <span>Linked to VoxaMeet Workspace</span>
                          <ExternalLink className="h-2.5 w-2.5" />
                        </Link>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isImporting}
                          onClick={() => handleImportAsMeeting(ev.id)}
                          className="text-xs gap-1.5 ml-auto"
                        >
                          <Sparkles className="h-3 w-3 text-burgundy" />
                          {isImporting ? 'Importing...' : 'Import as Meeting'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* Scheduled & Active VoxaMeet Meetings */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="py-4 px-6 border-b border-border">
              <CardTitle className="text-sm font-semibold text-ink flex items-center gap-2">
                <Video className="h-4 w-4 text-burgundy" />
                Scheduled for Recording ({scheduledMeetings.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-2.5">
              {loading ? (
                <p className="text-xs text-ink-muted py-4 text-center">Loading scheduled meetings...</p>
              ) : scheduledMeetings.length === 0 ? (
                <p className="text-xs text-ink-muted py-6 text-center">No scheduled meetings.</p>
              ) : (
                scheduledMeetings.map((m) => (
                  <Link
                    key={m.id}
                    href={`/meetings/${m.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 hover:bg-surface-subtle transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink truncate">{m.title}</p>
                      <p className="text-[11px] text-ink-muted">{formatDateTime(m.scheduledAt)}</p>
                    </div>
                    <Badge variant="midnight" className="text-[10px]">
                      Scheduled
                    </Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-4 px-6 border-b border-border">
              <CardTitle className="text-sm font-semibold text-ink flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                Recently Recorded Meetings ({pastMeetings.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-2.5 max-h-[320px] overflow-y-auto">
              {loading ? (
                <p className="text-xs text-ink-muted py-4 text-center">Loading...</p>
              ) : pastMeetings.length === 0 ? (
                <p className="text-xs text-ink-muted py-6 text-center">No recorded meetings yet.</p>
              ) : (
                pastMeetings.slice(0, 8).map((m) => (
                  <Link
                    key={m.id}
                    href={`/meetings/${m.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 hover:bg-surface-subtle transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-ink truncate">{m.title}</p>
                      <p className="text-[11px] text-ink-muted">{formatDateTime(m.createdAt)}</p>
                    </div>
                    <Badge variant={statusBadgeVariant(m.status)} className="text-[10px]">
                      {m.status}
                    </Badge>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Manual Event Modal */}
      <Modal
        open={eventModalOpen}
        onClose={() => setEventModalOpen(false)}
        title="Add Calendar Event"
        description="Schedule a calendar event manually in your workspace."
      >
        <form onSubmit={handleCreateEventSubmit} className="space-y-3.5">
          <div>
            <label className="block text-xs font-medium mb-1">Event Title</label>
            <Input
              required
              value={eventForm.title}
              onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
              placeholder="e.g. Q4 Strategy Review"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Description</label>
            <Input
              value={eventForm.description}
              onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
              placeholder="Topics to cover..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Location or Meeting URL</label>
            <Input
              value={eventForm.locationOrUrl}
              onChange={(e) => setEventForm({ ...eventForm, locationOrUrl: e.target.value })}
              placeholder="https://meet.google.com/..."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Start Time</label>
              <Input
                type="datetime-local"
                required
                value={eventForm.startTime}
                onChange={(e) => setEventForm({ ...eventForm, startTime: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">End Time</label>
              <Input
                type="datetime-local"
                value={eventForm.endTime}
                onChange={(e) => setEventForm({ ...eventForm, endTime: e.target.value })}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setEventModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save Event</Button>
          </div>
        </form>
      </Modal>

      <MeetingModal
        open={meetingModalOpen}
        onClose={() => setMeetingModalOpen(false)}
        onSaved={loadData}
      />
    </div>
  );
}
