export type PublicationMutationErrorCode =
  | "PUBLICATION_NOT_FOUND"
  | "PUBLICATION_UPLOAD_IN_PROGRESS"
  | "NOTIFY_SUBSCRIBERS_LOCKED"
  | "CUSTOM_TIME_REQUIRED"
  | "CUSTOM_TIME_IN_PAST"
  | "SLOT_SELECTION_REQUIRED"
  | "SLOT_OCCUPIED"
  | "TIME_OCCUPIED"
  | "SLOT_IN_PAST"
  | "INVALID_SLOT"
  | "INVALID_SLOT_DATE"
  | "PUBLICATION_MOVE_FORBIDDEN"
  | "PUBLICATION_ACTION_FORBIDDEN"
  | "UNKNOWN";

export type PublicationMutationErrorField =
  | "scheduledAtLocal"
  | "slot"
  | "notifySubscribers"
  | "title"
  | "description"
  | "tags";

export type PublicationMutationErrorPayload = {
  error: string;
  code: PublicationMutationErrorCode;
  field?: PublicationMutationErrorField;
};

type PublicationMutationErrorOptions = {
  code: PublicationMutationErrorCode;
  field?: PublicationMutationErrorField;
  status?: number;
};

export class PublicationMutationError extends Error {
  readonly code: PublicationMutationErrorCode;
  readonly field?: PublicationMutationErrorField;
  readonly status: number;

  constructor(message: string, options: PublicationMutationErrorOptions) {
    super(message);
    this.name = "PublicationMutationError";
    Object.setPrototypeOf(this, new.target.prototype);
    this.code = options.code;
    this.field = options.field;
    this.status = options.status ?? 400;
  }
}

export function isPublicationMutationError(error: unknown): error is PublicationMutationError {
  const candidate = error as { message?: unknown; code?: unknown } | null;
  return (
    error instanceof PublicationMutationError ||
    (candidate !== null &&
      typeof candidate === "object" &&
      typeof candidate.message === "string" &&
      typeof candidate.code === "string")
  );
}

export function toPublicationMutationErrorPayload(
  error: unknown,
  fallback: string
): {
  status: number;
  body: PublicationMutationErrorPayload;
} {
  if (isPublicationMutationError(error)) {
    return {
      status: error.status,
      body: {
        error: error.message || fallback,
        code: error.code,
        ...(error.field ? { field: error.field } : {})
      }
    };
  }

  const message = error instanceof Error ? error.message || fallback : fallback;
  const inferred = inferPublicationMutationFromMessage(message);

  return {
    status: 400,
    body: {
      error: message,
      code: inferred.code,
      ...(inferred.field ? { field: inferred.field } : {})
    }
  };
}

function inferPublicationMutationFromMessage(message: string): {
  code: PublicationMutationErrorCode;
  field?: PublicationMutationErrorField;
} {
  if (/публикац.*не найден/i.test(message)) {
    return { code: "PUBLICATION_NOT_FOUND" };
  }
  if (/только при первой загрузке видео/i.test(message)) {
    return { code: "NOTIFY_SUBSCRIBERS_LOCKED", field: "notifySubscribers" };
  }
  if (/для кастомной публикации укажите дату и время/i.test(message)) {
    return { code: "CUSTOM_TIME_REQUIRED", field: "scheduledAtLocal" };
  }
  if (/кастомное время уже в прошлом/i.test(message)) {
    return { code: "CUSTOM_TIME_IN_PAST", field: "scheduledAtLocal" };
  }
  if (/slotdate и slotindex/i.test(message)) {
    return { code: "SLOT_SELECTION_REQUIRED", field: "slot" };
  }
  if (/этот слот уже занят/i.test(message)) {
    return { code: "SLOT_OCCUPIED", field: "slot" };
  }
  if (/это время уже занято/i.test(message)) {
    return { code: "TIME_OCCUPIED", field: "slot" };
  }
  if (/уже прошедший слот/i.test(message)) {
    return { code: "SLOT_IN_PAST", field: "slot" };
  }
  if (/некорректная дата слота/i.test(message)) {
    return { code: "INVALID_SLOT_DATE", field: "slot" };
  }
  if (/некорректный слот/i.test(message)) {
    return { code: "INVALID_SLOT", field: "slot" };
  }
  if (/кастомное время не переносится/i.test(message)) {
    return { code: "PUBLICATION_MOVE_FORBIDDEN", field: "slot" };
  }
  if (/загружается в youtube/i.test(message)) {
    return { code: "PUBLICATION_UPLOAD_IN_PROGRESS" };
  }
  if (/больше нельзя|нельзя удалить из очереди/i.test(message)) {
    return { code: "PUBLICATION_ACTION_FORBIDDEN" };
  }
  return { code: "UNKNOWN" };
}
