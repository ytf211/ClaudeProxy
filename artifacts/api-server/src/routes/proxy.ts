import { Router, type IRouter, type Request, type Response } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger, debugLog } from "../lib/logger";

const router: IRouter = Router();

const openai = new OpenAI({
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY ?? "dummy",
});

const anthropic = new Anthropic({
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ?? "dummy",
});

// ─── Model lists ──────────────────────────────────────────────────────────────

const OPENAI_MODELS = [
  { id: "gpt-4.1",      provider: "openai" },
  { id: "gpt-4.1-mini", provider: "openai" },
  { id: "gpt-4.1-nano", provider: "openai" },
  { id: "gpt-4o",       provider: "openai" },
  { id: "gpt-4o-mini",  provider: "openai" },
  { id: "o4-mini",      provider: "openai" },
  { id: "o3",           provider: "openai" },
  { id: "o3-mini",      provider: "openai" },
];

const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-6",   provider: "anthropic" },
  { id: "claude-opus-4-5",   provider: "anthropic" },
  { id: "claude-opus-4-1",   provider: "anthropic" },
  { id: "claude-sonnet-4-6", provider: "anthropic" },
  { id: "claude-sonnet-4-5", provider: "anthropic" },
  { id: "claude-haiku-4-5",  provider: "anthropic" },
];

const ALL_MODELS = [...OPENAI_MODELS, ...ANTHROPIC_MODELS];

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function verifyBearer(req: Request, res: Response): boolean {
  const auth = req.headers["authorization"] ?? "";
  const bearerToken = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const xApiKey = (req.headers["x-api-key"] as string) ?? "";
  const token = bearerToken || xApiKey;
  if (!token || token !== process.env.PROXY_API_KEY) {
    res.status(401).json({ error: { message: "Unauthorized", type: "authentication_error" } });
    return false;
  }
  return true;
}

/** x-api-key only (no Authorization header) → treat as Anthropic-style client */
function isAnthropicStyleAuth(req: Request): boolean {
  return !!(req.headers["x-api-key"]) && !req.headers["authorization"];
}

// ─── Model type helpers ───────────────────────────────────────────────────────

function isOpenAIModel(model: string): boolean {
  return model.startsWith("gpt-") || /^o\d/.test(model);
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}

// ─── Request options / beta header ───────────────────────────────────────────

function extractBeta(req: Request): string | undefined {
  return (req.headers["anthropic-beta"] as string | undefined) ?? undefined;
}

function reqOpts(beta?: string): Anthropic.RequestOptions | undefined {
  return beta ? { headers: { "anthropic-beta": beta } } : undefined;
}

/**
 * Extract the thinking config from a request body.
 * Passes through whatever the client sends so we stay forward-compatible
 * with new Anthropic thinking types (adaptive, enabled, disabled).
 */
function getThinkingParam(body: Record<string, unknown>): Anthropic.ThinkingConfigParam | undefined {
  const t = body.thinking;
  if (!t || typeof t !== "object") return undefined;
  return t as Anthropic.ThinkingConfigParam;
}

/**
 * When thinking is active (enabled or adaptive), inject the extended-thinking
 * beta header unless it is already present in the client-supplied header.
 * This ensures /v1/chat/completions clients (e.g. rikkahub) that send thinking
 * params but omit the beta header still work correctly.
 */
function withThinkingBeta(beta: string | undefined, thinking: Anthropic.ThinkingConfigParam | undefined): string | undefined {
  if (!thinking) return beta;
  const type = (thinking as unknown as Record<string, unknown>).type;
  if (type === "disabled") return beta;
  const needed = "interleaved-thinking-2025-05-14";
  if (!beta) return needed;
  if (beta.includes(needed)) return beta;
  return `${beta},${needed}`;
}

// ─── Streaming fallback for non-streaming Anthropic requests ──────────────────

async function createAnthropicMessage(
  params: Anthropic.MessageCreateParams,
  beta?: string,
): Promise<Anthropic.Message> {
  const opts = reqOpts(beta);
  try {
    return await anthropic.messages.create(
      { ...params, stream: false } as Anthropic.MessageCreateParamsNonStreaming,
      opts,
    );
  } catch (err) {
    if (err instanceof Error && err.message.includes("Streaming is required")) {
      const stream = anthropic.messages.stream(params as Anthropic.MessageStreamParams, opts);
      return await stream.finalMessage();
    }
    throw err;
  }
}

// ─── Debug log helpers ────────────────────────────────────────────────────────

function sanitizeBodyForLog(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ["model", "stream", "max_tokens", "max_output_tokens", "temperature",
    "top_p", "stop", "tool_choice", "reasoning_effort"]) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  if (Array.isArray(body.messages)) {
    out.message_count = body.messages.length;
    out.roles = (body.messages as Array<{ role?: string }>).map((m) => m.role ?? "?");
  }
  if (body.input !== undefined) {
    if (typeof body.input === "string") out.input = `[string ${body.input.length}chars]`;
    else if (Array.isArray(body.input)) {
      out.input_items = (body.input as Array<Record<string, unknown>>).map((it) => ({
        type: it.type, role: it.role,
        content_len: typeof it.content === "string" ? it.content.length
          : Array.isArray(it.content) ? it.content.length : 0,
      }));
    }
  }
  if (body.system !== undefined) {
    out.has_system = true;
    if (Array.isArray(body.system)) out.system_blocks = body.system.length;
  }
  if (body.instructions !== undefined) out.has_instructions = true;
  if (Array.isArray(body.tools)) {
    out.tools = (body.tools as Array<Record<string, unknown>>).map((t) => t.name ?? t.type ?? "?");
  }
  return out;
}

function sanitizeHeadersForLog(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const val = Array.isArray(v) ? v.join(", ") : (v ?? "");
    const lk = k.toLowerCase();
    if (["cookie", "set-cookie"].includes(lk)) continue;
    if (["authorization", "x-api-key"].includes(lk)) {
      out[k] = val.length > 4 ? `***${val.slice(-4)}` : "***";
    } else {
      out[k] = val;
    }
  }
  return out;
}

function dbgReq(endpoint: string, req: Request, body: Record<string, unknown>) {
  if (!debugLog) return;
  logger.debug({
    endpoint,
    headers: sanitizeHeadersForLog(req.headers as Record<string, string | undefined>),
    body: sanitizeBodyForLog(body),
  }, `→ ${endpoint}`);
}

function dbgRes(endpoint: string, shape: unknown) {
  if (!debugLog) return;
  logger.debug({ response: shape }, `← ${endpoint}`);
}

// ─── Type aliases ─────────────────────────────────────────────────────────────

// OpenAI v6 changed ChatCompletionTool to a union (FunctionTool | CustomTool).
// We only work with standard function tools, so narrow to the function variant.
type OAIFunctionTool = OpenAI.Chat.Completions.ChatCompletionFunctionTool;
type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type AnthropicTool = Anthropic.Tool;
type AnthropicMessage = Anthropic.MessageParam;

// ─── Format converters: OpenAI → Anthropic ───────────────────────────────────

function openAIToolsToAnthropic(tools: OpenAI.Chat.Completions.ChatCompletionTool[]): AnthropicTool[] {
  return tools
    .filter((t): t is OAIFunctionTool => t.type === "function")
    .map((t) => ({
      name: t.function.name,
      description: t.function.description ?? "",
      input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
    }));
}

/**
 * Convert OpenAI tool_choice to Anthropic ToolChoice.
 * Accepts a loose type since both OAI and Anthropic formats are passed in practice.
 */
function openAIToolChoiceToAnthropic(
  choice: unknown,
): Anthropic.ToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return undefined; // Anthropic has no "none" — omit tool_choice, leave tools empty if needed
  if (choice === "required") return { type: "any" };
  if (typeof choice === "object") {
    const c = choice as Record<string, unknown>;
    if (c.type === "function" && c.function) {
      return { type: "tool", name: (c.function as Record<string, unknown>).name as string };
    }
  }
  return undefined;
}

/**
 * Convert Anthropic tool_choice to OpenAI tool_choice.
 * Used in /v1/messages when routing an Anthropic-format request to an OAI model.
 */
function anthropicToolChoiceToOAI(
  choice: unknown,
): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined {
  if (!choice || typeof choice !== "object") return undefined;
  const c = choice as Record<string, unknown>;
  if (c.type === "auto") return "auto";
  if (c.type === "any") return "required";
  if (c.type === "none") return "none";
  if (c.type === "tool" && c.name) return { type: "function", function: { name: c.name as string } };
  return undefined;
}

function openAIContentToAnthropic(
  content: OAIMessage["content"],
): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: Anthropic.ContentBlockParam[] = [];
  for (const part of content) {
    const p = part as unknown as Record<string, unknown>;
    // Preserve cache_control if the client sends it as an OAI extension
    const cc = p.cache_control as Anthropic.CacheControlEphemeral | undefined;
    if (part.type === "text") {
      const block: Anthropic.TextBlockParam = { type: "text", text: part.text };
      if (cc) block.cache_control = cc;
      parts.push(block);
    } else if (part.type === "image_url") {
      const url =
        typeof part.image_url === "string"
          ? part.image_url
          : (part.image_url as { url: string }).url;
      if (url.startsWith("data:")) {
        const ci = url.indexOf(",");
        const mediaType = url.slice(5, ci).split(";")[0] as
          "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        parts.push({ type: "image", source: { type: "base64", media_type: mediaType, data: url.slice(ci + 1) } });
      } else {
        parts.push({ type: "image", source: { type: "url", url } });
      }
    }
  }
  // Only collapse to plain string if there is exactly one text block with NO cache_control
  if (parts.length === 1 && parts[0].type === "text" && !(parts[0] as Anthropic.TextBlockParam).cache_control) {
    return (parts[0] as Anthropic.TextBlockParam).text;
  }
  return parts;
}

/** Convert OAI-format messages → Anthropic messages + system string */
function openAIMessagesToAnthropic(
  messages: OAIMessage[],
): { system?: string | Anthropic.TextBlockParam[]; messages: AnthropicMessage[] } {
  let system: string | Anthropic.TextBlockParam[] | undefined;
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (typeof msg.content === "string") {
        system = msg.content;
      } else if (Array.isArray(msg.content)) {
        // Support array system content (e.g. with cache_control blocks)
        const blocks: Anthropic.TextBlockParam[] = (msg.content as unknown as Record<string, unknown>[])
          .filter((p) => p.type === "text")
          .map((p) => {
            const block: Anthropic.TextBlockParam = { type: "text", text: p.text as string };
            const cc = p.cache_control as Anthropic.CacheControlEphemeral | undefined;
            if (cc) block.cache_control = cc;
            return block;
          });
        system = blocks.length === 1 && !blocks[0].cache_control ? blocks[0].text : blocks;
      }
      continue;
    }

    if (msg.role === "tool") {
      const last = result[result.length - 1];
      const block: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id ?? "",
        content: typeof msg.content === "string" ? msg.content : "",
      };
      if (last?.role === "user" && Array.isArray(last.content)) {
        (last.content as Anthropic.ToolResultBlockParam[]).push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const contentBlocks: Anthropic.ContentBlockParam[] = [];
      if (typeof msg.content === "string" && msg.content) {
        contentBlocks.push({ type: "text", text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          if (tc.type !== "function") continue;
          const ftc = tc as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(ftc.function.arguments); } catch { input = {}; }
          contentBlocks.push({ type: "tool_use", id: tc.id, name: ftc.function.name, input });
        }
      }
      result.push({ role: "assistant", content: contentBlocks });
      continue;
    }

    if (msg.role === "user") {
      result.push({ role: "user", content: openAIContentToAnthropic(msg.content) });
    }
  }

  return { system, messages: result };
}

/**
 * Convert Anthropic-format messages → OAI messages.
 * Used in /v1/messages when the model is an OpenAI model.
 */
function anthropicMessagesToOAI(
  messages: AnthropicMessage[],
  system?: string,
): OAIMessage[] {
  const result: OAIMessage[] = [];

  if (system) result.push({ role: "system", content: system });

  for (const msg of messages) {
    const role = msg.role as "user" | "assistant";
    const content = msg.content;

    if (typeof content === "string") {
      result.push({ role, content });
      continue;
    }

    if (!Array.isArray(content)) continue;

    if (role === "user") {
      const toolResults = content.filter(
        (b): b is Anthropic.ToolResultBlockParam =>
          (b as Anthropic.ToolResultBlockParam).type === "tool_result",
      );
      const other = content.filter(
        (b) => (b as { type: string }).type !== "tool_result",
      );

      if (other.length > 0) {
        const text = other
          .filter((b): b is Anthropic.TextBlockParam => (b as Anthropic.TextBlockParam).type === "text")
          .map((b) => b.text)
          .join("\n");
        if (text) result.push({ role: "user", content: text });
      }

      for (const tr of toolResults) {
        result.push({
          role: "tool",
          tool_call_id: tr.tool_use_id,
          content: typeof tr.content === "string" ? tr.content : "",
        });
      }
    } else {
      // assistant
      const textBlocks = content.filter(
        (b): b is Anthropic.TextBlockParam => (b as Anthropic.TextBlockParam).type === "text",
      );
      const toolUseBlocks = content.filter(
        (b): b is Anthropic.ToolUseBlockParam => (b as Anthropic.ToolUseBlockParam).type === "tool_use",
      );

      const text = textBlocks.map((b) => b.text).join("\n") || null;
      const tool_calls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = toolUseBlocks.map((b) => ({
        id: b.id,
        type: "function" as const,
        function: { name: b.name, arguments: JSON.stringify(b.input) },
      }));

      result.push({
        role: "assistant",
        content: text,
        ...(tool_calls.length > 0 ? { tool_calls } : {}),
      });
    }
  }

  return result;
}

// ─── Cleaners ─────────────────────────────────────────────────────────────────

function cleanTools(tools: unknown[]): unknown[] {
  return tools.map((t) => {
    const tool = { ...(t as Record<string, unknown>) };
    if (tool.type === "custom") delete tool.type;
    if (tool.input_schema == null) tool.input_schema = { type: "object", properties: {} };
    return tool;
  });
}

function cleanSystemBlocks(system: unknown): unknown {
  if (!system || typeof system === "string") return system;
  if (!Array.isArray(system)) return system;
  return system.map((block: Record<string, unknown>) => {
    if (block.cache_control && typeof block.cache_control === "object") {
      const { scope: _scope, ...restCC } = block.cache_control as Record<string, unknown>;
      const cleaned = { ...block, cache_control: Object.keys(restCC).length > 0 ? restCC : undefined };
      if (!cleaned.cache_control) delete (cleaned as Record<string, unknown>).cache_control;
      return cleaned;
    }
    return block;
  });
}

function cleanMessages(messages: unknown[]): unknown[] {
  return messages.map((msg) => {
    const m = msg as Record<string, unknown>;
    if (m.role !== "assistant" || !Array.isArray(m.content)) return m;
    const cleaned = (m.content as Record<string, unknown>[])
      .map((block) => {
        if (block.type !== "thinking") return block;
        const sig = (block.signature as string | undefined) ?? "";
        const think = (block.thinking as string | undefined) ?? "";
        if (!sig && !think) return null;
        if (!sig) return { type: "text", text: `<thinking>\n${think}\n</thinking>` };
        return block;
      })
      .filter(Boolean);
    return { ...m, content: cleaned };
  });
}

/** Extract plain system string from Anthropic system field (string | TextBlock[]) */
function systemToString(system: unknown): string | undefined {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return (system as Array<Record<string, unknown>>)
      .filter((b) => b.type === "text")
      .map((b) => b.text as string)
      .join("\n") || undefined;
  }
  return undefined;
}

// ─── Responses API converters ─────────────────────────────────────────────────

function responsesInputToAnthropic(
  input: unknown,
  instructions?: string,
): { system?: string; messages: AnthropicMessage[] } {
  const system = instructions || undefined;

  if (typeof input === "string") {
    return { system, messages: [{ role: "user", content: input }] };
  }
  if (!Array.isArray(input)) return { system, messages: [] };

  const messages: AnthropicMessage[] = [];
  for (const item of input as Array<Record<string, unknown>>) {
    if (item.type !== "message") continue;
    const role = item.role as "user" | "assistant";
    const content = item.content;

    if (typeof content === "string") {
      messages.push({ role, content });
    } else if (Array.isArray(content)) {
      const parts: Anthropic.ContentBlockParam[] = [];
      for (const part of content as Array<Record<string, unknown>>) {
        const t = part.type as string;
        if (["input_text", "output_text", "text"].includes(t)) {
          parts.push({ type: "text", text: part.text as string });
        } else if (t === "input_image") {
          const imgUrl = part.image_url as { url: string } | string;
          const url = typeof imgUrl === "string" ? imgUrl : imgUrl.url;
          if (url.startsWith("data:")) {
            const ci = url.indexOf(",");
            const mediaType = url.slice(5, ci).split(";")[0] as
              "image/jpeg" | "image/png" | "image/gif" | "image/webp";
            parts.push({ type: "image", source: { type: "base64", media_type: mediaType, data: url.slice(ci + 1) } });
          } else {
            parts.push({ type: "image", source: { type: "url", url } });
          }
        }
      }
      const c = parts.length === 1 && parts[0].type === "text"
        ? (parts[0] as Anthropic.TextBlockParam).text
        : parts;
      messages.push({ role, content: c });
    }
  }
  return { system, messages };
}

function responsesToolsToAnthropic(tools: Array<Record<string, unknown>>): AnthropicTool[] {
  return tools
    .filter((t) => t.type === "function")
    .map((t) => ({
      name: t.name as string,
      description: (t.description as string) ?? "",
      input_schema: (t.parameters as Anthropic.Tool.InputSchema) ?? { type: "object", properties: {} },
    }));
}

function responsesToolsToOAI(tools: Array<Record<string, unknown>>): OAIFunctionTool[] {
  return tools
    .filter((t) => t.type === "function")
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.name as string,
        description: (t.description as string) ?? "",
        parameters: (t.parameters as Record<string, unknown>) ?? { type: "object", properties: {} },
      },
    }));
}

function anthropicToResponses(resp: Anthropic.Message): Record<string, unknown> {
  const outputItems: Record<string, unknown>[] = [];
  const contentParts: Record<string, unknown>[] = [];

  for (const block of resp.content) {
    if (block.type === "text") {
      contentParts.push({ type: "output_text", text: block.text });
    } else if (block.type === "tool_use") {
      outputItems.push({
        type: "function_call", id: `fc_${block.id}`, call_id: block.id,
        name: block.name, arguments: JSON.stringify(block.input), status: "completed",
      });
    }
  }
  if (contentParts.length > 0) {
    outputItems.unshift({ type: "message", id: resp.id, role: "assistant", content: contentParts, status: "completed" });
  }
  return {
    id: `resp_${resp.id}`, object: "response",
    created_at: Math.floor(Date.now() / 1000), status: "completed", model: resp.model,
    output: outputItems,
    usage: { input_tokens: resp.usage.input_tokens, output_tokens: resp.usage.output_tokens, total_tokens: resp.usage.input_tokens + resp.usage.output_tokens },
  };
}

function chatCompletionToResponses(c: OpenAI.Chat.Completions.ChatCompletion): Record<string, unknown> {
  const choice = c.choices[0];
  const msgId = `msg_${c.id}`;
  const outputItems: Record<string, unknown>[] = [];
  const contentParts: Record<string, unknown>[] = [];

  if (choice?.message?.content) contentParts.push({ type: "output_text", text: choice.message.content });
  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      if (tc.type !== "function") continue;
      const ftc = tc as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
      outputItems.push({ type: "function_call", id: `fc_${ftc.id}`, call_id: ftc.id, name: ftc.function.name, arguments: ftc.function.arguments, status: "completed" });
    }
  }
  if (contentParts.length > 0) {
    outputItems.unshift({ type: "message", id: msgId, role: "assistant", content: contentParts, status: "completed" });
  }
  return {
    id: `resp_${c.id}`, object: "response", created_at: c.created, status: "completed", model: c.model,
    output: outputItems,
    usage: { input_tokens: c.usage?.prompt_tokens ?? 0, output_tokens: c.usage?.completion_tokens ?? 0, total_tokens: c.usage?.total_tokens ?? 0 },
  };
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────

function sseHeaders(res: Response) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /v1/models
// x-api-key (Anthropic-style) → Claude models only
// Authorization: Bearer (OAI-style) → all models
router.get("/models", (req, res) => {
  if (!verifyBearer(req, res)) return;
  const anthropicOnly = isAnthropicStyleAuth(req);
  const list = anthropicOnly ? ANTHROPIC_MODELS : ALL_MODELS;
  if (debugLog) logger.debug({ anthropicOnly, count: list.length }, "GET /v1/models");
  res.json({ object: "list", data: list.map((m) => ({ id: m.id, object: "model", created: 0, owned_by: m.provider })) });
});

// ─── POST /v1/chat/completions ────────────────────────────────────────────────

router.post("/chat/completions", async (req, res) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as Record<string, unknown>;
  const model = (body.model as string) ?? "";
  const stream = body.stream === true;
  const beta = extractBeta(req);

  dbgReq("/v1/chat/completions", req, body);

  try {
    if (isAnthropicModel(model)) {
      const { system, messages } = openAIMessagesToAnthropic((body.messages as OAIMessage[]) ?? []);
      const rawTools = body.tools as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined;
      const tools = rawTools ? openAIToolsToAnthropic(rawTools) : undefined;
      const toolChoice = openAIToolChoiceToAnthropic(body.tool_choice);
      const maxTokens = (body.max_tokens as number | undefined) ?? 8192;
      const thinking = getThinkingParam(body);
      const effectiveBeta = withThinkingBeta(beta, thinking);
      // Sampling params
      const temperature = body.temperature as number | undefined;
      const topP = body.top_p as number | undefined;
      const topK = body.top_k as number | undefined;
      const rawStop = body.stop_sequences ?? body.stop;
      const stopSequences = rawStop ? (Array.isArray(rawStop) ? rawStop as string[] : [rawStop as string]) : undefined;

      if (stream) {
        sseHeaders(res);
        const id = `chatcmpl-${Date.now()}`;
        let inputTokens = 0, outputTokens = 0;

        const s = anthropic.messages.stream({
          model, system,
          messages: cleanMessages(messages) as AnthropicMessage[],
          ...(tools ? { tools: cleanTools(tools) as AnthropicTool[] } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          ...(thinking ? { thinking } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(topP !== undefined ? { top_p: topP } : {}),
          ...(topK !== undefined ? { top_k: topK } : {}),
          ...(stopSequences ? { stop_sequences: stopSequences } : {}),
          max_tokens: maxTokens,
        }, reqOpts(effectiveBeta));

        for await (const e of s) {
          const ts = Math.floor(Date.now() / 1000);
          if (e.type === "message_start") {
            inputTokens = e.message.usage.input_tokens;
            res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: ts, model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`);
          } else if (e.type === "content_block_start" && e.content_block.type === "tool_use") {
            res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: ts, model, choices: [{ index: 0, delta: { tool_calls: [{ index: e.index, id: e.content_block.id, type: "function", function: { name: e.content_block.name, arguments: "" } }] }, finish_reason: null }] })}\n\n`);
          } else if (e.type === "content_block_delta") {
            if (e.delta.type === "text_delta") {
              res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: ts, model, choices: [{ index: 0, delta: { content: e.delta.text }, finish_reason: null }] })}\n\n`);
            } else if (e.delta.type === "input_json_delta") {
              res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: ts, model, choices: [{ index: 0, delta: { tool_calls: [{ index: e.index, function: { arguments: e.delta.partial_json } }] }, finish_reason: null }] })}\n\n`);
            }
          } else if (e.type === "message_delta") {
            outputTokens = e.usage.output_tokens;
            const fr = e.delta.stop_reason === "tool_use" ? "tool_calls" : "stop";
            res.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: ts, model, choices: [{ index: 0, delta: {}, finish_reason: fr }], usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens } })}\n\n`);
          }
        }
        res.write("data: [DONE]\n\n");
        res.end();
        dbgRes("/v1/chat/completions", { stream: true, model });

      } else {
        const r = await createAnthropicMessage({
          model, system,
          messages: cleanMessages(messages) as AnthropicMessage[],
          ...(tools ? { tools: cleanTools(tools) as AnthropicTool[] } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          ...(thinking ? { thinking } : {}),
          ...(temperature !== undefined ? { temperature } : {}),
          ...(topP !== undefined ? { top_p: topP } : {}),
          ...(topK !== undefined ? { top_k: topK } : {}),
          ...(stopSequences ? { stop_sequences: stopSequences } : {}),
          max_tokens: maxTokens,
        }, effectiveBeta);

        const textContent = r.content.map((b) => b.type === "text" ? b.text : "").join("") || null;
        const toolCalls = r.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } }));
        const fr = r.stop_reason === "tool_use" ? "tool_calls" : "stop";

        const resp = {
          id: r.id, object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
          choices: [{ index: 0, message: { role: "assistant", content: textContent, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: fr }],
          usage: { prompt_tokens: r.usage.input_tokens, completion_tokens: r.usage.output_tokens, total_tokens: r.usage.input_tokens + r.usage.output_tokens },
        };
        dbgRes("/v1/chat/completions", { model, stop_reason: r.stop_reason, usage: resp.usage });
        res.json(resp);
      }

    } else if (isOpenAIModel(model)) {
      const messages = (body.messages as OAIMessage[]) ?? [];
      const maxTokens = (body.max_tokens as number | undefined) ?? 8192;
      const rawTools = body.tools as OAIFunctionTool[] | undefined;
      const toolChoice = body.tool_choice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined;
      // Sampling & generation params — pass through whatever the client sends
      const oaiExtra: Record<string, unknown> = {};
      for (const k of ["temperature", "top_p", "seed", "stop", "presence_penalty", "frequency_penalty", "response_format", "reasoning_effort"]) {
        if (body[k] !== undefined) oaiExtra[k] = body[k];
      }

      if (stream) {
        sseHeaders(res);
        const s = await openai.chat.completions.create({
          model, messages,
          ...(rawTools ? { tools: rawTools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          ...oaiExtra,
          max_completion_tokens: maxTokens, stream: true,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);
        for await (const chunk of s) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        dbgRes("/v1/chat/completions", { stream: true, model });
      } else {
        const c = await openai.chat.completions.create({
          model, messages,
          ...(rawTools ? { tools: rawTools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          ...oaiExtra,
          max_completion_tokens: maxTokens, stream: false,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
        dbgRes("/v1/chat/completions", { model, finish_reason: c.choices[0]?.finish_reason, usage: c.usage });
        res.json(c);
      }

    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error" } });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    logger.error({ err }, "Error in /v1/chat/completions");
    if (res.headersSent) { res.write(`data: ${JSON.stringify({ error: { message: msg } })}\n\n`); res.end(); }
    else res.status(500).json({ error: { message: msg, type: "server_error" } });
  }
});

// ─── POST /v1/messages ────────────────────────────────────────────────────────

router.post("/messages", async (req, res) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as Record<string, unknown>;
  const model = (body.model as string) ?? "";
  const stream = body.stream === true;
  const beta = extractBeta(req);

  dbgReq("/v1/messages", req, body);

  // Strip fields that Anthropic doesn't accept
  const { output_config: _oc, stream_options: _so, reasoning_effort: _re, ...cleanBody } =
    body as Record<string, unknown>;

  try {
    if (isAnthropicModel(model)) {
      const rawMessages = (cleanBody.messages as unknown[]) ?? [];
      const cleanedMessages = cleanMessages(rawMessages) as AnthropicMessage[];
      const cleanedSystem = cleanSystemBlocks(cleanBody.system);
      const rawTools = cleanBody.tools as unknown[] | undefined;
      const cleanedTools = rawTools ? cleanTools(rawTools) : undefined;
      // thinking passes through via cleanBody spread; we only need the beta injection
      const thinkingParam = getThinkingParam(cleanBody);
      const effectiveBeta = withThinkingBeta(beta, thinkingParam);

      const params: Anthropic.MessageCreateParams = {
        ...(cleanBody as Omit<Anthropic.MessageCreateParams, "model" | "max_tokens" | "messages">),
        model,
        max_tokens: (cleanBody.max_tokens as number | undefined) ?? 8192,
        messages: cleanedMessages,
        system: cleanedSystem as Anthropic.MessageCreateParams["system"],
        ...(cleanedTools ? { tools: cleanedTools as AnthropicTool[] } : {}),
        stream,
      };

      if (stream) {
        sseHeaders(res);
        const s = anthropic.messages.stream(params as Anthropic.MessageStreamParams, reqOpts(effectiveBeta));
        for await (const e of s) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
        res.end();
        dbgRes("/v1/messages", { stream: true, model });
      } else {
        const r = await createAnthropicMessage(params, effectiveBeta);
        dbgRes("/v1/messages", { model, stop_reason: r.stop_reason, usage: r.usage });
        res.json(r);
      }

    } else if (isOpenAIModel(model)) {
      // /v1/messages sends Anthropic-format body → convert to OAI for OpenAI models
      const rawMessages = (cleanBody.messages as AnthropicMessage[]) ?? [];
      const systemStr = systemToString(cleanBody.system);
      const oaiMessages = anthropicMessagesToOAI(rawMessages, systemStr);
      const maxTokens = (cleanBody.max_tokens as number | undefined) ?? 8192;

      const rawTools = cleanBody.tools as AnthropicTool[] | undefined;
      const oaiTools: OAIFunctionTool[] | undefined = rawTools?.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description ?? "", parameters: t.input_schema as Record<string, unknown> },
      }));

      const oaiToolChoice = anthropicToolChoiceToOAI(cleanBody.tool_choice);

      // Sampling params (Anthropic field names, passed to OAI)
      const oaiSampling: Record<string, unknown> = {};
      if (cleanBody.temperature !== undefined) oaiSampling.temperature = cleanBody.temperature;
      if (cleanBody.top_p !== undefined) oaiSampling.top_p = cleanBody.top_p;

      if (stream) {
        sseHeaders(res);
        const msgId = `msg_${Date.now()}`;

        // Emit Anthropic SSE preamble
        res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: msgId, type: "message", role: "assistant", content: [], model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`);
        res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);

        // Real streaming — emit each delta as it arrives
        const s = await openai.chat.completions.create({
          model, messages: oaiMessages,
          ...(oaiTools ? { tools: oaiTools } : {}),
          ...(oaiToolChoice ? { tool_choice: oaiToolChoice } : {}),
          ...oaiSampling,
          max_completion_tokens: maxTokens, stream: true,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming);

        for await (const chunk of s) {
          const text = chunk.choices[0]?.delta?.content;
          if (text) {
            res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })}\n\n`);
          }
        }

        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
        res.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
        res.end();
        dbgRes("/v1/messages", { stream: true, model });

      } else {
        const c = await openai.chat.completions.create({
          model, messages: oaiMessages,
          ...(oaiTools ? { tools: oaiTools } : {}),
          ...(oaiToolChoice ? { tool_choice: oaiToolChoice } : {}),
          ...oaiSampling,
          max_completion_tokens: maxTokens, stream: false,
        } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
        const choice = c.choices[0];
        const content: Anthropic.ContentBlockParam[] = [];
        if (choice?.message?.content) content.push({ type: "text", text: choice.message.content });
        if (choice?.message?.tool_calls) {
          for (const tc of choice.message.tool_calls) {
            if (tc.type !== "function") continue;
            const ftc = tc as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(ftc.function.arguments); } catch { input = {}; }
            content.push({ type: "tool_use", id: ftc.id, name: ftc.function.name, input });
          }
        }
        const stopReason = choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn";
        // Return Anthropic-shaped response
        const resp = {
          id: c.id, type: "message", role: "assistant", content, model,
          stop_reason: stopReason, stop_sequence: null,
          usage: { input_tokens: c.usage?.prompt_tokens ?? 0, output_tokens: c.usage?.completion_tokens ?? 0 },
        };
        dbgRes("/v1/messages", { model, stop_reason: stopReason });
        res.json(resp);
      }

    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error" } });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    logger.error({ err }, "Error in /v1/messages");
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "server_error", message: msg } })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ type: "error", error: { type: "server_error", message: msg } });
    }
  }
});

// ─── POST /v1/responses  (OpenAI Responses API) ───────────────────────────────

router.post("/responses", async (req, res) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as Record<string, unknown>;
  const model = (body.model as string) ?? "";
  const stream = body.stream === true;
  const beta = extractBeta(req);
  const maxTokens = (body.max_output_tokens as number | undefined) ?? 8192;

  dbgReq("/v1/responses", req, body);

  const writeSSE = (type: string, data: Record<string, unknown>) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);

  try {
    if (isAnthropicModel(model)) {
      const { system, messages } = responsesInputToAnthropic(body.input, body.instructions as string | undefined);
      const rawTools = body.tools as Array<Record<string, unknown>> | undefined;
      const tools = rawTools ? responsesToolsToAnthropic(rawTools) : undefined;
      const cleanedTools = tools ? (cleanTools(tools as unknown[]) as AnthropicTool[]) : undefined;
      const thinking = getThinkingParam(body);
      const effectiveBeta = withThinkingBeta(beta, thinking);

      const params: Anthropic.MessageCreateParams = {
        model, max_tokens: maxTokens,
        messages: cleanMessages(messages) as AnthropicMessage[],
        system: system as string | undefined,
        ...(cleanedTools ? { tools: cleanedTools } : {}),
        ...(thinking ? { thinking } : {}),
        stream,
      };

      if (stream) {
        sseHeaders(res);
        const now = Date.now();
        const msgId = `msg_${now}`;
        const respId = `resp_${now}`;
        const createdAt = Math.floor(now / 1000);
        const baseResp = { id: respId, object: "response", created_at: createdAt, status: "in_progress", model, output: [] };

        writeSSE("response.created", { response: baseResp });
        writeSSE("response.output_item.added", { output_index: 0, item: { type: "message", id: msgId, role: "assistant", content: [], status: "in_progress" } });
        writeSSE("response.content_part.added", { item_id: msgId, output_index: 0, content_index: 0, part: { type: "output_text", text: "" } });

        const s = anthropic.messages.stream(params as Anthropic.MessageStreamParams, reqOpts(effectiveBeta));
        let fullText = "", inputTokens = 0, outputTokens = 0;

        for await (const e of s) {
          if (e.type === "message_start") inputTokens = e.message.usage.input_tokens;
          else if (e.type === "content_block_delta" && e.delta.type === "text_delta") {
            fullText += e.delta.text;
            writeSSE("response.output_text.delta", { item_id: msgId, output_index: 0, content_index: 0, delta: e.delta.text });
          } else if (e.type === "message_delta") outputTokens = e.usage.output_tokens;
        }

        writeSSE("response.output_text.done", { item_id: msgId, output_index: 0, content_index: 0, text: fullText });
        writeSSE("response.content_part.done", { item_id: msgId, output_index: 0, content_index: 0, part: { type: "output_text", text: fullText } });
        writeSSE("response.output_item.done", { output_index: 0, item: { type: "message", id: msgId, role: "assistant", content: [{ type: "output_text", text: fullText }], status: "completed" } });
        writeSSE("response.completed", {
          response: { ...baseResp, status: "completed", output: [{ type: "message", id: msgId, role: "assistant", content: [{ type: "output_text", text: fullText }], status: "completed" }], usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens } },
        });
        res.end();
        dbgRes("/v1/responses", { stream: true, model });

      } else {
        const r = await createAnthropicMessage(params, effectiveBeta);
        const result = anthropicToResponses(r);
        dbgRes("/v1/responses", { model, status: "completed" });
        res.json(result);
      }

    } else if (isOpenAIModel(model)) {
      const { system, messages } = responsesInputToAnthropic(body.input, body.instructions as string | undefined);
      const oaiMessages: OAIMessage[] = system
        ? [{ role: "system", content: system }, ...(messages as OAIMessage[])]
        : (messages as OAIMessage[]);
      const rawTools = body.tools as Array<Record<string, unknown>> | undefined;
      const oaiTools = rawTools ? responsesToolsToOAI(rawTools) : undefined;

      if (stream) {
        sseHeaders(res);
        const now = Date.now();
        const msgId = `msg_${now}`;
        const respId = `resp_${now}`;
        const createdAt = Math.floor(now / 1000);
        const baseResp = { id: respId, object: "response", created_at: createdAt, status: "in_progress", model, output: [] };

        writeSSE("response.created", { response: baseResp });
        writeSSE("response.output_item.added", { output_index: 0, item: { type: "message", id: msgId, role: "assistant", content: [], status: "in_progress" } });
        writeSSE("response.content_part.added", { item_id: msgId, output_index: 0, content_index: 0, part: { type: "output_text", text: "" } });

        const s = await openai.chat.completions.create({
          model, messages: oaiMessages,
          ...(oaiTools ? { tools: oaiTools } : {}),
          max_completion_tokens: maxTokens, stream: true,
        });

        let fullText = "";
        for await (const chunk of s) {
          const delta = chunk.choices[0]?.delta?.content;
          if (delta) {
            fullText += delta;
            writeSSE("response.output_text.delta", { item_id: msgId, output_index: 0, content_index: 0, delta });
          }
        }

        writeSSE("response.output_text.done", { item_id: msgId, output_index: 0, content_index: 0, text: fullText });
        writeSSE("response.content_part.done", { item_id: msgId, output_index: 0, content_index: 0, part: { type: "output_text", text: fullText } });
        writeSSE("response.output_item.done", { output_index: 0, item: { type: "message", id: msgId, role: "assistant", content: [{ type: "output_text", text: fullText }], status: "completed" } });
        writeSSE("response.completed", {
          response: { ...baseResp, status: "completed", output: [{ type: "message", id: msgId, role: "assistant", content: [{ type: "output_text", text: fullText }], status: "completed" }] },
        });
        res.end();
        dbgRes("/v1/responses", { stream: true, model });

      } else {
        const c = await openai.chat.completions.create({
          model, messages: oaiMessages,
          ...(oaiTools ? { tools: oaiTools } : {}),
          max_completion_tokens: maxTokens, stream: false,
        }) as OpenAI.Chat.Completions.ChatCompletion;
        const result = chatCompletionToResponses(c);
        dbgRes("/v1/responses", { model, status: "completed" });
        res.json(result);
      }

    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error" } });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal server error";
    logger.error({ err }, "Error in /v1/responses");
    if (res.headersSent) { writeSSE("error", { error: { type: "server_error", message: msg } }); res.end(); }
    else res.status(500).json({ error: { message: msg, type: "server_error" } });
  }
});

export default router;
