import { createReadStream, promises as fs } from "node:fs";
import { createNodeStreamResponse } from "./node-stream-response";

type NodeFileResponseOptions = {
  request: Request;
  filePath: string;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

type ParsedByteRange =
  | {
      start: number;
      end: number;
    }
  | null;

function parseByteRange(rangeHeader: string, fileSize: number): ParsedByteRange {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return null;
  }

  const [, startRaw, endRaw] = match;
  if (!startRaw && !endRaw) {
    return null;
  }

  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) {
      return null;
    }
    if (suffixLength >= fileSize) {
      return { start: 0, end: Math.max(0, fileSize - 1) };
    }
    return { start: fileSize - suffixLength, end: Math.max(0, fileSize - 1) };
  }

  const start = Number.parseInt(startRaw, 10);
  if (!Number.isFinite(start) || start < 0 || start >= fileSize) {
    return null;
  }

  if (!endRaw) {
    return { start, end: Math.max(start, fileSize - 1) };
  }

  const parsedEnd = Number.parseInt(endRaw, 10);
  if (!Number.isFinite(parsedEnd) || parsedEnd < start) {
    return null;
  }

  return { start, end: Math.min(parsedEnd, Math.max(0, fileSize - 1)) };
}

export async function createNodeFileResponse({
  request,
  filePath,
  headers,
  signal
}: NodeFileResponseOptions): Promise<Response> {
  const stat = await fs.stat(filePath);
  const fileSize = stat.size;
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Accept-Ranges", "bytes");

  const rangeHeader = request.headers.get("range");
  if (!rangeHeader) {
    responseHeaders.set("Content-Length", String(fileSize));
    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: responseHeaders
      });
    }
    return createNodeStreamResponse({
      stream: createReadStream(filePath),
      signal,
      headers: responseHeaders
    });
  }

  const parsedRange = parseByteRange(rangeHeader, fileSize);
  if (!parsedRange) {
    responseHeaders.set("Content-Range", `bytes */${fileSize}`);
    return new Response(null, {
      status: 416,
      headers: responseHeaders
    });
  }

  const { start, end } = parsedRange;
  const contentLength = end - start + 1;
  responseHeaders.set("Content-Length", String(contentLength));
  responseHeaders.set("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  if (request.method === "HEAD") {
    return new Response(null, {
      status: 206,
      headers: responseHeaders
    });
  }

  return createNodeStreamResponse({
    stream: createReadStream(filePath, { start, end }),
    signal,
    status: 206,
    headers: responseHeaders
  });
}

export function __testOnlyParseByteRange(rangeHeader: string, fileSize: number): ParsedByteRange {
  return parseByteRange(rangeHeader, fileSize);
}
