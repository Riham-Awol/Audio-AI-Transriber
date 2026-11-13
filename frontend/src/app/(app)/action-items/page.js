'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ListTodo, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { apiRequest } from '@/lib/api';
import { formatDateShort, humanizeEnum } from '@/lib/utils';
import { Badge, statusBadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Select } from '@/components/ui/input';

export default function ActionItemsPage() {
  const { activeOrg } = useAuth();
  const [items, setItems] = useState([]);
  const [meetings, setMeetings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({
    meetingId: '',
    title: '',
    assigneeName: '',
    dueDate: '',
    priority: 'medium',
  });
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    if (!activeOrg) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (priorityFilter !== 'all') qs.set('priority', priorityFilter);

      const [itemsRes, meetingsRes] = await Promise.all([
        apiRequest(`/action-items?${qs.toString()}`),
        apiRequest('/meetings?limit=50'),
      ]);
      setItems(itemsRes.actionItems || []);
      const loadedMeetings = meetingsRes.meetings || [];
      setMeetings(loadedMeetings);
      if (loadedMeetings[0]) {
        setForm((prev) => (prev.meetingId ? prev : { ...prev, meetingId: loadedMeetings[0].id }));
      }
    } finally {
      setLoading(false);
    }
  }, [activeOrg, statusFilter, priorityFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.meetingId || form.title.trim().length < 2) return;
    setSaving(true);
    try {
      await apiRequest('/action-items', {
        method: 'POST',
        body: {
          meetingId: form.meetingId,
          title: form.title.trim(),
          assigneeName: form.assigneeName.trim() || null,
          dueDate: form.dueDate || null,
          priority: form.priority,
        },
      });
      setCreateOpen(false);
      setForm((prev) => ({ ...prev, title: '', assigneeName: '', dueDate: '' }));
      loadData();
    } finally {
      setSaving(false);
    }
  };

  const handleStatusChange = async (id, status) => {
    await apiRequest(`/action-items/${id}`, { method: 'PATCH', body: { status } });
    loadData();
  };

  const handleDelete = async (id) => {
    await apiRequest(`/action-items/${id}`, { method: 'DELETE' });
    loadData();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Action Items</h1>
          <p className="text-sm text-ink-muted">
            Track responsibilities and tasks across <strong>{activeOrg?.name}</strong>
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} disabled={meetings.length === 0}>
          <Plus className="h-4 w-4" />
          New Action Item
        </Button>
      </div>

      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3">
          <Select
            className="w-44"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </Select>

          <Select
            className="w-44"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </Select>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading action items...</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No action items found"
          description="Create a task linked to any meeting or adjust your filters."
        />
      ) : (
        <Card className="divide-y divide-border">
          {items.map((item) => (
            <div
              key={item.id}
              className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-surface-muted/40"
            >
              <div className="flex items-start gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() =>
                    handleStatusChange(
                      item.id,
                      item.status === 'completed' ? 'pending' : 'completed'
                    )
                  }
                  className="mt-0.5 text-ink-muted hover:text-burgundy"
                  aria-label="Toggle completion"
                >
                  <CheckCircle2
                    className={`h-4 w-4 ${
                      item.status === 'completed' ? 'text-emerald-600' : 'text-ink-muted'
                    }`}
                  />
                </button>
                <div className="min-w-0">
                  <p
                    className={`text-sm font-medium ${
                      item.status === 'completed' ? 'line-through text-ink-muted' : 'text-ink'
                    }`}
                  >
                    {item.title}
                  </p>
                  <div className="text-xs text-ink-muted mt-0.5 flex flex-wrap gap-2">
                    <Link href={`/meetings/${item.meetingId}`} className="hover:underline text-burgundy">
                      {item.meetingTitle}
                    </Link>
                    {item.assigneeName && <span>· Owner: {item.assigneeName}</span>}
                    {item.dueDate && <span>· Due {formatDateShort(item.dueDate)}</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Badge variant={statusBadgeVariant(item.priority)}>
                  {humanizeEnum(item.priority)}
                </Badge>
                <Select
                  className="h-8 text-xs w-32"
                  value={item.status}
                  onChange={(e) => handleStatusChange(item.id, e.target.value)}
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </Select>
                <button
                  type="button"
                  onClick={() => handleDelete(item.id)}
                  className="p-1.5 rounded-md text-ink-muted hover:bg-red-50 hover:text-red-600"
                  aria-label="Delete action item"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Action Item"
        description="Assign a task tied to a meeting in your organization."
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1">Meeting</label>
            <Select
              value={form.meetingId}
              onChange={(e) => setForm({ ...form, meetingId: e.target.value })}
            >
              {meetings.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">Task Title</label>
            <Input
              required
              minLength={2}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Prepare Q1 architecture slides"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Assignee (optional)</label>
              <Input
                value={form.assigneeName}
                onChange={(e) => setForm({ ...form, assigneeName: e.target.value })}
                placeholder="Name"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Due Date</label>
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Priority</label>
              <Select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Create Task'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
