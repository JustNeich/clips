import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { runCodexExec } from "../codex-runner";
import { runAnthropicStructuredOutput } from "../anthropic-client";
import { runOpenRouterStructuredOutput } from "../openrouter-client";
import {
  isCaptionProviderRoutedStage,
  type Stage2CaptionProviderConfig
} from "../stage2-caption-provider";
import { prepareJsonSchemaTransport } from "../json-stage-transport";
import type { Stage2PipelineStageId, Stage2RegenerateStageId } from "../stage2-pipeline";

export { prepareJsonSchemaTransport as prepareCodexSchemaTransport } from "../json-stage-transport";

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
    stageId: JsonStageExecutorStageId;
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    timeoutMs?: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T>;
};

export type JsonStageExecutorStageId =
  | Stage2PipelineStageId
  | Stage2RegenerateStageId
  | "styleDiscovery";

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
    stageId: JsonStageExecutorStageId;
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
    const transport = prepareJsonSchemaTransport({
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

export class AnthropicJsonStageExecutor implements JsonStageExecutor {
  constructor(
    private readonly params: {
      apiKey: string;
      defaultModel: string;
      defaultTimeoutMs?: number;
    }
  ) {}

  async runJson<T>(input: {
    stageId: JsonStageExecutorStageId;
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    timeoutMs?: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T> {
    return runAnthropicStructuredOutput<T>({
      apiKey: this.params.apiKey,
      model: input.model?.trim() || this.params.defaultModel,
      prompt: input.prompt,
      schema: input.schema,
      imagePaths: input.imagePaths ?? [],
      timeoutMs: input.timeoutMs ?? this.params.defaultTimeoutMs
    });
  }
}

export class OpenRouterJsonStageExecutor implements JsonStageExecutor {
  constructor(
    private readonly params: {
      apiKey: string;
      defaultModel: string;
      defaultTimeoutMs?: number;
    }
  ) {}

  async runJson<T>(input: {
    stageId: JsonStageExecutorStageId;
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    timeoutMs?: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T> {
    return runOpenRouterStructuredOutput<T>({
      apiKey: this.params.apiKey,
      model: input.model?.trim() || this.params.defaultModel,
      prompt: input.prompt,
      schema: input.schema,
      imagePaths: input.imagePaths ?? [],
      timeoutMs: input.timeoutMs ?? this.params.defaultTimeoutMs
    });
  }
}

export class HybridJsonStageExecutor implements JsonStageExecutor {
  constructor(
    private readonly params: {
      captionProviderConfig: Stage2CaptionProviderConfig;
      codexExecutor: JsonStageExecutor;
      anthropicExecutor: JsonStageExecutor | null;
      openRouterExecutor: JsonStageExecutor | null;
    }
  ) {}

  async runJson<T>(input: {
    stageId: JsonStageExecutorStageId;
    prompt: string;
    schema: unknown;
    imagePaths?: string[];
    timeoutMs?: number;
    model?: string | null;
    reasoningEffort?: string | null;
  }): Promise<T> {
    if (isCaptionProviderRoutedStage(input.stageId)) {
      if (this.params.captionProviderConfig.provider === "anthropic") {
        if (!this.params.anthropicExecutor) {
          throw new Error("Anthropic captions включены, но Anthropic executor не настроен.");
        }
        return this.params.anthropicExecutor.runJson<T>({
          ...input,
          model: null,
          reasoningEffort: null
        });
      }
      if (this.params.captionProviderConfig.provider === "openrouter") {
        if (!this.params.openRouterExecutor) {
          throw new Error("OpenRouter captions включены, но OpenRouter executor не настроен.");
        }
        return this.params.openRouterExecutor.runJson<T>({
          ...input,
          model: null,
          reasoningEffort: null
        });
      }
    }
    return this.params.codexExecutor.runJson<T>(input);
  }
}
