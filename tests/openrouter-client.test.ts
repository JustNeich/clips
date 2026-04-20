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
        json_schema?: {
          name?: string;
          schema?: {
            properties?: {
              result?: {
                minItems?: number;
                maxItems?: number;
              };
            };
          };
        };
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
    assert.equal(body.response_format?.json_schema?.schema?.properties?.result?.minItems, 1);
    assert.equal(body.response_format?.json_schema?.schema?.properties?.result?.maxItems, 8);
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
        minItems: 8,
        maxItems: 8,
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

test("runOpenRouterStructuredOutput clamps unsupported OpenRouter array minItems values", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      response_format?: {
        json_schema?: {
          schema?: {
            properties?: {
              analysis?: {
                properties?: {
                  visual_anchors?: {
                    minItems?: number;
                    maxItems?: number;
                  };
                };
              };
              candidates?: {
                minItems?: number;
                maxItems?: number;
              };
              titles?: {
                minItems?: number;
                maxItems?: number;
              };
            };
          };
        };
      };
    };
    const schema = body.response_format?.json_schema?.schema;
    assert.equal(
      schema?.properties?.analysis?.properties?.visual_anchors?.minItems,
      1
    );
    assert.equal(
      schema?.properties?.analysis?.properties?.visual_anchors?.maxItems,
      3
    );
    assert.equal(schema?.properties?.candidates?.minItems, 1);
    assert.equal(schema?.properties?.candidates?.maxItems, 5);
    assert.equal(schema?.properties?.titles?.minItems, 1);
    assert.equal(schema?.properties?.titles?.maxItems, 5);

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                analysis: {
                  visual_anchors: ["a", "b", "c"],
                  comment_vibe: "observant",
                  key_phrase_to_adapt: "clock it"
                },
                candidates: Array.from({ length: 5 }, (_, index) => ({
                  candidate_id: `cand_${index + 1}`,
                  top: "",
                  bottom: `Bottom ${index + 1}`,
                  retained_handle: false
                })),
                winner_candidate_id: "cand_1",
                titles: Array.from({ length: 5 }, (_, index) => ({
                  title: `Title ${index + 1}`
                }))
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
    const result = await runOpenRouterStructuredOutput<{
      analysis: { visual_anchors: string[] };
      candidates: Array<{ candidate_id: string }>;
      winner_candidate_id: string;
      titles: Array<{ title: string }>;
    }>({
      apiKey: "sk-or-v1-test",
      model: "anthropic/claude-opus-4.7",
      prompt: "Return five finalists and titles.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["analysis", "candidates", "winner_candidate_id", "titles"],
        properties: {
          analysis: {
            type: "object",
            additionalProperties: false,
            required: ["visual_anchors", "comment_vibe", "key_phrase_to_adapt"],
            properties: {
              visual_anchors: {
                type: "array",
                minItems: 3,
                maxItems: 3,
                items: { type: "string" }
              },
              comment_vibe: { type: "string" },
              key_phrase_to_adapt: { type: "string" }
            }
          },
          candidates: {
            type: "array",
            minItems: 5,
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["candidate_id", "top", "bottom", "retained_handle"],
              properties: {
                candidate_id: { type: "string" },
                top: { type: "string" },
                bottom: { type: "string" },
                retained_handle: { type: "boolean" }
              }
            }
          },
          winner_candidate_id: { type: "string" },
          titles: {
            type: "array",
            minItems: 5,
            maxItems: 5,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["title"],
              properties: {
                title: { type: "string" }
              }
            }
          }
        }
      }
    });

    assert.equal(result.candidates.length, 5);
    assert.equal(result.titles.length, 5);
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
