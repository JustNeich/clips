const SECRET_KEY_PATTERNS = [
  /api[_-]?key/i,
  /authorization/i,
  /cookie/i,
  /session[_-]?token/i,
  /access[_-]?token/i,
  /refresh[_-]?token/i,
  /client[_-]?secret/i,
  /encrypted.*json/i,
  /lease[_-]?token/i,
  /token[_-]?hash/i,
  /^token$/i,
  /password/i,
  /secret/i
];

const SECRET_STRING_PATTERNS = [
  /^Bearer\s+[A-Za-z0-9._~+/=-]+$/i,
  /^Basic\s+[A-Za-z0-9._~+/=-]+$/i,
  /(?:access_token|refresh_token|api_key|client_secret)=([^&\s]+)/i
];

const SECRET_INLINE_STRING_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/g,
  /\bAIza[0-9A-Za-z_-]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g
];

export const REDACTED_VALUE = "[redacted]";

function shouldRedactKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

function redactSecretString(value: string): string {
  let next = value;
  for (const pattern of SECRET_STRING_PATTERNS) {
    next = next.replace(pattern, (match, captured?: string) => {
      if (captured) {
        return match.replace(captured, REDACTED_VALUE);
      }
      return REDACTED_VALUE;
    });
  }
  for (const pattern of SECRET_INLINE_STRING_PATTERNS) {
    next = next.replace(pattern, REDACTED_VALUE);
  }
  return next;
}

export function redactForFlowExport<T>(value: T): T {
  return redactUnknown(value, new WeakSet<object>()) as T;
}

function redactUnknown(value: unknown, activeStack: WeakSet<object>): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return redactSecretString(value);
  }
  if (typeof value !== "object") {
    return value;
  }
  if (activeStack.has(value)) {
    return "[circular]";
  }
  activeStack.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactUnknown(item, activeStack));
    }

    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      output[key] = shouldRedactKey(key) ? REDACTED_VALUE : redactUnknown(nested, activeStack);
    }
    return output;
  } finally {
    activeStack.delete(value);
  }
}
