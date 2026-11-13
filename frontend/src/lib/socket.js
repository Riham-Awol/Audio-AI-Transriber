'use client';

import { io } from 'socket.io-client';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';

let socketInstance = null;

export function connectSocket(token, organizationId) {
  if (!token) return null;

  if (socketInstance) {
    socketInstance.auth = { token, organizationId };
    if (!socketInstance.connected) {
      socketInstance.connect();
    } else if (organizationId) {
      socketInstance.emit('org:switch', organizationId);
    }
    return socketInstance;
  }

  socketInstance = io(SOCKET_URL, {
    auth: { token, organizationId },
    transports: ['websocket', 'polling'],
    autoConnect: true,
  });

  return socketInstance;
}

export function disconnectSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

export function getSocket() {
  return socketInstance;
}

