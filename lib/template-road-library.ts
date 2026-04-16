import type { ManagedTemplateSummary } from "./managed-template-types";

export type TemplateRoadUnavailableStatus = "archived" | "missing";

export type TemplateRoadUnavailableTemplate = {
  templateId: string;
  status: TemplateRoadUnavailableStatus;
};

export type TemplateRoadTemplateOption = {
  value: string;
  label: string;
  unavailable: boolean;
};

export function buildTemplateRoadTemplateOptions(params: {
  templates: ManagedTemplateSummary[];
  unavailableTemplate?: TemplateRoadUnavailableTemplate | null;
}): TemplateRoadTemplateOption[] {
  const options = params.templates.map((template) => ({
    value: template.id,
    label: template.name,
    unavailable: false
  }));
  const unavailableTemplateId = params.unavailableTemplate?.templateId?.trim() ?? "";
  if (!unavailableTemplateId || options.some((option) => option.value === unavailableTemplateId)) {
    return options;
  }
  return [
    {
      value: unavailableTemplateId,
      label: formatUnavailableTemplateOptionLabel(params.unavailableTemplate),
      unavailable: true
    },
    ...options
  ];
}

export function formatUnavailableTemplateOptionLabel(
  unavailableTemplate: TemplateRoadUnavailableTemplate | null | undefined
): string {
  if (!unavailableTemplate?.templateId?.trim()) {
    return "Недоступный шаблон";
  }
  const reason = unavailableTemplate.status === "archived" ? "архивирован" : "не найден";
  return `Недоступен (${reason}): ${unavailableTemplate.templateId}`;
}

export function describeUnavailableTemplate(
  unavailableTemplate: TemplateRoadUnavailableTemplate | null | undefined
): string {
  if (!unavailableTemplate?.templateId?.trim()) {
    return "Этот шаблон больше недоступен в библиотеке.";
  }
  if (unavailableTemplate.status === "archived") {
    return `Шаблон ${unavailableTemplate.templateId} уже архивирован. Выбери любой доступный workspace-шаблон ниже или создай новый.`;
  }
  return `Шаблон ${unavailableTemplate.templateId} не найден. Возможно, ссылка устарела или шаблон был удалён вне текущей библиотеки.`;
}
