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

const OPENAI_MODELS = [
  { id: "gpt-5.2", provider: "openai" },
  { id: "gpt-5-mini", provider: "openai" },
  { id: "gpt-5-nano", provider: "openai" },
  { id: "o4-mini", provider: "openai" },
  { id: "o3", provider: "openai" },
];

const ANTHROPIC_MODELS = [
  { id: "claude-opus-4-6", provider: "anthropic" },
  { id: "claude-sonnet-4-6", provider: "anthropic" },
  { id: "claude-haiku-4-5", provider: "anthropic" },
];

const ALL_MODELS = [...OPENAI_MODELS, ...ANTHROPIC_MODELS];

// ─── helpers ──────────────────────────────────────────────────────────────────

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

function isOpenAIModel(model: string): boolean {
  return model.startsWith("gpt-") || /^o\d/.test(model);
}

function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}

/** Extract the anthropic-beta header forwarded by Claude Code / other clients */
function extractBeta(req: Request): string | undefined {
  return (req.headers["anthropic-beta"] as string | undefined) ?? undefined;
}

/** Build RequestOptions with optional beta header */
function reqOpts(beta?: string): Anthropic.RequestOptions | undefined {
  return beta ? { headers: { "anthropic-beta": beta } } : undefined;
}

/**
 * BUG FIX #1 — Streaming fallback for non-streaming Anthropic requests.
 *
 * Anthropic SDK throws "Streaming is required for operations that may take
 * longer than 10 minutes" when it decides the request is too long.
 * We catch that and fall back to stream → finalMessage().
 */
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
      const stream = anthropic.messages.stream(
        params as Anthropic.MessageStreamParams,
        opts,
      );
      return await stream.finalMessage();
    }
    throw err;
  }
}

// ─── format converters ────────────────────────────────────────────────────────

type OpenAITool = OpenAI.Chat.Completions.ChatCompletionTool;
type AnthropicTool = Anthropic.Tool;
type OpenAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
type AnthropicMessage = Anthropic.MessageParam;

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

/**
 * BUG FIX #2 — user message content can be an array of content parts.
 * rikkahub and many OpenAI-compatible clients send:
 *   content: [{ type: "text", text: "..." }]
 * or image parts:
 *   content: [{ type: "image_url", image_url: { url: "data:..." } }]
 */
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
        const meta = url.slice(5, commaIdx); // e.g. "image/jpeg;base64"
        const mediaType = meta.split(";")[0] as
          | "image/jpeg"
          | "image/png"
          | "image/gif"
          | "image/webp";
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
          try {
            input = JSON.parse(tc.function.arguments);
          } catch {
            input = {};
          }
          contentBlocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
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

function cleanTools(tools: unknown[]): unknown[] {
  return tools.map((t) => {
    const tool = { ...(t as Record<string, unknown>) };
    if (tool.type === "custom") delete tool.type;
    if (tool.input_schema == null) {
      tool.input_schema = { type: "object", properties: {} };
    }
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

// ─── routes ───────────────────────────────────────────────────────────────────

// GET /v1/models
router.get("/models", (req, res) => {
  if (!verifyBearer(req, res)) return;

  const models = ALL_MODELS.map((m) => ({
    id: m.id,
    object: "model",
    created: 0,
    owned_by: m.provider,
  }));

  res.json({ object: "list", data: models });
});

// ─── POST /v1/chat/completions ────────────────────────────────────────────────

router.post("/chat/completions", async (req, res) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as Record<string, unknown>;
  const model = (body.model as string) ?? "";
  const stream = body.stream === true;
  const beta = extractBeta(req);

  if (debugLog) logger.debug({ model, stream }, "chat/completions request");

  try {
    // ── Claude model via /chat/completions ──────────────────────────────────
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

        let inputTokens = 0;
        let outputTokens = 0;
        const completionId = `chatcmpl-${Date.now()}`;

        for await (const event of anthropicStream) {
          if (event.type === "message_start") {
            inputTokens = event.message.usage.input_tokens;
            const chunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          } else if (event.type === "content_block_start") {
            if (event.content_block.type === "tool_use") {
              const chunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{
                  index: 0,
                  delta: {
                    tool_calls: [{
                      index: event.index,
                      id: event.content_block.id,
                      type: "function",
                      function: { name: event.content_block.name, arguments: "" },
                    }],
                  },
                  finish_reason: null,
                }],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              const chunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            } else if (event.delta.type === "input_json_delta") {
              const chunk = {
                id: completionId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model,
                choices: [{
                  index: 0,
                  delta: { tool_calls: [{ index: event.index, function: { arguments: event.delta.partial_json } }] },
                  finish_reason: null,
                }],
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          } else if (event.type === "message_delta") {
            outputTokens = event.usage.output_tokens;
            const finishReason = event.delta.stop_reason === "tool_use" ? "tool_calls" : "stop";
            const chunk = {
              id: completionId,
              object: "chat.completion.chunk",
              created: Math.floor(Date.now() / 1000),
              model,
              choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
              usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        }

        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        // BUG FIX #1: streaming fallback via createAnthropicMessage
        const anthropicResp = await createAnthropicMessage(
          {
            model,
            system,
            messages: cleanMessages(messages) as AnthropicMessage[],
            ...(tools ? { tools: cleanTools(tools) as AnthropicTool[] } : {}),
            ...(toolChoice ? { tool_choice: toolChoice } : {}),
            max_tokens: maxTokens,
          },
          beta,
        );

        const oaiContent =
          anthropicResp.content
            .map((block) => (block.type === "text" ? block.text : ""))
            .join("") || null;

        const toolCalls = anthropicResp.content
          .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
          .map((b) => ({
            id: b.id,
            type: "function",
            function: { name: b.name, arguments: JSON.stringify(b.input) },
          }));

        const finishReason = anthropicResp.stop_reason === "tool_use" ? "tool_calls" : "stop";

        res.json({
          id: anthropicResp.id,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model,
          choices: [{
            index: 0,
            message: {
              role: "assistant",
              content: oaiContent,
              ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
            },
            finish_reason: finishReason,
          }],
          usage: {
            prompt_tokens: anthropicResp.usage.input_tokens,
            completion_tokens: anthropicResp.usage.output_tokens,
            total_tokens: anthropicResp.usage.input_tokens + anthropicResp.usage.output_tokens,
          },
        });
      }

    // ── OpenAI model via /chat/completions ───────────────────────────────────
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
          model,
          messages,
          ...(tools ? { tools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          max_completion_tokens: maxTokens,
          stream: true,
        });

        for await (const chunk of oaiStream) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        const oaiCompletion = await openai.chat.completions.create({
          model,
          messages,
          ...(tools ? { tools } : {}),
          ...(toolChoice ? { tool_choice: toolChoice } : {}),
          max_completion_tokens: maxTokens,
          stream: false,
        });
        res.json(oaiCompletion);
      }

    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error" } });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Internal server error";
    logger.error({ err }, "Proxy error in /v1/chat/completions");
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: { message: errMsg } })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: { message: errMsg, type: "server_error" } });
    }
  }
});

// ─── POST /v1/messages ────────────────────────────────────────────────────────

router.post("/messages", async (req, res) => {
  if (!verifyBearer(req, res)) return;

  const body = req.body as Record<string, unknown>;
  const model = (body.model as string) ?? "";
  const stream = body.stream === true;
  const beta = extractBeta(req);

  if (debugLog) logger.debug({ model, stream }, "/v1/messages request");

  const {
    output_config: _oc,
    stream_options: _so,
    reasoning_effort: _re,
    ...cleanBody
  } = body as Record<string, unknown>;

  try {
    // ── Claude model via /messages ───────────────────────────────────────────
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

        // BUG FIX #5: don't manually emit message_stop — the SDK already
        // includes it in the event stream. Just forward every event as-is.
        for await (const event of anthropicStream) {
          res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
      } else {
        // BUG FIX #1: streaming fallback via createAnthropicMessage
        const response = await createAnthropicMessage(anthropicParams, beta);
        res.json(response);
      }

    // ── OpenAI model via /messages ───────────────────────────────────────────
    } else if (isOpenAIModel(model)) {
      const { system, messages } = openAIMessagesToAnthropic(
        (cleanBody.messages as OpenAIMessage[]) ?? [],
      );
      const allMessages = system
        ? [{ role: "user" as const, content: `[System]: ${system}` }, ...messages]
        : messages;
      const maxTokens = (cleanBody.max_tokens as number | undefined) ?? 8192;
      const rawTools = cleanBody.tools as AnthropicTool[] | undefined;
      const openAITools: OpenAITool[] | undefined = rawTools
        ? rawTools.map((t) => ({
            type: "function" as const,
            function: {
              name: t.name,
              description: t.description ?? "",
              parameters: t.input_schema as Record<string, unknown>,
            },
          }))
        : undefined;
      const openAIToolChoice = openAIToolChoiceToAnthropic(
        cleanBody.tool_choice as Anthropic.ToolChoice | undefined,
      );
      const oaiToolChoice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined =
        openAIToolChoice
          ? openAIToolChoice.type === "auto"
            ? "auto"
            : openAIToolChoice.type === "any"
              ? "required"
              : openAIToolChoice.type === "tool"
                ? { type: "function", function: { name: (openAIToolChoice as Anthropic.ToolChoiceTool).name } }
                : undefined
          : undefined;

      if (stream) {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const oaiStream = await openai.chat.completions.create({
          model,
          messages: allMessages as OpenAIMessage[],
          ...(openAITools ? { tools: openAITools } : {}),
          ...(oaiToolChoice ? { tool_choice: oaiToolChoice } : {}),
          max_completion_tokens: maxTokens,
          stream: true,
        });

        let buffer = "";
        for await (const chunk of oaiStream) {
          const delta = chunk.choices[0]?.delta;
          if (delta?.content) buffer += delta.content;
        }

        const anthropicStreamResp: Anthropic.Message = {
          id: `msg_${Date.now()}`,
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: buffer }],
          model,
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        };

        res.write(`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: anthropicStreamResp })}\n\n`);
        res.write(`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`);
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: buffer } })}\n\n`);
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
        res.write(`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 0 } })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
        res.end();
      } else {
        const oaiCompletion = await openai.chat.completions.create({
          model,
          messages: allMessages as OpenAIMessage[],
          ...(openAITools ? { tools: openAITools } : {}),
          ...(oaiToolChoice ? { tool_choice: oaiToolChoice } : {}),
          max_completion_tokens: maxTokens,
          stream: false,
        });

        const choice = oaiCompletion.choices[0];
        const content: Anthropic.ContentBlock[] = [];
        if (choice?.message?.content) {
          content.push({ type: "text", text: choice.message.content });
        }
        if (choice?.message?.tool_calls) {
          for (const tc of choice.message.tool_calls) {
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(tc.function.arguments); } catch { input = {}; }
            content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
          }
        }

        const stopReason = choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn";
        const anthropicResponse: Anthropic.Message = {
          id: oaiCompletion.id,
          type: "message",
          role: "assistant",
          content,
          model,
          stop_reason: stopReason,
          stop_sequence: null,
          usage: {
            input_tokens: oaiCompletion.usage?.prompt_tokens ?? 0,
            output_tokens: oaiCompletion.usage?.completion_tokens ?? 0,
          },
        };
        res.json(anthropicResponse);
      }

    } else {
      res.status(400).json({ error: { message: `Unknown model: ${model}`, type: "invalid_request_error" } });
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Internal server error";
    logger.error({ err }, "Proxy error in /v1/messages");
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "server_error", message: errMsg } })}\n\n`);
      res.end();
    } else {
      // BUG FIX #3: correct Anthropic error envelope (remove double-wrapping)
      res.status(500).json({ type: "error", error: { type: "server_error", message: errMsg } });
    }
  }
});

export default router;
