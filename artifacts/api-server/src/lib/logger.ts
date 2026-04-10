import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";
export const debugLog = process.env.DEBUG_LOG === "true" || process.env.DEBUG_LOG === "1";

export const logger = pino({
  level: debugLog ? "debug" : (process.env.LOG_LEVEL ?? "info"),
  // In debug mode expose all headers (auth values are partially redacted in proxy.ts itself)
  redact: debugLog
    ? []
    : ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
  ...(isProduction && !debugLog
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, ignore: "hostname,pid" },
        },
      }),
});
