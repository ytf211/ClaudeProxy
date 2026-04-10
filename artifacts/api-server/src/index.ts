import app from "./app";
import { logger } from "./lib/logger";
import { runStartupHealthCheck } from "./routes/proxy";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
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
  // Run provider health checks in the background after startup
  runStartupHealthCheck().catch((err) => logger.error({ err }, "Startup health check failed"));
});

// Disable the default 5-minute request timeout so long-running AI responses
// (e.g. extended thinking, large tool calls) are never cut off by the server.
server.requestTimeout = 0;
server.keepAliveTimeout = 65000;
