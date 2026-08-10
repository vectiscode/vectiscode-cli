import * as Sentry from "@sentry/node";

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: 0.25
  });
} else {
  const log = (await import("./services/logger.js")).createLogger({ service: "server" });
  log.warn("SENTRY_DSN not configured - errors will not be tracked remotely");
}

import { createServer } from "http";
import { createApp } from "./app.js";
import { socketService } from "./services/socket.js";
import { assertReleaseReadyForProduction } from "./services/releaseReadiness.js";
import { config } from "./services/config.js";
import { discordBot } from "./services/discordBot.js";
import { createLogger } from "./services/logger.js";

const log = createLogger({ service: "server" });

assertReleaseReadyForProduction();

const port = Number(process.env.PORT ?? 8787);
const app = await createApp();
const server = createServer(app);

server.requestTimeout = 120_000;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 65_000;

socketService.init(server);

discordBot.start().catch((error) => {
  log.error("Failed to start Discord bot", { error: String(error) });
});

server.listen(port, "0.0.0.0", () => {
  log.info("API listening", { host: "0.0.0.0", port });
  log.info("WebSockets enabled", { host: "0.0.0.0", port });
});

const shutdown = (signal: NodeJS.Signals) => {
  log.info("Received signal, shutting down", { signal });
  discordBot.stop().catch(() => undefined);
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("unhandledRejection", (reason) => {
  log.error("Unhandled promise rejection", { reason: String(reason) });
  Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
});

process.on("uncaughtException", (error) => {
  log.error("Uncaught exception", { error: String(error) });
  Sentry.captureException(error);
  // Give Sentry time to flush before the forced exit
  setTimeout(() => process.exit(1), 2000).unref();
  process.exit(1);
});
