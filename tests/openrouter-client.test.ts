import assert from "node:assert/strict";
import test from "node:test";

import { runOpenRouterStructuredOutput } from "../lib/openrouter-client";

test("runOpenRouterStructuredOutput unwraps structured JSON responses", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      model?: string;
      response_format?: {
        type?: string;
        json_schema?: { name?: string };
      };
    };
    assert.equal(body.model, "anthropic/claude-opus-4.7");
    assert.equal(body.response_format?.type, "json_schema");
    assert.equal(body.response_format?.json_schema?.name, "record_result");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                result: ["alpha", "beta"]
              })
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
    const result = await runOpenRouterStructuredOutput<string[]>({
      apiKey: "sk-or-v1-test",
      model: "anthropic/claude-opus-4.7",
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

test("runOpenRouterStructuredOutput fails closed when OpenRouter skips structured JSON content", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: ""
            }
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
        runOpenRouterStructuredOutput({
          apiKey: "sk-or-v1-test",
          model: "anthropic/claude-opus-4.7",
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
      /expected structured JSON result/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
