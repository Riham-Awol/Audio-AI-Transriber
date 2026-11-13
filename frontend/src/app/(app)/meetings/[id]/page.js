'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  Edit3,
  FileText,
  Gavel,
  ListTodo,
  Play,
  RefreshCw,
  Share2,
  Sparkles,
  StickyNote,
  Trash2,
  Users,
} from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatDateTime, formatDuration, humanizeEnum } from '@/lib/utils';
import { Badge, statusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { MeetingModal } from '@/components/meetings/MeetingModal';
import { ExportModal } from '@/components/meetings/ExportModal';
import { TranscriptWorkspace } from '@/components/meetings/TranscriptWorkspace';
import { SummaryWorkspace } from '@/components/meetings/SummaryWorkspace';
import { DecisionsWorkspace } from '@/components/meetings/DecisionsWorkspace';
import { ActionItemsWorkspace } from '@/components/meetings/ActionItemsWorkspace';

const TABS = [
  { id: 'transcript', label: 'Transcript', icon: FileText },
  { id: 'summary', label: 'Summary', icon: Sparkles },
  { id: 'decisions', label: 'Decisions', icon: Gavel },
  { id: 'actionItems', label: 'Action Items', icon: ListTodo },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'aiChat', label: 'AI Chat', icon: Sparkles },
];

export default function MeetingDetailPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('summary');

  const [editOpen, setEditOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [orgMembers, setOrgMembers] = useState([]);
  const [shareUserId, setShareUserId] = useState('');
  const [sharePermission, setSharePermission] = useState('view');

  const [noteTitle, setNoteTitle] = useState('');
  const [noteContent, setNoteContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const [taskTitle, setTaskTitle] = useState('');
  const [taskPriority, setTaskPriority] = useState('medium');
  const [taskAssignee, setTaskAssignee] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  const [playbackUrl, setPlaybackUrl] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [headerExportOpen, setHeaderExportOpen] = useState(false);
  const mediaRef = useRef(null);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiRequest(`/meetings/${id}`);
      setDetail(data);
      const primaryRec = data.recordings?.[0];
      if (primaryRec) {
        const urlRes = await apiRequest(`/recordings/${primaryRec.id}/playback-url`).catch(
          () => null
        );
        setPlaybackUrl(urlRes?.url || '');
      } else {
        setPlaybackUrl('');
      }
    } catch (err) {
      setError(err.message || 'Unable to load meeting details.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onProgress = (payload) => {
      if (payload?.meetingId === id) {
        setDetail((prev) =>
          prev
            ? {
                ...prev,
                meeting: {
                  ...prev.meeting,
                  status: payload.status || prev.meeting.status,
                  processingProgress: payload.progress ?? prev.meeting.processingProgress,
                },
              }
            : prev
        );
        if (payload.status === 'completed' || payload.status === 'failed') {
          loadDetail();
        }
      }
    };
    const onUpdated = (payload) => {
      if (payload?.id === id) loadDetail();
    };
    socket.on('transcription:progress', onProgress);
    socket.on('meeting:updated', onUpdated);
    return () => {
      socket.off('transcription:progress', onProgress);
      socket.off('meeting:updated', onUpdated);
    };
  }, [id, loadDetail]);

  const seekToMs = (ms) => {
    if (!mediaRef.current) return;
    mediaRef.current.currentTime = Math.max(0, ms / 1000);
    mediaRef.current.play().catch(() => {});
  };

  const handleRetryTranscription = async () => {
    const rec = detail?.recordings?.[0];
    if (!rec) return;
    setRetrying(true);
    try {
      await apiRequest(`/recordings/${rec.id}/retry`, { method: 'POST' });
      await loadDetail();
    } finally {
      setRetrying(false);
    }
  };

  const handleDeleteRecording = async () => {
    const rec = detail?.recordings?.[0];
    if (!rec) return;
    await apiRequest(`/recordings/${rec.id}`, { method: 'DELETE' });
    setPlaybackUrl('');
    loadDetail();
  };

  const openShareModal = async () => {
    setShareOpen(true);
    try {
      const data = await apiRequest('/organizations/current/members');
      setOrgMembers(data.members || []);
      if (data.members?.[0]) {
        setShareUserId(data.members[0].userId);
      }
    } catch {
      setOrgMembers([]);
    }
  };

  const handleShareSubmit = async (e) => {
    e.preventDefault();
    if (!shareUserId) return;
    await apiRequest(`/meetings/${id}/share`, {
      method: 'POST',
      body: { userId: shareUserId, permission: sharePermission },
    });
    setShareOpen(false);
    loadDetail();
  };

  const handleAddNote = async (e) => {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setSavingNote(true);
    try {
      await apiRequest(`/meetings/${id}/notes`, {
        method: 'POST',
        body: { title: noteTitle.trim(), content: noteContent.trim(), isShared: true },
      });
      setNoteTitle('');
      setNoteContent('');
      loadDetail();
    } finally {
      setSavingNote(false);
    }
  };

  const handleAddActionItem = async (e) => {
    e.preventDefault();
    if (taskTitle.trim().length < 2) return;
    setSavingTask(true);
    try {
      await apiRequest('/action-items', {
        method: 'POST',
        body: {
          meetingId: id,
          title: taskTitle.trim(),
          priority: taskPriority,
          assigneeName: taskAssignee.trim() || null,
        },
      });
      setTaskTitle('');
      setTaskAssignee('');
      loadDetail();
    } finally {
      setSavingTask(false);
    }
  };

  const handleToggleTaskStatus = async (item) => {
    const nextStatus = item.status === 'completed' ? 'pending' : 'completed';
    await apiRequest(`/action-items/${item.id}`, {
      method: 'PATCH',
      body: { status: nextStatus },
    });
    loadDetail();
  };

  if (loading) {
    return <p className="text-sm text-ink-muted p-4">Loading meeting workspace...</p>;
  }

  if (error || !detail?.meeting) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-3">
          <p className="text-sm text-red-600">{error || 'Meeting not found.'}</p>
          <Link href="/meetings">
            <Button variant="outline">Back to Meetings</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const { meeting, summary, decisions, actionItems, notes, shares, segments, speakers, recordings } = detail;
  const primaryRecording = recordings?.[0] || null;
  const isVideoRecording = primaryRecording?.mimeType?.startsWith('video/');

  const formatTs = (ms) => {
    const totalSec = Math.floor(Math.max(0, Number(ms || 0)) / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/meetings"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Meetings
        </Link>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-xl font-semibold text-ink">{meeting.title}</h1>
                  <Badge variant={statusBadgeVariant(meeting.status)}>
                    {humanizeEnum(meeting.status)}
                  </Badge>
                </div>
                {meeting.description && (
                  <p className="text-sm text-ink-muted max-w-3xl">{meeting.description}</p>
                )}
                <div className="flex flex-wrap items-center gap-4 text-xs text-ink-muted pt-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDateTime(meeting.scheduledAt || meeting.createdAt)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    {formatDuration(meeting.durationSeconds)}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" />
                    {meeting.speakerCount || speakers?.length || 0} speakers
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Edit3 className="h-3.5 w-3.5" />
                  Edit Details
                </Button>
                <Button variant="outline" size="sm" onClick={openShareModal}>
                  <Share2 className="h-3.5 w-3.5" />
                  Share ({shares?.length || 0})
                </Button>
                <Button variant="outline" size="sm" onClick={() => setHeaderExportOpen(true)}>
                  <FileText className="h-3.5 w-3.5" />
                  Export Report
                </Button>
                {primaryRecording && playbackUrl && (
                  <a href={`${playbackUrl}&download=1`} download={primaryRecording.fileName}>
                    <Button variant="outline" size="sm">
                      <Download className="h-3.5 w-3.5" />
                      Download Recording
                    </Button>
                  </a>
                )}
                {primaryRecording && (meeting.status === 'queued' || meeting.status === 'failed') && (
                  <Button size="sm" onClick={handleRetryTranscription} disabled={retrying}>
                    <RefreshCw className="h-3.5 w-3.5" />
                    {retrying ? 'Retrying...' : 'Retry Transcription'}
                  </Button>
                )}
              </div>
            </div>

            {/* Processing Progress or Error Banner */}
            {(meeting.status === 'queued' || meeting.status === 'processing') && (
              <div className="rounded-lg border border-border bg-surface-subtle p-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>
                    {meeting.status === 'queued'
                      ? 'Queued for AI transcription & diarization'
                      : 'Processing with FFmpeg, WhisperX & pyannote.audio...'}
                  </span>
                  <span>{meeting.processingProgress}%</span>
                </div>
                <div className="h-2 rounded-full bg-surface-muted overflow-hidden">
                  <div
                    className="h-full bg-burgundy transition-all"
                    style={{ width: `${meeting.processingProgress}%` }}
                  />
                </div>
                {meeting.processingError && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    {meeting.processingError}
                  </p>
                )}
              </div>
            )}

            {meeting.status === 'failed' && meeting.processingError && (
              <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-xs text-red-700 dark:text-red-300">
                Processing error: {meeting.processingError}
              </div>
            )}

            {/* Media Player */}
            {primaryRecording && playbackUrl && (
              <div className="rounded-lg border border-border bg-surface-subtle p-3 space-y-2">
                <div className="flex items-center justify-between text-xs text-ink-muted">
                  <span className="font-medium text-ink">{primaryRecording.fileName}</span>
                  <button
                    type="button"
                    onClick={handleDeleteRecording}
                    className="inline-flex items-center gap-1 text-red-600 hover:underline"
                  >
                    <Trash2 className="h-3 w-3" />
                    Delete Recording
                  </button>
                </div>
                {isVideoRecording ? (
                  <video
                    ref={mediaRef}
                    src={playbackUrl}
                    controls
                    onTimeUpdate={(e) => setCurrentTimeMs(Math.floor(e.currentTarget.currentTime * 1000))}
                    className="w-full max-h-64 rounded bg-black"
                  />
                ) : (
                  <audio
                    ref={mediaRef}
                    src={playbackUrl}
                    controls
                    onTimeUpdate={(e) => setCurrentTimeMs(Math.floor(e.currentTarget.currentTime * 1000))}
                    className="w-full"
                  />
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Workspace Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border pb-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-colors ${
                active
                  ? 'bg-midnight text-white'
                  : 'text-ink-muted hover:bg-surface-muted hover:text-ink'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'transcript' && (
        <TranscriptWorkspace
          meeting={meeting}
          segments={segments}
          speakers={speakers}
          summary={summary}
          decisions={decisions}
          actionItems={actionItems}
          currentTimeMs={currentTimeMs}
          seekToMs={seekToMs}
          onReload={loadDetail}
        />
      )}

      {activeTab === 'summary' && (
        <SummaryWorkspace
          meeting={meeting}
          summary={summary}
          onReload={loadDetail}
        />
      )}

      {activeTab === 'decisions' && (
        <DecisionsWorkspace
          meeting={meeting}
          decisions={decisions}
          speakers={speakers}
          seekToMs={seekToMs}
          onReload={loadDetail}
        />
      )}

      {activeTab === 'actionItems' && (
        <ActionItemsWorkspace
          meeting={meeting}
          actionItems={actionItems}
          orgMembers={orgMembers}
          seekToMs={seekToMs}
          onReload={loadDetail}
        />
      )}

      {activeTab === 'notes' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Meeting Notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {notes?.length === 0 ? (
                <p className="text-sm text-ink-muted">No notes added for this meeting yet.</p>
              ) : (
                notes.map((n) => (
                  <div key={n.id} className="rounded-lg border border-border p-3.5 space-y-1">
                    <div className="flex items-center justify-between text-xs text-ink-muted">
                      <span className="font-semibold text-ink">{n.title || 'Workspace Note'}</span>
                      <span>{n.authorName}</span>
                    </div>
                    <p className="text-sm text-ink whitespace-pre-wrap">{n.content}</p>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Add Note</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddNote} className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Title (optional)</label>
                  <Input
                    value={noteTitle}
                    onChange={(e) => setNoteTitle(e.target.value)}
                    placeholder="Key takeaway"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Content</label>
                  <Textarea
                    required
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                    placeholder="Write meeting notes..."
                  />
                </div>
                <Button type="submit" className="w-full" disabled={savingNote}>
                  {savingNote ? 'Saving...' : 'Save Note'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'aiChat' && (
        <Card>
          <CardHeader>
            <CardTitle>Meeting AI Assistant</CardTitle>
            <Badge variant="midnight">RAG Pipeline in Phase 5</Badge>
          </CardHeader>
          <CardContent className="text-sm text-ink-muted">
            ChromaDB semantic chunk retrieval (`nomic-embed-text`) and Qwen3.5 meeting Q&A with
            clickable transcript citations will be enabled in Phase 5.
          </CardContent>
        </Card>
      )}

      <MeetingModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        initialMeeting={meeting}
        onSaved={loadDetail}
      />

      <Modal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share Meeting"
        description="Grant access to another member within your organization."
      >
        <form onSubmit={handleShareSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Team Member</label>
            <Select value={shareUserId} onChange={(e) => setShareUserId(e.target.value)}>
              {orgMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.fullName} ({m.email})
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Permission</label>
            <Select value={sharePermission} onChange={(e) => setSharePermission(e.target.value)}>
              <option value="view">View Only</option>
              <option value="comment">Comment</option>
              <option value="edit">Can Edit</option>
            </Select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShareOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!shareUserId}>
              Share Meeting
            </Button>
          </div>
        </form>
      </Modal>

      <ExportModal
        open={headerExportOpen}
        onClose={() => setHeaderExportOpen(false)}
        meeting={meeting}
        onPrint={() => window.print()}
      />
    </div>
  );
}

