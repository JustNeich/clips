import path from "node:path";
import { constants, promises as fs } from "node:fs";

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveAbsoluteOrRelative(candidate: string): Promise<string | null> {
  const filePath = path.isAbsolute(candidate) ? candidate : path.resolve(candidate);
  return (await isExecutable(filePath)) ? filePath : null;
}

async function resolveFromPath(command: string): Promise<string | null> {
  const pathEnv = process.env.PATH?.trim();
  if (!pathEnv) {
    return null;
  }

  for (const dir of pathEnv.split(path.delimiter)) {
    const trimmed = dir.trim();
    if (!trimmed) {
      continue;
    }
    const candidate = path.join(trimmed, command);
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function resolveExecutableCandidate(candidateRaw: string | null | undefined): Promise<string | null> {
  const candidate = candidateRaw?.trim();
  if (!candidate) {
    return null;
  }

  if (candidate.includes("/") || candidate.startsWith(".")) {
    return resolveAbsoluteOrRelative(candidate);
  }

  return resolveFromPath(candidate);
}

export async function resolveExecutableFromCandidates(
  candidates: Array<string | null | undefined>
): Promise<string | null> {
  for (const candidate of candidates) {
    const resolved = await resolveExecutableCandidate(candidate);
    if (resolved) {
      return resolved;
    }
  }
  return null;
}
