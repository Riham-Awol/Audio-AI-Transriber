'use client';

import { Plug } from 'lucide-react';
import { PhaseRoadmapCard } from '@/components/ui/phase-roadmap-card';

export default function IntegrationsPage() {
  return (
    <PhaseRoadmapCard
      icon={Plug}
      title="Integrations Marketplace"
      phaseLabel="Scheduled for Phase 6"
      description="Official OAuth 2.0 integrations for Zoom, Google Meet, Microsoft Teams, Calendar, Slack, and Jira."
      capabilities={[
        'Zoom, Google Meet & Microsoft Teams cloud recording import',
        'Google Calendar & Outlook Calendar event synchronization',
        'Slack meeting summary & action item notifications',
        'Jira, Trello & Asana issue creation from action items',
        'Google Drive & Dropbox recording storage connectors',
        'Encrypted OAuth token vault & refresh lifecycle logs',
      ]}
    />
  );
}

