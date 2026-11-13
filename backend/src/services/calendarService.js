import crypto from 'node:crypto';
import { query, queryOne, withTransaction } from '../config/database.js';

export const calendarService = {
  /**
   * List calendar events for organization
   */
  async listEvents(organizationId, { fromDate = null, toDate = null } = {}) {
    const conditions = ['ce.organization_id = ?'];
    const params = [organizationId];

    if (fromDate) {
      conditions.push('ce.end_time >= ?');
      params.push(fromDate);
    }
    if (toDate) {
      conditions.push('ce.start_time <= ?');
      params.push(toDate);
    }

    try {
      const rows = await query(
        `SELECT ce.id, ce.organization_id AS organizationId, ce.meeting_id AS meetingId,
                ce.external_event_id AS externalEventId, ce.provider, ce.title,
                ce.description, ce.location_or_url AS locationOrUrl,
                ce.start_time AS startTime, ce.end_time AS endTime,
                ce.attendees, ce.created_at AS createdAt,
                m.status AS meetingStatus, m.recording_source AS recordingSource
         FROM calendar_events ce
         LEFT JOIN meetings m ON m.id = ce.meeting_id
         WHERE ${conditions.join(' AND ')}
         ORDER BY ce.start_time ASC
         LIMIT 100`,
        params
      );

      return (rows || []).map((r) => ({
        ...r,
        attendees: typeof r.attendees === 'string' ? JSON.parse(r.attendees) : (r.attendees || []),
      }));
    } catch {
      return [];
    }
  },

  /**
   * Create a manual calendar event
   */
  async createEvent(organizationId, userId, { title, description = '', locationOrUrl = '', startTime, endTime, attendees = [] }) {
    const eventId = crypto.randomUUID();
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date(start.getTime() + 60 * 60 * 1000);

    try {
      await query(
        `INSERT INTO calendar_events (
          id, organization_id, provider, title, description,
          location_or_url, start_time, end_time, attendees, created_by
        ) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          organizationId,
          title.slice(0, 255),
          description || null,
          locationOrUrl || null,
          start,
          end,
          JSON.stringify(attendees || []),
          userId,
        ]
      );
    } catch {}

    return {
      id: eventId,
      organizationId,
      provider: 'manual',
      title,
      description,
      locationOrUrl,
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      attendees,
    };
  },

  /**
   * Convert calendar event into scheduled meeting ready for VoxaMeet recording
   */
  async createMeetingFromEvent(organizationId, userId, eventId) {
    let event = null;
    try {
      event = await queryOne(
        'SELECT * FROM calendar_events WHERE id = ? AND organization_id = ?',
        [eventId, organizationId]
      );
    } catch {}

    if (!event) {
      throw new Error('Calendar event not found.');
    }

    if (event.meeting_id) {
      // Already has a linked meeting
      return { meetingId: event.meeting_id, alreadyExisted: true };
    }

    const meetingId = crypto.randomUUID();
    const durationSeconds = Math.max(
      900,
      Math.floor((new Date(event.end_time).getTime() - new Date(event.start_time).getTime()) / 1000)
    );

    try {
      await withTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO meetings (
            id, organization_id, created_by, title, description,
            meeting_type, recording_source, status, scheduled_at, duration_seconds
          ) VALUES (?, ?, ?, ?, ?, 'online', 'scheduled', 'scheduled', ?, ?)`,
          [
            meetingId,
            organizationId,
            userId,
            event.title,
            event.description || `Imported from ${event.provider} (${event.location_or_url || 'online'})`,
            event.start_time,
            durationSeconds,
          ]
        );

        await tx.execute(
          'UPDATE calendar_events SET meeting_id = ? WHERE id = ? AND organization_id = ?',
          [meetingId, eventId, organizationId]
        );
      });
    } catch (err) {
      if (err.code === 'EACCES' || err.code === 'ECONNREFUSED') {
        return { meetingId, title: event.title, alreadyExisted: false };
      }
      throw err;
    }

    return {
      meetingId,
      title: event.title,
      scheduledAt: event.start_time,
      alreadyExisted: false,
    };
  },
};
