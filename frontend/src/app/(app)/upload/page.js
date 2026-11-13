'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  FileAudio,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest, uploadRecordingWithProgress } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { formatDateTime, formatDuration, humanizeEnum } from '@/lib/utils';
import { Badge, statusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';

const ACCEPTED_EXTENSIONS = ['.mp3', '.wav', '.m4a', '.mp4', '.webm', '.ogg', '.opus', '.flac', '.mkv', '.mov', '.aac'];
const MAX_SIZE_BYTES = 2048 * 1024 * 1024; // 2 GB

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** idx).toFixed(1)} ${units[idx]}`;
}

export default function UploadRecordingPage() {
  const { activeOrg } = useAuth();
  const router = useRouter();
  const fileInputRef = useRef(null);
  const abortFnRef = useRef(null);

  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [meetingType, setMeetingType] = useState('online');
  const [description, setDescription] = useState('');
  const [speakerHints, setSpeakerHints] = useState('');
  const [customVocabulary, setCustomVocabulary] = useState('');
  const [consentConfirmed, setConsentConfirmed] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState('');
  const [recentMeetings, setRecentMeetings] = useState([]);

  const loadRecentUploads = useCallback(async () => {
    if (!activeOrg) return;
    try {
      const data = await apiRequest('/meetings?limit=8');
      setRecentMeetings(
        (data.meetings || []).filter((m) => m.recordingSource !== 'scheduled')
      );
    } catch {
      // Ignore transient errors
    }
  }, [activeOrg]);

  useEffect(() => {
    loadRecentUploads();
  }, [loadRecentUploads]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const refresh = () => loadRecentUploads();
    socket.on('meeting:updated', refresh);
    socket.on('transcription:progress', refresh);
    return () => {
      socket.off('meeting:updated', refresh);
      socket.off('transcription:progress', refresh);
    };
  }, [loadRecentUploads]);

  const validateAndPickFile = (file) => {
    setError('');
    if (!file) return;
    const lowerName = file.name.toLowerCase();
    const hasValidExt = ACCEPTED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!hasValidExt) {
      setError(`Unsupported file format. Supported: ${ACCEPTED_EXTENSIONS.join(', ')}`);
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError('File exceeds the 2 GB maximum recording upload limit.');
      return;
    }

    setSelectedFile(file);
    if (!title.trim()) {
      const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ');
      setTitle(cleanTitle);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    validateAndPickFile(file);
  };

  const handleUpload = async (e) => {
    e.preventDefault();
    setError('');
    if (!selectedFile) {
      setError('Please select an audio or video recording file.');
      return;
    }
    if (!consentConfirmed) {
      setError('Please confirm participant recording consent before uploading.');
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', title.trim());
      formData.append('meetingType', meetingType);
      formData.append('recordingSource', 'upload');
      formData.append('description', description.trim());
      formData.append('speakerHints', speakerHints);
      formData.append('customVocabulary', customVocabulary);
      formData.append('consentConfirmed', 'true');
      if (scheduledAt) {
        formData.append('scheduledAt', new Date(scheduledAt).toISOString());
      }

      const res = await uploadRecordingWithProgress(formData, {
        onProgress: (pct) => setUploadProgress(pct),
        onRegisterAbort: (abortFn) => {
          abortFnRef.current = abortFn;
        },
      });

      setSelectedFile(null);
      setTitle('');
      setDescription('');
      await loadRecentUploads();
      router.push(`/meetings/${res.meeting.id}`);
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
      abortFnRef.current = null;
    }
  };

  const handleCancelUpload = () => {
    if (abortFnRef.current) {
      abortFnRef.current();
      abortFnRef.current = null;
    }
    setUploading(false);
    setUploadProgress(0);
  };

  const handleRetryMeeting = async (meetingId) => {
    const recRes = await apiRequest(`/recordings/meeting/${meetingId}`);
    const latestRec = recRes.recordings?.[0];
    if (!latestRec) return;
    await apiRequest(`/recordings/${latestRec.id}/retry`, { method: 'POST' });
    loadRecentUploads();
  };

  const handleDeleteRecording = async (meetingId) => {
    const recRes = await apiRequest(`/recordings/meeting/${meetingId}`);
    for (const r of recRes.recordings || []) {
      await apiRequest(`/recordings/${r.id}`, { method: 'DELETE' });
    }
    await apiRequest(`/meetings/${meetingId}`, { method: 'DELETE' });
    loadRecentUploads();
  };

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Upload Recording</h1>
        <p className="text-sm text-ink-muted">
          Upload audio or video recordings (up to 2 GB / multi-hour meetings) for asynchronous
          FFmpeg normalization, WhisperX transcription, and pyannote speaker diarization.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-4 py-3 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <Card>
        <CardContent className="p-6">
          <form onSubmit={handleUpload} className="space-y-5">
            {/* Drag & Drop Zone */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => !uploading && fileInputRef.current?.click()}
              className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                dragActive
                  ? 'border-burgundy bg-burgundy/5'
                  : 'border-border bg-surface-subtle hover:border-burgundy/60'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_EXTENSIONS.join(',')}
                className="hidden"
                onChange={(e) => validateAndPickFile(e.target.files?.[0])}
              />
              {selectedFile ? (
                <div className="flex flex-col items-center gap-2">
                  <FileAudio className="h-9 w-9 text-burgundy" />
                  <p className="text-sm font-semibold text-ink">{selectedFile.name}</p>
                  <p className="text-xs text-ink-muted">{formatBytes(selectedFile.size)}</p>
                  {!uploading && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFile(null);
                      }}
                      className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline mt-1"
                    >
                      <X className="h-3.5 w-3.5" />
                      Remove file
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <UploadCloud className="h-9 w-9 text-burgundy" />
                  <p className="text-sm font-semibold text-ink">
                    Drag & drop your audio/video file here, or click to browse
                  </p>
                  <p className="text-xs text-ink-muted">
                    Supports MP3, WAV, M4A, MP4, WEBM, OGG, FLAC, MKV, MOV (max 2 GB)
                  </p>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Meeting Title</label>
                <Input
                  required
                  minLength={2}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Q4 Product Strategy Review"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Meeting Date & Time</label>
                <Input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Meeting Type</label>
                <Select value={meetingType} onChange={(e) => setMeetingType(e.target.value)}>
                  <option value="online">Online</option>
                  <option value="in_person">In-Person</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="imported">Imported</option>
                </Select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Optional Speaker Names (comma-separated)
                </label>
                <Input
                  value={speakerHints}
                  onChange={(e) => setSpeakerHints(e.target.value)}
                  placeholder="Elena Vance, Marcus Chen"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1">Description (optional)</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Meeting context or key agenda..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">
                  Custom Vocabulary Hints (optional)
                </label>
                <Textarea
                  value={customVocabulary}
                  onChange={(e) => setCustomVocabulary(e.target.value)}
                  placeholder="Product names, acronyms, client names..."
                />
              </div>
            </div>

            <label className="flex items-center gap-2.5 text-xs font-medium text-ink cursor-pointer">
              <input
                type="checkbox"
                checked={consentConfirmed}
                onChange={(e) => setConsentConfirmed(e.target.checked)}
                className="rounded border-border accent-burgundy h-4 w-4"
              />
              I confirm this organization is authorized to store and transcribe this recording.
            </label>

            {uploading && (
              <div className="space-y-2 rounded-lg border border-border bg-surface-subtle p-4">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span>Uploading media file...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="h-2.5 rounded-full bg-surface-muted overflow-hidden">
                  <div
                    className="h-full bg-burgundy transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              {uploading && (
                <Button type="button" variant="outline" onClick={handleCancelUpload}>
                  Cancel Upload
                </Button>
              )}
              <Button type="submit" size="lg" disabled={uploading || !selectedFile}>
                <UploadCloud className="h-4 w-4" />
                {uploading ? `Uploading (${uploadProgress}%)...` : 'Upload & Queue Transcription'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Recent Uploads & Background Job Status */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Recordings & Processing Queue</CardTitle>
        </CardHeader>
        <CardContent className="p-0 divide-y divide-border">
          {recentMeetings.length === 0 ? (
            <p className="p-6 text-xs text-ink-muted">No uploaded or recorded meetings yet.</p>
          ) : (
            recentMeetings.map((m) => (
              <div
                key={m.id}
                className="px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <Link
                    href={`/meetings/${m.id}`}
                    className="text-sm font-medium text-ink hover:text-burgundy truncate block"
                  >
                    {m.title}
                  </Link>
                  <p className="text-xs text-ink-muted">
                    {formatDateTime(m.createdAt)} · {humanizeEnum(m.recordingSource)} ·{' '}
                    {formatDuration(m.durationSeconds)}
                  </p>
                  {m.processingError && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                      {m.processingError}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={statusBadgeVariant(m.status)}>
                    {humanizeEnum(m.status)} ({m.processingProgress}%)
                  </Badge>
                  {(m.status === 'failed' || m.status === 'queued') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRetryMeeting(m.id)}
                      title="Retry transcription job"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Retry
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeleteRecording(m.id)}
                    className="p-1.5 rounded-md text-ink-muted hover:bg-red-50 hover:text-red-600"
                    title="Delete recording & meeting"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
