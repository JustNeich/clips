export function buildTemplateRoadHref(templateId: string | null | undefined): string {
  const normalizedTemplateId = typeof templateId === "string" ? templateId.trim() : "";
  if (!normalizedTemplateId) {
    return "/design/template-road";
  }
  return `/design/template-road?template=${encodeURIComponent(normalizedTemplateId)}`;
}
