'use client';

import { Sparkles } from 'lucide-react';
import { PhaseRoadmapCard } from '@/components/ui/phase-roadmap-card';

export default function GlobalAssistantPage() {
  return (
    <PhaseRoadmapCard
      icon={Sparkles}
      title="Global AI Assistant"
      phaseLabel="Scheduled for Phase 5"
      description="Cross-meeting RAG assistant powered by ChromaDB, nomic-embed-text, and Qwen3.5 via Ollama."
      capabilities={[
        'Search across current, selected, or all authorized meetings',
        'Filter knowledge retrieval by date range and organization',
        'Grounded answers with clickable meeting & timestamp citations',
        'Strict refusal when information is absent from transcripts',
        'Persistent per-meeting & cross-meeting chat sessions',
        'Organization-isolated ChromaDB vector collections',
      ]}
    />
  );
}

