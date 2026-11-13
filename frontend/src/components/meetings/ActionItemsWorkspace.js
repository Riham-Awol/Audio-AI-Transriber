'use client';

import { useState } from 'react';
import {
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Edit2,
  ListTodo,
  Loader2,
  Play,
  Plus,
  Trash2,
  User,
  Users,
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

const PRIORITY_BADGES = {
  urgent: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300',
  high: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300',
  medium: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300',
  low: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300 border-slate-300',
};

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function ActionItemsWorkspace({
  meeting,
  actionItems = [],
  orgMembers = [],
  seekToMs,
  onReload,
}) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);

  // Form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [assigneeUserId, setAssigneeUserId] = useState('');
  const [assigneeName, setAssigneeName] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('medium');
  const [status, setStatus] = useState('pending');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const filteredItems = (actionItems || []).filter((ai) => {
    if (statusFilter !== 'all' && ai.status !== statusFilter) return false;
    return true;
  });

  const openAddModal = () => {
    setEditingItem(null);
    setTitle('');
    setDescription('');
    setAssigneeUserId('');
    setAssigneeName('');
    setDueDate('');
    setPriority('medium');
    setStatus('pending');
    setError('');
    setModalOpen(true);
  };

  const openEditModal = (ai) => {
    setEditingItem(ai);
    setTitle(ai.title || '');
    setDescription(ai.description || '');
    setAssigneeUserId(ai.assignee_user_id || ai.assigneeUserId || '');
    setAssigneeName(ai.assignee_name || ai.assigneeName || '');
    setDueDate(ai.due_date || ai.dueDate ? (ai.due_date || ai.dueDate).slice(0, 10) : '');
    setPriority(ai.priority || 'medium');
    setStatus(ai.status || 'pending');
    setError('');
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Task title is required.');
      return;
    }

    setSaving(true);
    setError('');

    // Resolve assigneeName if user was chosen from orgMembers
    let finalAssigneeName = assigneeName;
    if (assigneeUserId) {
      const found = orgMembers.find((m) => m.userId === assigneeUserId);
      if (found) finalAssigneeName = found.fullName || found.email;
    }

    try {
      if (editingItem) {
        await apiRequest(`/meetings/${meeting.id}/action-items/${editingItem.id}`, {
          method: 'PATCH',
          body: {
            title: title.trim(),
            description: description.trim(),
            assigneeUserId: assigneeUserId || null,
            assigneeName: finalAssigneeName || null,
            dueDate: dueDate || null,
            priority,
            status,
          },
        });
      } else {
        await apiRequest(`/meetings/${meeting.id}/action-items`, {
          method: 'POST',
          body: {
            title: title.trim(),
            description: description.trim(),
            assigneeUserId: assigneeUserId || null,
            assigneeName: finalAssigneeName || null,
            dueDate: dueDate || null,
            priority,
            status,
          },
        });
      }
      setModalOpen(false);
      await onReload?.();
    } catch (err) {
      setError(err.message || 'Failed to save action item.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleComplete = async (ai) => {
    const nextStatus = ai.status === 'completed' ? 'pending' : 'completed';
    try {
      await apiRequest(`/meetings/${meeting.id}/action-items/${ai.id}`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      await onReload?.();
    } catch (err) {
      alert(err.message || 'Failed to update task.');
    }
  };

  const handleDelete = async (ai) => {
    if (!confirm('Are you sure you want to delete this action item?')) return;
    try {
      await apiRequest(`/meetings/${meeting.id}/action-items/${ai.id}`, {
        method: 'DELETE',
      });
      await onReload?.();
    } catch (err) {
      alert(err.message || 'Failed to delete action item.');
    }
  };

  const handleExportCsv = () => {
    const headers = ['Title', 'Description', 'Assignee', 'Priority', 'Status', 'Due Date'];
    const rows = (actionItems || []).map((ai) => [
      `"${(ai.title || '').replace(/"/g, '""')}"`,
      `"${(ai.description || '').replace(/"/g, '""')}"`,
      `"${(ai.assignee_name || ai.assigneeName || 'Unassigned').replace(/"/g, '""')}"`,
      ai.priority || 'medium',
      ai.status || 'pending',
      ai.due_date || ai.dueDate || '',
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meeting.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_tasks.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      {/* Action Items Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-burgundy" />
          <h2 className="text-sm font-semibold text-ink">Action Items & Tasks</h2>
          <Badge variant="midnight">{filteredItems.length} tasks</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-surface-muted p-1 text-xs">
            {['all', 'pending', 'in_progress', 'completed'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded-md capitalize font-medium transition-colors ${
                  statusFilter === st
                    ? 'bg-midnight text-white shadow-xs'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {st.replace('_', ' ')}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="h-8 text-xs"
            title="Download CSV task export"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </Button>

          <Button
            size="sm"
            onClick={openAddModal}
            className="h-8 text-xs bg-burgundy text-white hover:bg-burgundy-deep"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Task
          </Button>
        </div>
      </div>

      {/* Task List */}
      {filteredItems.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-ink-muted text-sm space-y-2">
            <ListTodo className="h-8 w-8 mx-auto opacity-50" />
            <p>
              {statusFilter !== 'all'
                ? `No action items found with "${statusFilter}" status.`
                : 'No action items extracted or assigned yet.'}
            </p>
            {statusFilter === 'all' && (
              <Button size="sm" variant="outline" onClick={openAddModal}>
                <Plus className="h-3.5 w-3.5" />
                Create First Action Item
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {filteredItems.map((ai) => {
            const isDone = ai.status === 'completed';
            const assignee = ai.assignee_name || ai.assigneeName || 'Unassigned';
            const ts = ai.source_timestamp_ms || ai.sourceTimestampMs || 0;
            const due = ai.due_date || ai.dueDate;
            const prioClass = PRIORITY_BADGES[ai.priority] || PRIORITY_BADGES.medium;

            return (
              <div
                key={ai.id}
                className={`group p-3.5 rounded-xl border transition-all flex items-start gap-3 shadow-xs ${
                  isDone
                    ? 'border-border/60 bg-surface-muted/30 opacity-75'
                    : 'border-border bg-surface hover:border-border-hover'
                }`}
              >
                {/* Completion Checkbox */}
                <button
                  type="button"
                  onClick={() => handleToggleComplete(ai)}
                  className={`mt-0.5 h-5 w-5 rounded-md border flex items-center justify-center transition-all ${
                    isDone
                      ? 'bg-emerald-600 border-emerald-600 text-white'
                      : 'border-border hover:border-burgundy text-transparent'
                  }`}
                  title={isDone ? 'Mark pending' : 'Mark completed'}
                >
                  <Check className="h-3.5 w-3.5 stroke-[3]" />
                </button>

                {/* Task Details */}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`text-sm font-medium leading-tight ${
                        isDone ? 'line-through text-ink-muted' : 'text-ink'
                      }`}
                    >
                      {ai.title}
                    </span>

                    <span
                      className={`text-[10px] font-semibold uppercase px-1.5 py-0.2 rounded border ${prioClass}`}
                    >
                      {ai.priority}
                    </span>

                    {ai.status === 'in_progress' && (
                      <span className="text-[10px] uppercase font-semibold text-blue-700 bg-blue-100 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.2 rounded">
                        In Progress
                      </span>
                    )}
                  </div>

                  {ai.description && (
                    <p className="text-xs text-ink-muted leading-relaxed">{ai.description}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-3 text-[11px] text-ink-muted pt-1">
                    <span className="inline-flex items-center gap-1 font-medium text-ink">
                      <User className="h-3 w-3 text-burgundy" />
                      {assignee}
                    </span>

                    {due && (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Calendar className="h-3 w-3" />
                        Due {new Date(due).toLocaleDateString()}
                      </span>
                    )}

                    {ts > 0 && (
                      <button
                        type="button"
                        onClick={() => seekToMs?.(ts)}
                        className="inline-flex items-center gap-1 font-mono hover:text-burgundy hover:underline"
                        title="Seek audio to when this task was assigned"
                      >
                        <Play className="h-2.5 w-2.5 text-burgundy" />
                        {formatTimestamp(ts)}
                      </button>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => openEditModal(ai)}
                    className="h-7 w-7 p-0 text-ink-muted hover:text-burgundy"
                    title="Edit task"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(ai)}
                    className="h-7 w-7 p-0 text-ink-muted hover:text-red-600"
                    title="Delete task"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Task Modal */}
      {modalOpen && (
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title={editingItem ? 'Edit Action Item' : 'New Action Item'}
          size="md"
        >
          <form onSubmit={handleSave} className="space-y-4">
            {error && (
              <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs text-red-600 dark:text-red-400">
                {error}
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-ink block mb-1">Task Title *</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                className="text-xs h-8"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-ink block mb-1">
                Description / Context
              </label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Additional instructions or notes..."
                rows={2}
                className="text-xs"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-ink block mb-1">Assignee</label>
                <Select
                  value={assigneeUserId}
                  onChange={(e) => {
                    setAssigneeUserId(e.target.value);
                    const found = orgMembers.find((m) => m.userId === e.target.value);
                    if (found) setAssigneeName(found.fullName || found.email);
                  }}
                  className="text-xs h-8"
                >
                  <option value="">Unassigned</option>
                  {orgMembers.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.fullName || m.email}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink block mb-1">Or Custom Name</label>
                <Input
                  value={assigneeName}
                  onChange={(e) => setAssigneeName(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  className="text-xs h-8"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-semibold text-ink block mb-1">Due Date</label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="text-xs h-8"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink block mb-1">Priority</label>
                <Select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="text-xs h-8"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </Select>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink block mb-1">Status</label>
                <Select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="text-xs h-8"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button type="button" variant="outline" size="sm" onClick={() => setModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={saving || !title.trim()}
                className="bg-burgundy text-white hover:bg-burgundy-deep"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save Task'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

