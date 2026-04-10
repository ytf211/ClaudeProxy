import crypto from "node:crypto";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import router from "./routes";
import proxyRouter from "./routes/proxy";
import v1betaRouter from "./routes/v1beta";
import { logger } from "./lib/logger";

const app: Express = express();

// ── Security headers (Helmet) ─────────────────────────────────────────────────
// Disable CSP — pure API, no HTML served.
// Disable COEP — not relevant for API responses.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// ── Request ID ────────────────────────────────────────────────────────────────
// Assign a short unique ID to every request; expose it in the response header
// so clients / users can reference it when reporting issues.
app.use(
  pinoHttp({
    logger,
    genReqId: () => `req-${crypto.randomUUID().slice(0, 8)}`,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Expose request ID in the response so callers can reference it
app.use((req: Request, res: Response, next: NextFunction) => {
  const id = (req as unknown as { id: string }).id;
  if (id) res.setHeader("X-Request-Id", id);
  next();
});

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-api-key",
    "x-goog-api-key",
    "anthropic-version",
    "anthropic-beta",
    "x-stainless-arch",
    "x-stainless-lang",
    "x-stainless-os",
    "x-stainless-package-version",
    "x-stainless-runtime",
    "x-stainless-runtime-version",
  ],
  credentials: false,
}));

// ── Response compression ──────────────────────────────────────────────────────
// Skip compression for SSE (text/event-stream) — chunked streaming must not be
// buffered by gzip. Check both Accept and Content-Type headers to be safe.
app.use(compression({
  filter: (req: Request, res: Response) => {
    const accept = req.headers["accept"] ?? "";
    if (accept.includes("text/event-stream")) return false;
    const ct = (res.getHeader("Content-Type") as string) ?? "";
    if (ct.includes("text/event-stream")) return false;
    return compression.filter(req, res);
  },
}));

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api", router);
app.use("/v1", proxyRouter);
app.use("/v1beta", v1betaRouter);

export default app;
