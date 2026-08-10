import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { store } from './store.js';
import { isAllowedOrigin } from './config.js';
import type { AgentRunEvent } from '../types.js';

interface Client {
  ws: WebSocket;
  userId: string;
  isAlive: boolean;
}

class SocketService {
  private wss: WebSocketServer | null = null;
  private clients: Set<Client> = new Set();
  private heartbeat?: NodeJS.Timeout;
  private readonly maxClientsPerUser = 5;

  init(server: Server) {
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', async (ws, req) => {
      const originHeader = req.headers.origin;
      const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
      if (origin && !isAllowedOrigin(origin)) {
        ws.close(1008, "Origin not allowed");
        return;
      }

      const userId = await this.userIdFromCookie(req.headers.cookie);

      if (!userId) {
        ws.close(1008, "Authenticated session required");
        return;
      }

      const existing = [...this.clients].filter((client) => client.userId === userId);
      if (existing.length >= this.maxClientsPerUser) {
        ws.close(1013, "Too many active connections");
        return;
      }

      const client: Client = { ws, userId, isAlive: true };
      this.clients.add(client);

      ws.on('pong', () => {
        client.isAlive = true;
      });

      ws.on('error', () => {
        this.clients.delete(client);
      });

      ws.on('close', () => {
        this.clients.delete(client);
      });
    });

    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (client.ws.readyState !== WebSocket.OPEN) {
          this.clients.delete(client);
          continue;
        }

        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(client);
          continue;
        }

        client.isAlive = false;
        client.ws.ping();
      }
    }, 30_000);

    this.wss.on('close', () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
    });
  }

  private async userIdFromCookie(header?: string) {
    if (!header) return undefined;
    const cookie = header
      .split(';')
      .map((item) => item.trim())
      .find((item) => item.startsWith('ras_session='));
    if (!cookie) return undefined;
    const sessionId = decodeURIComponent(cookie.slice('ras_session='.length));
    return (await store.resolveAuthSessionUser(sessionId))?.id;
  }

  broadcast(userId: string, type: string, payload: any) {
    const message = JSON.stringify({ type, payload });
    for (const client of this.clients) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  notifyUpdate(userId: string) {
    this.broadcast(userId, 'update', { timestamp: Date.now() });
  }

  notifyChatContent(userId: string, payload: { threadId: string; content: string; done: boolean }) {
    this.broadcast(userId, 'chat_content', { ...payload, timestamp: Date.now() });
  }

  notifyChatReasoning(userId: string, payload: { threadId: string; content: string; done?: boolean }) {
    this.broadcast(userId, 'chat_reasoning', { ...payload, timestamp: Date.now() });
  }

  notifyChatProgress(userId: string, payload: {
    threadId: string;
    stage: string;
    label: string;
    detail?: string;
    elapsedMs: number;
    model?: string;
    thinkingLevel?: string;
    planning?: "running" | "skipped" | "completed";
  }) {
    this.broadcast(userId, 'chat_progress', {
      ...payload,
      timestamp: Date.now()
    });
  }

  notifyAgentRunEvent(userId: string, threadId: string, event: AgentRunEvent) {
    this.broadcast(userId, 'agent_run_event', { threadId, agentRunEvent: event, timestamp: Date.now() });
  }
}

export const socketService = new SocketService();
