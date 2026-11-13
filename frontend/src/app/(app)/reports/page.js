'use client';

import { BarChart3 } from 'lucide-react';
import { PhaseRoadmapCard } from '@/components/ui/phase-roadmap-card';

export default function ReportsPage() {
  return (
    <PhaseRoadmapCard
      icon={BarChart3}
      title="Reports & Exports"
      phaseLabel="Scheduled for Phases 3 & 7"
      description="Branded PDF, DOCX, TXT, and CSV executive reports and organization-wide analytics."
      capabilities={[
        'Executive Summary & Detailed Meeting Minutes (PDF / DOCX)',
        'Full Speaker-Labeled Transcript Exports (PDF / DOCX / TXT)',
        'Decisions & Action Items CSV Export',
        'Customizable section selection & enterprise print layout',
        'Cross-team meeting volume & task completion analytics',
        'Audit log & compliance reporting',
      ]}
    />
  );
}

