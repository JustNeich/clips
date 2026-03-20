export type NormalizedStage2TitleOption = {
  option: number;
  title: string;
  titleRu: string;
};

type UnknownRecord = Record<string, unknown>;

function parseJsonLikeString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const startsJson =
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"));
  if (!startsJson) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function getOptionFromRecord(record: UnknownRecord, fallbackIndex: number): number {
  const directOption = Number(record.option);
  if (Number.isFinite(directOption)) {
    return Math.max(1, Math.floor(directOption));
  }

  const titleId = String(record.title_id ?? record.titleId ?? "").trim();
  const parsedOption = titleId.match(/(\d+)/)?.[1];
  if (parsedOption && Number.isFinite(Number(parsedOption))) {
    return Math.max(1, Math.floor(Number(parsedOption)));
  }

  return fallbackIndex + 1;
}

function resolveRawEntries(value: unknown): unknown[] | null {
  const candidate =
    value && typeof value === "object" && "titleOptions" in (value as UnknownRecord)
      ? (value as UnknownRecord).titleOptions
      : value;
  if (Array.isArray(candidate)) {
    return candidate;
  }
  if (typeof candidate === "string") {
    const parsed = parseJsonLikeString(candidate);
    return Array.isArray(parsed) ? parsed : null;
  }
  return null;
}

function coerceStructuredEntry(
  value: unknown,
  index: number,
  preferredOption = index + 1
): UnknownRecord | null {
  if (typeof value === "string") {
    const parsed = parseJsonLikeString(value);
    if (parsed !== null) {
      return coerceStructuredEntry(parsed, index, preferredOption);
    }
    const title = value.trim();
    return title ? { option: preferredOption, title, title_ru: title } : null;
  }

  if (Array.isArray(value)) {
    const normalizedItems = value
      .map((item, nestedIndex) => coerceStructuredEntry(item, nestedIndex, preferredOption))
      .filter((item): item is UnknownRecord => item !== null);
    if (normalizedItems.length === 0) {
      return null;
    }
    return (
      normalizedItems.find((item) => getOptionFromRecord(item, index) === preferredOption) ??
      normalizedItems[index] ??
      normalizedItems[0] ??
      null
    );
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as UnknownRecord;
  const nestedPayloads = [
    typeof record.title === "string" ? parseJsonLikeString(record.title) : null,
    typeof record.titleRu === "string" ? parseJsonLikeString(record.titleRu) : null,
    typeof record.title_ru === "string" ? parseJsonLikeString(record.title_ru) : null
  ].filter((item): item is unknown => item !== null);

  const nested = nestedPayloads
    .map((item) => coerceStructuredEntry(item, index, getOptionFromRecord(record, index)))
    .find((item): item is UnknownRecord => item !== null);

  if (!nested) {
    return record;
  }

  const nestedTitle = typeof nested.title === "string" ? nested.title.trim() : "";
  const nestedTitleRu =
    typeof nested.titleRu === "string"
      ? nested.titleRu.trim()
      : typeof nested.title_ru === "string"
        ? nested.title_ru.trim()
        : "";
  const fallbackTitleRuSource = record.title_ru ?? record.titleRu ?? nestedTitle ?? record.title ?? "";
  const resolvedTitleRu = nestedTitleRu || String(fallbackTitleRuSource).trim();

  return {
    ...record,
    option: record.option ?? nested.option ?? preferredOption,
    title_id: record.title_id ?? nested.title_id,
    titleId: record.titleId ?? nested.titleId,
    title: nestedTitle || String(record.title ?? "").trim(),
    title_ru: resolvedTitleRu,
    titleRu: resolvedTitleRu
  };
}

export function normalizeStage2TitleOptionsValue(
  value: unknown
): NormalizedStage2TitleOption[] | null {
  const rawEntries = resolveRawEntries(value);
  if (!rawEntries) {
    return null;
  }

  const normalized = rawEntries
    .map((entry, index) => {
      const record = coerceStructuredEntry(entry, index);
      if (!record) {
        return null;
      }

      const title = String(record.title ?? "").trim();
      if (!title) {
        return null;
      }

      const titleRu = String(record.titleRu ?? record.title_ru ?? title).trim() || title;
      return {
        option: getOptionFromRecord(record, index),
        title,
        titleRu
      };
    })
    .filter((item): item is NormalizedStage2TitleOption => item !== null);

  return normalized.length > 0 ? normalized : null;
}

export function normalizeStage2ResultTitleOptions<T>(value: T): T {
  if (!value || typeof value !== "object") {
    return value;
  }

  const candidate = value as UnknownRecord;
  const output = candidate.output;
  if (!output || typeof output !== "object") {
    return value;
  }

  const normalized = normalizeStage2TitleOptionsValue((output as UnknownRecord).titleOptions);
  if (!normalized) {
    return value;
  }

  return {
    ...(candidate as object),
    output: {
      ...(output as object),
      titleOptions: normalized
    }
  } as T;
}
