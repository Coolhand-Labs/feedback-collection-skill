// wildcard-tool.ts — agent-side "complaint box" for stuck AI agents.
//
// When your agent gets stuck (failed tool call, wrong data, missing
// capability) it calls the `wildcard` tool. The call is logged either to
// Coolhand (if COOLHAND_API_KEY is set) or appended to .wildcard-feedback.jsonl
// in the current working directory (zero-config fallback). The agent always
// receives the same response string so it continues with what it has.
//
// Requires Node 18+ (native fetch, fs/promises, crypto.randomUUID).
//
// Wiring into an Anthropic SDK agent loop:
//
//     import Anthropic from "@anthropic-ai/sdk";
//     import { wildcardTool, handleWildcard } from "./wildcard-tool";
//
//     const client = new Anthropic();
//
//     const response = await client.messages.create({
//       model: "claude-opus-4-7",
//       max_tokens: 1024,
//       tools: [wildcardTool /*, ...your other tools */],
//       messages: [{ role: "user", content: "..." }],
//     });
//
//     // In your tool-dispatch switch:
//     if (toolUse.name === "wildcard") {
//       const result = await handleWildcard(toolUse.input as WildcardInput);
//       // pass `result` back as the tool result content.
//     }

import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// The Coolhand v2 feedback endpoint. Single source of truth — swap here if
// Coolhand confirms a different production URL.
const COOLHAND_FEEDBACK_URL = "https://coolhandlabs.com/api/v2/feedback";

const FALLBACK_FILE = ".wildcard-feedback.jsonl";

const RESPONSE =
  "Your feedback has been logged. The capability you need is not available " +
  "right now. Please continue the task using only your existing tools, or " +
  "ask the user for help if you cannot proceed.";

export interface WildcardInput {
  task_description: string;
  tool_or_capability_needed: string;
  last_tool_called?: string;
  error_or_wrong_output?: string;
}

export const wildcardTool = {
  name: "wildcard",
  description:
    "Use this tool when you are stuck: when a tool call failed, returned " +
    "incomplete or wrong data, or when you need a capability that does not " +
    "exist in your current tool set. Tell this tool what you were trying " +
    "to do, what went wrong, and what you need. This tool will log your " +
    "feedback and tell you how to proceed.",
  input_schema: {
    type: "object" as const,
    properties: {
      task_description: { type: "string" as const },
      tool_or_capability_needed: { type: "string" as const },
      last_tool_called: { type: "string" as const },
      error_or_wrong_output: { type: "string" as const },
    },
    required: ["task_description", "tool_or_capability_needed"] as const,
  },
};

export async function handleWildcard(input: WildcardInput): Promise<string> {
  const payload = {
    client_unique_id: randomUUID(),
    creator_unique_id: "wildcard-agent",
    collector: "wildcard-tool-v0.1.0",
    sentiment: "dislike",
    explanation:
      `Task: ${input.task_description}\n` +
      `Missing: ${input.tool_or_capability_needed}\n` +
      `Last tool: ${input.last_tool_called ?? "n/a"}\n` +
      `Error: ${input.error_or_wrong_output ?? "n/a"}`,
  };

  const apiKey = process.env.COOLHAND_API_KEY;
  if (apiKey) {
    await postToCoolhand(payload, apiKey);
  } else {
    await appendToFallback(payload);
  }

  return RESPONSE;
}

async function postToCoolhand(
  payload: Record<string, unknown>,
  apiKey: string,
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      await fetch(COOLHAND_FEEDBACK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    // Never fail the agent on a network hiccup. The response string is the
    // contract; logging is best-effort.
    console.error(`[wildcard] coolhand POST failed:`, err);
  }
}

async function appendToFallback(payload: Record<string, unknown>): Promise<void> {
  try {
    await appendFile(FALLBACK_FILE, JSON.stringify(payload) + "\n", "utf-8");
  } catch (err) {
    console.error(`[wildcard] fallback write failed:`, err);
  }
}
