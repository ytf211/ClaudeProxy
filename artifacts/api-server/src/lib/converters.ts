import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger";

// ─── Type aliases ──────────────────────────────────────────────────────────────
export type OAIFunctionTool = OpenAI.Chat.Completions.ChatCompletionFunctionTool;
export type OAIMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;
export type AnthropicTool = Anthropic.Tool;
export type AnthropicMessage = Anthropic.MessageParam;

// ─── Per-model max output token caps ──────────────────────────────────────────
export const MODEL_MAX_OUTPUT: Record<string, number> = {
  "claude-opus-4-1": 32000,
};

export function clampMaxTokens(
  model: string,
  requested: number | undefined,
  defaultVal = 8192,
): number {
  const val = requested ?? defaultVal;
  const cap = MODEL_MAX_OUTPUT[model];
  return cap !== undefined ? Math.min(val, cap) : val;
}

// ─── Model type helpers ────────────────────────────────────────────────────────
export function isOpenAIModel(model: string): boolean {
  return model.startsWith("gpt-") || /^o\d/.test(model);
}

export function isAnthropicModel(model: string): boolean {
  return model.startsWith("claude-");
}

export function isGeminiModel(model: string): boolean {
  return model.startsWith("gemini-");
}

// ─── OpenAI → Anthropic tool converters ───────────────────────────────────────

export function openAIToolsToAnthropic(
  tools: OpenAI.Chat.Completions.ChatCompletionTool[],
): AnthropicTool[] {
  return tools
    .filter((t): t is OAIFunctionTool => t.type === "function")
    .map((t) => ({
      name: t.function.name,
      description: t.function.description ?? "",
      input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
    }));
}

export function openAIToolChoiceToAnthropic(
  choice: unknown,
): Anthropic.ToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return undefined;
  if (choice === "required") return { type: "any" };
  if (typeof choice === "object") {
    const c = choice as Record<string, unknown>;
    if (c.type === "function" && c.function) {
      return { type: "tool", name: (c.function as Record<string, unknown>).name as string };
    }
  }
  return undefined;
}

export function anthropicToolChoiceToOAI(
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

// ─── Content converter ─────────────────────────────────────────────────────────

export function openAIContentToAnthropic(
  content: OAIMessage["content"],
): Anthropic.MessageParam["content"] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: Anthropic.ContentBlockParam[] = [];
  for (const part of content) {
    const p = part as unknown as Record<string, unknown>;
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
  if (parts.length === 1 && parts[0].type === "text" && !(parts[0] as Anthropic.TextBlockParam).cache_control) {
    return (parts[0] as Anthropic.TextBlockParam).text;
  }
  return parts;
}

// ─── Message converters ────────────────────────────────────────────────────────

export function openAIMessagesToAnthropic(
  messages: OAIMessage[],
): { system?: string | Anthropic.TextBlockParam[]; messages: AnthropicMessage[] } {
  const systemBlocks: Anthropic.TextBlockParam[] = [];
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === "system") {
      if (typeof msg.content === "string" && msg.content) {
        systemBlocks.push({ type: "text", text: msg.content });
      } else if (Array.isArray(msg.content)) {
        const blocks: Anthropic.TextBlockParam[] = (msg.content as unknown as Record<string, unknown>[])
          .filter((p) => p.type === "text" && p.text)
          .map((p) => {
            const block: Anthropic.TextBlockParam = { type: "text", text: p.text as string };
            const cc = p.cache_control as Anthropic.CacheControlEphemeral | undefined;
            if (cc) block.cache_control = cc;
            return block;
          });
        systemBlocks.push(...blocks);
      }
      continue;
    }

    if (msg.role === "tool") {
      const toolCallId = msg.tool_call_id;
      if (!toolCallId) {
        logger.warn("tool message missing tool_call_id — skipping");
        continue;
      }
      const last = result[result.length - 1];
      const block: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: toolCallId,
        content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? ""),
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
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          if (tc.type !== "function") continue;
          const ftc = tc as OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall;
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(ftc.function.arguments); } catch { input = {}; }
          contentBlocks.push({ type: "tool_use", id: tc.id, name: ftc.function.name, input });
        }
      }
      if (contentBlocks.length === 0) continue;
      result.push({ role: "assistant", content: contentBlocks });
      continue;
    }

    if (msg.role === "user") {
      result.push({ role: "user", content: openAIContentToAnthropic(msg.content) });
    }
  }

  let system: string | Anthropic.TextBlockParam[] | undefined;
  if (systemBlocks.length === 1 && !systemBlocks[0].cache_control) {
    system = systemBlocks[0].text;
  } else if (systemBlocks.length > 1) {
    system = systemBlocks;
  }

  return { system, messages: result };
}

export function anthropicMessagesToOAI(
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

// ─── System field helpers ──────────────────────────────────────────────────────

export function systemToString(system: unknown): string | undefined {
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

// ─── Cleaners ──────────────────────────────────────────────────────────────────

export function cleanTools(tools: unknown[]): unknown[] {
  return tools.map((t) => {
    const tool = { ...(t as Record<string, unknown>) };
    if (tool.type === "custom") delete tool.type;
    if (tool.input_schema == null) tool.input_schema = { type: "object", properties: {} };
    return tool;
  });
}

export function cleanSystemBlocks(system: unknown): unknown {
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

export function cleanMessages(messages: unknown[]): unknown[] {
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
