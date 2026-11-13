'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Edit2,
  FileText,
  Lightbulb,
  ListOrdered,
  Loader2,
  RefreshCw,
  Save,
  ShieldAlert,
  Sparkles,
  Target,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { apiRequest } from '@/lib/api';
import { humanizeEnum } from '@/lib/utils';

export function SummaryWorkspace({ meeting, summary, onReload }) {
  const [detailLevel, setDetailLevel] = useState(summary?.detailLevel || 'standard');
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable fields
  const [execSummary, setExecSummary] = useState(summary?.executiveSummary || '');
  const [purpose, setPurpose] = useState(summary?.meetingPurpose || '');
  const [minutesMd, setMinutesMd] = useState(summary?.minutesMarkdown || '');
  const [copiedMinutes, setCopiedMinutes] = useState(false);

  const mainTopics = Array.isArray(summary?.mainTopics)
    ? summary.mainTopics
    : typeof summary?.mainTopics === 'string'
    ? JSON.parse(summary.mainTopics || '[]')
    : [];

  const discussionPoints = Array.isArray(summary?.discussionPoints)
    ? summary.discussionPoints
    : typeof summary?.discussionPoints === 'string'
    ? JSON.parse(summary.discussionPoints || '[]')
    : [];

  const challenges = Array.isArray(summary?.challengesConcerns)
    ? summary.challengesConcerns
    : typeof summary?.challengesConcerns === 'string'
    ? JSON.parse(summary.challengesConcerns || '[]')
    : [];

  const risks = Array.isArray(summary?.risksIdentified)
    ? summary.risksIdentified
    : typeof summary?.risksIdentified === 'string'
    ? JSON.parse(summary.risksIdentified || '[]')
    : [];

  const nextSteps = Array.isArray(summary?.nextSteps)
    ? summary.nextSteps
    : typeof summary?.nextSteps === 'string'
    ? JSON.parse(summary.nextSteps || '[]')
    : [];

  const handleRegenerate = async (targetLevel = detailLevel) => {
    setGenerating(true);
    try {
      await apiRequest(`/meetings/${meeting.id}/summary/generate`, {
        method: 'POST',
        body: { detailLevel: targetLevel },
      });
      await onReload?.();
    } catch (err) {
      alert(err.message || 'Failed to generate summary.');
    } finally {
      setGenerating(false);
    }
  };

  const handleSaveEdits = async () => {
    setSaving(true);
    try {
      await apiRequest(`/meetings/${meeting.id}/summary`, {
        method: 'PATCH',
        body: {
          detailLevel,
          executiveSummary: execSummary,
          meetingPurpose: purpose,
          minutesMarkdown: minutesMd,
        },
      });
      setEditing(false);
      await onReload?.();
    } catch (err) {
      alert(err.message || 'Failed to save summary changes.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyMinutes = () => {
    const textToCopy = summary?.minutesMarkdown || summary?.executiveSummary || '';
    navigator.clipboard.writeText(textToCopy);
    setCopiedMinutes(true);
    setTimeout(() => setCopiedMinutes(false), 2000);
  };

  const handleDownloadMinutes = () => {
    const md = summary?.minutesMarkdown || `# ${meeting.title}\n\n${summary?.executiveSummary}`;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meeting.title.replace(/[^a-zA-Z0-9_-]/g, '_')}_minutes.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* Top Header / Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-border bg-surface shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-border bg-surface-muted p-1">
            {['short', 'standard', 'detailed'].map((lvl) => (
              <button
                key={lvl}
                type="button"
                onClick={() => {
                  setDetailLevel(lvl);
                  if (summary && summary.detailLevel !== lvl) {
                    handleRegenerate(lvl);
                  }
                }}
                className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition-all ${
                  detailLevel === lvl
                    ? 'bg-midnight text-white shadow-xs'
                    : 'text-ink-muted hover:text-ink'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>

          {summary && (
            <Badge variant="burgundy" className="hidden sm:inline-flex capitalize">
              {summary.modelName || 'Qwen 3.5 AI'}
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {summary && !editing && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setExecSummary(summary.executiveSummary || '');
                  setPurpose(summary.meetingPurpose || '');
                  setMinutesMd(summary.minutesMarkdown || '');
                  setEditing(true);
                }}
                className="h-8 text-xs"
              >
                <Edit2 className="h-3.5 w-3.5" />
                Edit Summary
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyMinutes}
                className="h-8 text-xs"
                title="Copy markdown minutes"
              >
                {copiedMinutes ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedMinutes ? 'Copied' : 'Copy'}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadMinutes}
                className="h-8 text-xs"
                title="Download meeting minutes as markdown file"
              >
                <Download className="h-3.5 w-3.5" />
                Markdown
              </Button>
            </>
          )}

          {editing ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="h-8 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveEdits}
                disabled={saving}
                className="h-8 text-xs bg-burgundy text-white hover:bg-burgundy-deep"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Changes
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={() => handleRegenerate(detailLevel)}
              disabled={generating}
              className="h-8 text-xs bg-burgundy text-white hover:bg-burgundy-deep"
            >
              {generating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  {summary ? 'Regenerate' : 'Generate AI Summary'}
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {!summary && !generating ? (
        <Card>
          <CardContent className="p-12 text-center space-y-4">
            <div className="h-12 w-12 rounded-2xl bg-burgundy/10 text-burgundy flex items-center justify-center mx-auto">
              <Sparkles className="h-6 w-6" />
            </div>
            <div className="max-w-md mx-auto space-y-1">
              <h3 className="text-base font-semibold text-ink">No Summary Generated Yet</h3>
              <p className="text-xs text-ink-muted">
                Extract executive takeaways, key discussion points, decisions, and action items
                automatically using self-hosted open-source intelligence.
              </p>
            </div>
            <Button
              onClick={() => handleRegenerate('standard')}
              className="bg-burgundy text-white hover:bg-burgundy-deep"
            >
              <Sparkles className="h-4 w-4" />
              Generate Summary Now
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Executive Summary Card */}
          <Card className="border-border bg-surface">
            <CardHeader className="pb-3 border-b border-border/60">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-burgundy" />
                <CardTitle className="text-sm font-semibold">Executive Summary</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-3">
              {editing ? (
                <Textarea
                  value={execSummary}
                  onChange={(e) => setExecSummary(e.target.value)}
                  rows={4}
                  className="text-sm leading-relaxed"
                />
              ) : (
                <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
                  {summary.executiveSummary || 'No executive summary text available.'}
                </p>
              )}

              {/* Purpose */}
              <div className="pt-2 border-t border-border/60">
                <div className="text-xs font-semibold text-ink-muted mb-1 flex items-center gap-1.5">
                  <Target className="h-3.5 w-3.5 text-burgundy" />
                  Meeting Purpose
                </div>
                {editing ? (
                  <Input
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    className="text-xs h-8"
                  />
                ) : (
                  <p className="text-xs text-ink">{summary.meetingPurpose || 'General discussion'}</p>
                )}
              </div>

              {/* Topics */}
              {mainTopics.length > 0 && (
                <div className="pt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-ink-muted mr-1">Topics:</span>
                  {mainTopics.map((topic, i) => (
                    <Badge key={i} variant="outline" className="text-xs font-normal">
                      {topic}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Discussion Points & Takeaways */}
          {discussionPoints.length > 0 && (
            <Card className="border-border bg-surface">
              <CardHeader className="pb-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-burgundy" />
                  <CardTitle className="text-sm font-semibold">Important Discussion Points</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {discussionPoints.map((dp, i) => (
                    <div
                      key={i}
                      className="p-3 rounded-lg border border-border bg-surface-muted/40 space-y-1"
                    >
                      <div className="text-xs font-semibold text-ink">
                        {dp.topic || `Discussion Point ${i + 1}`}
                      </div>
                      <p className="text-xs text-ink-muted leading-relaxed">
                        {dp.summary || (typeof dp === 'string' ? dp : '')}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Challenges, Risks & Next Steps (Two Column Grid) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Challenges & Risks */}
            <Card className="border-border bg-surface">
              <CardHeader className="pb-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-amber-600" />
                  <CardTitle className="text-sm font-semibold">Challenges & Risks</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-3">
                {challenges.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-ink-muted mb-1.5 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3 text-amber-500" />
                      Challenges & Concerns
                    </div>
                    <ul className="space-y-1">
                      {challenges.map((c, i) => (
                        <li key={i} className="text-xs text-ink flex items-start gap-1.5">
                          <span className="text-ink-muted">•</span>
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {risks.length > 0 && (
                  <div className="pt-2 border-t border-border/60">
                    <div className="text-xs font-semibold text-ink-muted mb-1.5 flex items-center gap-1">
                      <ShieldAlert className="h-3 w-3 text-red-500" />
                      Identified Risks
                    </div>
                    <ul className="space-y-1">
                      {risks.map((r, i) => (
                        <li key={i} className="text-xs text-ink flex items-start gap-1.5">
                          <span className="text-ink-muted">•</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Next Steps */}
            <Card className="border-border bg-surface">
              <CardHeader className="pb-3 border-b border-border/60">
                <div className="flex items-center gap-2">
                  <ListOrdered className="h-4 w-4 text-emerald-600" />
                  <CardTitle className="text-sm font-semibold">Next Steps</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {nextSteps.length > 0 ? (
                  <ul className="space-y-2">
                    {nextSteps.map((step, i) => (
                      <li key={i} className="text-xs text-ink flex items-start gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{step}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-ink-muted">No explicit next steps identified.</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Meeting Minutes Markdown */}
          {summary.minutesMarkdown && (
            <Card className="border-border bg-surface">
              <CardHeader className="pb-3 border-b border-border/60">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-burgundy" />
                    <CardTitle className="text-sm font-semibold">Official Meeting Minutes</CardTitle>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyMinutes}
                    className="h-7 text-xs"
                  >
                    {copiedMinutes ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedMinutes ? 'Copied' : 'Copy Minutes'}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {editing ? (
                  <Textarea
                    value={minutesMd}
                    onChange={(e) => setMinutesMd(e.target.value)}
                    rows={8}
                    className="font-mono text-xs leading-relaxed"
                  />
                ) : (
                  <div className="p-4 rounded-xl border border-border bg-surface-muted/30 font-mono text-xs text-ink whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                    {summary.minutesMarkdown}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

