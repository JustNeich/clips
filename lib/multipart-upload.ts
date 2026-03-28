import { createRequire } from "node:module";
import { Readable } from "node:stream";

const require = createRequire(import.meta.url);
const Busboy = require("next/dist/compiled/busboy") as (options: {
  headers: Record<string, string>;
}) => {
  on(event: string, listener: (...args: any[]) => void): void;
};

export class MultipartUploadError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "MultipartUploadError";
    this.status = status;
  }
}

export type ParsedMultipartFile = {
  fieldName: string;
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  sizeBytes: number;
};

export async function parseMultipartSingleFileRequest(
  request: Request,
  options: {
    fileFieldName: string;
    maxFileBytes?: number;
    fileTooLargeMessage?: string;
    parseErrorMessage?: string;
    missingBodyMessage?: string;
  }
): Promise<{
  file: ParsedMultipartFile | null;
  fields: Record<string, string>;
}> {
  const contentType = request.headers.get("content-type")?.trim() ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data") || !request.body) {
    throw new MultipartUploadError(
      options.missingBodyMessage ?? "Передайте multipart/form-data с полем file."
    );
  }

  const parseErrorMessage = options.parseErrorMessage ?? "Не удалось разобрать upload-запрос. Повторите попытку.";

  return await new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: {
          "content-type": contentType
        }
      });
    } catch {
      reject(new MultipartUploadError(parseErrorMessage));
      return;
    }

    const fields: Record<string, string> = {};
    const pendingFiles: Array<Promise<void>> = [];
    let targetFile: ParsedMultipartFile | null = null;
    let deferredError: MultipartUploadError | null = null;
    let settled = false;

    const settleResolve = (value: { file: ParsedMultipartFile | null; fields: Record<string, string> }) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const settleReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(
        error instanceof MultipartUploadError
          ? error
          : new MultipartUploadError(
              error instanceof Error && error.message ? error.message : parseErrorMessage
            )
      );
    };

    parser.on("field", (name: string, value: string) => {
      if (!(name in fields)) {
        fields[name] = value;
      }
    });

    parser.on(
      "file",
      (name: string, stream: NodeJS.ReadableStream, info: unknown, legacyEncoding?: string, legacyMime?: string) => {
        if (name !== options.fileFieldName || targetFile) {
          stream.resume();
          return;
        }

        const meta =
          info && typeof info === "object"
            ? (info as { filename?: string; mimeType?: string })
            : null;
        const fileName = meta?.filename?.trim() || "upload.bin";
        const mimeType = meta?.mimeType?.trim() || legacyMime?.trim() || "application/octet-stream";
        const chunks: Buffer[] = [];
        let sizeBytes = 0;
        let exceededSize = false;

        pendingFiles.push(
          new Promise<void>((fileResolve) => {
            let fileSettled = false;

            const finishFile = () => {
              if (fileSettled) {
                return;
              }
              fileSettled = true;
              fileResolve();
            };

            stream.on("data", (chunk: Buffer | Uint8Array) => {
              if (deferredError || exceededSize) {
                return;
              }
              const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              sizeBytes += buffer.byteLength;
              if (options.maxFileBytes && sizeBytes > options.maxFileBytes) {
                exceededSize = true;
                deferredError = new MultipartUploadError(
                  options.fileTooLargeMessage ??
                    `Файл слишком большой. Максимум ${Math.round(options.maxFileBytes / (1024 * 1024))} MB.`
                );
                chunks.length = 0;
                stream.resume();
                return;
              }
              chunks.push(buffer);
            });
            stream.on("end", () => {
              if (!exceededSize && !deferredError) {
                targetFile = {
                  fieldName: name,
                  name: fileName,
                  mimeType,
                  bytes: new Uint8Array(Buffer.concat(chunks)),
                  sizeBytes
                };
              }
              finishFile();
            });
            stream.on("error", (error) => {
              void error;
              deferredError ??= new MultipartUploadError(parseErrorMessage);
              settleReject(deferredError);
              finishFile();
            });
          })
        );
      }
    );

    parser.on("error", (error: unknown) => {
      void error;
      settleReject(new MultipartUploadError(parseErrorMessage));
    });

    parser.on("finish", () => {
      void Promise.all(pendingFiles)
        .then(() => {
          if (deferredError) {
            settleReject(deferredError);
            return;
          }
          settleResolve({
            file: targetFile,
            fields
          });
        })
        .catch(settleReject);
    });

    Readable.fromWeb(request.body as any)
      .on("error", () => {
        settleReject(new MultipartUploadError(parseErrorMessage));
      })
      .pipe(parser as any);
  });
}
