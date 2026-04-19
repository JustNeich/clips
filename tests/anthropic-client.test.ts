import assert from "node:assert/strict";
import test from "node:test";

import { runAnthropicStructuredOutput } from "../lib/anthropic-client";

test("runAnthropicStructuredOutput unwraps wrapped structured tool results", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      model?: string;
      tool_choice?: { name?: string };
      tools?: Array<{ name?: string }>;
    };
    assert.equal(body.model, "claude-opus-4-6");
    assert.equal(body.tool_choice?.name, "record_result");
    assert.equal(body.tools?.[0]?.name, "record_result");
    return new Response(
      JSON.stringify({
        content: [
          {
            type: "tool_use",
            name: "record_result",
            input: {
              result: ["alpha", "beta"]
            }
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };
  globalThis.fetch = fetchMock;

  try {
    const result = await runAnthropicStructuredOutput<string[]>({
      apiKey: "sk-ant-test",
      model: "claude-opus-4-6",
      prompt: "Return two strings.",
      schema: {
        type: "array",
        items: {
          type: "string"
        }
      }
    });

    assert.deepEqual(result, ["alpha", "beta"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runAnthropicStructuredOutput fails closed when Anthropic skips the forced tool block", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        content: [
          {
            type: "text",
            text: "plain text instead of tool output"
          }
        ]
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  globalThis.fetch = fetchMock;

  try {
    await assert.rejects(
      () =>
        runAnthropicStructuredOutput({
          apiKey: "sk-ant-test",
          model: "claude-opus-4-6",
          prompt: "Return a record.",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["ok"],
            properties: {
              ok: { type: "boolean" }
            }
          }
        }),
      /expected structured tool result/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
