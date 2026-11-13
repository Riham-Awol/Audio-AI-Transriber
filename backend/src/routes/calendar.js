import { Router } from 'express';
import { requireAuth, requireOrganization } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { assertValidUuid } from '../middleware/validate.js';
import { calendarService } from '../services/calendarService.js';
import { integrationService } from '../services/integrationService.js';

const router = Router();

router.use(requireAuth);
router.use(requireOrganization);

/**
 * GET /api/calendar/events - List calendar events
 */
router.get(
  '/events',
  asyncHandler(async (req, res) => {
    const { fromDate, toDate } = req.query;
    const events = await calendarService.listEvents(req.organization.id, { fromDate, toDate });
    res.json({ events });
  })
);

/**
 * POST /api/calendar/events - Create manual calendar event
 */
router.post(
  '/events',
  asyncHandler(async (req, res) => {
    const { title, description, locationOrUrl, startTime, endTime, attendees } = req.body || {};
    if (!title || !title.trim()) {
      throw new AppError(400, 'Title is required.', 'VALIDATION_ERROR');
    }
    if (!startTime) {
      throw new AppError(400, 'Start time is required.', 'VALIDATION_ERROR');
    }

    const event = await calendarService.createEvent(req.organization.id, req.user.id, {
      title: title.trim(),
      description,
      locationOrUrl,
      startTime,
      endTime,
      attendees,
    });

    res.status(201).json({ event });
  })
);

/**
 * POST /api/calendar/events/:id/create-meeting - Convert calendar event into scheduled meeting
 */
router.post(
  '/events/:id/create-meeting',
  asyncHandler(async (req, res) => {
    const eventId = assertValidUuid(req.params.id, 'eventId');
    const result = await calendarService.createMeetingFromEvent(
      req.organization.id,
      req.user.id,
      eventId
    );

    res.json({ success: true, ...result });
  })
);

/**
 * POST /api/calendar/sync - Sync events from all connected calendar integrations
 */
router.post(
  '/sync',
  asyncHandler(async (req, res) => {
    const integrations = await integrationService.listIntegrations(req.organization.id);
    const calendarIntegrations = integrations.filter(
      (i) => i.category === 'calendar' && i.status === 'connected'
    );

    let totalSynced = 0;
    const results = [];

    for (const ci of calendarIntegrations) {
      try {
        const syncRes = await integrationService.syncIntegration(
          req.organization.id,
          req.user.id,
          ci.key
        );
        totalSynced += syncRes.syncedCount || 0;
        results.push({ provider: ci.key, success: true, count: syncRes.syncedCount });
      } catch (err) {
        results.push({ provider: ci.key, success: false, error: err.message });
      }
    }

    res.json({
      success: true,
      totalSynced,
      results,
    });
  })
);

export default router;
