import { readFile } from "node:fs/promises";
import path from "node:path";
import { prepareJsonSchemaTransport } from "./json-stage-transport";

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";
const ANTHROPIC_TEST_PROMPT = "Return a short machine-readable acknowledgement.";
const ANTHROPIC_TEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: {
    ok: { type: "boolean" }
  }
} as const;

type AnthropicToolUseBlock = {
  type?: string;
  name?: string;
  input?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getAnthropicErrorMessage(payload: unknown, status: number): string {
  const record = asRecord(payload);
  const nestedError = asRecord(record?.error);
  const message =
    (typeof nestedError?.message === "string" && nestedError.message.trim()) ||
    (typeof record?.message === "string" && record.message.trim()) ||
    "";
  return message || `Anthropic API request failed (HTTP ${status}).`;
}

function inferImageMediaType(imagePath: string): string {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".png") {
    return "image/png";
  }
  if (ext === ".webp") {
    return "image/webp";
  }
  if (ext === ".gif") {
    return "image/gif";
  }
  return "image/jpeg";
}

async function buildAnthropicUserContent(
  imagePaths: string[],
  prompt: string
): Promise<Array<Record<string, unknown>>> {
  const content: Array<Record<string, unknown>> = [];
  for (const imagePath of imagePaths) {
    const bytes = await readFile(imagePath);
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: inferImageMediaType(imagePath),
        data: bytes.toString("base64")
      }
    });
  }
  content.push({
    type: "text",
    text: prompt
  });
  return content;
}

function extractToolResult(payload: unknown): unknown {
  const record = asRecord(payload);
  const content = Array.isArray(record?.content) ? record.content : [];
  const toolUse = content.find((block) => {
    const candidate = asRecord(block) as AnthropicToolUseBlock | null;
    return candidate?.type === "tool_use" && candidate?.name === "record_result";
  }) as AnthropicToolUseBlock | undefined;
  if (!toolUse) {
    throw new Error("Anthropic did not return the expected structured tool result.");
  }
  return toolUse.input;
}

async function fetchAnthropicStructuredOutput<T>(input: {
  apiKey: string;
  model: string;
  prompt: string;
  schema: unknown;
  imagePaths?: string[];
  timeoutMs?: number;
  maxTokens?: number;
}): Promise<T> {
  const transport = prepareJsonSchemaTransport({
    schema: input.schema,
    prompt: input.prompt
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 8 * 60_000);

  try {
    const response = await fetch(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxTokens ?? 8_192,
        tool_choice: { type: "tool", name: "record_result" },
        tools: [
          {
            name: "record_result",
            description: "Return the final JSON payload exactly in the required schema.",
            input_schema: transport.schema
          }
        ],
        messages: [
          {
            role: "user",
            content: await buildAnthropicUserContent(input.imagePaths ?? [], transport.prompt)
          }
        ]
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(getAnthropicErrorMessage(payload, response.status));
    }
    return transport.unwrap(extractToolResult(payload)) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Anthropic generation timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function runAnthropicStructuredOutput<T>(input: {
  apiKey: string;
  model: string;
  prompt: string;
  schema: unknown;
  imagePaths?: string[];
  timeoutMs?: number;
}): Promise<T> {
  const apiKey = input.apiKey.trim();
  const model = input.model.trim();
  if (!apiKey) {
    throw new Error("Anthropic API key не задан.");
  }
  if (!model) {
    throw new Error("Anthropic model не задан.");
  }
  return fetchAnthropicStructuredOutput<T>({
    ...input,
    apiKey,
    model
  });
}

export async function testAnthropicApiKey(input: {
  apiKey: string;
  model: string;
}): Promise<void> {
  await fetchAnthropicStructuredOutput<{ ok?: boolean }>({
    apiKey: input.apiKey.trim(),
    model: input.model.trim(),
    prompt: ANTHROPIC_TEST_PROMPT,
    schema: ANTHROPIC_TEST_SCHEMA,
    maxTokens: 32,
    timeoutMs: 30_000
  });
}
