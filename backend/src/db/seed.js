import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { closePool, queryOne, withTransaction } from '../config/database.js';
import { runMigrations } from './migrate.js';

/**
 * Development-only database seeder.
 * Populates realistic enterprise workspace data so Phase 1 dashboards and CRUD
 * run against real MySQL queries without hardcoded frontend stats.
 */
async function seedDevelopmentData() {
  if (env.isProduction) {
    throw new Error('Development seed script cannot run when NODE_ENV=production.');
  }

  await runMigrations();

  const existing = await queryOne('SELECT id FROM organizations WHERE slug = ?', ['acme-enterprise']);
  if (existing) {
    console.log('Development seed data already exists (acme-enterprise). Skipping.');
    return;
  }

  const passwordHash = await bcrypt.hash('Password123!', 12);

  const adminId = crypto.randomUUID();
  const managerId = crypto.randomUUID();
  const memberId = crypto.randomUUID();
  const orgId = crypto.randomUUID();

  await withTransaction(async (tx) => {
    await tx.execute(
      `INSERT INTO users (id, email, password_hash, full_name, job_title, timezone, email_verified, is_super_admin)
       VALUES
         (?, 'admin@acme-corp.demo', ?, 'Elena Vance', 'VP of Operations', 'America/New_York', 1, 0),
         (?, 'manager@acme-corp.demo', ?, 'Marcus Chen', 'Engineering Manager', 'America/Los_Angeles', 1, 0),
         (?, 'member@acme-corp.demo', ?, 'Priya Patel', 'Senior Product Designer', 'UTC', 1, 0)`,
      [adminId, passwordHash, managerId, passwordHash, memberId, passwordHash]
    );

    await tx.execute(
      `INSERT INTO organizations (id, name, slug, industry, plan_tier, default_vocabulary, created_by)
       VALUES (?, 'Acme Enterprise', 'acme-enterprise', 'Enterprise Software', 'enterprise', ?, ?)`,
      [orgId, JSON.stringify(['WhisperX', 'VoxaMeet', 'Q4 OKRs', 'SOC2']), adminId]
    );

    await tx.execute(
      `INSERT INTO organization_members (id, organization_id, user_id, role, status)
       VALUES
         (?, ?, ?, 'org_admin', 'active'),
         (?, ?, ?, 'manager', 'active'),
         (?, ?, ?, 'member', 'active')`,
      [crypto.randomUUID(), orgId, adminId, crypto.randomUUID(), orgId, managerId, crypto.randomUUID(), orgId, memberId]
    );

    const now = Date.now();
    const dayMs = 86400000;

    const meetings = [
      {
        id: crypto.randomUUID(),
        createdBy: adminId,
        title: 'Q4 Executive Architecture & Security Review',
        description: 'Quarterly review of multi-tenant data isolation, SOC2 compliance controls, and infrastructure scaling.',
        meetingType: 'online',
        recordingSource: 'zoom',
        status: 'completed',
        progress: 100,
        scheduledAt: new Date(now - 5 * dayMs),
        durationSeconds: 3420,
        speakerCount: 4,
        hasTranscript: 1,
        hasSummary: 1,
      },
      {
        id: crypto.randomUUID(),
        createdBy: managerId,
        title: 'Platform Database Migration Sprint Planning',
        description: 'Planning schema rollout, read-replica cutover windows, and rollback verification.',
        meetingType: 'online',
        recordingSource: 'google_meet',
        status: 'completed',
        progress: 100,
        scheduledAt: new Date(now - 3 * dayMs),
        durationSeconds: 2700,
        speakerCount: 3,
        hasTranscript: 1,
        hasSummary: 1,
      },
      {
        id: crypto.randomUUID(),
        createdBy: managerId,
        title: 'Design System & Accessibility Audit',
        description: 'Reviewing contrast ratios, keyboard navigation, and dark mode tokens across the web app.',
        meetingType: 'hybrid',
        recordingSource: 'upload',
        status: 'completed',
        progress: 100,
        scheduledAt: new Date(now - 1 * dayMs),
        durationSeconds: 1980,
        speakerCount: 3,
        hasTranscript: 1,
        hasSummary: 1,
      },
      {
        id: crypto.randomUUID(),
        createdBy: adminId,
        title: 'Enterprise Customer Onboarding Sync',
        description: 'Aligning implementation timeline with customer IT security and SSO setup.',
        meetingType: 'in_person',
        recordingSource: 'microphone',
        status: 'processing',
        progress: 64,
        scheduledAt: new Date(now - 4 * 3600 * 1000),
        durationSeconds: 2150,
        speakerCount: 2,
        hasTranscript: 0,
        hasSummary: 0,
      },
      {
        id: crypto.randomUUID(),
        createdBy: memberId,
        title: 'Weekly Product & Engineering Sync',
        description: 'Upcoming roadmap checkpoint for Phase 2 recording and transcription milestones.',
        meetingType: 'online',
        recordingSource: 'scheduled',
        status: 'scheduled',
        progress: 0,
        scheduledAt: new Date(now + 2 * dayMs),
        durationSeconds: 0,
        speakerCount: 0,
        hasTranscript: 0,
        hasSummary: 0,
      },
      {
        id: crypto.randomUUID(),
        createdBy: adminId,
        title: 'Board Deck & Financial Forecast Prep',
        description: 'Preparing Q1 operational metrics and SaaS expansion KPIs.',
        meetingType: 'in_person',
        recordingSource: 'scheduled',
        status: 'scheduled',
        progress: 0,
        scheduledAt: new Date(now + 4 * dayMs),
        durationSeconds: 0,
        speakerCount: 0,
        hasTranscript: 0,
        hasSummary: 0,
      },
    ];

    for (const m of meetings) {
      await tx.execute(
        `INSERT INTO meetings (
          id, organization_id, created_by, title, description, meeting_type,
          recording_source, status, processing_progress, scheduled_at,
          started_at, duration_seconds, speaker_count, has_transcript, has_summary
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          m.id,
          orgId,
          m.createdBy,
          m.title,
          m.description,
          m.meetingType,
          m.recordingSource,
          m.status,
          m.progress,
          m.scheduledAt,
          m.status === 'scheduled' ? null : m.scheduledAt,
          m.durationSeconds,
          m.speakerCount,
          m.hasTranscript,
          m.hasSummary,
        ]
      );
    }

    // Add summaries and action items for completed meetings so dashboard widgets reflect real rows
    const completedMeetings = meetings.filter((m) => m.hasSummary === 1);
    for (const m of completedMeetings) {
      await tx.execute(
        `INSERT INTO meeting_summaries (
          id, organization_id, meeting_id, detail_level, model_name,
          executive_summary, meeting_purpose, main_topics, next_steps
        ) VALUES (?, ?, ?, 'standard', 'qwen3.5:9b', ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          orgId,
          m.id,
          `Aligned stakeholders on deliverables and ownership for ${m.title}.`,
          m.description,
          JSON.stringify(['Architecture & Milestones', 'Ownership & Timelines', 'Risk Mitigation']),
          JSON.stringify(['Circulate follow-up notes', 'Track action items to completion']),
        ]
      );
    }

    const actionItems = [
      {
        meetingId: meetings[0].id,
        assigneeId: managerId,
        assigneeName: 'Marcus Chen',
        title: 'Finalize MySQL row-level organization isolation audit tests',
        priority: 'high',
        status: 'in_progress',
        dueDate: new Date(now + 3 * dayMs).toISOString().slice(0, 10),
      },
      {
        meetingId: meetings[1].id,
        assigneeId: adminId,
        assigneeName: 'Elena Vance',
        title: 'Approve production cutover maintenance window',
        priority: 'urgent',
        status: 'pending',
        dueDate: new Date(now + 2 * dayMs).toISOString().slice(0, 10),
      },
      {
        meetingId: meetings[2].id,
        assigneeId: memberId,
        assigneeName: 'Priya Patel',
        title: 'Verify WCAG AA contrast on burgundy primary CTA in dark mode',
        priority: 'medium',
        status: 'completed',
        dueDate: new Date(now - 1 * dayMs).toISOString().slice(0, 10),
      },
      {
        meetingId: meetings[2].id,
        assigneeId: memberId,
        assigneeName: 'Priya Patel',
        title: 'Document collapsible sidebar keyboard shortcuts',
        priority: 'low',
        status: 'pending',
        dueDate: null,
      },
    ];

    for (const item of actionItems) {
      await tx.execute(
        `INSERT INTO meeting_action_items (
          id, organization_id, meeting_id, assignee_user_id, assignee_name,
          title, priority, status, due_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          orgId,
          item.meetingId,
          item.assigneeId,
          item.assigneeName,
          item.title,
          item.priority,
          item.status,
          item.dueDate,
        ]
      );
    }

    await tx.execute(
      `INSERT INTO notifications (id, organization_id, user_id, type, title, message, entity_type, entity_id)
       VALUES (?, ?, ?, 'summary_generated', 'Meeting workspace initialized', 'Acme Enterprise workspace and sample meetings are ready.', 'organization', ?)`,
      [crypto.randomUUID(), orgId, adminId, orgId]
    );
  });

  console.log('Development seed completed for Acme Enterprise.');
  console.log('Demo login: admin@acme-corp.demo / Password123!');
}

seedDevelopmentData()
  .then(async () => {
    await closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Seed failed:', err.message);
    await closePool();
    process.exit(1);
  });

