/**
 * /v1beta transparent proxy → Replit Gemini backend
 *
 * Allows native Google GenAI SDK clients to point at this proxy:
 *   new GoogleGenAI({ apiKey: PROXY_API_KEY, httpOptions: { baseUrl: PROXY_URL } })
 *
 * Auth accepted:
 *   x-goog-api-key: <PROXY_API_KEY>   (Google GenAI SDK default)
 *   Authorization: Bearer <PROXY_API_KEY>
 *   x-api-key: <PROXY_API_KEY>
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const GEMINI_MODELS = [
  {
    name: "models/gemini-3.1-pro-preview",
    baseModelId: "gemini-3.1-pro-preview",
    version: "001",
    displayName: "Gemini 3.1 Pro Preview",
    description: "Gemini 3.1 Pro Preview model.",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    supportedGenerationMethods: ["generateContent", "countTokens", "streamGenerateContent"],
    temperature: 1,
    topP: 0.95,
    topK: 64,
  },
  {
    name: "models/gemini-3-flash-preview",
    baseModelId: "gemini-3-flash-preview",
    version: "001",
    displayName: "Gemini 3 Flash Preview",
    description: "Gemini 3 Flash Preview model.",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    supportedGenerationMethods: ["generateContent", "countTokens", "streamGenerateContent"],
    temperature: 1,
    topP: 0.95,
    topK: 64,
  },
  {
    name: "models/gemini-2.5-pro",
    baseModelId: "gemini-2.5-pro",
    version: "001",
    displayName: "Gemini 2.5 Pro",
    description: "Gemini 2.5 Pro model with enhanced reasoning.",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    supportedGenerationMethods: ["generateContent", "countTokens", "streamGenerateContent"],
    temperature: 1,
    topP: 0.95,
    topK: 64,
  },
  {
    name: "models/gemini-2.5-flash",
    baseModelId: "gemini-2.5-flash",
    version: "001",
    displayName: "Gemini 2.5 Flash",
    description: "Fast and efficient Gemini 2.5 Flash model.",
    inputTokenLimit: 1048576,
    outputTokenLimit: 65536,
    supportedGenerationMethods: ["generateContent", "countTokens", "streamGenerateContent"],
    temperature: 1,
    topP: 0.95,
    topK: 64,
  },
];

function verifyKey(req: Request, res: Response): boolean {
  const expected = process.env.PROXY_API_KEY;
  if (!expected) {
    res.status(500).json({ error: { code: "INTERNAL", message: "PROXY_API_KEY not configured" } });
    return false;
  }
  const googKey = req.headers["x-goog-api-key"] as string | undefined;
  const apiKey  = req.headers["x-api-key"] as string | undefined;
  const auth    = req.headers["authorization"] ?? "";
  const bearerKey = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const provided = googKey || apiKey || bearerKey;
  if (!provided || provided !== expected) {
    res.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Unauthorized" } });
    return false;
  }
  return true;
}

// GET /v1beta/models  — list available Gemini models (static, Replit backend doesn't support this endpoint)
router.get("/models", (req: Request, res: Response) => {
  if (!verifyKey(req, res)) return;
  res.json({ models: GEMINI_MODELS });
});

// GET /v1beta/models/:modelId  — get single model info
router.get("/models/:modelId", (req: Request, res: Response) => {
  if (!verifyKey(req, res)) return;
  const modelId = req.params.modelId;
  const model = GEMINI_MODELS.find(
    (m) => m.baseModelId === modelId || m.name === modelId || m.name === `models/${modelId}`
  );
  if (!model) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: `Model ${modelId} not found` } });
    return;
  }
  res.json(model);
});

// Catch-all: proxy everything else to Replit Gemini backend
router.all(/(.*)/, async (req: Request, res: Response) => {
  if (!verifyKey(req, res)) return;

  const backendBase = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const backendKey  = process.env.AI_INTEGRATIONS_GEMINI_API_KEY ?? "dummy";

  if (!backendBase) {
    res.status(503).json({ error: { code: "UNAVAILABLE", message: "Gemini backend not configured" } });
    return;
  }

  // Build target URL: strip leading slash from req.path, append query string
  const queryStr = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const targetPath = req.path.replace(/^\//, "");
  const targetUrl = `${backendBase.replace(/\/$/, "")}/${targetPath}${queryStr}`;

  // Forward headers, swapping auth for the backend key
  const forwardHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-goog-api-key": backendKey,
  };
  for (const [k, v] of Object.entries(req.headers)) {
    const lk = k.toLowerCase();
    if (["host", "authorization", "x-goog-api-key", "x-api-key", "content-length"].includes(lk)) continue;
    if (typeof v === "string") forwardHeaders[lk] = v;
  }

  const hasBody = ["POST", "PUT", "PATCH"].includes(req.method.toUpperCase());

  logger.debug({ method: req.method, targetUrl }, "v1beta proxy");

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: hasBody ? JSON.stringify(req.body) : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg, targetUrl }, "v1beta upstream fetch error");
    res.status(502).json({ error: { code: "UPSTREAM_ERROR", message: msg } });
    return;
  }

  // Copy status and content-type back
  res.status(upstream.status);
  const ct = upstream.headers.get("content-type");
  if (ct) res.setHeader("content-type", ct);

  if (!upstream.body) {
    res.end();
    return;
  }

  // Stream the response body back
  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
});

export default router;
