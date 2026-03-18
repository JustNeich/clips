import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { runCodexExec } from "../codex-runner";

function parseJsonBlock(raw: string): unknown {
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
    throw new Error("Не удалось разобрать JSON из ответа Codex.");
  }
}

export type JsonStageExecutor = {
  runJson<T>(input: {
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    timeoutMs?: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T>;
};

type CodexSchemaTransport = {
  schema: unknown;
  prompt: string;
  unwrap: (value: unknown) => unknown;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function allowNullInSchema(schema: unknown): unknown {
  if (!isPlainObject(schema)) {
    return schema;
  }

  const typeValue = schema.type;
  if (typeof typeValue === "string") {
    if (typeValue === "null") {
      return schema;
    }
    return {
      ...schema,
      type: [typeValue, "null"]
    };
  }

  if (Array.isArray(typeValue)) {
    if (typeValue.includes("null")) {
      return schema;
    }
    return {
      ...schema,
      type: [...typeValue, "null"]
    };
  }

  return schema;
}

function strictifyCodexSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((item) => strictifyCodexSchema(item));
  }

  if (!isPlainObject(schema)) {
    return schema;
  }

  const next: Record<string, unknown> = { ...schema };

  if ("items" in schema) {
    next.items = strictifyCodexSchema(schema.items);
  }

  if (isPlainObject(schema.additionalProperties)) {
    next.additionalProperties = strictifyCodexSchema(schema.additionalProperties);
  }

  if (!isPlainObject(schema.properties)) {
    return next;
  }

  const originalRequired = Array.isArray(schema.required)
    ? schema.required.map((value) => String(value))
    : [];
  const propertyEntries = Object.entries(schema.properties);
  const strictProperties = Object.fromEntries(
    propertyEntries.map(([key, value]) => {
      const normalizedProperty = strictifyCodexSchema(value);
      return [
        key,
        originalRequired.includes(key)
          ? normalizedProperty
          : allowNullInSchema(normalizedProperty)
      ];
    })
  );

  next.properties = strictProperties;
  next.required = propertyEntries.map(([key]) => key);
  return next;
}

export function prepareCodexSchemaTransport(input: {
  schema: unknown;
  prompt: string;
}): CodexSchemaTransport {
  const strictSchema = strictifyCodexSchema(input.schema);
  const schemaObject = isPlainObject(strictSchema) ? strictSchema : null;
  if (schemaObject?.type === "object") {
    return {
      schema: strictSchema,
      prompt: input.prompt,
      unwrap: (value) => value
    };
  }

  const wrappedSchema = {
    type: "object",
    additionalProperties: false,
    required: ["result"],
    properties: {
      result: strictSchema
    }
  };

  const wrappedPrompt = [
    input.prompt.trim(),
    "",
    "TRANSPORT FORMAT RULE:",
    '- The response must be a single JSON object with exactly one key: "result".',
    '- Put the actual requested payload inside "result".',
    '- The value of "result" must satisfy the requested schema.'
  ].join("\n");

  return {
    schema: wrappedSchema,
    prompt: wrappedPrompt,
    unwrap: (value) => {
      if (isPlainObject(value) && "result" in value) {
        return value.result;
      }
      return value;
    }
  };
}

export class CodexJsonStageExecutor implements JsonStageExecutor {
  constructor(
    private readonly params: {
      cwd: string;
      codexHome: string;
      defaultTimeoutMs?: number;
      defaultModel?: string | null;
      defaultReasoningEffort?: string | null;
    }
  ) {}

  async runJson<T>(input: {
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    timeoutMs?: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T> {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "viral-shorts-stage-"));
    const schemaPath = path.join(tmpDir, "schema.json");
    const outputPath = path.join(tmpDir, "output.json");
    const transport = prepareCodexSchemaTransport({
      schema: input.schema,
      prompt: input.prompt
    });

    try {
      await writeFile(schemaPath, JSON.stringify(transport.schema, null, 2), "utf-8");
      await runCodexExec({
        prompt: transport.prompt,
        imagePaths: input.imagePaths ?? [],
        outputSchemaPath: schemaPath,
        outputMessagePath: outputPath,
        cwd: this.params.cwd,
        codexHome: this.params.codexHome,
        timeoutMs: input.timeoutMs ?? this.params.defaultTimeoutMs,
        model: input.model ?? this.params.defaultModel ?? null,
        reasoningEffort:
          input.reasoningEffort ?? this.params.defaultReasoningEffort ?? null
      });
      const raw = await readFile(outputPath, "utf-8");
      return transport.unwrap(parseJsonBlock(raw)) as T;
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
