import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import actionItemsRoutes from './routes/actionItems.js';
import assistantRoutes from './routes/assistant.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import healthRoutes from './routes/health.js';
import internalRoutes from './routes/internal.js';
import meetingsRoutes from './routes/meetings.js';
import notificationsRoutes from './routes/notifications.js';
import organizationsRoutes from './routes/organizations.js';
import recordingsRoutes from './routes/recordings.js';
import searchRoutes from './routes/search.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || env.allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error('CORS origin not allowed'));
      },
      credentials: true,
    })
  );

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  if (env.nodeEnv !== 'test') {
    app.use(morgan(env.isProduction ? 'combined' : 'dev'));
  }

  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 40,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authentication attempts. Please try again later.',
      },
    },
  });

  app.use('/api', globalLimiter);
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/organizations', organizationsRoutes);
  app.use('/api/dashboard', dashboardRoutes);
  app.use('/api/meetings', meetingsRoutes);
  app.use('/api/recordings', recordingsRoutes);
  app.use('/api/internal', internalRoutes);
  app.use('/api/assistant', assistantRoutes);
  app.use('/api/action-items', actionItemsRoutes);
  app.use('/api/notifications', notificationsRoutes);
  app.use('/api/search', searchRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

