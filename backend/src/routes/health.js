import { Router } from 'express';
import { checkDatabaseHealth } from '../config/database.js';
import { env } from '../config/env.js';

const router = Router();

router.get('/', async (_req, res) => {
  const db = await checkDatabaseHealth();
  const statusCode = db.connected ? 200 : 503;

  res.status(statusCode).json({
    status: db.connected ? 'ok' : 'degraded',
    service: 'voxameet-backend',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
    checks: {
      mysql: db,
    },
  });
});

export default router;

