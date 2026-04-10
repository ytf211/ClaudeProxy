import app from "./app";
import { logger } from "./lib/logger";
import { runStartupHealthCheck } from "./routes/proxy";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  runStartupHealthCheck().catch((err) => logger.error({ err }, "Startup health check failed"));
});

// Disable default 5-minute request timeout — long AI responses must not be cut off.
server.requestTimeout = 0;
server.keepAliveTimeout = 65000;

// ── Graceful shutdown ──────────────────────────────────────────────────────────
// On SIGTERM (Replit deploy / container stop): stop accepting new connections,
// wait up to 30s for in-flight requests (including streams) to finish, then exit.

let isShuttingDown = false;

function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started — draining in-flight requests...");

  // Stop accepting new connections
  server.close((err) => {
    if (err) {
      logger.error({ err }, "Error during graceful shutdown");
      process.exit(1);
    }
    logger.info("All connections closed — exiting cleanly");
    process.exit(0);
  });

  // Hard kill if still alive after 30s
  setTimeout(() => {
    logger.warn("Graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, 30_000).unref(); // .unref() so this timer doesn't keep the event loop alive
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
