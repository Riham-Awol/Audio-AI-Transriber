'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Archive,
  Copy,
  Edit3,
  LayoutGrid,
  List,
  Plus,
  Search,
  Trash2,
  Video,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatDateTime, formatDuration, humanizeEnum } from '@/lib/utils';
import { Badge, statusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Select } from '@/components/ui/input';
import { MeetingModal } from '@/components/meetings/MeetingModal';

export default function MeetingsPage() {
  const { activeOrg } = useAuth();
  const [meetings, setMeetings] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('table');

  const [filters, setFilters] = useState({
    search: '',
    status: 'all',
    meetingType: 'all',
    recordingSource: 'all',
    dateFrom: '',
    dateTo: '',
    includeArchived: false,
    page: 1,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [feedback, setFeedback] = useState('');

  const loadMeetings = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(filters.page),
        limit: '12',
        includeArchived: String(filters.includeArchived),
      });
      if (filters.search.trim()) qs.set('search', filters.search.trim());
      if (filters.status !== 'all') qs.set('status', filters.status);
      if (filters.meetingType !== 'all') qs.set('meetingType', filters.meetingType);
      if (filters.recordingSource !== 'all') qs.set('recordingSource', filters.recordingSource);
      if (filters.dateFrom) qs.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) qs.set('dateTo', filters.dateTo);

      const data = await apiRequest(`/meetings?${qs.toString()}`);
      setMeetings(data.meetings || []);
      setPagination(data.pagination || { page: 1, totalPages: 1, total: 0 });
    } finally {
      setLoading(false);
    }
  }, [activeOrg, filters]);

  useEffect(() => {
    loadMeetings();
  }, [loadMeetings]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refresh = () => loadMeetings();
    socket.on('meeting:created', refresh);
    socket.on('meeting:updated', refresh);
    socket.on('meeting:deleted', refresh);
    return () => {
      socket.off('meeting:created', refresh);
      socket.off('meeting:updated', refresh);
      socket.off('meeting:deleted', refresh);
    };
  }, [loadMeetings]);

  const handleDuplicate = async (meeting) => {
    await apiRequest(`/meetings/${meeting.id}/duplicate`, { method: 'POST' });
    setFeedback(`Duplicated "${meeting.title}"`);
    loadMeetings();
  };

  const handleArchiveToggle = async (meeting) => {
    await apiRequest(`/meetings/${meeting.id}/archive`, {
      method: 'POST',
      body: { archived: !meeting.isArchived },
    });
    setFeedback(meeting.isArchived ? 'Meeting restored from archive.' : 'Meeting archived.');
    loadMeetings();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    await apiRequest(`/meetings/${deleteTarget.id}`, { method: 'DELETE' });
    setFeedback(`Deleted "${deleteTarget.title}"`);
    setDeleteTarget(null);
    loadMeetings();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Meetings</h1>
          <p className="text-sm text-ink-muted">
            {pagination.total} total meetings in <strong>{activeOrg?.name}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={`rounded-md p-1.5 ${viewMode === 'table' ? 'bg-midnight text-white' : 'text-ink-muted'}`}
              aria-label="Table view"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              className={`rounded-md p-1.5 ${viewMode === 'cards' ? 'bg-midnight text-white' : 'text-ink-muted'}`}
              aria-label="Card view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          <Button
            onClick={() => {
              setEditingMeeting(null);
              setModalOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New Meeting
          </Button>
        </div>
      </div>

      {feedback && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800 px-3.5 py-2 text-xs text-emerald-800 dark:text-emerald-200 flex justify-between">
          <span>{feedback}</span>
          <button type="button" onClick={() => setFeedback('')} className="underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <Card>
        <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="relative lg:col-span-2">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
            <Input
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))}
              placeholder="Search by title or agenda..."
              className="pl-9"
            />
          </div>

          <Select
            value={filters.meetingType}
            onChange={(e) => setFilters((f) => ({ ...f, meetingType: e.target.value, page: 1 }))}
          >
            <option value="all">All Types</option>
            <option value="online">Online</option>
            <option value="in_person">In-Person</option>
            <option value="hybrid">Hybrid</option>
            <option value="imported">Imported</option>
          </Select>

          <Select
            value={filters.recordingSource}
            onChange={(e) =>
              setFilters((f) => ({ ...f, recordingSource: e.target.value, page: 1 }))
            }
          >
            <option value="all">All Sources</option>
            <option value="scheduled">Scheduled</option>
            <option value="microphone">Microphone</option>
            <option value="browser_tab">Browser Tab</option>
            <option value="upload">Upload</option>
            <option value="zoom">Zoom</option>
            <option value="google_meet">Google Meet</option>
            <option value="microsoft_teams">Microsoft Teams</option>
          </Select>

          <Select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value, page: 1 }))}
          >
            <option value="all">All Statuses</option>
            <option value="scheduled">Scheduled</option>
            <option value="processing">Processing</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="archived">Archived</option>
          </Select>

          <label className="flex items-center gap-2 text-xs text-ink-muted px-2 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.includeArchived}
              onChange={(e) =>
                setFilters((f) => ({ ...f, includeArchived: e.target.checked, page: 1 }))
              }
              className="rounded border-border accent-burgundy"
            />
            Include archived
          </label>
        </CardContent>
      </Card>

      {/* Content */}
      {loading ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-ink-muted">
            Loading meetings...
          </CardContent>
        </Card>
      ) : meetings.length === 0 ? (
        <EmptyState
          icon={Video}
          title="No meetings match your filters"
          description="Create a new meeting or adjust your search and filter criteria."
          action={
            <Button
              onClick={() => {
                setEditingMeeting(null);
                setModalOpen(true);
              }}
            >
              Create Meeting
            </Button>
          }
        />
      ) : viewMode === 'table' ? (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-surface-subtle text-xs font-semibold uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="px-4 py-3">Meeting Title</th>
                  <th className="px-4 py-3">Date & Time</th>
                  <th className="px-4 py-3">Duration</th>
                  <th className="px-4 py-3">Type / Source</th>
                  <th className="px-4 py-3">Speakers</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Summary</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {meetings.map((m) => (
                  <tr key={m.id} className="hover:bg-surface-muted/40 transition-colors">
                    <td className="px-4 py-3.5 max-w-[260px]">
                      <Link
                        href={`/meetings/${m.id}`}
                        className="font-medium text-ink hover:text-burgundy block truncate"
                      >
                        {m.title}
                      </Link>
                      {m.description && (
                        <p className="text-xs text-ink-muted truncate">{m.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-ink-muted whitespace-nowrap">
                      {formatDateTime(m.scheduledAt || m.createdAt)}
                    </td>
                    <td className="px-4 py-3.5 text-xs whitespace-nowrap">
                      {formatDuration(m.durationSeconds)}
                    </td>
                    <td className="px-4 py-3.5 text-xs">
                      <span className="font-medium">{humanizeEnum(m.meetingType)}</span>
                      <span className="block text-[11px] text-ink-muted">
                        {humanizeEnum(m.recordingSource)}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-xs">{m.speakerCount || '—'}</td>
                    <td className="px-4 py-3.5">
                      <Badge variant={statusBadgeVariant(m.status)}>{humanizeEnum(m.status)}</Badge>
                    </td>
                    <td className="px-4 py-3.5 text-xs">
                      {m.hasSummary ? (
                        <Badge variant="burgundy">Available</Badge>
                      ) : (
                        <span className="text-ink-muted">Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMeeting(m);
                            setModalOpen(true);
                          }}
                          className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink"
                          title="Edit meeting"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDuplicate(m)}
                          className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink"
                          title="Duplicate metadata"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleArchiveToggle(m)}
                          className="rounded-md p-1.5 text-ink-muted hover:bg-surface-muted hover:text-ink"
                          title={m.isArchived ? 'Restore' : 'Archive'}
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(m)}
                          className="rounded-md p-1.5 text-ink-muted hover:bg-red-50 hover:text-red-600"
                          title="Delete meeting"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {meetings.map((m) => (
            <Card key={m.id} className="flex flex-col justify-between">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/meetings/${m.id}`}
                    className="text-base font-semibold text-ink hover:text-burgundy line-clamp-2"
                  >
                    {m.title}
                  </Link>
                  <Badge variant={statusBadgeVariant(m.status)}>{humanizeEnum(m.status)}</Badge>
                </div>
                {m.description && (
                  <p className="text-xs text-ink-muted line-clamp-2">{m.description}</p>
                )}
                <div className="text-xs text-ink-muted space-y-1 pt-1">
                  <div>{formatDateTime(m.scheduledAt || m.createdAt)}</div>
                  <div>
                    {humanizeEnum(m.meetingType)} · {humanizeEnum(m.recordingSource)} ·{' '}
                    {formatDuration(m.durationSeconds)}
                  </div>
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-border">
                  <Link href={`/meetings/${m.id}`}>
                    <Button size="sm" variant="outline">
                      Open Workspace
                    </Button>
                  </Link>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingMeeting(m);
                        setModalOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(m)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-ink-muted">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <MeetingModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initialMeeting={editingMeeting}
        onSaved={loadMeetings}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        title="Delete Meeting"
        description="This will remove the meeting from your active workspace."
      >
        <p className="text-sm text-ink-muted">
          Are you sure you want to delete <strong>{deleteTarget?.title}</strong>?
        </p>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDelete}>
            Delete Meeting
          </Button>
        </div>
      </Modal>
    </div>
  );
}

