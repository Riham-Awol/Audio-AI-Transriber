'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { humanizeEnum } from '@/lib/utils';

export function MeetingActivityChart({ data = [] }) {
  const maxCount = Math.max(1, ...data.map((d) => Number(d.meetingCount || 0)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meeting Activity (Last 14 Days)</CardTitle>
        <span className="text-xs text-ink-muted">Real database records</span>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="h-44 flex items-center justify-center text-xs text-ink-muted">
            No meeting activity recorded in the last 14 days.
          </div>
        ) : (
          <div className="h-44 flex items-end gap-2 pt-4">
            {data.map((point) => {
              const count = Number(point.meetingCount || 0);
              const pct = Math.max(10, Math.round((count / maxCount) * 100));
              const label = new Date(point.day).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
              });
              return (
                <div key={String(point.day)} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                  <span className="text-[11px] font-medium text-ink">{count}</span>
                  <div className="w-full max-w-[34px] h-28 flex items-end rounded-md bg-surface-muted/70 overflow-hidden">
                    <div
                      className="w-full rounded-t-md bg-burgundy transition-all duration-300"
                      style={{ height: `${pct}%` }}
                      title={`${label}: ${count} meetings (${point.totalMinutes}m)`}
                    />
                  </div>
                  <span className="text-[10px] text-ink-muted truncate max-w-full">{label}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function MeetingDurationChart({ data = [] }) {
  const maxMinutes = Math.max(1, ...data.map((d) => Number(d.totalMinutes || 0)));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Meeting Duration by Type</CardTitle>
        <span className="text-xs text-ink-muted">Minutes recorded</span>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="h-44 flex items-center justify-center text-xs text-ink-muted">
            No meeting duration data yet.
          </div>
        ) : (
          <div className="space-y-4 py-1">
            {data.map((row) => {
              const mins = Number(row.totalMinutes || 0);
              const widthPct = Math.max(4, Math.round((mins / maxMinutes) * 100));
              return (
                <div key={row.meetingType} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-ink">
                      {humanizeEnum(row.meetingType)} ({row.count})
                    </span>
                    <span className="text-ink-muted">{mins} min</span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-surface-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-midnight dark:bg-burgundy transition-all duration-300"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

