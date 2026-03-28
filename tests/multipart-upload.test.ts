import assert from "node:assert/strict";
import test from "node:test";

import { POST as uploadStage3Background } from "../app/api/stage3/background/route";
import {
  MultipartUploadError,
  parseMultipartSingleFileRequest
} from "../lib/multipart-upload";

test("parseMultipartSingleFileRequest reads a file and text fields from browser FormData", async () => {
  const formData = new FormData();
  formData.append("kind", "background");
  formData.append(
    "file",
    new File([Buffer.from([1, 2, 3, 4])], "bg.png", {
      type: "image/png"
    })
  );

  const parsed = await parseMultipartSingleFileRequest(
    new Request("http://localhost/api/upload", {
      method: "POST",
      body: formData
    }),
    {
      fileFieldName: "file",
      maxFileBytes: 1024
    }
  );

  assert.equal(parsed.fields.kind, "background");
  assert.equal(parsed.file?.name, "bg.png");
  assert.equal(parsed.file?.mimeType, "image/png");
  assert.equal(parsed.file?.sizeBytes, 4);
  assert.deepEqual(Array.from(parsed.file?.bytes ?? []), [1, 2, 3, 4]);
});

test("parseMultipartSingleFileRequest rejects oversized uploads with a stable 400-class error", async () => {
  const formData = new FormData();
  formData.append(
    "file",
    new File([Buffer.from([1, 2, 3, 4, 5])], "bg.png", {
      type: "image/png"
    })
  );

  await assert.rejects(
    () =>
      parseMultipartSingleFileRequest(
        new Request("http://localhost/api/upload", {
          method: "POST",
          body: formData
        }),
        {
          fileFieldName: "file",
          maxFileBytes: 4,
          fileTooLargeMessage: "Файл слишком большой."
        }
      ),
    (error: unknown) =>
      error instanceof MultipartUploadError &&
      error.status === 400 &&
      error.message === "Файл слишком большой."
  );
});

test("parseMultipartSingleFileRequest surfaces malformed multipart bodies as parse errors instead of fake missing-file errors", async () => {
  await assert.rejects(
    () =>
      parseMultipartSingleFileRequest(
        new Request("http://localhost/api/upload", {
          method: "POST",
          headers: {
            "Content-Type": "multipart/form-data"
          },
          body: "--broken-boundary\r\n"
        }),
        {
          fileFieldName: "file",
          parseErrorMessage: "Не удалось разобрать upload."
        }
      ),
    (error: unknown) =>
      error instanceof MultipartUploadError &&
      error.status === 400 &&
      error.message === "Не удалось разобрать upload."
  );
});

test("stage3 background upload route accepts multipart files end-to-end", async () => {
  const formData = new FormData();
  formData.append(
    "file",
    new File([Buffer.from([1, 2, 3, 4])], "bg.png", {
      type: "image/png"
    })
  );

  const response = await uploadStage3Background(
    new Request("http://localhost/api/stage3/background", {
      method: "POST",
      body: formData
    })
  );
  const body = (await response.json()) as {
    asset?: { id?: string; url?: string; mimeType?: string; kind?: string; sizeBytes?: number };
  };

  assert.equal(response.status, 200);
  assert.ok(body.asset?.id);
  assert.equal(body.asset?.mimeType, "image/png");
  assert.equal(body.asset?.kind, "image");
  assert.equal(body.asset?.sizeBytes, 4);
  assert.ok(body.asset?.url?.includes(body.asset.id ?? ""));
});

test("stage3 background upload route returns a parse error for malformed multipart bodies", async () => {
  const unhandled: unknown[] = [];
  const onUnhandledRejection = (error: unknown) => {
    unhandled.push(error);
  };
  process.on("unhandledRejection", onUnhandledRejection);

  const response = await uploadStage3Background(
    new Request("http://localhost/api/stage3/background", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data"
      },
      body: "--broken-boundary\r\n"
    })
  );
  const body = (await response.json()) as { error?: string };

  try {
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(response.status, 400);
    assert.equal(body.error, "Не удалось разобрать background upload. Повторите загрузку файла.");
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandledRejection);
  }
});
