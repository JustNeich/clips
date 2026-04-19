"use client";

import { useEffect, useMemo, useState } from "react";
import type { Stage3TemplateConfig } from "../../lib/stage3-template";
import { getTemplateById } from "../../lib/stage3-template";
import { isBuiltInTemplateId } from "../../lib/stage3-template-registry";
import {
  resolveTemplateTextFieldSemantics,
  type Stage3TemplateTextFieldSemantics
} from "../../lib/stage3-template-semantics";

const FALLBACK_TEMPLATE_CONFIG = getTemplateById("science-card-v1");

export function useResolvedTemplateTextSemantics(
  templateId: string | null | undefined
): Stage3TemplateTextFieldSemantics {
  const [templateConfig, setTemplateConfig] = useState<Stage3TemplateConfig>(
    isBuiltInTemplateId(templateId) ? getTemplateById(templateId ?? "science-card-v1") : FALLBACK_TEMPLATE_CONFIG
  );

  useEffect(() => {
    const candidate = templateId?.trim();
    if (!candidate) {
      setTemplateConfig(FALLBACK_TEMPLATE_CONFIG);
      return;
    }
    if (isBuiltInTemplateId(candidate)) {
      setTemplateConfig(getTemplateById(candidate));
      return;
    }

    let cancelled = false;
    void fetch(`/api/design/templates/${encodeURIComponent(candidate)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("template_load_failed");
        }
        return (await response.json()) as { template?: { templateConfig?: Stage3TemplateConfig } };
      })
      .then((payload) => {
        if (!cancelled && payload.template?.templateConfig) {
          setTemplateConfig(payload.template.templateConfig);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTemplateConfig(FALLBACK_TEMPLATE_CONFIG);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [templateId]);

  return useMemo(() => resolveTemplateTextFieldSemantics(templateConfig), [templateConfig]);
}
