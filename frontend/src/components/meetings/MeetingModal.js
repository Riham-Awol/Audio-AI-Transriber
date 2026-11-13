'use client';

import { useEffect, useState } from 'react';
import { apiRequest } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';

export function MeetingModal({ open, onClose, onSaved, initialMeeting = null }) {
  const isEdit = Boolean(initialMeeting?.id);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [meetingType, setMeetingType] = useState('online');
  const [recordingSource, setRecordingSource] = useState('scheduled');
  const [status, setStatus] = useState('scheduled');
  const [scheduledAt, setScheduledAt] = useState('');
  const [vocabulary, setVocabulary] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    if (initialMeeting) {
      setTitle(initialMeeting.title || '');
      setDescription(initialMeeting.description || '');
      setMeetingType(initialMeeting.meetingType || 'online');
      setRecordingSource(initialMeeting.recordingSource || 'scheduled');
      setStatus(initialMeeting.status || 'scheduled');
      setScheduledAt(
        initialMeeting.scheduledAt
          ? new Date(initialMeeting.scheduledAt).toISOString().slice(0, 16)
          : ''
      );
      setVocabulary(
        Array.isArray(initialMeeting.customVocabulary)
          ? initialMeeting.customVocabulary.join(', ')
          : ''
      );
    } else {
      setTitle('');
      setDescription('');
      setMeetingType('online');
      setRecordingSource('scheduled');
      setStatus('scheduled');
      setScheduledAt('');
      setVocabulary('');
    }
  }, [open, initialMeeting]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        meetingType,
        recordingSource,
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        customVocabulary: vocabulary
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };

      const res = isEdit
        ? await apiRequest(`/meetings/${initialMeeting.id}`, { method: 'PATCH', body: payload })
        : await apiRequest('/meetings', { method: 'POST', body: payload });

      onSaved?.(res.meeting);
      onClose?.();
    } catch (err) {
      setError(err.message || 'Unable to save meeting.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit Meeting' : 'Create / Schedule Meeting'}
      description="Manage meeting metadata, custom vocabulary hints, and scheduling."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium mb-1">Meeting Title</label>
          <Input
            required
            minLength={2}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Q4 Architecture Alignment"
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Description / Agenda</label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Key discussion topics, goals, or participants..."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
            <label className="block text-xs font-medium mb-1">Scheduled Date & Time</label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>
        </div>

        {isEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Recording Source</label>
              <Select value={recordingSource} onChange={(e) => setRecordingSource(e.target.value)}>
                <option value="scheduled">Scheduled</option>
                <option value="microphone">Microphone</option>
                <option value="browser_tab">Browser Tab</option>
                <option value="upload">File Upload</option>
                <option value="zoom">Zoom</option>
                <option value="google_meet">Google Meet</option>
                <option value="microsoft_teams">Microsoft Teams</option>
              </Select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Status</label>
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="scheduled">Scheduled</option>
                <option value="completed">Completed</option>
                <option value="processing">Processing</option>
                <option value="archived">Archived</option>
              </Select>
            </div>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium mb-1">
            Custom Vocabulary Hints (comma-separated, optional)
          </label>
          <Input
            value={vocabulary}
            onChange={(e) => setVocabulary(e.target.value)}
            placeholder="WhisperX, Qwen3.5, SOC2, Acme Corp"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Meeting'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

