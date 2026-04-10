import { describe, it, expect } from "vitest";
import {
  clampMaxTokens,
  openAIToolChoiceToAnthropic,
  anthropicToolChoiceToOAI,
  systemToString,
  openAIMessagesToAnthropic,
  anthropicMessagesToOAI,
  cleanTools,
  cleanMessages,
  isOpenAIModel,
  isAnthropicModel,
  isGeminiModel,
} from "../lib/converters";

// ─── clampMaxTokens ────────────────────────────────────────────────────────────
describe("clampMaxTokens", () => {
  it("returns requested value for uncapped model", () => {
    expect(clampMaxTokens("claude-haiku-4-5", 4096)).toBe(4096);
  });

  it("clamps to cap for claude-opus-4-1", () => {
    expect(clampMaxTokens("claude-opus-4-1", 100000)).toBe(32000);
  });

  it("returns value under cap unchanged", () => {
    expect(clampMaxTokens("claude-opus-4-1", 16000)).toBe(16000);
  });

  it("uses defaultVal when requested is undefined", () => {
    expect(clampMaxTokens("gpt-4o", undefined)).toBe(8192);
    expect(clampMaxTokens("gpt-4o", undefined, 4096)).toBe(4096);
  });

  it("clamps defaultVal for capped model", () => {
    expect(clampMaxTokens("claude-opus-4-1", undefined, 100000)).toBe(32000);
  });
});

// ─── Model type helpers ────────────────────────────────────────────────────────
describe("model helpers", () => {
  it("recognises OpenAI models", () => {
    expect(isOpenAIModel("gpt-4o")).toBe(true);
    expect(isOpenAIModel("gpt-4.1-mini")).toBe(true);
    expect(isOpenAIModel("o3-mini")).toBe(true);
    expect(isOpenAIModel("o4-mini")).toBe(true);
    expect(isOpenAIModel("claude-haiku-4-5")).toBe(false);
  });

  it("recognises Anthropic models", () => {
    expect(isAnthropicModel("claude-haiku-4-5")).toBe(true);
    expect(isAnthropicModel("gpt-4o")).toBe(false);
  });

  it("recognises Gemini models", () => {
    expect(isGeminiModel("gemini-2.5-flash")).toBe(true);
    expect(isGeminiModel("gpt-4o")).toBe(false);
  });
});

// ─── openAIToolChoiceToAnthropic ───────────────────────────────────────────────
describe("openAIToolChoiceToAnthropic", () => {
  it("maps auto → {type:auto}", () => {
    expect(openAIToolChoiceToAnthropic("auto")).toEqual({ type: "auto" });
  });

  it("maps none → undefined (Anthropic has no none)", () => {
    expect(openAIToolChoiceToAnthropic("none")).toBeUndefined();
  });

  it("maps required → {type:any}", () => {
    expect(openAIToolChoiceToAnthropic("required")).toEqual({ type: "any" });
  });

  it("maps function object → {type:tool, name}", () => {
    expect(openAIToolChoiceToAnthropic({ type: "function", function: { name: "get_weather" } }))
      .toEqual({ type: "tool", name: "get_weather" });
  });

  it("returns undefined for falsy input", () => {
    expect(openAIToolChoiceToAnthropic(undefined)).toBeUndefined();
    expect(openAIToolChoiceToAnthropic(null)).toBeUndefined();
  });
});

// ─── anthropicToolChoiceToOAI ──────────────────────────────────────────────────
describe("anthropicToolChoiceToOAI", () => {
  it("maps {type:auto} → auto", () => {
    expect(anthropicToolChoiceToOAI({ type: "auto" })).toBe("auto");
  });

  it("maps {type:any} → required", () => {
    expect(anthropicToolChoiceToOAI({ type: "any" })).toBe("required");
  });

  it("maps {type:none} → none", () => {
    expect(anthropicToolChoiceToOAI({ type: "none" })).toBe("none");
  });

  it("maps {type:tool, name} → function object", () => {
    expect(anthropicToolChoiceToOAI({ type: "tool", name: "search" }))
      .toEqual({ type: "function", function: { name: "search" } });
  });

  it("returns undefined for falsy input", () => {
    expect(anthropicToolChoiceToOAI(null)).toBeUndefined();
    expect(anthropicToolChoiceToOAI(undefined)).toBeUndefined();
  });
});

// ─── systemToString ────────────────────────────────────────────────────────────
describe("systemToString", () => {
  it("passes through plain string", () => {
    expect(systemToString("Be helpful")).toBe("Be helpful");
  });

  it("joins text blocks from array", () => {
    expect(systemToString([{ type: "text", text: "Block 1" }, { type: "text", text: "Block 2" }]))
      .toBe("Block 1\nBlock 2");
  });

  it("ignores non-text blocks", () => {
    expect(systemToString([{ type: "image" }, { type: "text", text: "hello" }]))
      .toBe("hello");
  });

  it("returns undefined for empty/null", () => {
    expect(systemToString(undefined)).toBeUndefined();
    expect(systemToString(null)).toBeUndefined();
    expect(systemToString([])).toBeUndefined();
  });
});

// ─── openAIMessagesToAnthropic ─────────────────────────────────────────────────
describe("openAIMessagesToAnthropic", () => {
  it("converts single user message", () => {
    const { system, messages } = openAIMessagesToAnthropic([
      { role: "user", content: "Hello" },
    ]);
    expect(system).toBeUndefined();
    expect(messages).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("extracts system message into system field", () => {
    const { system, messages } = openAIMessagesToAnthropic([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hi" },
    ]);
    expect(system).toBe("You are helpful");
    expect(messages).toEqual([{ role: "user", content: "Hi" }]);
  });

  it("merges multiple system messages", () => {
    const { system } = openAIMessagesToAnthropic([
      { role: "system", content: "Rule 1" },
      { role: "system", content: "Rule 2" },
    ]);
    expect(Array.isArray(system)).toBe(true);
    expect((system as { text: string }[])[0].text).toBe("Rule 1");
    expect((system as { text: string }[])[1].text).toBe("Rule 2");
  });

  it("skips empty assistant messages", () => {
    const { messages } = openAIMessagesToAnthropic([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "" },
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("user");
  });

  it("batches consecutive tool results into one user message", () => {
    const { messages } = openAIMessagesToAnthropic([
      { role: "user", content: "Use tools" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "tc_1", type: "function", function: { name: "fn_a", arguments: "{}" } },
          { id: "tc_2", type: "function", function: { name: "fn_b", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "tc_1", content: "result_a" },
      { role: "tool", tool_call_id: "tc_2", content: "result_b" },
    ]);
    // Tool results should be batched into a single user message
    const userMsgs = messages.filter((m) => m.role === "user");
    const lastUser = userMsgs[userMsgs.length - 1];
    expect(Array.isArray(lastUser.content)).toBe(true);
    expect((lastUser.content as { type: string }[]).length).toBe(2);
  });
});

// ─── anthropicMessagesToOAI ────────────────────────────────────────────────────
describe("anthropicMessagesToOAI", () => {
  it("converts simple user/assistant exchange", () => {
    const result = anthropicMessagesToOAI([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
    ]);
    expect(result).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!", },
    ]);
  });

  it("prepends system message when provided", () => {
    const result = anthropicMessagesToOAI([{ role: "user", content: "Hi" }], "Be helpful");
    expect(result[0]).toEqual({ role: "system", content: "Be helpful" });
  });

  it("converts tool_use blocks to tool_calls", () => {
    const result = anthropicMessagesToOAI([
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "tu_1", name: "search", input: { q: "test" } }],
      },
    ]);
    const msg = result[0] as { tool_calls: { id: string; function: { name: string } }[] };
    expect(msg.tool_calls[0].id).toBe("tu_1");
    expect(msg.tool_calls[0].function.name).toBe("search");
  });
});

// ─── cleanTools ────────────────────────────────────────────────────────────────
describe("cleanTools", () => {
  it("removes type:custom field", () => {
    const result = cleanTools([{ type: "custom", name: "foo", input_schema: {} }]);
    expect((result[0] as Record<string, unknown>).type).toBeUndefined();
  });

  it("adds default input_schema if missing", () => {
    const result = cleanTools([{ name: "bar" }]);
    expect((result[0] as Record<string, unknown>).input_schema).toEqual({ type: "object", properties: {} });
  });
});

// ─── cleanMessages ─────────────────────────────────────────────────────────────
describe("cleanMessages", () => {
  it("keeps normal messages unchanged", () => {
    const msgs = [{ role: "user", content: "Hi" }];
    expect(cleanMessages(msgs)).toEqual(msgs);
  });

  it("converts unsigned thinking blocks to text", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "thinking", thinking: "Let me think...", signature: "" }] },
    ];
    const result = cleanMessages(msgs) as Array<{ content: Array<{ type: string; text?: string }> }>;
    expect(result[0].content[0].type).toBe("text");
    expect(result[0].content[0].text).toContain("Let me think...");
  });

  it("preserves signed thinking blocks", () => {
    const msgs = [
      { role: "assistant", content: [{ type: "thinking", thinking: "...", signature: "sig123" }] },
    ];
    const result = cleanMessages(msgs) as Array<{ content: Array<{ type: string }> }>;
    expect(result[0].content[0].type).toBe("thinking");
  });
});
