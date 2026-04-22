import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { GET as readStage3Background } from "../app/api/stage3/background/[id]/route";
import { POST as uploadSourceRoute } from "../app/api/pipeline/source-upload/route";
import { POST as uploadStage3Background } from "../app/api/stage3/background/route";
import { APP_SESSION_COOKIE } from "../lib/auth/cookies";
import {
  MultipartUploadError,
  parseMultipartFilesRequest,
  parseMultipartSingleFileRequest
} from "../lib/multipart-upload";
import { ensureSourceMediaCached } from "../lib/source-media-cache";
import { readStage3BackgroundAsset } from "../lib/stage3-background";
import { bootstrapOwner } from "../lib/team-store";

const execFileAsync = promisify(execFile);

async function withIsolatedAppData<T>(run: (appDataDir: string) => Promise<T>): Promise<T> {
  const appDataDir = await mkdtemp(path.join(os.tmpdir(), "clips-multipart-test-"));
  const previousAppDataDir = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = appDataDir;
  delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;

  try {
    return await run(appDataDir);
  } finally {
    delete (globalThis as { __clipsAppDb?: unknown }).__clipsAppDb;
    if (previousAppDataDir === undefined) {
      delete process.env.APP_DATA_DIR;
    } else {
      process.env.APP_DATA_DIR = previousAppDataDir;
    }
    await rm(appDataDir, { recursive: true, force: true });
  }
}

function buildAuthedHeaders(sessionToken: string): Headers {
  const headers = new Headers();
  headers.set("cookie", `${APP_SESSION_COOKIE}=${sessionToken}`);
  return headers;
}

async function createTinyMp4File(input: {
  outputPath: string;
  color: string;
  size?: string;
  withAudio?: boolean;
}): Promise<void> {
  const args = [
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${input.color}:s=${input.size ?? "540x960"}:d=0.6`
  ];

  if (input.withAudio) {
    args.push("-f", "lavfi", "-i", "sine=frequency=330:sample_rate=48000:duration=0.6");
  }

  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");

  if (input.withAudio) {
    args.push("-c:a", "aac", "-ar", "48000", "-ac", "2", "-shortest");
  } else {
    args.push("-an");
  }

  args.push("-movflags", "+faststart", input.outputPath);
  await execFileAsync("ffmpeg", args);
}

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

test("parseMultipartSingleFileRequest preserves UTF-8 file names from browser FormData", async () => {
  const formData = new FormData();
  formData.append(
    "file",
    new File([Buffer.from([1, 2, 3, 4])], "тест upload.mp4", {
      type: "video/mp4"
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

  assert.equal(parsed.file?.name, "тест upload.mp4");
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

test("parseMultipartFilesRequest preserves file order for repeated multipart fields", async () => {
  const formData = new FormData();
  formData.append("channelId", "channel_123");
  formData.append(
    "files",
    new File([Buffer.from([1, 2, 3])], "before.mp4", {
      type: "video/mp4"
    })
  );
  formData.append(
    "files",
    new File([Buffer.from([4, 5, 6])], "after.mp4", {
      type: "video/mp4"
    })
  );

  const parsed = await parseMultipartFilesRequest(
    new Request("http://localhost/api/upload", {
      method: "POST",
      body: formData
    }),
    {
      fileFieldName: "files",
      maxTotalFileBytes: 1024
    }
  );

  assert.equal(parsed.fields.channelId, "channel_123");
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.files[0]?.name, "before.mp4");
  assert.equal(parsed.files[1]?.name, "after.mp4");
});

test("stage3 background upload route accepts multipart files end-to-end", async () => {
  await withIsolatedAppData(async (appDataDir) => {
    const owner = await bootstrapOwner({
      workspaceName: "Background Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });

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
        headers: buildAuthedHeaders(owner.sessionToken),
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

    const stored = await readStage3BackgroundAsset(body.asset?.id ?? "");
    assert.ok(stored);
    assert.ok(stored?.filePath.startsWith(path.join(appDataDir, "stage3-backgrounds")));

    const downloadResponse = await readStage3Background(
      new Request(`http://localhost/api/stage3/background/${body.asset?.id}`, {
        headers: buildAuthedHeaders(owner.sessionToken)
      }),
      { params: Promise.resolve({ id: body.asset?.id ?? "" }) }
    );
    const bytes = new Uint8Array(await downloadResponse.arrayBuffer());
    assert.equal(downloadResponse.status, 200);
    assert.equal(downloadResponse.headers.get("content-type"), "image/png");
    assert.deepEqual(Array.from(bytes), [1, 2, 3, 4]);
  });
});

test("stage3 background upload route returns a parse error for malformed multipart bodies", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Background Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => {
      unhandled.push(error);
    };
    process.on("unhandledRejection", onUnhandledRejection);

    const response = await uploadStage3Background(
      new Request("http://localhost/api/stage3/background", {
        method: "POST",
        headers: {
          "Content-Type": "multipart/form-data",
          cookie: `${APP_SESSION_COOKIE}=${owner.sessionToken}`
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
});

test("source upload route handles multi-mp4 batch uploads as one atomic source flow", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Source Upload Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const chatHistory = await import("../lib/chat-history");
    const sourceJobs = await import("../lib/source-job-store");
    const mediaDir = await mkdtemp(path.join(os.tmpdir(), "clips-source-upload-files-"));

    try {
      const channel = await chatHistory.createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: "Batch Upload Channel",
        username: "batch_upload"
      });

      const firstPath = path.join(mediaDir, "before.mp4");
      const secondPath = path.join(mediaDir, "after.mp4");
      await createTinyMp4File({ outputPath: firstPath, color: "red" });
      await createTinyMp4File({ outputPath: secondPath, color: "blue" });
      const [firstBytes, secondBytes] = await Promise.all([readFile(firstPath), readFile(secondPath)]);

      const formData = new FormData();
      formData.append("channelId", channel.id);
      formData.append("autoRunStage2", "0");
      formData.append(
        "files",
        new File([firstBytes], "before.mp4", {
          type: "video/mp4"
        })
      );
      formData.append(
        "files",
        new File([secondBytes], "after.mp4", {
          type: "video/mp4"
        })
      );

      const response = await uploadSourceRoute(
        new Request("http://localhost/api/pipeline/source-upload", {
          method: "POST",
          headers: buildAuthedHeaders(owner.sessionToken),
          body: formData
        })
      );
      const body = (await response.json()) as {
        chat?: { id?: string; title?: string; url?: string };
        job?: { jobId?: string; sourceUrl?: string };
      };

      assert.equal(response.status, 202);
      assert.ok(body.chat?.id);
      assert.equal(body.chat?.title, "before + after");
      assert.equal(body.job?.sourceUrl, body.chat?.url);

      const chats = await chatHistory.listChats(channel.id);
      assert.equal(chats.length, 1);
      assert.equal(chats[0]?.id, body.chat?.id);

      const jobs = sourceJobs.listSourceJobsForChat(body.chat?.id ?? "", owner.workspace.id, 10);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]?.sourceUrl, body.chat?.url);

      const cached = await ensureSourceMediaCached(body.chat?.url ?? "");
      assert.equal(cached.fileName, "before + after.mp4");
      assert.equal(cached.downloadProvider, "upload");
    } finally {
      await rm(mediaDir, { recursive: true, force: true });
    }
  });
});

test("source upload route accepts a single multipart mp4 and preserves its readable file name", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Source Upload Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const chatHistory = await import("../lib/chat-history");
    const sourceJobs = await import("../lib/source-job-store");
    const mediaDir = await mkdtemp(path.join(os.tmpdir(), "clips-source-upload-single-"));

    try {
      const channel = await chatHistory.createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: "Single Upload Channel",
        username: "single_upload"
      });

      const filePath = path.join(mediaDir, "single.mp4");
      await createTinyMp4File({ outputPath: filePath, color: "purple" });
      const fileBytes = await readFile(filePath);

      const formData = new FormData();
      formData.append("channelId", channel.id);
      formData.append("autoRunStage2", "0");
      formData.append(
        "files",
        new File([fileBytes], "тест upload.mp4", {
          type: "video/mp4"
        })
      );

      const response = await uploadSourceRoute(
        new Request("http://localhost/api/pipeline/source-upload", {
          method: "POST",
          headers: buildAuthedHeaders(owner.sessionToken),
          body: formData
        })
      );
      const body = (await response.json()) as {
        chat?: { id?: string; title?: string; url?: string };
        job?: { sourceUrl?: string };
      };

      assert.equal(response.status, 202);
      assert.ok(body.chat?.id);
      assert.equal(body.chat?.title, "тест upload");
      assert.equal(body.job?.sourceUrl, body.chat?.url);

      const chats = await chatHistory.listChats(channel.id);
      assert.equal(chats.length, 1);
      assert.equal(chats[0]?.title, "тест upload");

      const jobs = sourceJobs.listSourceJobsForChat(body.chat?.id ?? "", owner.workspace.id, 10);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]?.sourceUrl, body.chat?.url);

      const cached = await ensureSourceMediaCached(body.chat?.url ?? "");
      assert.equal(cached.fileName, "тест upload.mp4");
      assert.equal(cached.title, "тест upload");
      assert.equal(cached.downloadProvider, "upload");
    } finally {
      await rm(mediaDir, { recursive: true, force: true });
    }
  });
});

test("source upload route accepts a single raw-body mp4 stream without multipart buffering", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Source Upload Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const chatHistory = await import("../lib/chat-history");
    const sourceJobs = await import("../lib/source-job-store");
    const mediaDir = await mkdtemp(path.join(os.tmpdir(), "clips-source-upload-raw-"));

    try {
      const channel = await chatHistory.createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: "Raw Upload Channel",
        username: "raw_upload"
      });

      const filePath = path.join(mediaDir, "single.mp4");
      await createTinyMp4File({ outputPath: filePath, color: "orange" });
      const fileBytes = await readFile(filePath);
      const headers = buildAuthedHeaders(owner.sessionToken);
      headers.set("Content-Type", "video/mp4");
      headers.set("X-Channel-Id", channel.id);
      headers.set("X-File-Name", encodeURIComponent("тест raw upload.mp4"));
      headers.set("X-Auto-Run-Stage2", "0");

      const response = await uploadSourceRoute(
        new Request("http://localhost/api/pipeline/source-upload", {
          method: "POST",
          headers,
          body: fileBytes
        })
      );
      const body = (await response.json()) as {
        chat?: { id?: string; title?: string; url?: string };
        job?: { sourceUrl?: string };
      };

      assert.equal(response.status, 202);
      assert.ok(body.chat?.id);
      assert.equal(body.chat?.title, "тест raw upload");
      assert.equal(body.job?.sourceUrl, body.chat?.url);

      const chats = await chatHistory.listChats(channel.id);
      assert.equal(chats.length, 1);
      assert.equal(chats[0]?.title, "тест raw upload");

      const jobs = sourceJobs.listSourceJobsForChat(body.chat?.id ?? "", owner.workspace.id, 10);
      assert.equal(jobs.length, 1);
      assert.equal(jobs[0]?.sourceUrl, body.chat?.url);

      const cached = await ensureSourceMediaCached(body.chat?.url ?? "");
      assert.equal(cached.fileName, "тест raw upload.mp4");
      assert.equal(cached.title, "тест raw upload");
      assert.equal(cached.downloadProvider, "upload");
    } finally {
      await rm(mediaDir, { recursive: true, force: true });
    }
  });
});

test("source upload route normalizes mixed audio and frame sizes before combining mp4 parts", async () => {
  await withIsolatedAppData(async () => {
    const owner = await bootstrapOwner({
      workspaceName: "Source Upload Workspace",
      email: "owner@example.com",
      password: "Password123!",
      displayName: "Owner"
    });
    const chatHistory = await import("../lib/chat-history");
    const mediaDir = await mkdtemp(path.join(os.tmpdir(), "clips-source-upload-mixed-"));

    try {
      const channel = await chatHistory.createChannel({
        workspaceId: owner.workspace.id,
        creatorUserId: owner.user.id,
        name: "Batch Upload Channel",
        username: "batch_upload"
      });

      const firstPath = path.join(mediaDir, "before.mp4");
      const secondPath = path.join(mediaDir, "after.mp4");
      await createTinyMp4File({
        outputPath: firstPath,
        color: "green",
        size: "540x960",
        withAudio: false
      });
      await createTinyMp4File({
        outputPath: secondPath,
        color: "yellow",
        size: "720x1280",
        withAudio: true
      });
      const [firstBytes, secondBytes] = await Promise.all([readFile(firstPath), readFile(secondPath)]);

      const formData = new FormData();
      formData.append("channelId", channel.id);
      formData.append(
        "files",
        new File([firstBytes], "before.mp4", {
          type: "video/mp4"
        })
      );
      formData.append(
        "files",
        new File([secondBytes], "after.mp4", {
          type: "video/mp4"
        })
      );

      const response = await uploadSourceRoute(
        new Request("http://localhost/api/pipeline/source-upload", {
          method: "POST",
          headers: buildAuthedHeaders(owner.sessionToken),
          body: formData
        })
      );
      const body = (await response.json()) as {
        chat?: { url?: string };
      };

      assert.equal(response.status, 202);
      const cached = await ensureSourceMediaCached(body.chat?.url ?? "");
      const { stdout } = await execFileAsync("ffprobe", [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height",
        "-of",
        "json",
        cached.sourcePath
      ]);
      const payload = JSON.parse(stdout) as {
        streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
      };
      const streams = Array.isArray(payload.streams) ? payload.streams : [];
      const videoStream = streams.find((stream) => stream.codec_type === "video");

      assert.equal(videoStream?.width, 540);
      assert.equal(videoStream?.height, 960);
      assert.equal(streams.some((stream) => stream.codec_type === "audio"), true);
    } finally {
      await rm(mediaDir, { recursive: true, force: true });
    }
  });
});
