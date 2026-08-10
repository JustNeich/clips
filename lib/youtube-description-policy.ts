const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/giu;
const EMPTY_SOURCE_LABEL_PATTERN =
  /^(?:source(?:\s+url)?|источник|ссылка(?:\s+на\s+источник)?)[\s:：\-–—]*$/iu;

export function sanitizeYoutubeDescription(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(URL_PATTERN, "").replace(/[ \t]+/g, " ").trim())
    .filter((line) => line && !EMPTY_SOURCE_LABEL_PATTERN.test(line))
    .join("\n")
    .trim();
}

export function youtubeDescriptionContainsLink(value: string): boolean {
  return /\b(?:https?:\/\/|www\.)/iu.test(value);
}
