'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Clock,
  Combine,
  Copy,
  Download,
  Edit2,
  FileText,
  Filter,
  Loader2,
  MoreVertical,
  Play,
  Printer,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/dialog';
import { apiRequest } from '@/lib/api';
import { ExportModal } from './ExportModal';
import { RenameSpeakerModal } from './RenameSpeakerModal';

function formatTimestamp(ms) {
  const totalSeconds = Math.floor(Math.max(0, Number(ms || 0)) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function TranscriptWorkspace({
  meeting,
  segments = [],
  speakers = [],
  summary = null,
  decisions = [],
  actionItems = [],
  currentTimeMs = 0,
  seekToMs,
  onReload,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('all');
  const [showMatchesOnly, setShowMatchesOnly] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  // Search Match Navigation
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Editing state
  const [editingSegmentId, setEditingSegmentId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editSpeakerId, setEditSpeakerId] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Split dialog state
  const [splitModalOpen, setSplitModalOpen] = useState(false);
  const [splitTargetSeg, setSplitTargetSeg] = useState(null);
  const [splitFirstPart, setSplitFirstPart] = useState('');
  const [splitSecondPart, setSplitSecondPart] = useState('');
  const [splitTimeMs, setSplitTimeMs] = useState(0);
  const [splitting, setSplitting] = useState(false);

  // Modals
  const [exportOpen, setExportOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);

  // Copy feedback
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const activeSegmentRef = useRef(null);
  const transcriptContainerRef = useRef(null);

  // Active segment detection based on audio playback time
  const activeSegmentId = useMemo(() => {
    if (!segments || segments.length === 0 || currentTimeMs <= 0) return null;
    const found = segments.find(
      (s) => currentTimeMs >= Number(s.startMs || 0) && currentTimeMs <= Number(s.endMs || 0)
    );
    return found ? found.id : null;
  }, [segments, currentTimeMs]);

  // Auto-scroll to active segment
  useEffect(() => {
    if (autoScroll && activeSegmentRef.current && activeSegmentId) {
      activeSegmentRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeSegmentId, autoScroll]);

  // Filtered segments and search matches
  const { filteredSegments, totalMatches, matchSegmentIds } = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const matchIds = [];
    let count = 0;

    const filtered = (segments || []).filter((seg) => {
      // Speaker filter
      if (selectedSpeaker !== 'all') {
        const matchesSpeakerId = seg.speakerId === selectedSpeaker;
        const matchesSpeakerKey = seg.speakerKey === selectedSpeaker;
        if (!matchesSpeakerId && !matchesSpeakerKey) return false;
      }

      // Search query
      if (query) {
        const textLower = (seg.text || '').toLowerCase();
        const speakerLower = (seg.speakerName || '').toLowerCase();
        const matches = textLower.includes(query) || speakerLower.includes(query);
        if (matches) {
          matchIds.push(seg.id);
          // Count occurrences in text
          const matchesCount = (textLower.match(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
          count += matchesCount;
        }
        if (showMatchesOnly && !matches) {
          return false;
        }
      }

      return true;
    });

    return { filteredSegments: filtered, totalMatches: count, matchSegmentIds: matchIds };
  }, [segments, searchQuery, selectedSpeaker, showMatchesOnly]);

  // Navigate between search matches
  const handleNextMatch = () => {
    if (matchSegmentIds.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % matchSegmentIds.length;
    setCurrentMatchIndex(nextIdx);
    const targetId = matchSegmentIds[nextIdx];
    const el = document.getElementById(`segment-${targetId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const handlePrevMatch = () => {
    if (matchSegmentIds.length === 0) return;
    const prevIdx = (currentMatchIndex - 1 + matchSegmentIds.length) % matchSegmentIds.length;
    setCurrentMatchIndex(prevIdx);
    const targetId = matchSegmentIds[prevIdx];
    const el = document.getElementById(`segment-${targetId}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Inline editing actions
  const startEditing = (seg) => {
    setEditingSegmentId(seg.id);
    setEditText(seg.text);
    setEditSpeakerId(seg.speakerId || '');
  };

  const cancelEditing = () => {
    setEditingSegmentId(null);
    setEditText('');
    setEditSpeakerId('');
  };

  const saveEdit = async (segmentId) => {
    if (!editText.trim()) return;
    setSavingEdit(true);
    try {
      await apiRequest(`/meetings/${meeting.id}/transcript/segments/${segmentId}`, {
        method: 'PATCH',
        body: {
          text: editText.trim(),
          speakerId: editSpeakerId || null,
        },
      });
      setEditingSegmentId(null);
      await onReload?.();
    } catch (err) {
      alert(err.message || 'Failed to save segment edit.');
    } finally {
      setSavingEdit(false);
    }
  };

  // Merge with next segment
  const handleMergeNext = async (seg) => {
    if (!confirm('Merge this segment with the following segment?')) return;
    try {
      await apiRequest(`/meetings/${meeting.id}/transcript/segments/${seg.id}/merge-next`, {
        method: 'POST',
      });
      await onReload?.();
    } catch (err) {
      alert(err.message || 'Failed to merge segments.');
    }
  };

  // Delete segment
  const handleDeleteSegment = async (seg) => {
    if (!confirm('Are you sure you want to delete this segment?')) return;
    try {
      await apiRequest(`/meetings/${meeting.id}/transcript/segments/${seg.id}`, {
        method: 'DELETE',
      });
      await onReload?.();
    } catch (err) {
      alert(err.message || 'Failed to delete segment.');
    }
  };

  // Open split modal
  const openSplitModal = (seg) => {
    setSplitTargetSeg(seg);
    const words = (seg.text || '').split(' ');
    const half = Math.ceil(words.length / 2);
    setSplitFirstPart(words.slice(0, half).join(' '));
    setSplitSecondPart(words.slice(half).join(' '));
    setSplitTimeMs(Math.floor((Number(seg.startMs || 0) + Number(seg.endMs || 0)) / 2));
    setSplitModalOpen(true);
  };

  const handleExecuteSplit = async () => {
    if (!splitTargetSeg || !splitFirstPart.trim() || !splitSecondPart.trim()) return;
    setSplitting(true);
    try {
      await apiRequest(`/meetings/${meeting.id}/transcript/segments/${splitTargetSeg.id}/split`, {
        method: 'POST',
        body: {
          splitTimestampMs: splitTimeMs,
          splitTextFirst: splitFirstPart.trim(),
          splitTextSecond: splitSecondPart.trim(),
        },
      });
      setSplitModalOpen(false);
      setEditingSegmentId(null);
      await onReload?.();
    } catch (err) {
      alert(err.message || 'Failed to split segment.');
    } finally {
      setSplitting(false);
    }
  };

  // Copying actions
  const handleCopyAll = () => {
    const text = (segments || [])
      .map((s) => `[${formatTimestamp(s.startMs)}] ${s.speakerName}: ${s.text}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  const handleCopySegment = (seg) => {
    navigator.clipboard.writeText(`[${formatTimestamp(seg.startMs)}] ${seg.speakerName}: ${seg.text}`);
    setCopiedId(seg.id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  const handlePrint = () => {
    window.print();
  };

  // Highlight matches helper
  const renderHighlightedText = (text, isCurrentSegmentActive, wordsJson) => {
    const query = searchQuery.trim();

    // If active playback and word timestamps are present, render word-by-word with sync
    if (isCurrentSegmentActive && Array.isArray(wordsJson) && wordsJson.length > 0) {
      const currentSec = currentTimeMs / 1000;
      return (
        <span className="leading-relaxed">
          {wordsJson.map((w, idx) => {
            const isWordActive = currentSec >= Number(w.start || 0) && currentSec <= Number(w.end || 0);
            const matchesQuery = query && (w.word || '').toLowerCase().includes(query.toLowerCase());

            return (
              <span
                key={idx}
                onClick={(e) => {
                  e.stopPropagation();
                  if (w.start) seekToMs(Math.floor(w.start * 1000));
                }}
                className={`cursor-pointer rounded transition-colors px-0.5 ${
                  isWordActive
                    ? 'bg-burgundy/20 dark:bg-burgundy/40 text-burgundy dark:text-burgundy-light font-bold'
                    : matchesQuery
                    ? 'bg-amber-200 dark:bg-amber-900/60 font-semibold'
                    : 'hover:bg-surface-muted'
                }`}
                title={`Seek to ${formatTimestamp(w.start * 1000)}`}
              >
                {w.word}{' '}
              </span>
            );
          })}
        </span>
      );
    }

    // Default text rendering with search highlighting
    if (!query) {
      return <span className="leading-relaxed">{text}</span>;
    }

    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = text.split(regex);

    return (
      <span className="leading-relaxed">
        {parts.map((part, i) =>
          regex.test(part) ? (
            <mark
              key={i}
              className="bg-amber-200 dark:bg-amber-900/60 text-ink font-semibold rounded px-0.5"
            >
              {part}
            </mark>
          ) : (
            <span key={i}>{part}</span>
          )
        )}
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {/* Print View Header (Only visible when printing) */}
      <div className="hidden print:block print:mb-6 border-b pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-black">{meeting.title}</h1>
          <span className="text-xs text-gray-500">VoxaMeet AI Enterprise Report</span>
        </div>
        <p className="text-sm text-gray-600 mt-1">
          Date: {new Date(meeting.scheduledAt || meeting.createdAt).toLocaleString()} | Duration:{' '}
          {Math.floor((meeting.durationSeconds || 0) / 60)} minutes | Speakers:{' '}
          {speakers.map((s) => s.displayName || s.speakerKey).join(', ')}
        </p>
      </div>

      {/* Interactive Transcript Toolbar */}
      <Card className="print:hidden border-border bg-surface shadow-sm">
        <CardContent className="p-3.5 space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Search Input & Navigation */}
            <div className="flex items-center gap-2 flex-1 max-w-lg">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-muted" />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setCurrentMatchIndex(0);
                  }}
                  placeholder="Search transcript phrases, speakers..."
                  className="pl-9 h-9 text-xs"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {searchQuery && (
                <div className="flex items-center gap-1 shrink-0 text-xs">
                  <span className="text-[11px] font-mono text-ink-muted px-1.5 py-0.5 rounded bg-surface-muted">
                    {totalMatches > 0
                      ? `${Math.min(currentMatchIndex + 1, matchSegmentIds.length)}/${matchSegmentIds.length}`
                      : '0'}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handlePrevMatch}
                    disabled={matchSegmentIds.length === 0}
                    className="h-8 w-8 p-0"
                    title="Previous match"
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleNextMatch}
                    disabled={matchSegmentIds.length === 0}
                    className="h-8 w-8 p-0"
                    title="Next match"
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* Filter, Auto-scroll & Main Actions */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {/* Speaker Filter */}
              <div className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 text-ink-muted shrink-0" />
                <Select
                  value={selectedSpeaker}
                  onChange={(e) => setSelectedSpeaker(e.target.value)}
                  className="h-9 text-xs py-1 pr-7"
                >
                  <option value="all">All Speakers ({speakers.length})</option>
                  {speakers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName || s.speakerKey}
                    </option>
                  ))}
                </Select>
              </div>

              {/* Auto Scroll Toggle */}
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface-muted/50 cursor-pointer text-xs select-none">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="h-3.5 w-3.5 rounded text-burgundy border-border focus:ring-burgundy"
                />
                <span className="text-ink">Auto-scroll</span>
              </label>

              {searchQuery && (
                <label className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border bg-surface-muted/50 cursor-pointer text-xs select-none">
                  <input
                    type="checkbox"
                    checked={showMatchesOnly}
                    onChange={(e) => setShowMatchesOnly(e.target.checked)}
                    className="h-3.5 w-3.5 rounded text-burgundy border-border focus:ring-burgundy"
                  />
                  <span className="text-ink">Matches only</span>
                </label>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-ink-muted font-mono text-[11px]">
                {filteredSegments.length} of {segments.length} segments
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setRenameOpen(true)}
                className="h-7 text-xs"
              >
                <Users className="h-3.5 w-3.5" />
                Rename Speakers
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyAll}
                className="h-7 text-xs"
                title="Copy full transcript with speaker labels and timestamps"
              >
                {copiedAll ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedAll ? 'Copied!' : 'Copy Transcript'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handlePrint}
                className="h-7 text-xs"
                title="Print formatted meeting report"
              >
                <Printer className="h-3.5 w-3.5" />
                Print
              </Button>

              <Button
                size="sm"
                onClick={() => setExportOpen(true)}
                className="h-7 text-xs bg-burgundy text-white hover:bg-burgundy-deep"
              >
                <Download className="h-3.5 w-3.5" />
                Export (PDF / Word)
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Segments Stream */}
      <div
        ref={transcriptContainerRef}
        className="space-y-3 print:space-y-4 max-h-[750px] overflow-y-auto pr-1"
      >
        {filteredSegments.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-ink-muted text-sm space-y-2">
              <FileText className="h-8 w-8 mx-auto text-ink-muted opacity-50" />
              <p>
                {searchQuery || selectedSpeaker !== 'all'
                  ? 'No transcript segments match your current search or speaker filter.'
                  : 'No transcript recorded for this meeting yet.'}
              </p>
              {(searchQuery || selectedSpeaker !== 'all') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedSpeaker('all');
                    setShowMatchesOnly(false);
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          filteredSegments.map((seg) => {
            const isEditing = editingSegmentId === seg.id;
            const isActive = activeSegmentId === seg.id;

            return (
              <div
                key={seg.id}
                id={`segment-${seg.id}`}
                ref={isActive ? activeSegmentRef : null}
                className={`group rounded-xl border p-4 transition-all duration-150 ${
                  isActive
                    ? 'border-burgundy/60 bg-burgundy/5 dark:bg-burgundy/10 shadow-sm ring-1 ring-burgundy/30'
                    : 'border-border bg-surface hover:border-border-hover'
                }`}
              >
                {/* Segment Header */}
                <div className="flex items-center justify-between gap-3 text-xs mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0 shadow-sm"
                      style={{ backgroundColor: seg.speakerColor || '#762F48' }}
                    />
                    <span
                      className="font-semibold text-xs truncate cursor-pointer hover:underline"
                      style={{ color: seg.speakerColor || '#762F48' }}
                      onClick={() => setRenameOpen(true)}
                      title="Click to rename this speaker globally"
                    >
                      {seg.speakerName}
                    </span>

                    {/* Timestamp seek button */}
                    <button
                      type="button"
                      onClick={() => seekToMs(Number(seg.startMs || 0))}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] text-ink-muted hover:bg-burgundy/10 hover:text-burgundy transition-colors"
                      title="Play original audio from this point"
                    >
                      <Play className="h-2.5 w-2.5 text-burgundy shrink-0" />
                      {formatTimestamp(seg.startMs)} – {formatTimestamp(seg.endMs)}
                    </button>

                    {seg.confidence && (
                      <span className="hidden sm:inline-block text-[10px] text-ink-muted font-mono">
                        {Math.round(Number(seg.confidence) * 100)}%
                      </span>
                    )}

                    {seg.isEdited && (
                      <span className="text-[10px] uppercase font-semibold text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/50 px-1 rounded">
                        Edited
                      </span>
                    )}
                  </div>

                  {/* Segment Actions (Hidden when editing or printing) */}
                  {!isEditing && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity print:hidden">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopySegment(seg)}
                        className="h-7 w-7 p-0 text-ink-muted hover:text-ink"
                        title="Copy segment"
                      >
                        {copiedId === seg.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEditing(seg)}
                        className="h-7 w-7 p-0 text-ink-muted hover:text-burgundy"
                        title="Edit text or reassign speaker"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openSplitModal(seg)}
                        className="h-7 w-7 p-0 text-ink-muted hover:text-burgundy"
                        title="Split segment into two"
                      >
                        <Scissors className="h-3.5 w-3.5" />
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleMergeNext(seg)}
                        className="h-7 w-7 p-0 text-ink-muted hover:text-burgundy"
                        title="Merge with next segment"
                      >
                        <Combine className="h-3.5 w-3.5" />
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDeleteSegment(seg)}
                        className="h-7 w-7 p-0 text-ink-muted hover:text-red-600"
                        title="Delete segment"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

                {/* Inline Editing Mode */}
                {isEditing ? (
                  <div className="space-y-3 pt-1">
                    <Textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={3}
                      className="text-sm leading-relaxed"
                      autoFocus
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-ink-muted">Assign Speaker:</span>
                        <Select
                          value={editSpeakerId}
                          onChange={(e) => setEditSpeakerId(e.target.value)}
                          className="h-8 text-xs py-1"
                        >
                          <option value="">Keep Default / Unassigned</option>
                          {speakers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.displayName || s.speakerKey}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={cancelEditing}
                          disabled={savingEdit}
                          className="h-8 text-xs"
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveEdit(seg.id)}
                          disabled={savingEdit || !editText.trim()}
                          className="h-8 text-xs bg-burgundy text-white hover:bg-burgundy-deep"
                        >
                          {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save Changes'}
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* Standard Read Mode (Double click to edit) */
                  <div
                    onDoubleClick={() => startEditing(seg)}
                    className="text-sm text-ink leading-relaxed cursor-text selection:bg-burgundy/20"
                    title="Double click to edit text inline"
                  >
                    {renderHighlightedText(seg.text, isActive, seg.wordsJson)}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Split Segment Modal */}
      {splitModalOpen && (
        <Modal
          open={splitModalOpen}
          onClose={() => setSplitModalOpen(false)}
          title="Split Transcript Segment"
          size="md"
        >
          <div className="space-y-4">
            <p className="text-xs text-ink-muted">
              Divide this segment into two sequential segments. Adjust the text and the split
              timestamp below:
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-ink block mb-1">
                  First Segment Text
                </label>
                <Textarea
                  value={splitFirstPart}
                  onChange={(e) => setSplitFirstPart(e.target.value)}
                  rows={2}
                  className="text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink block mb-1">
                  Split Timestamp (e.g. milliseconds)
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    value={splitTimeMs}
                    onChange={(e) => setSplitTimeMs(Number(e.target.value))}
                    className="text-xs font-mono h-8"
                  />
                  <span className="text-xs font-mono text-ink-muted">
                    {formatTimestamp(splitTimeMs)}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink block mb-1">
                  Second Segment Text
                </label>
                <Textarea
                  value={splitSecondPart}
                  onChange={(e) => setSplitSecondPart(e.target.value)}
                  rows={2}
                  className="text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSplitModalOpen(false)}
                disabled={splitting}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleExecuteSplit}
                disabled={splitting || !splitFirstPart.trim() || !splitSecondPart.trim()}
                className="bg-burgundy text-white hover:bg-burgundy-deep"
              >
                {splitting ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm Split'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Rename Speaker Modal */}
      <RenameSpeakerModal
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        meetingId={meeting.id}
        speakers={speakers}
        onUpdated={onReload}
      />

      {/* Export Modal */}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        meeting={meeting}
        onPrint={handlePrint}
      />
    </div>
  );
}

