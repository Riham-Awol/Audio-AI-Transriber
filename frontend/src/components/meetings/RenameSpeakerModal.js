'use client';

import { useState } from 'react';
import { Check, Loader2, Palette, Plus, UserPlus, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/api';

const PALETTE = [
  '#762F48', // Burgundy
  '#17243C', // Midnight Blue
  '#2B6CB0', // Sapphire
  '#2F855A', // Forest Green
  '#975A16', // Bronze
  '#6B46C1', // Violet
  '#C53030', // Crimson
  '#319795', // Teal
];

export function RenameSpeakerModal({ open, onClose, meetingId, speakers = [], onUpdated }) {
  const [editingId, setEditingId] = useState(null);
  const [nameVal, setNameVal] = useState('');
  const [colorVal, setColorVal] = useState('#762F48');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // New speaker state
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#762F48');
  const [adding, setAdding] = useState(false);

  if (!open) return null;

  const startEdit = (spk) => {
    setEditingId(spk.id);
    setNameVal(spk.displayName || spk.speakerKey);
    setColorVal(spk.colorHex || '#762F48');
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setNameVal('');
  };

  const handleSave = async (speakerId) => {
    if (!nameVal.trim()) return;
    setSaving(true);
    setError('');
    try {
      await apiRequest(`/meetings/${meetingId}/speakers/${speakerId}`, {
        method: 'PATCH',
        body: {
          displayName: nameVal.trim(),
          colorHex: colorVal,
        },
      });
      setEditingId(null);
      await onUpdated?.();
    } catch (err) {
      setError(err.message || 'Failed to update speaker.');
    } finally {
      setSaving(false);
    }
  };

  const handleAddSpeaker = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setAdding(true);
    setError('');
    try {
      await apiRequest(`/meetings/${meetingId}/speakers`, {
        method: 'POST',
        body: {
          displayName: newName.trim(),
          colorHex: newColor,
        },
      });
      setNewName('');
      setShowAdd(false);
      await onUpdated?.();
    } catch (err) {
      setError(err.message || 'Failed to add speaker.');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Manage Meeting Speakers" size="md">
      <div className="space-y-4">
        <p className="text-xs text-ink-muted">
          Correct speaker names or colors across the entire meeting transcript. Renaming a speaker
          updates all associated segments automatically.
        </p>

        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 p-2.5 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        <div className="divide-y divide-border border border-border rounded-xl bg-surface overflow-hidden max-h-72 overflow-y-auto">
          {speakers.length === 0 ? (
            <p className="p-4 text-center text-xs text-ink-muted">No speakers identified yet.</p>
          ) : (
            speakers.map((spk) => {
              const isEditing = editingId === spk.id;
              return (
                <div key={spk.id} className="p-3 flex flex-col gap-2">
                  {isEditing ? (
                    <div className="space-y-2.5">
                      <div className="flex items-center gap-2">
                        <Input
                          value={nameVal}
                          onChange={(e) => setNameVal(e.target.value)}
                          placeholder="Speaker name..."
                          className="h-8 text-xs flex-1"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={() => handleSave(spk.id)}
                          disabled={saving || !nameVal.trim()}
                          className="h-8 text-xs bg-burgundy text-white hover:bg-burgundy-deep"
                        >
                          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={cancelEdit}
                          disabled={saving}
                          className="h-8 text-xs"
                        >
                          Cancel
                        </Button>
                      </div>

                      {/* Color Picker Swatches */}
                      <div className="flex items-center gap-1.5 pt-1">
                        <Palette className="h-3.5 w-3.5 text-ink-muted mr-1" />
                        {PALETTE.map((hex) => (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => setColorVal(hex)}
                            className="h-5 w-5 rounded-full border border-black/10 flex items-center justify-center transition-transform hover:scale-110"
                            style={{ backgroundColor: hex }}
                            title={hex}
                          >
                            {colorVal === hex && <Check className="h-3 w-3 text-white" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="h-7 w-7 rounded-full text-white text-xs font-semibold flex items-center justify-center shrink-0 shadow-sm"
                          style={{ backgroundColor: spk.colorHex || '#762F48' }}
                        >
                          {(spk.displayName || spk.speakerKey || 'S').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-ink truncate">
                            {spk.displayName || spk.speakerKey}
                          </div>
                          <div className="text-[10px] text-ink-muted font-mono">
                            {spk.speakerKey} · {Math.floor((spk.totalSpeakingSeconds || 0) / 60)}m spoken
                          </div>
                        </div>
                      </div>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(spk)}
                        className="h-7 px-2 text-xs"
                      >
                        Rename
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Add Speaker Form */}
        {showAdd ? (
          <form onSubmit={handleAddSpeaker} className="p-3 border border-border rounded-xl bg-surface-muted/50 space-y-2.5">
            <div className="text-xs font-semibold text-ink">Add New Speaker Label</div>
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Dr. Alex Morgan"
                className="h-8 text-xs flex-1"
                autoFocus
              />
              <Button
                type="submit"
                size="sm"
                disabled={adding || !newName.trim()}
                className="h-8 text-xs bg-burgundy text-white hover:bg-burgundy-deep"
              >
                {adding ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Add'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setShowAdd(false)}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
            </div>
            <div className="flex items-center gap-1.5 pt-0.5">
              <span className="text-[11px] text-ink-muted mr-1">Color:</span>
              {PALETTE.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  onClick={() => setNewColor(hex)}
                  className="h-4 w-4 rounded-full border border-black/10 flex items-center justify-center transition-transform hover:scale-110"
                  style={{ backgroundColor: hex }}
                >
                  {newColor === hex && <Check className="h-2.5 w-2.5 text-white" />}
                </button>
              ))}
            </div>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAdd(true)}
            className="w-full text-xs"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Add New Speaker Label
          </Button>
        )}

        <div className="pt-2 border-t border-border flex justify-end">
          <Button type="button" onClick={onClose} className="bg-burgundy text-white hover:bg-burgundy-deep text-xs">
            Done
          </Button>
        </div>
      </div>
    </Modal>
  );
}

