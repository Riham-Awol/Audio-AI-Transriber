'use client';

import { useState } from 'react';
import { Download, FileCode, FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/dialog';
import { getStoredAuth } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4002/api';

export function ExportModal({ open, onClose, meeting, onPrint }) {
  const [format, setFormat] = useState('pdf');
  const [exportType, setExportType] = useState('full_report');
  const [includeTimestamps, setIncludeTimestamps] = useState(true);
  const [includeSpeakers, setIncludeSpeakers] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  if (!meeting) return null;

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      const { accessToken, organizationId } = getStoredAuth();
      const params = new URLSearchParams({
        format,
        type: exportType,
        includeTimestamps: includeTimestamps ? '1' : '0',
        includeSpeakers: includeSpeakers ? '1' : '0',
      });

      const url = `${API_BASE}/meetings/${meeting.id}/export?${params.toString()}`;
      const res = await fetch(url, {
        headers: {
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...(organizationId ? { 'X-Organization-Id': organizationId } : {}),
        },
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `Export failed with status ${res.status}`);
      }

      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const cleanTitle = (meeting.title || 'Meeting-Report')
        .replace(/[^a-zA-Z0-9_-]/g, '_')
        .slice(0, 50);

      const extMap = { pdf: 'pdf', docx: 'docx', txt: 'txt', markdown: 'md' };
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `${cleanTitle}.${extMap[format] || 'txt'}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);

      onClose();
    } catch (err) {
      setError(err.message || 'Failed to download export file.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Export & Print Meeting" size="lg">
      <div className="space-y-5">
        {error && (
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 p-3 text-xs text-red-600 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Format Selector */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted block mb-2">
            File Format
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {[
              { id: 'pdf', label: 'PDF Document', ext: '.pdf', icon: FileText },
              { id: 'docx', label: 'Word (DOCX)', ext: '.docx', icon: FileSpreadsheet },
              { id: 'txt', label: 'Plain Text', ext: '.txt', icon: FileCode },
              { id: 'markdown', label: 'Markdown', ext: '.md', icon: FileCode },
            ].map((f) => {
              const Icon = f.icon;
              const selected = format === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormat(f.id)}
                  className={`flex flex-col items-center justify-center p-3 rounded-xl border text-center transition-all ${
                    selected
                      ? 'border-burgundy bg-burgundy/10 text-burgundy font-semibold ring-2 ring-burgundy/20'
                      : 'border-border bg-surface hover:bg-surface-muted text-ink'
                  }`}
                >
                  <Icon className="h-6 w-6 mb-1 text-burgundy" />
                  <span className="text-xs">{f.label}</span>
                  <span className="text-[10px] text-ink-muted">{f.ext}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Content Scope */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted block mb-2">
            Report Content
          </label>
          <div className="space-y-2">
            {[
              {
                id: 'full_report',
                title: 'Full Meeting Report',
                desc: 'Metadata, Executive Summary, Decisions, Action Items & Timestamped Transcript.',
              },
              {
                id: 'transcript',
                title: 'Transcript Only',
                desc: 'Complete conversation text, speaker names, and audio timestamps.',
              },
              {
                id: 'summary',
                title: 'Executive Summary Only',
                desc: 'Key decisions, discussion points, action items, and next steps.',
              },
            ].map((scope) => (
              <label
                key={scope.id}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                  exportType === scope.id
                    ? 'border-burgundy bg-burgundy/5 text-ink'
                    : 'border-border bg-surface hover:bg-surface-muted text-ink'
                }`}
              >
                <input
                  type="radio"
                  name="exportType"
                  value={scope.id}
                  checked={exportType === scope.id}
                  onChange={(e) => setExportType(e.target.value)}
                  className="mt-1 h-4 w-4 text-burgundy border-border focus:ring-burgundy"
                />
                <div>
                  <div className="text-xs font-medium text-ink">{scope.title}</div>
                  <div className="text-[11px] text-ink-muted">{scope.desc}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Options */}
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-ink-muted block mb-2">
            Transcript Options
          </label>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-2 cursor-pointer text-ink">
              <input
                type="checkbox"
                checked={includeTimestamps}
                onChange={(e) => setIncludeTimestamps(e.target.checked)}
                className="h-4 w-4 rounded text-burgundy border-border focus:ring-burgundy"
              />
              <span>Include Timestamps (e.g. [01:23])</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-ink">
              <input
                type="checkbox"
                checked={includeSpeakers}
                onChange={(e) => setIncludeSpeakers(e.target.checked)}
                className="h-4 w-4 rounded text-burgundy border-border focus:ring-burgundy"
              />
              <span>Include Speaker Labels</span>
            </label>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-2.5 pt-3 border-t border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              onClose();
              onPrint?.();
            }}
            className="w-full sm:w-auto"
          >
            <Printer className="h-4 w-4" />
            Print-Friendly View
          </Button>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button type="button" variant="outline" onClick={onClose} disabled={downloading}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="bg-burgundy text-white hover:bg-burgundy-deep"
            >
              {downloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating {format.toUpperCase()}...
                </>
              ) : (
                <>
                  <Download className="h-4 w-4" />
                  Download {format.toUpperCase()}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

