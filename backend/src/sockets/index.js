import { Server } from 'socket.io';
import { queryOne } from '../config/database.js';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../services/tokenService.js';

/**
 * Configures authenticated Socket.IO server with strict organization room isolation.
 */
export function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.allowedOrigins,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      const organizationId = socket.handshake.auth?.organizationId;
      if (!token) {
        return next(new Error('Unauthorized socket connection'));
      }

      const decoded = verifyAccessToken(token);
      socket.userId = decoded.sub;

      if (organizationId) {
        const member = await queryOne(
          `SELECT organization_id FROM organization_members
           WHERE organization_id = ? AND user_id = ? AND status = 'active'`,
          [organizationId, decoded.sub]
        );
        if (!member) {
          return next(new Error('Forbidden organization room'));
        }
        socket.organizationId = organizationId;
      }

      return next();
    } catch {
      return next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);
    if (socket.organizationId) {
      socket.join(`org:${socket.organizationId}`);
    }

    socket.on('org:switch', async (nextOrgId) => {
      try {
        const member = await queryOne(
          `SELECT organization_id FROM organization_members
           WHERE organization_id = ? AND user_id = ? AND status = 'active'`,
          [nextOrgId, socket.userId]
        );
        if (!member) return;
        if (socket.organizationId) {
          socket.leave(`org:${socket.organizationId}`);
        }
        socket.organizationId = nextOrgId;
        socket.join(`org:${nextOrgId}`);
      } catch {
        // Ignore invalid switch requests
      }
    });
  });

  return io;
}

