import { readFile } from "node:fs/promises";
import path from "node:path";
import { prepareJsonSchemaTransport } from "./json-stage-transport";

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MAX_REDIRECTS = 3;
const OPENROUTER_TEST_PROMPT = "Return a short machine-readable acknowledgement.";
const OPENROUTER_TEST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: {
    ok: { type: "boolean" }
  }
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseNestedOpenRouterProviderError(payload: unknown): {
  providerName: string | null;
  rawMessage: string | null;
} {
  const record = asRecord(payload);
  const nestedError = asRecord(record?.error);
  const metadata = asRecord(nestedError?.metadata);
  const providerName =
    typeof metadata?.provider_name === "string" && metadata.provider_name.trim()
      ? metadata.provider_name.trim()
      : null;
  const raw = typeof metadata?.raw === "string" ? metadata.raw.trim() : "";
  if (!raw) {
    return { providerName, rawMessage: null };
  }

  try {
    const rawRecord = asRecord(JSON.parse(raw));
    const rawError = asRecord(rawRecord?.error);
    const rawMessage =
      (typeof rawError?.message === "string" && rawError.message.trim()) ||
      (typeof rawRecord?.message === "string" && rawRecord.message.trim()) ||
      null;
    return {
      providerName,
      rawMessage
    };
  } catch {
    return { providerName, rawMessage: null };
  }
}

function getOpenRouterErrorMessage(payload: unknown, status: number): string {
  const record = asRecord(payload);
  const nestedError = asRecord(record?.error);
  const { providerName, rawMessage } = parseNestedOpenRouterProviderError(payload);
  const message =
    (typeof nestedError?.message === "string" && nestedError.message.trim()) ||
    (typeof record?.message === "string" && record.message.trim()) ||
    "";
  if (rawMessage) {
    return providerName
      ? `OpenRouter provider ${providerName}: ${rawMessage}`
      : rawMessage;
  }
  return message || `OpenRouter API request failed (HTTP ${status}).`;
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

function buildOpenRouterHeaders(apiKey: string): Headers {
  const headers = new Headers();
  headers.set("Authorization", `Bearer ${apiKey}`);
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
  headers.set("User-Agent", "clips-automations-openrouter/1.0");
  headers.set("X-Title", "Clips Automations");
  return headers;
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

async function postOpenRouterJson(input: {
  apiKey: string;
  body: string;
  signal: AbortSignal;
}): Promise<Response> {
  let requestUrl = OPENROUTER_CHAT_COMPLETIONS_URL;

  for (let redirectIndex = 0; redirectIndex <= OPENROUTER_MAX_REDIRECTS; redirectIndex += 1) {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: buildOpenRouterHeaders(input.apiKey),
      body: input.body,
      signal: input.signal,
      redirect: "manual"
    });

    if (!isRedirectStatus(response.status)) {
      return response;
    }

    const location = response.headers.get("location")?.trim();
    if (!location) {
      throw new Error(`OpenRouter redirected without a location header (HTTP ${response.status}).`);
    }
    requestUrl = new URL(location, requestUrl).toString();
  }

  throw new Error("OpenRouter redirected too many times.");
}

async function buildOpenRouterUserContent(
  imagePaths: string[],
  prompt: string
): Promise<Array<Record<string, unknown>>> {
  const content: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: prompt
    }
  ];
  for (const imagePath of imagePaths) {
    const bytes = await readFile(imagePath);
    content.push({
      type: "image_url",
      image_url: {
        url: `data:${inferImageMediaType(imagePath)};base64,${bytes.toString("base64")}`
      }
    });
  }
  return content;
}

function parseJsonContent(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced =
      trimmed.match(/```json\s*([\s\S]*?)```/i) ??
      trimmed.match(/```\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1]);
    }
    throw new Error("Не удалось разобрать JSON из ответа OpenRouter.");
  }
}

function extractStructuredResult(payload: unknown): unknown {
  const record = asRecord(payload);
  const choices = Array.isArray(record?.choices) ? record.choices : [];
  const firstChoice = asRecord(choices[0]);
  const message = asRecord(firstChoice?.message);
  if (message?.parsed !== undefined) {
    return message.parsed;
  }

  const content = message?.content;
  if (typeof content === "string" && content.trim()) {
    return parseJsonContent(content);
  }
  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        const candidate = asRecord(block);
        return typeof candidate?.text === "string" ? candidate.text : "";
      })
      .join("")
      .trim();
    if (text) {
      return parseJsonContent(text);
    }
  }

  throw new Error("OpenRouter did not return the expected structured JSON result.");
}

async function fetchOpenRouterStructuredOutput<T>(input: {
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
  const userContent = await buildOpenRouterUserContent(input.imagePaths ?? [], transport.prompt);
  const requestBody = JSON.stringify({
    model: input.model,
    max_tokens: input.maxTokens ?? 8_192,
    messages: [
      {
        role: "user",
        content: userContent
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "record_result",
        strict: true,
        schema: transport.schema
      }
    }
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 8 * 60_000);

  try {
    const response = await postOpenRouterJson({
      apiKey: input.apiKey,
      body: requestBody,
      signal: controller.signal
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(getOpenRouterErrorMessage(payload, response.status));
    }
    return transport.unwrap(extractStructuredResult(payload)) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("OpenRouter generation timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function runOpenRouterStructuredOutput<T>(input: {
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
    throw new Error("OpenRouter API key не задан.");
  }
  if (!model) {
    throw new Error("OpenRouter model не задан.");
  }
  return fetchOpenRouterStructuredOutput<T>({
    ...input,
    apiKey,
    model
  });
}

export async function testOpenRouterApiKey(input: {
  apiKey: string;
  model: string;
}): Promise<void> {
  await fetchOpenRouterStructuredOutput<{ ok?: boolean }>({
    apiKey: input.apiKey.trim(),
    model: input.model.trim(),
    prompt: OPENROUTER_TEST_PROMPT,
    schema: OPENROUTER_TEST_SCHEMA,
    maxTokens: 32,
    timeoutMs: 30_000
  });
}
