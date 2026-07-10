import { createHash } from "node:crypto";

export const CHANNEL_PRODUCTION_PROFILE_VERSION = "project-kings-profile-v1" as const;
export const CONCEPT_CONTRACT_VERSION = "concept-v2" as const;
export const MIN_CONTINUITY_UNIQUE_EVENTS = 6;
export const MAX_CONTINUITY_UNIQUE_EVENTS = 12;

export type ConceptShape =
  | "channel"
  | "series"
  | "one-video"
  | "broad"
  | "split"
  | "merge"
  | "reject";

export type InstagramConceptExample = Readonly<{
  id: string;
  url: string;
  storyEventId: string;
  reason: string;
}>;

export type AdjacentConceptCategory = Readonly<{
  categoryId: string;
  difference: string;
}>;

export type ConceptContract = Readonly<{
  contractVersion: typeof CONCEPT_CONTRACT_VERSION;
  conceptId: string;
  label: string;
  conceptShape: ConceptShape;
  instagramCoherence: "pass" | "fail" | "unknown";
  channelPromise: string;
  axes: Readonly<{
    audience: string;
    source: Readonly<{
      platform: "instagram";
      mediaType: "reel";
      description: string;
    }>;
    event: string;
    emotion: string;
    reasonToWatch: string;
    format: string;
  }>;
  inclusions: readonly string[];
  exclusions: readonly string[];
  adjacentCategories: readonly AdjacentConceptCategory[];
  positiveExamples: readonly InstagramConceptExample[];
  negativeExamples: readonly InstagramConceptExample[];
  evidenceBoundary: Readonly<{
    categoryAuthority: "instagram";
    youtubeRole: "market-validation-only";
    youtubeCanWidenCategory: false;
  }>;
  continuityBuffer: Readonly<{
    uniqueStoryEventIds: readonly string[];
  }>;
}>;

export type ChannelProductionProfile = Readonly<{
  profileVersion: typeof CHANNEL_PRODUCTION_PROFILE_VERSION;
  profileId: string;
  youtube: Readonly<{
    channelId: string;
    titleAdvisory: string;
  }>;
  templateIdentity: Readonly<{
    channelId: string;
    templateSha: string;
  }>;
  concept: ConceptContract;
  publication: Readonly<{
    timezone: string;
    slots: readonly Readonly<{
      slotId: string;
      localTime: string;
    }>[];
    limits: Readonly<{
      dailyPublicationLimit: number;
      maxCandidatesPerRun: number;
      maxConcurrentSourceJobs: number;
      maxConcurrentModelCalls: number;
      maxConcurrentRenders: number;
    }>;
    retryPolicy: Readonly<{
      strategy: "exponential";
      maxAttempts: number;
      initialDelayMs: number;
      maxDelayMs: number;
      retryableErrorCodes: readonly string[];
      nonRetryableErrorCodes: readonly string[];
    }>;
  }>;
  credentialRefs: Readonly<{
    youtubePublishing: string;
    instagramSource: string;
  }>;
}>;

export type ProfileValidationIssue = Readonly<{
  path: string;
  code: string;
  message: string;
}>;

export class ChannelProductionProfileValidationError extends Error {
  readonly issues: readonly ProfileValidationIssue[];

  constructor(issues: readonly ProfileValidationIssue[]) {
    super(
      `Channel production profile is invalid: ${issues
        .map((issue) => `${issue.path} ${issue.message}`)
        .join("; ")}`
    );
    this.name = "ChannelProductionProfileValidationError";
    this.issues = issues;
  }
}

export function collectUniqueStoryEventIds(
  examples: readonly Pick<InstagramConceptExample, "storyEventId">[]
): readonly string[] {
  return Object.freeze(
    Array.from(
      new Set(
        examples
          .map((example) => example.storyEventId.trim())
          .filter(Boolean)
      )
    )
  );
}

type UnknownRecord = Record<string, unknown>;

const YOUTUBE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const CLIPS_CHANNEL_ID = /^[a-f0-9]{32}$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const CREDENTIAL_REFERENCE = /^credential-ref:\/\/[a-z0-9][a-z0-9._/-]*$/;
const ERROR_CODE = /^[a-z][a-z0-9_:-]*$/;
const DENIED_SECRET_KEYS = new Set([
  "apikey",
  "api_key",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "clientsecret",
  "client_secret",
  "password",
  "secret",
  "token",
  "cookie",
  "cookies"
]);

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function addIssue(
  issues: ProfileValidationIssue[],
  path: string,
  code: string,
  message: string
): void {
  issues.push({ path, code, message });
}

function validateKnownKeys(
  value: UnknownRecord,
  path: string,
  allowed: readonly string[],
  issues: ProfileValidationIssue[]
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      addIssue(issues, `${path}.${key}`, "unknown_field", "is not part of this contract.");
    }
  }
}

function validateRequiredString(
  value: unknown,
  path: string,
  issues: ProfileValidationIssue[],
  options: { min?: number; max?: number } = {}
): value is string {
  const min = options.min ?? 1;
  const max = options.max ?? 2_000;
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    addIssue(
      issues,
      path,
      "invalid_string",
      `must be a trimmed string between ${min} and ${max} characters.`
    );
    return false;
  }
  if (value !== value.trim()) {
    addIssue(issues, path, "untrimmed_string", "must not have leading or trailing whitespace.");
    return false;
  }
  return true;
}

function validateInteger(
  value: unknown,
  path: string,
  issues: ProfileValidationIssue[],
  min: number,
  max: number
): value is number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    addIssue(issues, path, "invalid_integer", `must be an integer from ${min} through ${max}.`);
    return false;
  }
  return true;
}

function validateStringList(
  value: unknown,
  path: string,
  issues: ProfileValidationIssue[],
  options: { min: number; max: number; pattern?: RegExp }
): string[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "invalid_list", "must be an array.");
    return [];
  }
  if (value.length < options.min || value.length > options.max) {
    addIssue(
      issues,
      path,
      "invalid_list_size",
      `must contain between ${options.min} and ${options.max} items.`
    );
  }
  const valid: string[] = [];
  value.forEach((entry, index) => {
    if (validateRequiredString(entry, `${path}[${index}]`, issues, { max: 1_000 })) {
      if (options.pattern && !options.pattern.test(entry)) {
        addIssue(issues, `${path}[${index}]`, "invalid_format", "has an invalid format.");
      }
      valid.push(entry);
    }
  });
  if (new Set(valid).size !== valid.length) {
    addIssue(issues, path, "duplicate_items", "must contain unique items.");
  }
  return valid;
}

function isInstagramReelUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host === "instagram.com" && /^\/reel\/[^/]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function validateExamples(
  value: unknown,
  path: string,
  issues: ProfileValidationIssue[],
  minimumExamples: number
): InstagramConceptExample[] {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "invalid_examples", "must be an array of Instagram examples.");
    return [];
  }
  if (value.length < minimumExamples || value.length > 20) {
    addIssue(
      issues,
      path,
      "invalid_example_count",
      `must contain between ${minimumExamples} and 20 examples.`
    );
  }

  const valid: InstagramConceptExample[] = [];
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      addIssue(issues, entryPath, "invalid_example", "must be an object.");
      return;
    }
    validateKnownKeys(entry, entryPath, ["id", "url", "storyEventId", "reason"], issues);
    const idOk = validateRequiredString(entry.id, `${entryPath}.id`, issues, { max: 120 });
    const urlOk = validateRequiredString(entry.url, `${entryPath}.url`, issues, { max: 500 });
    const storyOk = validateRequiredString(entry.storyEventId, `${entryPath}.storyEventId`, issues, {
      max: 160
    });
    const reasonOk = validateRequiredString(entry.reason, `${entryPath}.reason`, issues, {
      min: 12,
      max: 500
    });
    if (urlOk && !isInstagramReelUrl(entry.url as string)) {
      addIssue(
        issues,
        `${entryPath}.url`,
        "non_instagram_evidence",
        "must be a canonical Instagram Reel URL; YouTube is market validation only."
      );
    }
    if (idOk && urlOk && storyOk && reasonOk && isInstagramReelUrl(entry.url as string)) {
      valid.push(entry as InstagramConceptExample);
    }
  });

  const urls = valid.map((entry) => entry.url);
  const ids = valid.map((entry) => entry.id);
  if (new Set(urls).size !== urls.length) {
    addIssue(issues, path, "duplicate_example_urls", "must not repeat the same Reel URL.");
  }
  if (new Set(ids).size !== ids.length) {
    addIssue(issues, path, "duplicate_example_ids", "must contain unique example ids.");
  }
  return valid;
}

function validateAdjacentCategories(
  value: unknown,
  path: string,
  issues: ProfileValidationIssue[]
): void {
  if (!Array.isArray(value)) {
    addIssue(issues, path, "invalid_adjacent_categories", "must be an array.");
    return;
  }
  if (value.length < 3 || value.length > 7) {
    addIssue(issues, path, "invalid_adjacent_count", "must contain between 3 and 7 categories.");
  }
  const categoryIds: string[] = [];
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      addIssue(issues, entryPath, "invalid_adjacent_category", "must be an object.");
      return;
    }
    validateKnownKeys(entry, entryPath, ["categoryId", "difference"], issues);
    if (validateRequiredString(entry.categoryId, `${entryPath}.categoryId`, issues, { max: 120 })) {
      categoryIds.push(entry.categoryId as string);
    }
    validateRequiredString(entry.difference, `${entryPath}.difference`, issues, {
      min: 12,
      max: 500
    });
  });
  if (new Set(categoryIds).size !== categoryIds.length) {
    addIssue(issues, path, "duplicate_adjacent_categories", "must contain unique category ids.");
  }
}

function findEmbeddedSecrets(
  value: unknown,
  path: string,
  issues: ProfileValidationIssue[]
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findEmbeddedSecrets(entry, `${path}[${index}]`, issues));
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (DENIED_SECRET_KEYS.has(key.toLowerCase())) {
      addIssue(
        issues,
        `${path}.${key}`,
        "embedded_secret",
        "must not contain credentials; store only credential-ref:// references."
      );
    }
    findEmbeddedSecrets(child, `${path}.${key}`, issues);
  }
}

export function validateConceptContract(value: unknown): readonly ProfileValidationIssue[] {
  const issues: ProfileValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ path: "concept", code: "invalid_concept", message: "must be an object." }];
  }

  validateKnownKeys(
    value,
    "concept",
    [
      "contractVersion",
      "conceptId",
      "label",
      "conceptShape",
      "instagramCoherence",
      "channelPromise",
      "axes",
      "inclusions",
      "exclusions",
      "adjacentCategories",
      "positiveExamples",
      "negativeExamples",
      "evidenceBoundary",
      "continuityBuffer"
    ],
    issues
  );

  if (value.contractVersion !== CONCEPT_CONTRACT_VERSION) {
    addIssue(
      issues,
      "concept.contractVersion",
      "legacy_concept_contract",
      `must equal ${CONCEPT_CONTRACT_VERSION}; v1 concept artifacts are not launch inputs.`
    );
  }
  validateRequiredString(value.conceptId, "concept.conceptId", issues, { max: 160 });
  validateRequiredString(value.label, "concept.label", issues, { max: 160 });
  if (value.conceptShape !== "channel") {
    addIssue(
      issues,
      "concept.conceptShape",
      value.conceptShape === "one-video" ? "one_video_concept" : "non_channel_concept",
      "must be channel; broad, one-video, series, split, merge, and rejected concepts cannot launch."
    );
  }
  if (value.instagramCoherence !== "pass") {
    addIssue(
      issues,
      "concept.instagramCoherence",
      "instagram_coherence_not_proven",
      "must be pass before the category can drive production."
    );
  }
  validateRequiredString(value.channelPromise, "concept.channelPromise", issues, {
    min: 20,
    max: 500
  });

  if (!isRecord(value.axes)) {
    addIssue(issues, "concept.axes", "invalid_axes", "must be an object.");
  } else {
    validateKnownKeys(
      value.axes,
      "concept.axes",
      ["audience", "source", "event", "emotion", "reasonToWatch", "format"],
      issues
    );
    for (const field of ["audience", "event", "emotion", "reasonToWatch", "format"] as const) {
      validateRequiredString(value.axes[field], `concept.axes.${field}`, issues, {
        min: 12,
        max: 500
      });
    }
    if (!isRecord(value.axes.source)) {
      addIssue(issues, "concept.axes.source", "invalid_source_axis", "must be an object.");
    } else {
      validateKnownKeys(
        value.axes.source,
        "concept.axes.source",
        ["platform", "mediaType", "description"],
        issues
      );
      if (value.axes.source.platform !== "instagram") {
        addIssue(
          issues,
          "concept.axes.source.platform",
          "invalid_boundary_source",
          "must be instagram."
        );
      }
      if (value.axes.source.mediaType !== "reel") {
        addIssue(issues, "concept.axes.source.mediaType", "invalid_media_type", "must be reel.");
      }
      validateRequiredString(
        value.axes.source.description,
        "concept.axes.source.description",
        issues,
        { min: 12, max: 500 }
      );
    }
  }

  validateStringList(value.inclusions, "concept.inclusions", issues, { min: 3, max: 20 });
  validateStringList(value.exclusions, "concept.exclusions", issues, { min: 3, max: 20 });
  validateAdjacentCategories(value.adjacentCategories, "concept.adjacentCategories", issues);
  validateExamples(value.positiveExamples, "concept.positiveExamples", issues, 3);
  validateExamples(value.negativeExamples, "concept.negativeExamples", issues, 5);

  if (!isRecord(value.evidenceBoundary)) {
    addIssue(issues, "concept.evidenceBoundary", "invalid_evidence_boundary", "must be an object.");
  } else {
    validateKnownKeys(
      value.evidenceBoundary,
      "concept.evidenceBoundary",
      ["categoryAuthority", "youtubeRole", "youtubeCanWidenCategory"],
      issues
    );
    if (value.evidenceBoundary.categoryAuthority !== "instagram") {
      addIssue(
        issues,
        "concept.evidenceBoundary.categoryAuthority",
        "invalid_category_authority",
        "must be instagram."
      );
    }
    if (value.evidenceBoundary.youtubeRole !== "market-validation-only") {
      addIssue(
        issues,
        "concept.evidenceBoundary.youtubeRole",
        "invalid_youtube_role",
        "must be market-validation-only."
      );
    }
    if (value.evidenceBoundary.youtubeCanWidenCategory !== false) {
      addIssue(
        issues,
        "concept.evidenceBoundary.youtubeCanWidenCategory",
        "youtube_boundary_widening_forbidden",
        "must be false."
      );
    }
  }

  if (!isRecord(value.continuityBuffer)) {
    addIssue(issues, "concept.continuityBuffer", "invalid_continuity_buffer", "must be an object.");
  } else {
    validateKnownKeys(
      value.continuityBuffer,
      "concept.continuityBuffer",
      ["uniqueStoryEventIds"],
      issues
    );
    validateStringList(
      value.continuityBuffer.uniqueStoryEventIds,
      "concept.continuityBuffer.uniqueStoryEventIds",
      issues,
      { min: MIN_CONTINUITY_UNIQUE_EVENTS, max: MAX_CONTINUITY_UNIQUE_EVENTS }
    );
  }

  return issues;
}

function validateTimezone(value: unknown, path: string, issues: ProfileValidationIssue[]): void {
  if (!validateRequiredString(value, path, issues, { max: 80 })) {
    return;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value as string }).format();
  } catch {
    addIssue(issues, path, "invalid_timezone", "must be a valid IANA timezone.");
  }
}

function validateCredentialReference(
  value: unknown,
  path: string,
  issues: ProfileValidationIssue[]
): void {
  if (
    validateRequiredString(value, path, issues, { max: 300 }) &&
    !CREDENTIAL_REFERENCE.test(value as string)
  ) {
    addIssue(
      issues,
      path,
      "invalid_credential_reference",
      "must be a credential-ref:// reference, never a credential value."
    );
  }
}

export function validateChannelProductionProfile(
  value: unknown
): readonly ProfileValidationIssue[] {
  const issues: ProfileValidationIssue[] = [];
  if (!isRecord(value)) {
    return [{ path: "profile", code: "invalid_profile", message: "must be an object." }];
  }
  findEmbeddedSecrets(value, "profile", issues);
  validateKnownKeys(
    value,
    "profile",
    [
      "profileVersion",
      "profileId",
      "youtube",
      "templateIdentity",
      "concept",
      "publication",
      "credentialRefs"
    ],
    issues
  );
  if (value.profileVersion !== CHANNEL_PRODUCTION_PROFILE_VERSION) {
    addIssue(
      issues,
      "profile.profileVersion",
      "unsupported_profile_version",
      `must equal ${CHANNEL_PRODUCTION_PROFILE_VERSION}.`
    );
  }
  const profileIdOk = validateRequiredString(value.profileId, "profile.profileId", issues, {
    max: 160
  });
  if (profileIdOk && !CLIPS_CHANNEL_ID.test(value.profileId as string)) {
    addIssue(
      issues,
      "profile.profileId",
      "invalid_clips_channel_id",
      "must be the stable 32-character Clips channel ID."
    );
  }

  if (!isRecord(value.youtube)) {
    addIssue(issues, "profile.youtube", "invalid_youtube_identity", "must be an object.");
  } else {
    validateKnownKeys(value.youtube, "profile.youtube", ["channelId", "titleAdvisory"], issues);
    if (
      validateRequiredString(value.youtube.channelId, "profile.youtube.channelId", issues, {
        max: 24
      }) &&
      !YOUTUBE_CHANNEL_ID.test(value.youtube.channelId as string)
    ) {
      addIssue(
        issues,
        "profile.youtube.channelId",
        "invalid_youtube_channel_id",
        "must be a stable UC... YouTube channel ID, not a title or handle."
      );
    }
    validateRequiredString(value.youtube.titleAdvisory, "profile.youtube.titleAdvisory", issues, {
      max: 120
    });
  }

  if (!isRecord(value.templateIdentity)) {
    addIssue(issues, "profile.templateIdentity", "invalid_template_identity", "must be an object.");
  } else {
    validateKnownKeys(
      value.templateIdentity,
      "profile.templateIdentity",
      ["channelId", "templateSha"],
      issues
    );
    const channelIdOk = validateRequiredString(
      value.templateIdentity.channelId,
      "profile.templateIdentity.channelId",
      issues,
      { max: 160 }
    );
    if (channelIdOk && !CLIPS_CHANNEL_ID.test(value.templateIdentity.channelId as string)) {
      addIssue(
        issues,
        "profile.templateIdentity.channelId",
        "invalid_template_channel_id",
        "must be the stable 32-character Clips channel ID."
      );
    }
    if (profileIdOk && channelIdOk && value.templateIdentity.channelId !== value.profileId) {
      addIssue(
        issues,
        "profile.templateIdentity.channelId",
        "template_channel_mismatch",
        "must match profileId so a template cannot drift across channels."
      );
    }
    if (
      validateRequiredString(
        value.templateIdentity.templateSha,
        "profile.templateIdentity.templateSha",
        issues,
        { min: 64, max: 64 }
      ) &&
      !SHA256_HEX.test(value.templateIdentity.templateSha as string)
    ) {
      addIssue(
        issues,
        "profile.templateIdentity.templateSha",
        "invalid_template_sha",
        "must be a lowercase SHA-256 digest."
      );
    }
  }

  issues.push(...validateConceptContract(value.concept));

  if (!isRecord(value.publication)) {
    addIssue(issues, "profile.publication", "invalid_publication_policy", "must be an object.");
  } else {
    validateKnownKeys(
      value.publication,
      "profile.publication",
      ["timezone", "slots", "limits", "retryPolicy"],
      issues
    );
    validateTimezone(value.publication.timezone, "profile.publication.timezone", issues);
    const slots = value.publication.slots;
    const slotIds: string[] = [];
    const localTimes: string[] = [];
    if (!Array.isArray(slots) || slots.length < 1 || slots.length > 12) {
      addIssue(
        issues,
        "profile.publication.slots",
        "invalid_publication_slots",
        "must contain between 1 and 12 slots."
      );
    } else {
      slots.forEach((slot, index) => {
        const slotPath = `profile.publication.slots[${index}]`;
        if (!isRecord(slot)) {
          addIssue(issues, slotPath, "invalid_publication_slot", "must be an object.");
          return;
        }
        validateKnownKeys(slot, slotPath, ["slotId", "localTime"], issues);
        if (validateRequiredString(slot.slotId, `${slotPath}.slotId`, issues, { max: 80 })) {
          slotIds.push(slot.slotId as string);
        }
        if (
          validateRequiredString(slot.localTime, `${slotPath}.localTime`, issues, { min: 5, max: 5 })
        ) {
          if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot.localTime as string)) {
            addIssue(issues, `${slotPath}.localTime`, "invalid_local_time", "must use HH:MM.");
          } else {
            localTimes.push(slot.localTime as string);
          }
        }
      });
    }
    if (new Set(slotIds).size !== slotIds.length) {
      addIssue(issues, "profile.publication.slots", "duplicate_slot_ids", "slot ids must be unique.");
    }
    if (new Set(localTimes).size !== localTimes.length) {
      addIssue(
        issues,
        "profile.publication.slots",
        "duplicate_slot_times",
        "slot times must be unique."
      );
    }

    if (!isRecord(value.publication.limits)) {
      addIssue(issues, "profile.publication.limits", "invalid_limits", "must be an object.");
    } else {
      const limits = value.publication.limits;
      validateKnownKeys(
        limits,
        "profile.publication.limits",
        [
          "dailyPublicationLimit",
          "maxCandidatesPerRun",
          "maxConcurrentSourceJobs",
          "maxConcurrentModelCalls",
          "maxConcurrentRenders"
        ],
        issues
      );
      const dailyPublicationLimit = limits.dailyPublicationLimit;
      const maxCandidatesPerRun = limits.maxCandidatesPerRun;
      const dailyOk = validateInteger(
        dailyPublicationLimit,
        "profile.publication.limits.dailyPublicationLimit",
        issues,
        1,
        12
      );
      const candidatesOk = validateInteger(
        maxCandidatesPerRun,
        "profile.publication.limits.maxCandidatesPerRun",
        issues,
        1,
        50
      );
      validateInteger(
        limits.maxConcurrentSourceJobs,
        "profile.publication.limits.maxConcurrentSourceJobs",
        issues,
        1,
        12
      );
      validateInteger(
        limits.maxConcurrentModelCalls,
        "profile.publication.limits.maxConcurrentModelCalls",
        issues,
        1,
        24
      );
      validateInteger(
        limits.maxConcurrentRenders,
        "profile.publication.limits.maxConcurrentRenders",
        issues,
        1,
        8
      );
      if (dailyOk && Array.isArray(slots) && dailyPublicationLimit > slots.length) {
        addIssue(
          issues,
          "profile.publication.limits.dailyPublicationLimit",
          "daily_limit_exceeds_slots",
          "cannot exceed the number of publication slots."
        );
      }
      if (dailyOk && candidatesOk && maxCandidatesPerRun < dailyPublicationLimit) {
        addIssue(
          issues,
          "profile.publication.limits.maxCandidatesPerRun",
          "candidate_budget_too_small",
          "must be at least dailyPublicationLimit."
        );
      }
    }

    if (!isRecord(value.publication.retryPolicy)) {
      addIssue(issues, "profile.publication.retryPolicy", "invalid_retry_policy", "must be an object.");
    } else {
      const retry = value.publication.retryPolicy;
      validateKnownKeys(
        retry,
        "profile.publication.retryPolicy",
        [
          "strategy",
          "maxAttempts",
          "initialDelayMs",
          "maxDelayMs",
          "retryableErrorCodes",
          "nonRetryableErrorCodes"
        ],
        issues
      );
      if (retry.strategy !== "exponential") {
        addIssue(
          issues,
          "profile.publication.retryPolicy.strategy",
          "invalid_retry_strategy",
          "must be exponential."
        );
      }
      validateInteger(
        retry.maxAttempts,
        "profile.publication.retryPolicy.maxAttempts",
        issues,
        1,
        8
      );
      const initialDelayMs = retry.initialDelayMs;
      const maxDelayMs = retry.maxDelayMs;
      const initialOk = validateInteger(
        initialDelayMs,
        "profile.publication.retryPolicy.initialDelayMs",
        issues,
        100,
        300_000
      );
      const maxOk = validateInteger(
        maxDelayMs,
        "profile.publication.retryPolicy.maxDelayMs",
        issues,
        100,
        900_000
      );
      if (initialOk && maxOk && maxDelayMs < initialDelayMs) {
        addIssue(
          issues,
          "profile.publication.retryPolicy.maxDelayMs",
          "invalid_retry_delay_range",
          "must be greater than or equal to initialDelayMs."
        );
      }
      const retryable = validateStringList(
        retry.retryableErrorCodes,
        "profile.publication.retryPolicy.retryableErrorCodes",
        issues,
        { min: 1, max: 30, pattern: ERROR_CODE }
      );
      const nonRetryable = validateStringList(
        retry.nonRetryableErrorCodes,
        "profile.publication.retryPolicy.nonRetryableErrorCodes",
        issues,
        { min: 1, max: 30, pattern: ERROR_CODE }
      );
      const nonRetryableSet = new Set(nonRetryable);
      if (retryable.some((code) => nonRetryableSet.has(code))) {
        addIssue(
          issues,
          "profile.publication.retryPolicy",
          "overlapping_retry_codes",
          "the same error code cannot be both retryable and non-retryable."
        );
      }
    }
  }

  if (!isRecord(value.credentialRefs)) {
    addIssue(issues, "profile.credentialRefs", "invalid_credential_refs", "must be an object.");
  } else {
    validateKnownKeys(
      value.credentialRefs,
      "profile.credentialRefs",
      ["youtubePublishing", "instagramSource"],
      issues
    );
    validateCredentialReference(
      value.credentialRefs.youtubePublishing,
      "profile.credentialRefs.youtubePublishing",
      issues
    );
    validateCredentialReference(
      value.credentialRefs.instagramSource,
      "profile.credentialRefs.instagramSource",
      issues
    );
  }

  return issues;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  for (const child of Object.values(value as UnknownRecord)) {
    deepFreeze(child);
  }
  return value;
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Template identity cannot hash non-finite numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((entry) => (entry === undefined ? "null" : stableSerialize(entry)))
      .join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  throw new Error(`Template identity cannot hash value of type ${typeof value}.`);
}

export function calculateTemplateSha(templateSnapshot: unknown): string {
  return createHash("sha256").update(stableSerialize(templateSnapshot)).digest("hex");
}

export function defineChannelProductionProfile(value: unknown): ChannelProductionProfile {
  const issues = validateChannelProductionProfile(value);
  if (issues.length > 0) {
    throw new ChannelProductionProfileValidationError(issues);
  }
  return deepFreeze(structuredClone(value) as ChannelProductionProfile);
}
