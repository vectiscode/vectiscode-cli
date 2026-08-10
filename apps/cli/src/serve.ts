import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { sessionStore } from "@vectiscode/core";

export interface ServeOptions {
  host?: string;
  port?: number;
  authToken?: string;
}

function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

function jsonResponse(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  response.end(payload);
}

function handleRequest(request: IncomingMessage, response: ServerResponse, authToken?: string): void {
  if (authToken) {
    const header = request.headers.authorization;
    if (header !== `Bearer ${authToken}`) {
      jsonResponse(response, 401, { error: "unauthorized" });
      return;
    }
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1:4097"}`);
  if (url.pathname === "/health") {
    jsonResponse(response, 200, { ok: true, service: "vectiscode" });
    return;
  }
  if (url.pathname === "/sessions" && request.method === "GET") {
    jsonResponse(response, 200, { sessions: sessionStore.listSessions().slice(0, 50) });
    return;
  }
  if (url.pathname.startsWith("/sessions/") && request.method === "GET") {
    const id = url.pathname.slice("/sessions/".length);
    const session = sessionStore.getSession(id) ?? sessionStore.resolveSession(id);
    if (!session) {
      jsonResponse(response, 404, { error: "session not found" });
      return;
    }
    jsonResponse(response, 200, { session, events: sessionStore.readEvents(session.id).slice(-100) });
    return;
  }
  jsonResponse(response, 404, { error: "not found" });
}

export async function startServe(options: ServeOptions = {}): Promise<{ host: string; port: number; close: () => Promise<void> }> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4097;

  if (!isLoopback(host) && !options.authToken) {
    throw new Error("Non-loopback bind requires --auth <token>. Standalone servers bind to 127.0.0.1:4097 by default and require explicit auth for non-loopback access");
  }

  const server = createServer((request, response) => {
    try {
      handleRequest(request, response, options.authToken);
    } catch (error) {
      jsonResponse(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolvePromise());
  });

  return {
    host,
    port,
    close: async () => {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error ? rejectClose(error) : resolveClose()));
      });
    }
  };
}

export async function attachToServer(url: string, authToken?: string): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (authToken) headers.authorization = `Bearer ${authToken}`;
  const response = await fetch(new URL("/health", url).toString(), { headers });
  if (!response.ok) throw new Error(`Attach failed: HTTP ${response.status}`);
  return response.json();
}
