import assert from "node:assert/strict";
import test from "node:test";

import { runOpenRouterStructuredOutput } from "../lib/openrouter-client";

test("runOpenRouterStructuredOutput keeps response_format transport for non-Anthropic models", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      model?: string;
      provider?: {
        require_parameters?: boolean;
        allow_fallbacks?: boolean;
        order?: string[];
      };
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
      tools?: unknown;
      tool_choice?: unknown;
    };
    assert.equal(headers.get("Authorization"), "Bearer sk-or-v1-test");
    assert.equal(headers.get("Content-Type"), "application/json");
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(headers.get("X-Title"), "Clips Automations");
    assert.equal(headers.get("anthropic-beta"), null);
    assert.equal(init?.redirect, "manual");
    assert.equal(body.model, "openai/gpt-4.1-mini");
    assert.equal(body.provider?.require_parameters, true);
    assert.equal(body.response_format?.type, "json_schema");
    assert.equal(body.response_format?.json_schema?.name, "record_result");
    assert.equal(body.response_format?.json_schema?.schema?.properties?.result?.minItems, 8);
    assert.equal(body.response_format?.json_schema?.schema?.properties?.result?.maxItems, 8);
    assert.equal(Array.isArray(body.tools), false);
    assert.equal(body.tool_choice ?? null, null);

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
      model: "openai/gpt-4.1-mini",
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

test("runOpenRouterStructuredOutput uses strict tool transport for Anthropic models and unwraps stray result envelopes", async () => {
  const originalFetch = globalThis.fetch;
  const fetchMock: typeof fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      model?: string;
      parallel_tool_calls?: boolean;
      response_format?: unknown;
      tool_choice?: {
        type?: string;
        function?: { name?: string };
      };
      tools?: Array<{
        type?: string;
        function?: {
          name?: string;
          strict?: boolean;
          parameters?: {
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
      }>;
    };
    const tool = body.tools?.[0]?.function;
    const schema = tool?.parameters;
    assert.equal(headers.get("Authorization"), "Bearer sk-or-v1-test");
    assert.equal(headers.get("anthropic-beta"), "structured-outputs-2025-11-13");
    assert.equal(body.model, "anthropic/claude-opus-4.7");
    assert.equal(body.parallel_tool_calls, false);
    assert.equal(body.response_format ?? null, null);
    assert.equal(body.tool_choice?.type, "function");
    assert.equal(body.tool_choice?.function?.name, "record_result");
    assert.equal(body.tools?.[0]?.type, "function");
    assert.equal(tool?.name, "record_result");
    assert.equal(tool?.strict, true);
    assert.equal(schema?.properties?.analysis?.properties?.visual_anchors?.minItems, 3);
    assert.equal(schema?.properties?.analysis?.properties?.visual_anchors?.maxItems, 3);
    assert.equal(schema?.properties?.candidates?.minItems, 5);
    assert.equal(schema?.properties?.candidates?.maxItems, 5);
    assert.equal(schema?.properties?.titles?.minItems, 5);
    assert.equal(schema?.properties?.titles?.maxItems, 5);

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  type: "function",
                  function: {
                    name: "record_result",
                    arguments: JSON.stringify({
                      result: {
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
                      }
                    })
                  }
                }
              ]
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

    assert.equal(result.analysis.visual_anchors.length, 3);
    assert.equal(result.candidates.length, 5);
    assert.equal(result.titles.length, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("runOpenRouterStructuredOutput preserves Authorization and anthropic beta headers across OpenRouter redirects", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const fetchMock: typeof fetch = async (input, init) => {
    callCount += 1;
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer sk-or-v1-test");
    assert.equal(headers.get("anthropic-beta"), "structured-outputs-2025-11-13");
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
              tool_calls: [
                {
                  type: "function",
                  function: {
                    name: "record_result",
                    arguments: JSON.stringify({
                      ok: true
                    })
                  }
                }
              ]
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

test("runOpenRouterStructuredOutput fails closed when OpenRouter returns neither tool calls nor structured JSON", async () => {
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
