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

/**
 * Strips text/content from a request body, keeping only structural metadata.
 * Safe to log — no conversation content is included.
 */
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
    if (typeof body.input === "string") {
      out.input = `[string ${body.input.length}chars]`;
    } else if (Array.isArray(body.input)) {
      out.input_items = (body.input as Array<Record<string, unknown>>).map((it) => ({
        type: it.type,
        role: it.role,
        content_len: typeof it.content === "string"
          ? it.content.length
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
    out.tools = (body.tools as Array<Record<string, unknown>>)
      .map((t) => t.name ?? t.type ?? "?");
  }

  return out;
}

/**
 * Returns a headers object safe to log:
 * - auth values show only last 4 chars (***xxxx)
 * - cookie / set-cookie are dropped entirely
 */
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

function dbgRes(endpoint: string, statusOrShape: unknown) {
  if (!debugLog) return;
  logger.debug({ response: statusOrShape }, `← ${endpoint}`);
}

// ─── Type aliases ─────────────────────────────────────────────────────────────

type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool;
type AnthropicTool = Anthropic.Tool;
type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type AnthropicMessage = Anthropic.MessageParam;

// ─── Format converters: OpenAI → Anthropic ───────────────────────────────────

function openAIToolsToAnthropic(tools: OpenAITool[]): AnthropicTool[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description ?? "",
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));
}

function openAIToolChoiceToAnthropic(
  choice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined,
): Anthropic.ToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return { type: "auto" };
  if (choice === "required") return { type: "any" };
  if (typeof choice === "object" && choice.function) {
    return { type: "tool", name: choice.function.name };
  }
  return undefined;
}

function openAIContentToAnthropic(
  content: OpenAIMessage["content"],
): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: Anthropic.ContentBlockParam[] = [];
  for (const part of content) {
    if (part.type === "text") {
      parts.push({ type: "text", text: part.text });
    } else if (part.type === "image_url") {
      const url =
        typeof part.image_url === "string"
          ? part.image_url
          : (part.image_url as { url: string }).url;
      if (url.startsWith("data:")) {
        const commaIdx = url.indexOf(",");
        const meta = url.slice(5, commaIdx);
        const mediaType = meta.split(";")[0] as
          | "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        const data = url.slice(commaIdx + 1);
        parts.push({ type: "image", source: { type: "base64", media_type: mediaType, data } });
      } else {
        parts.push({ type: "image", source: { type: "url", url } });
      }
    }
  }
  return parts.length === 1 && parts[0].type === "text"
    ? (parts[0] as Anthropic.TextBlockParam).text
    : parts;
}

function openAIMessagesToAnthropic(
  messages: OpenAIMessage[],
): { system?: string; messages: AnthropicMessage[] } {
  let system: string | undefined;
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      system = typeof msg.content === "string" ? msg.content : "";
      continue;
    }

    if (msg.role === "tool") {
      const last = result[result.length - 1];
      const block: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: msg.tool_call_id ?? "",
        content: typeof msg.content === "string" ? msg.content : "",
      };
      if (last && last.role === "user" && Array.isArray(last.content)) {
        (last.content as Anthropic.ToolResultBlockParam[]).push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (msg.role === "assistant") {
      const contentBlocks: Anthropic.ContentBlock[] = [];
      if (typeof msg.content === "string" && msg.content) {
        contentBlocks.push({ type: "text", text: msg.content });
      }
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
          contentBlocks.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
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

    const cleanedContent = (m.content as Record<string, unknown>[])
      .map((block) => {
        if (block.type !== "thinking") return block;
        const signature = (block.signature as string | undefined) ?? "";
        const thinking = (block.thinking as string | undefined) ?? "";
        if (!signature && !thinking) return null;
        if (!signature && thinking) {
          return { type: "text", text: `<thinking>\n${thinking}\n</thinking>` };
        }
        return block;
      })
      .filter(Boolean);

    return { ...m, content: cleanedContent };
  });
}

// ─── Responses API converters ─────────────────────────────────────────────────

/**
 * Convert OpenAI Responses API `input` + `instructions` → Anthropic messages format.
 *
 * Responses API input types:
 *   - string  → single user text message
 *   - array of { type:"message", role, content: string | ContentPart[] }
 *
 * ContentPart types: input_text, output_text, text, input_image
 */
function responsesInputToAnthropic(
  input: unknown,
  instructions?: string,
): { system?: string; messages: AnthropicMessage[] } {
  const system = instructions || undefined;

  if (typeof input === "string") {
    return { system, messages: [{ role: "user", content: input }] };
  }

  if (!Array.isArray(input)) {
    return { system, messages: [] };
  }

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
        if (t === "input_text" || t === "output_text" || t === "text") {
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
        // Ignore refusal, audio, etc.
      }
      const anthropicContent = parts.length === 1 && parts[0].type === "text"
        ? (parts[0] as Anthropic.TextBlockParam).text
        : parts;
      messages.push({ role, content: anthropicContent });
    }
  }

  return { system, messages };
}

/**
 * Convert Responses API tool list to Anthropic tools.
 * Responses API tool format: { type:"function", name, description, parameters, strict? }
 * (no .function wrapper — that's Chat Completions format)
 */
function responsesToolsToAnthropic(tools: Array<Record<string, unknown>>): AnthropicTool[] {
  return tools
    .filter((t) => t.type === "function")
    .map((t) => ({
      name: t.name as string,
      description: (t.description as string) ?? "",
      input_schema: (t.parameters as Anthropic.Tool.InputSchema) ?? { type: "object", properties: {} },
    }));
}

/** Convert Responses API tool list to OpenAI Chat Completions tools */
function responsesToolsToOAI(tools: Array<Record<string, unknown>>): OpenAITool[] {
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

/** Build a Responses API response object from an Anthropic Message */
function anthropicToResponses(resp: Anthropic.Message): Record<string, unknown> {
  const msgId = resp.id;
  const outputItems: Record<string, unknown>[] = [];
  const contentParts: Record<string, unknown>[] = [];

  for (const block of resp.content) {
    if (block.type === "text") {
      contentParts.push({ type: "output_text", text: block.text });
    } else if (block.type === "tool_use") {
      outputItems.push({
        type: "function_call",
        id: `fc_${block.id}`,
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input),
        status: "completed",
      });
    }
  }

  if (contentParts.length > 0) {
    outputItems.unshift({
      type: "message",
      id: msgId,
      role: "assistant",
      content: contentParts,
      status: "completed",
    });
  }

  return {
    id: `resp_${msgId}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: resp.model,
    output: outputItems,
    usage: {
      input_tokens: resp.usage.input_tokens,
      output_tokens: resp.usage.output_tokens,
      total_tokens: resp.usage.input_tokens + resp.usage.output_tokens,
    },
  };
}

/** Build a Responses API response object from an OpenAI Chat Completion */
function chatCompletionToResponses(
  completion: OpenAI.Chat.Completions.ChatCompletion,
): Record<string, unknown> {
  const choice = completion.choices[0];
  const msgId = `msg_${completion.id}`;
  const outputItems: Record<string, unknown>[] = [];
  const contentParts: Record<string, unknown>[] = [];

  if (choice?.message?.content) {
    contentParts.push({ type: "output_text", text: choice.message.content });
  }

  if (choice?.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      outputItems.push({
        type: "function_call",
        id: `fc_${tc.id}`,
        call_id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
        status: "completed",
      });
    }
  }

  if (contentParts.length > 0) {
    outputItems.unshift({
      type: "message",
      id: msgId,
      role: "assistant",
      content: contentParts,
      status: "completed",
    });
  }

  return {
    id: `resp_${completion.id}`,
    object: "response",
    created_at: completion.created,
    status: "completed",
    model: completion.model,
    output: outputItems,
    usage: {
      input_tokens: completion.usage?.prompt_tokens ?? 0,
      output_tokens: completion.usage?.completion_tokens ?? 0,
      total_tokens: completion.usage?.total_tokens ?? 0,
    },
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /v1/models
// If client used x-api-key (Anthropic style) → return only Claude models
// If client used Authorization: Bearer (OpenAI style) → return all models
router.get("/models", (req, res) => {
  if (!verifyBearer(req, res)) return;

  const anthropicOnly = isAnthropicStyleAuth(req);
  const list = anthropicOnly ? ANTHROPIC_MODELS : ALL_MODELS;

  if (debugLog) logger.debug({ anthropicOnly, count: list.length }, "GET /v1/models");

  res.json({
    object: "list",
    data: list.map((m) => ({ id: m.id, object: "model", created: 0, owned_by: m.provider })),
  });
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
      const { system, messages } = openAIMessagesToAnthropic(
        (body.messages as OpenAIMessage[]) ?? [],
      );
      const tools = body.tools ? openAIToolsToAnthropic(body.tools as OpenAITool[]) : undefined;
      const toolChoice = openAIToolChoiceToAnthropic(
        body.tool_choice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined,
      );
      const maxTokens = (body.max_tokens as number | undefined) ?? 8192;

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const anthropicStream = anthropic.messages.stream(
          {
            model,
            system,
            messages: cleanMessages(messages) as AnthropicMessage[],
            ...(tools ? { tools: cleanTools(tools) as AnthropicTool[] } : {}),
            ...(toolChoice ? { tool_choice: toolChoice } : {}),
            max_tokens: maxTokens,
          },
          reqOpts(beta),
        );

        let inputTokens = 0, outputTokens = 0;
        const completionId = `chatcmpl-${Date.now()}`;

        for await (const event of anthropicStream) {
          if (event.type === "message_start") {
            inputTokens = event.message.usage.input_tokens;
            res.write(`data: ${JSON.stringify({
              id: completionId, object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000), model,
              choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
            })}\n\n`);
          } else if (event.type === "content_block_start") {
            if (event.content_block.type === "tool_use") {
              res.write(`data: ${JSON.stringify({
                id: completionId, object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000), model,
                choices: [{ index: 0, delta: { tool_calls: [{ index: event.index, id: event.content_block.id, type: "function", function: { name: event.content_block.name, arguments: "" } }] }, finish_reason: null }],
              })}\n\n`);
            }
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              res.write(`data: ${JSON.stringify({
                id: completionId, object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000), model,
                choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }],
              })}\n\n`);
            } else if (event.delta.type === "input_json_delta") {
              res.write(`data: ${JSON.stringify({
                id: completionId, object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000), model,
                choices: [{ index: 0, delta: { tool_calls: [{ index: event.index, function: { arguments: event.delta.partial_json } }] }, finish_reason: null }],
              })}\n\n`);
            }
          } else if (event.type === "message_delta") {
            outputTokens = event.usage.output_tokens;
            const finishReason = event.delta.stop_reason === "tool_use" ? "tool_calls" : "stop";
            res.write(`data: ${JSON.stringify({
              id: completionId, object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000), model,
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
              usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
            })}\n\n`);
          }
        }

        res.write("data: [DONE]\n\n");
        res.end();
        dbgRes("/v1/chat/completions", { stream: true, model });
      } else {
        const anthropicResp = await createAnthropicMessage({
          model, system,
          messages: cleanMessages(messages) as AnthropicMessage[],
          ...(tools ? { tools: cleanTools(tools) as AnthropicTool[] } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          max_tokens: maxTokens,
        }, beta);

        const oaiContent = anthropicResp.content
          .map((b) => (b.type === "text" ? b.text : "")).join("") || null;

        const toolCalls = anthropicResp.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } }));

        const finishReason = anthropicResp.stop_reason === "tool_use" ? "tool_calls" : "stop";
        const resp = {
          id: anthropicResp.id, object: "chat.completion",
          created: Math.floor(Date.now() / 1000), model,
          choices: [{ index: 0, message: { role: "assistant", content: oaiContent, ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) }, finish_reason: finishReason }],
          usage: { prompt_tokens: anthropicResp.usage.input_tokens, completion_tokens: anthropicResp.usage.output_tokens, total_tokens: anthropicResp.usage.input_tokens + anthropicResp.usage.output_tokens },
        };
        dbgRes("/v1/chat/completions", { model, stop_reason: anthropicResp.stop_reason, usage: resp.usage });
        res.json(resp);
      }

    } else if (isOpenAIModel(model)) {
      const messages = (body.messages as OpenAIMessage[]) ?? [];
      const maxTokens = (body.max_tokens as number | undefined) ?? 8192;
      const tools = body.tools as OpenAITool[] | undefined;
      const toolChoice = body.tool_choice as OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined;

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const oaiStream = await openai.chat.completions.create({
          model, messages,
          ...(tools ? { tools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          max_completion_tokens: maxTokens, stream: true,
        });
        for await (const chunk of oaiStream) res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        dbgRes("/v1/chat/completions", { stream: true, model });
      } else {
        const completion = await openai.chat.completions.create({
          model, messages,
          ...(tools ? { tools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          max_completion_tokens: maxTokens, stream: false,
        });
        dbgRes("/v1/chat/completions", { model, finish_reason: completion.choices[0]?.finish_reason, usage: completion.usage });
        res.json(completion);
      }

    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error" } });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Internal server error";
    logger.error({ err }, "Error in /v1/chat/completions");
    if (res.headersSent) { res.write(`data: ${JSON.stringify({ error: { message: errMsg } })}\n\n`); res.end(); }
    else res.status(500).json({ error: { message: errMsg, type: "server_error" } });
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

  const { output_config: _oc, stream_options: _so, reasoning_effort: _re, ...cleanBody } =
    body as Record<string, unknown>;

  try {
    if (isAnthropicModel(model)) {
      const rawMessages = (cleanBody.messages as unknown[]) ?? [];
      const cleanedMessages = cleanMessages(rawMessages) as AnthropicMessage[];
      const cleanedSystem = cleanSystemBlocks(cleanBody.system);
      const rawTools = cleanBody.tools as unknown[] | undefined;
      const cleanedTools = rawTools ? cleanTools(rawTools) : undefined;

      const anthropicParams: Anthropic.MessageCreateParams = {
        ...(cleanBody as Omit<Anthropic.MessageCreateParams, "model" | "max_tokens" | "messages">),
        model,
        max_tokens: (cleanBody.max_tokens as number | undefined) ?? 8192,
        messages: cleanedMessages,
        system: cleanedSystem as Anthropic.MessageCreateParams["system"],
        ...(cleanedTools ? { tools: cleanedTools as AnthropicTool[] } : {}),
        stream,
      };

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const anthropicStream = anthropic.messages.stream(
          anthropicParams as Anthropic.MessageStreamParams,
          reqOpts(beta),
        );
        for await (const event of anthropicStream) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
        dbgRes("/v1/messages", { stream: true, model });
      } else {
        const response = await createAnthropicMessage(anthropicParams, beta);
        dbgRes("/v1/messages", { model, stop_reason: response.stop_reason, usage: response.usage });
        res.json(response);
      }

    } else if (isOpenAIModel(model)) {
      const { system, messages } = openAIMessagesToAnthropic(
        (cleanBody.messages as OpenAIMessage[]) ?? [],
      );
      const allMessages = system
        ? [{ role: "user" as const, content: `[System]: ${system}` }, ...messages]
        : messages;
      const maxTokens = (cleanBody.max_tokens as number | undefined) ?? 8192;
      const rawTools = cleanBody.tools as AnthropicTool[] | undefined;
      const openAITools: OpenAITool[] | undefined = rawTools?.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description ?? "", parameters: t.input_schema as Record<string, unknown> },
      }));

      const anthropicToolChoice = openAIToolChoiceToAnthropic(
        cleanBody.tool_choice as Anthropic.ToolChoice | undefined,
      );
      const oaiToolChoice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined =
        anthropicToolChoice
          ? anthropicToolChoice.type === "auto" ? "auto"
            : anthropicToolChoice.type === "any" ? "required"
            : anthropicToolChoice.type === "tool" ? { type: "function", function: { name: (anthropicToolChoice as Anthropic.ToolChoiceTool).name } }
            : undefined
          : undefined;

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const oaiStream = await openai.chat.completions.create({
          model, messages: allMessages as OpenAIMessage[],
          ...(openAITools ? { tools: openAITools } : {}),
          ...(oaiToolChoice ? { tool_choice: oaiToolChoice } : {}),
          max_completion_tokens: maxTokens, stream: true,
        });
        let buffer = "";
        for await (const chunk of oaiStream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) buffer += delta.content;
        }
        const anthropicStreamResp: Anthropic.Message = {
          id: `msg_${Date.now()}`, type: "message", role: "assistant",
          content: [{ type: "text", text: buffer }], model,
          stop_reason: "end_turn", stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
        res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: anthropicStreamResp })}\n\n`);
        res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: buffer } })}\n\n`);
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
        res.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
        res.end();
        dbgRes("/v1/messages", { stream: true, model });
      } else {
        const completion = await openai.chat.completions.create({
          model, messages: allMessages as OpenAIMessage[],
          ...(openAITools ? { tools: openAITools } : {}),
          ...(oaiToolChoice ? { tool_choice: oaiToolChoice } : {}),
          max_completion_tokens: maxTokens, stream: false,
        });
        const choice = completion.choices[0];
        const content: Anthropic.ContentBlock[] = [];
        if (choice?.message?.content) content.push({ type: "text", text: choice.message.content });
        if (choice?.message?.tool_calls) {
          for (const tc of choice.message.tool_calls) {
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
            content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
          }
        }
        const stopReason = choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn";
        const resp: Anthropic.Message = {
          id: completion.id, type: "message", role: "assistant", content, model,
          stop_reason: stopReason, stop_sequence: null,
          usage: { input_tokens: completion.usage?.prompt_tokens ?? 0, output_tokens: completion.usage?.completion_tokens ?? 0 },
        };
        dbgRes("/v1/messages", { model, stop_reason: stopReason });
        res.json(resp);
      }

    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error" } });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Internal server error";
    logger.error({ err }, "Error in /v1/messages");
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "server_error", message: errMsg } })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ type: "error", error: { type: "server_error", message: errMsg } });
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
      const { system, messages } = responsesInputToAnthropic(
        body.input,
        body.instructions as string | undefined,
      );
      const rawTools = body.tools as Array<Record<string, unknown>> | undefined;
      const tools = rawTools ? responsesToolsToAnthropic(rawTools) : undefined;
      const cleanedTools = tools ? (cleanTools(tools as unknown[]) as AnthropicTool[]) : undefined;

      const anthropicParams: Anthropic.MessageCreateParams = {
        model,
        max_tokens: maxTokens,
        messages: cleanMessages(messages) as AnthropicMessage[],
        system: system as string | undefined,
        ...(cleanedTools ? { tools: cleanedTools } : {}),
        stream,
      };

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const msgId = `msg_${Date.now()}`;
        const respId = `resp_${msgId}`;
        const createdAt = Math.floor(Date.now() / 1000);
        const baseResp = { id: respId, object: "response", created_at: createdAt, status: "in_progress", model, output: [] };

        writeSSE("response.created", { response: baseResp });
        writeSSE("response.output_item.added", { output_index: 0, item: { type: "message", id: msgId, role: "assistant", content: [], status: "in_progress" } });
        writeSSE("response.content_part.added", { item_id: msgId, output_index: 0, content_index: 0, part: { type: "output_text", text: "" } });

        const anthropicStream = anthropic.messages.stream(
          anthropicParams as Anthropic.MessageStreamParams,
          reqOpts(beta),
        );

        let fullText = "";
        let inputTokens = 0, outputTokens = 0;

        for await (const event of anthropicStream) {
          if (event.type === "message_start") {
            inputTokens = event.message.usage.input_tokens;
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullText += event.delta.text;
            writeSSE("response.output_text.delta", { item_id: msgId, output_index: 0, content_index: 0, delta: event.delta.text });
          } else if (event.type === "message_delta") {
            outputTokens = event.usage.output_tokens;
          }
        }

        writeSSE("response.output_text.done", { item_id: msgId, output_index: 0, content_index: 0, text: fullText });
        writeSSE("response.content_part.done", { item_id: msgId, output_index: 0, content_index: 0, part: { type: "output_text", text: fullText } });
        writeSSE("response.output_item.done", { output_index: 0, item: { type: "message", id: msgId, role: "assistant", content: [{ type: "output_text", text: fullText }], status: "completed" } });
        writeSSE("response.completed", {
          response: {
            ...baseResp, status: "completed",
            output: [{ type: "message", id: msgId, role: "assistant", content: [{ type: "output_text", text: fullText }], status: "completed" }],
            usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
          },
        });
        res.end();
        dbgRes("/v1/responses", { stream: true, model });
      } else {
        const response = await createAnthropicMessage(anthropicParams, beta);
        const result = anthropicToResponses(response);
        dbgRes("/v1/responses", { model, status: "completed" });
        res.json(result);
      }

    } else if (isOpenAIModel(model)) {
      const { system, messages } = responsesInputToAnthropic(
        body.input,
        body.instructions as string | undefined,
      );
      const allMessages: OpenAIMessage[] = system
        ? [{ role: "system", content: system }, ...messages as OpenAIMessage[]]
        : messages as OpenAIMessage[];
      const rawTools = body.tools as Array<Record<string, unknown>> | undefined;
      const oaiTools = rawTools ? responsesToolsToOAI(rawTools) : undefined;

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const msgId = `msg_${Date.now()}`;
        const respId = `resp_${Date.now()}`;
        const createdAt = Math.floor(Date.now() / 1000);
        const baseResp = { id: respId, object: "response", created_at: createdAt, status: "in_progress", model, output: [] };

        writeSSE("response.created", { response: baseResp });
        writeSSE("response.output_item.added", { output_index: 0, item: { type: "message", id: msgId, role: "assistant", content: [], status: "in_progress" } });
        writeSSE("response.content_part.added", { item_id: msgId, output_index: 0, content_index: 0, part: { type: "output_text", text: "" } });

        const oaiStream = await openai.chat.completions.create({
          model, messages: allMessages,
          ...(oaiTools ? { tools: oaiTools } : {}),
          max_completion_tokens: maxTokens, stream: true,
        });

        let fullText = "";
        for await (const chunk of oaiStream) {
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
          response: {
            ...baseResp, status: "completed",
            output: [{ type: "message", id: msgId, role: "assistant", content: [{ type: "output_text", text: fullText }], status: "completed" }],
          },
        });
        res.end();
        dbgRes("/v1/responses", { stream: true, model });
      } else {
        const completion = await openai.chat.completions.create({
          model, messages: allMessages,
          ...(oaiTools ? { tools: oaiTools } : {}),
          max_completion_tokens: maxTokens, stream: false,
        }) as OpenAI.Chat.Completions.ChatCompletion;
        const result = chatCompletionToResponses(completion);
        dbgRes("/v1/responses", { model, status: "completed" });
        res.json(result);
      }

    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error" } });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Internal server error";
    logger.error({ err }, "Error in /v1/responses");
    if (res.headersSent) {
      writeSSE("error", { error: { type: "server_error", message: errMsg } });
      res.end();
    } else {
      res.status(500).json({ error: { message: errMsg, type: "server_error" } });
    }
  }
});

export default router;
