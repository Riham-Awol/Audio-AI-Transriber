import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function PhaseRoadmapCard({ icon: Icon, title, phaseLabel, description, capabilities = [] }) {
  return (
    <div className="space-y-5 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          <p className="text-sm text-ink-muted">{description}</p>
        </div>
        <Badge variant="midnight">{phaseLabel}</Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 text-burgundy" />}
            Module Architecture & Roadmap
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-ink-muted">
            Phase 1 delivers the multi-tenant database schema, authentication, organization
            isolation, dashboard, and meetings management foundation. This module is scheduled in
            the phased rollout below:
          </p>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-sm">
            {capabilities.map((cap) => (
              <li
                key={cap}
                className="rounded-lg border border-border bg-surface-subtle px-3.5 py-2.5 text-xs font-medium text-ink"
              >
                {cap}
              </li>
            ))}
          </ul>
          <div className="pt-2 flex flex-wrap gap-2">
            <Link href="/meetings">
              <Button variant="outline" size="sm">
                Open Meetings Workspace
              </Button>
            </Link>
            <Link href="/dashboard">
              <Button size="sm">Back to Dashboard</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

