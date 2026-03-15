import { createHash, randomBytes } from "node:crypto";

export type Stage3VariationSeed = string;
export type Stage3VariationMode = "off" | "encode" | "hybrid";
export type Stage3VariationX264Preset = "slow" | "medium";

export type Stage3VariationSignalProfile = {
  enabled: boolean;
  seed: number;
  baseFrequencyX: number;
  baseFrequencyY: number;
  numOctaves: 1 | 2;
  opacity: number;
  blendMode: "soft-light";
};

export type Stage3VariationEncodeProfile = {
  codec: "h264";
  pixelFormat: "yuv420p";
  crf: 17 | 18 | 19;
  x264Preset: Stage3VariationX264Preset;
  keyintFrames: number;
  keyintMinFrames: number;
};

export type Stage3VariationContainerProfile = {
  faststart: true;
  metadataNonce: string;
  metadataTagKey: "variation_seed";
};

export type Stage3VariationProfile = {
  profileVersion: 1;
  seed: Stage3VariationSeed;
  requestedMode: Stage3VariationMode;
  appliedMode: Stage3VariationMode;
  signal: Stage3VariationSignalProfile;
  encode: Stage3VariationEncodeProfile;
  container: Stage3VariationContainerProfile;
};

export type Stage3VariationManifest = {
  profileVersion: 1;
  seed: Stage3VariationSeed;
  requestedMode: Stage3VariationMode;
  appliedMode: Stage3VariationMode;
  templateId: string;
  snapshotHash: string;
  specRevision: string;
  fitRevision: string;
  outputName: string;
  generatedAt: string;
  signal: Stage3VariationSignalProfile;
  encode: Stage3VariationEncodeProfile;
  container: Stage3VariationContainerProfile;
};

const DEFAULT_MODE: Stage3VariationMode = "hybrid";
const HEX_SEED_RE = /^[0-9a-f]{32}$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function parseMode(value: string | undefined | null): Stage3VariationMode {
  if (value === "off" || value === "encode" || value === "hybrid") {
    return value;
  }
  return DEFAULT_MODE;
}

function boolFromEnv(value: string | undefined | null): boolean {
  return value?.trim() === "1";
}

function resolveSeedOverride(rawValue: string | null | undefined): string | null {
  const trimmed = rawValue?.trim().toLowerCase() ?? "";
  if (!trimmed) {
    return null;
  }
  return HEX_SEED_RE.test(trimmed) ? trimmed : null;
}

function readSeedUnit(seed: string, salt: string): number {
  const digest = createHash("sha256").update(seed).update(":").update(salt).digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

function readSeedInt(seed: string, salt: string, min: number, max: number): number {
  if (max <= min) {
    return min;
  }
  const unit = readSeedUnit(seed, salt);
  return min + Math.floor(unit * (max - min + 1));
}

function readSeedChoice<T>(seed: string, salt: string, options: readonly T[]): T {
  return options[readSeedInt(seed, salt, 0, Math.max(0, options.length - 1))]!;
}

function defaultEncodeProfile(): Stage3VariationEncodeProfile {
  return {
    codec: "h264",
    pixelFormat: "yuv420p",
    crf: 18,
    x264Preset: "medium",
    keyintFrames: 60,
    keyintMinFrames: 58
  };
}

function defaultSignalProfile(): Stage3VariationSignalProfile {
  return {
    enabled: false,
    seed: 0,
    baseFrequencyX: 1,
    baseFrequencyY: 1,
    numOctaves: 1,
    opacity: 0,
    blendMode: "soft-light"
  };
}

export function resolveStage3RenderVariationMode(): Stage3VariationMode {
  return parseMode(process.env.STAGE3_RENDER_VARIATION_MODE?.trim().toLowerCase() ?? undefined);
}

export function generateStage3VariationSeed(requestedSeed?: string | null): Stage3VariationSeed {
  const allowOverride =
    boolFromEnv(process.env.STAGE3_RENDER_VARIATION_ALLOW_SEED_OVERRIDE) ||
    boolFromEnv(process.env.STAGE3_RENDER_VARIATION_DEBUG);
  const requested = allowOverride ? resolveSeedOverride(requestedSeed) : null;
  if (requested) {
    return requested;
  }
  const envSeed = allowOverride ? resolveSeedOverride(process.env.STAGE3_RENDER_VARIATION_DEBUG_SEED) : null;
  if (envSeed) {
    return envSeed;
  }
  return randomBytes(16).toString("hex");
}

export function createStage3VariationProfile(input?: {
  requestedSeed?: string | null;
  requestedMode?: Stage3VariationMode | null;
}): Stage3VariationProfile {
  const requestedMode = input?.requestedMode ?? resolveStage3RenderVariationMode();
  const seed = generateStage3VariationSeed(input?.requestedSeed);
  const keyintFrames = clamp(readSeedInt(seed, "encode:gop", 58, 62), 58, 62);
  const encode: Stage3VariationEncodeProfile =
    requestedMode === "off"
      ? defaultEncodeProfile()
      : {
          codec: "h264",
          pixelFormat: "yuv420p",
          crf: readSeedChoice(seed, "encode:crf", [17, 18, 19] as const),
          x264Preset: readSeedChoice(seed, "encode:preset", ["slow", "medium"] as const),
          keyintFrames,
          keyintMinFrames: Math.min(keyintFrames, clamp(readSeedInt(seed, "encode:keyint-min", 58, 62), 58, 62))
        };

  const signalEnabled = requestedMode === "hybrid";
  const signal: Stage3VariationSignalProfile = signalEnabled
    ? {
        enabled: true,
        seed: readSeedInt(seed, "signal:seed", 1, 2_147_483_647),
        baseFrequencyX: round(0.82 + readSeedUnit(seed, "signal:freq-x") * 0.34, 4),
        baseFrequencyY: round(0.94 + readSeedUnit(seed, "signal:freq-y") * 0.36, 4),
        numOctaves: readSeedChoice(seed, "signal:octaves", [1, 2] as const),
        opacity: round(0.018 + readSeedUnit(seed, "signal:opacity") * 0.014, 4),
        blendMode: "soft-light"
      }
    : defaultSignalProfile();

  return {
    profileVersion: 1,
    seed,
    requestedMode,
    appliedMode: requestedMode,
    signal,
    encode,
    container: {
      faststart: true,
      metadataNonce: createHash("sha256").update(seed).update(":container").digest("hex").slice(0, 16),
      metadataTagKey: "variation_seed"
    }
  };
}

export function createStage3SignalFallbackProfile(
  profile: Stage3VariationProfile
): Stage3VariationProfile {
  if (profile.appliedMode !== "hybrid") {
    return profile;
  }
  return {
    ...profile,
    appliedMode: "encode",
    signal: defaultSignalProfile()
  };
}

export function buildStage3VariationManifest(input: {
  profile: Stage3VariationProfile;
  templateId: string;
  snapshotHash: string;
  specRevision: string;
  fitRevision: string;
  outputName: string;
}): Stage3VariationManifest {
  return {
    profileVersion: input.profile.profileVersion,
    seed: input.profile.seed,
    requestedMode: input.profile.requestedMode,
    appliedMode: input.profile.appliedMode,
    templateId: input.templateId,
    snapshotHash: input.snapshotHash,
    specRevision: input.specRevision,
    fitRevision: input.fitRevision,
    outputName: input.outputName,
    generatedAt: new Date().toISOString(),
    signal: input.profile.signal,
    encode: input.profile.encode,
    container: input.profile.container
  };
}
