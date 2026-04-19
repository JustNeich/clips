import assert from "node:assert/strict";
import test from "node:test";

import { runOpenRouterStructuredOutput } from "../lib/openrouter-client";

test("runOpenRouterStructuredOutput unwraps structured JSON responses", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      model?: string;
      response_format?: {
        type?: string;
        json_schema?: { name?: string };
      };
    };
    assert.equal(headers.get("Authorization"), "Bearer sk-or-v1-test");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(headers.get("X-Title"), "Clips Automations");
    assert.equal(init?.redirect, "manual");
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

test("runOpenRouterStructuredOutput preserves Authorization across OpenRouter redirects", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const fetchMock: typeof fetch = async (input, init) => {
    callCount += 1;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer sk-or-v1-test");
    if (callCount === 1) {
      assert.equal(String(input), "https://openrouter.ai/api/v1/chat/completions");
      return new Response(null, {
        status: 307,
        headers: {
          location: "https://openrouter.ai/api/v1/chat/completions?region=iad"
        }
      });
    }
    assert.equal(String(input), "https://openrouter.ai/api/v1/chat/completions?region=iad");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ok: true
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
    const result = await runOpenRouterStructuredOutput<{ ok: boolean }>({
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
    });

    assert.deepEqual(result, { ok: true });
    assert.equal(callCount, 2);
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

test("runOpenRouterStructuredOutput surfaces nested provider-side OpenRouter errors", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Provider returned error",
          metadata: {
            provider_name: "Azure",
            raw: JSON.stringify({
              type: "error",
              error: {
                type: "invalid_request_error",
                message: "Could not process image"
              }
            })
          }
        }
      }),
      {
        status: 400,
        headers: { "content-type": "application/json" }
      }
    );
  globalThis.fetch = fetchMock;

  try {
    await assert.rejects(
      () =>
        runOpenRouterStructuredOutput({
          apiKey: "sk-or-v1-test",
          model: "anthropic/claude-sonnet-4.6",
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
      /OpenRouter provider Azure: Could not process image/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
