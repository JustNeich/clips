import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeStage3EditorPreviewNotice,
  normalizeStage3SourceFailureNotice
} from "../lib/stage3-preview-notice";

test("editor preview notice hides low-level yt-dlp diagnostics on local executor", () => {
  const message = normalizeStage3EditorPreviewNotice(
    "YouTube отклонил запрос на этом сервере (anti-bot/auth). Если YTDLP_COOKIES уже заданы, проблема может быть в IP или репутации runtime.",
    "local"
  );

  assert.equal(
    message,
    "Не удалось подготовить исходник для Stage 3 preview на локальном executor. Проверьте ссылку из Шага 1 или откройте логи executor."
  );
});

test("editor preview notice preserves already user-facing editor errors", () => {
  const message = normalizeStage3EditorPreviewNotice(
    "Не удалось обновить статус proxy-видео."
  );

  assert.equal(message, "Не удалось обновить статус proxy-видео.");
});

test("render notice hides low-level yt-dlp diagnostics behind Stage 3 wording", () => {
  const message = normalizeStage3SourceFailureNotice(
    "YouTube отклонил запрос на этом сервере (anti-bot/auth). Если YTDLP_COOKIES уже заданы, проблема может быть в IP или репутации runtime.",
    { mode: "render" }
  );

  assert.equal(
    message,
    "Не удалось подготовить исходник для Stage 3 рендера. Проверьте ссылку из Шага 1."
  );
});

test("accurate preview notice preserves local executor context", () => {
  const message = normalizeStage3SourceFailureNotice(
    "yt-dlp не смог скачать исходное видео.",
    {
      mode: "accurate-preview",
      executionTarget: "local"
    }
  );

  assert.equal(
    message,
    "Не удалось подготовить исходник для точного clip-preview на локальном executor. Проверьте ссылку из Шага 1 или откройте логи executor."
  );
});
