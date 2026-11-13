'use client';

import { useState } from 'react';
import {
  CheckCircle2,
  Clock,
  Edit2,
  Gavel,
  Loader2,
  Play,
  Plus,
  Quote,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/api';

function formatTimestamp(ms) {
  const totalSeconds = Math.floor(Math.max(0, Number(ms || 0)) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const STATUS_CONFIG = {
  agreed: { label: 'Agreed', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300' },
  proposed: { label: 'Proposed', color: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300' },
  deferred: { label: 'Deferred', color: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-300' },
  rejected: { label: 'Rejected', color: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300' },
};

export function DecisionsWorkspace({ meeting, decisions = [], speakers = [], seekToMs, onReload }) {
  const [filterStatus, setFilterStatus] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDecision, setEditingDecision] = useState(null);

  // Form State
  const [description, setDescription] = useState('');
  const [speakerId, setSpeakerId] = useState('');
  const [status, setStatus] = useState('agreed');
  const [timestampMs, setTimestampMs] = useState(0);
  const [supportingQuote, setSupportingQuote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filteredDecisions = (decisions || []).filter((d) => {
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    return true;
  });

  const openAddModal = () => {
    setEditingDecision(null);
    setDescription('');
    setSpeakerId('');
    setStatus('agreed');
    setTimestampMs(0);
    setSupportingQuote('');
    setError('');
    setModalOpen(true);
  };

  const openEditModal = (d) => {
    setEditingDecision(d);
    setDescription(d.description || '');
    setSpeakerId(d.speaker_id || d.speakerId || '');
    setStatus(d.status || 'agreed');
    setTimestampMs(d.timestamp_ms || d.timestampMs || 0);
    setSupportingQuote(d.supporting_quote || d.supportingQuote || '');
    setError('');
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!description.trim()) {
      setError('Decision description is required.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      if (editingDecision) {
        await apiRequest(`/meetings/${meeting.id}/decisions/${editingDecision.id}`, {
          method: 'PATCH',
          body: {
            description: description.trim(),
            speakerId: speakerId || null,
            status,
            timestampMs,
            supportingQuote: supportingQuote.trim(),
          },
        });
      } else {
        await apiRequest(`/meetings/${meeting.id}/decisions`, {
          method: 'POST',
          body: {
            description: description.trim(),
            speakerId: speakerId || null,
            status,
            timestampMs,
            supportingQuote: supportingQuote.trim(),
          },
        });
      }
      setModalOpen(false);
      await onReload?.();
    } catch (err) {
      setError(err.message || 'Failed to save decision.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (d) => {
    if (!confirm('Are you sure you want to delete this decision?')) return;
    try {
      await apiRequest(`/meetings/${meeting.id}/decisions/${d.id}`, {
        method: 'DELETE',
      });
      await onReload?.();
    } catch (err) {
      alert(err.message || 'Failed to delete decision.');
    }
  };

  const handleQuickStatusChange = async (d, newStatus) => {
    try {
      await apiRequest(`/meetings/${meeting.id}/decisions/${d.id}`, {
        method: 'PATCH',
        body: { status: newStatus },
      });
      await onReload?.();
    } catch (err) {
      alert(err.message || 'Failed to update decision status.');
    }
  };

  return (
    <div className="space-y-4">
      {/* Header and Filter Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex items-center gap-2">
          <Gavel className="h-4 w-4 text-burgundy" />
          <h2 className="text-sm font-semibold text-ink">Key Decisions</h2>
          <Badge variant="midnight">{filteredDecisions.length} recorded</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-surface-muted p-1 text-xs">
            {['all', 'agreed', 'proposed', 'deferred', 'rejected'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFilterStatus(st)}
                className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
                  filterStatus === st
                    ? 'bg-midnight text-white shadow-xs'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <Button
            size="sm"
            onClick={openAddModal}
            className="h-8 text-xs bg-burgundy text-white hover:bg-burgundy-deep"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Decision
          </Button>
        </div>
      </div>

      {/* Decisions List */}
      {filteredDecisions.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-ink-muted text-sm space-y-2">
            <Gavel className="h-8 w-8 mx-auto opacity-50" />
            <p>
              {filterStatus !== 'all'
                ? `No decisions match the "${filterStatus}" status filter.`
                : 'No decisions recorded for this meeting yet. Generate an AI summary or add decisions manually.'}
            </p>
            {filterStatus === 'all' && (
              <Button size="sm" variant="outline" onClick={openAddModal}>
                <Plus className="h-3.5 w-3.5" />
                Record First Decision
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredDecisions.map((d) => {
            const stConf = STATUS_CONFIG[d.status] || STATUS_CONFIG.agreed;
            const ts = d.timestamp_ms || d.timestampMs || 0;
            const quote = d.supporting_quote || d.supportingQuote;

            return (
              <div
                key={d.id}
                className="group p-4 rounded-xl border border-border bg-surface hover:border-border-hover transition-all space-y-2.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`text-[11px] font-semibold uppercase px-2 py-0.5 rounded border ${stConf.color}`}>
                        {stConf.label}
                      </span>
                      {d.speakerName && (
                        <span className="text-xs text-ink-muted font-medium flex items-center gap-1">
                          <Users className="h-3 w-3 text-burgundy" />
                          {d.speakerName}
                        </span>
                      )}
                      {ts > 0 && (
                        <button
                          type="button"
                          onClick={() => seekToMs?.(ts)}
                          className="inline-flex items-center gap-1 text-[11px] font-mono text-ink-muted hover:text-burgundy hover:underline"
                          title="Seek audio to when this was decided"
                        >
                          <Play className="h-2.5 w-2.5 text-burgundy" />
                          {formatTimestamp(ts)}
                        </button>
                      )}
                    </div>
                    <p className="text-sm font-medium text-ink leading-relaxed">
                      {d.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Select
                      value={d.status}
                      onChange={(e) => handleQuickStatusChange(d, e.target.value)}
                      className="h-7 text-xs py-0 pr-6"
                    >
                      <option value="agreed">Agreed</option>
                      <option value="proposed">Proposed</option>
                      <option value="deferred">Deferred</option>
                      <option value="rejected">Rejected</option>
                    </Select>

                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => openEditModal(d)}
                      className="h-7 w-7 p-0 text-ink-muted hover:text-burgundy"
                      title="Edit decision"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(d)}
                      className="h-7 w-7 p-0 text-ink-muted hover:text-red-600"
                      title="Delete decision"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {quote && (
                  <div className="p-2.5 rounded-lg bg-surface-muted/50 border border-border/60 text-xs text-ink-muted flex items-start gap-2 italic">
                    <Quote className="h-3.5 w-3.5 text-burgundy shrink-0 mt-0.5" />
                    <span>&ldquo;{quote}&rdquo;</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Decision Modal */}
      {modalOpen && (
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editingDecision ? 'Edit Decision' : 'Record New Decision'}
          size="md"
        >
          <form onSubmit={handleSave} className="space-y-4">
            {error && (
              <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-ink block mb-1">
                Decision Description *
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What was decided? (e.g. Deploy WhisperX to dedicated GPU instance next Monday)"
                rows={3}
                className="text-xs"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-ink block mb-1">Status</label>
                <Select value={status} onChange={(e) => setStatus(e.target.value)} className="text-xs h-8">
                  <option value="agreed">Agreed</option>
                  <option value="proposed">Proposed</option>
                  <option value="deferred">Deferred</option>
                  <option value="rejected">Rejected</option>
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink block mb-1">Speaker / Lead</label>
                <Select value={speakerId} onChange={(e) => setSpeakerId(e.target.value)} className="text-xs h-8">
                  <option value="">Unassigned</option>
                  {speakers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName || s.speakerKey}
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-ink block mb-1">
                Supporting Transcript Quote (Optional)
              </label>
              <Input
                value={supportingQuote}
                onChange={(e) => setSupportingQuote(e.target.value)}
                placeholder="Direct excerpt or quotation from meeting"
                className="text-xs h-8"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving || !description.trim()}
                className="bg-burgundy text-white hover:bg-burgundy-deep"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save Decision'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

