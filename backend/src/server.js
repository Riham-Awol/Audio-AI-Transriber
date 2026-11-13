import http from 'node:http';
import { createApp } from './app.js';
import { closePool } from './config/database.js';
import { env } from './config/env.js';
import { closeQueue } from './services/queueService.js';
import { initSocketServer } from './sockets/index.js';

const app = createApp();
const server = http.createServer(app);
const io = initSocketServer(server);
app.set('io', io);

server.listen(env.port, () => {
  console.log(`VoxaMeet AI backend listening on http://localhost:${env.port} (${env.nodeEnv})`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down gracefully...`);
  io.close();
  server.close(async () => {
    await closeQueue();
    await closePool();
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

