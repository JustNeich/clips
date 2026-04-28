export type AdminFlowTextSource = {
  title?: string | null;
  sourceUrl?: string | null;
};

export type AdminFlowUrlDisplay = {
  href: string | null;
  host: string;
  path: string;
  label: string;
  original: string;
};

export function truncateMiddle(value: string, maxLength = 96): string {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  const tailLength = Math.max(16, Math.floor(maxLength * 0.32));
  const headLength = Math.max(12, maxLength - tailLength - 3);
  return `${normalized.slice(0, headLength)}...${normalized.slice(-tailLength)}`;
}

function parseHttpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function safeDecodePathname(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizePathLabel(parsed: URL): string {
  const path = safeDecodePathname(parsed.pathname)
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const search = parsed.search ? parsed.search : "";
  return truncateMiddle(`${path}${search}`, 92);
}

export function getAdminFlowUrlDisplay(value?: string | null): AdminFlowUrlDisplay {
  const original = value?.trim() ?? "";
  if (!original) {
    return {
      href: null,
      host: "Источник не указан",
      path: "",
      label: "Источник не указан",
      original
    };
  }

  const parsed = parseHttpUrl(original);
  if (!parsed) {
    const label = truncateMiddle(original, 92);
    return {
      href: null,
      host: label,
      path: "",
      label,
      original
    };
  }

  const pathLabel = normalizePathLabel(parsed);
  const label = pathLabel ? `${parsed.host} / ${pathLabel}` : parsed.host;
  return {
    href: parsed.toString(),
    host: parsed.host,
    path: pathLabel,
    label,
    original
  };
}

export function getAdminFlowDisplayTitle(flow: AdminFlowTextSource): string {
  const title = flow.title?.trim() ?? "";
  if (!title) {
    return "Источник без названия";
  }

  const titleAsUrl = getAdminFlowUrlDisplay(title);
  if (titleAsUrl.href) {
    return truncateMiddle(titleAsUrl.label, 112);
  }

  return title;
}

export function buildAdminFlowMcpHint(chatId: string): string {
  return `clips_get_flow({ "chatId": "${chatId}" })`;
}
